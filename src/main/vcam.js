'use strict';
/**
 * BTS Studio Virtual Camera — a DirectShow camera that Zoom, Teams, Google Meet (Chrome / Edge), OBS, Skype…
 * can pick like a webcam. The filter (bts-vcam.dll, built from softcam, MIT) is registered once with Windows
 * (needs administrator rights → one UAC prompt); afterwards this process creates the camera and sends frames
 * through shared memory. Frames are 24-bit BGR, top-down, width a multiple of 4 — the renderer packs them on
 * the GPU, so no per-pixel work happens here.
 */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const log = require('electron-log/main');

const CLSID = '{2549D071-66AE-4F28-8116-6ABFE429F663}';
let ctx = null;
let lib = null, api = null, loadError = null;
let cam = null, camInfo = null, frames = 0;

function init(c) { ctx = c; }

function dllPath() {
  const cands = [];
  if (ctx && ctx.isPackaged) cands.push(path.join(ctx.resourcesPath, 'native', 'vcam', 'bts-vcam.dll'));
  cands.push(path.join(ctx ? ctx.root : process.cwd(), 'vendor', 'native', 'win32-x64', 'vcam', 'bts-vcam.dll'));
  return cands.find(p => fs.existsSync(p)) || null;
}

/** why the camera cannot be used here, or null */
function unsupported() {
  if (process.platform !== 'win32') return 'The virtual camera is available on Windows only.';
  if (process.windowsStore) return 'The Microsoft Store version cannot install a virtual camera (Store apps may not register camera drivers). Install BTS Studio from studio.btspl.tech to use it.';
  if (!dllPath()) return 'The virtual camera component is missing from this installation — reinstall BTS Studio.';
  return null;
}

function run(cmd, args) {
  return new Promise(res => execFile(cmd, args, { windowsHide: true, timeout: 60000 }, (e, so, se) => res({ code: e ? (e.code ?? 1) : 0, out: String(so || '') + String(se || '') })));
}

async function registered() {
  if (process.platform !== 'win32') return false;
  // regsvr32 writes HKLM\SOFTWARE\Classes\CLSID\{…}\InprocServer32 (visible as HKCR)
  const r = await run('reg', ['query', `HKCR\\CLSID\\${CLSID}\\InprocServer32`, '/ve']);
  if (r.code !== 0) return false;
  const m = /REG_SZ\s+(.+)$/m.exec(r.out);
  return m ? m[1].trim() : true;
}

async function status() {
  const why = unsupported();
  const reg = why ? false : await registered();
  const dll = dllPath();
  return {
    supported: !why, reason: why, installed: !!reg,
    // registered from another copy (e.g. an older install folder) — reinstall to point Windows at this one
    stale: !!(reg && typeof reg === 'string' && dll && path.resolve(reg).toLowerCase() !== path.resolve(dll).toLowerCase()),
    running: !!cam, info: camInfo, frames, connected: cam && api ? safeConnected() : false
  };
}
function safeConnected() { try { return !!api.isConnected(cam); } catch { return false; } }

/** register / unregister the filter with an elevated regsvr32 (one UAC prompt) */
async function setInstalled(on) {
  const why = unsupported();
  if (why) return { ok: false, error: why };
  if (!on) stop();
  const dll = dllPath();
  const args = `${on ? '' : '/u '}/s "${dll}"`;
  const ps = `$p = Start-Process -FilePath "$env:SystemRoot\\System32\\regsvr32.exe" -ArgumentList '${args.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
  const now = !!(await registered());
  if (now !== on) {
    const cancelled = /canceled|cancelled|operation was canceled/i.test(r.out);
    log.warn('[vcam] regsvr32', r.code, r.out.trim());
    return { ok: false, error: cancelled ? 'Windows asked for permission and it was not given.' : `Windows did not ${on ? 'register' : 'remove'} the virtual camera (code ${r.code}).` };
  }
  log.info(`[vcam] ${on ? 'installed' : 'removed'} (${dll})`);
  return { ok: true };
}

function load() {
  if (api) return true;
  const why = unsupported();
  if (why) { loadError = why; return false; }
  try {
    const koffi = require('koffi');
    lib = koffi.load(dllPath());
    api = {
      create: lib.func('void *scCreateCamera(int width, int height, float framerate)'),
      del: lib.func('void scDeleteCamera(void *camera)'),
      send: lib.func('void scSendFrame(void *camera, const void *image_bits)'),
      isConnected: lib.func('bool scIsConnected(void *camera)')
    };
    return true;
  } catch (e) { loadError = e.message; api = null; log.warn('[vcam] load', e.message); return false; }
}

/** create the camera (width must be a multiple of 4); framerate 0 = frames are delivered as they arrive */
function start(width, height, fps) {
  stop();
  if (!load()) return { ok: false, error: loadError };
  width = Math.max(4, Math.round(width / 4) * 4); height = Math.max(2, Math.round(height / 2) * 2);
  try { cam = api.create(width, height, 0); } catch (e) { cam = null; return { ok: false, error: e.message }; }
  if (!cam) return { ok: false, error: 'The virtual camera is already in use by another program (only one sender at a time).' };
  camInfo = { width, height, fps: fps || 30 }; frames = 0;
  log.info(`[vcam] started ${width}x${height}@${fps}`);
  return { ok: true, width, height };
}

function frame(data) {
  if (!cam || !camInfo) return;
  const need = camInfo.width * camInfo.height * 3;
  if (!data || data.byteLength < need) return;
  try { api.send(cam, Buffer.from(data.buffer, data.byteOffset, need)); frames++; } catch (e) { log.warn('[vcam] send', e.message); }
}

function stop() {
  if (cam && api) { try { api.del(cam); } catch { /* noop */ } log.info('[vcam] stopped'); }
  cam = null; camInfo = null;
}

function registerIpc(ipcMain) {
  ipcMain.handle('vcam:status', () => status());
  ipcMain.handle('vcam:install', (e, on) => setInstalled(on !== false));
  ipcMain.handle('vcam:start', (e, w, h, fps) => start(w, h, fps));
  ipcMain.handle('vcam:stop', () => { stop(); return true; });
  ipcMain.on('vcam:frame', (e, data) => frame(data));
}

module.exports = { init, registerIpc, stop, status };
