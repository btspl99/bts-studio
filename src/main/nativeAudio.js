'use strict';
/**
 * Pro audio — ASIO, WASAPI (exclusive), WDM-KS and MME devices with VST3 effects, through the native
 * helper bts-audio(.exe) (native/audio). One helper process per "Audio Device (Pro)" input and one per
 * pro audio output.
 *
 *  Inputs:  helper → 48 kHz stereo s16le on stdout → 'stream:audio' IPC (same path as stream / NDI inputs,
 *           played into the mixer by the bts-pcm worklet). JSON events on stderr → 'proaudio:event'.
 *  Outputs: renderer tap (s16 stereo) → 'proaudio:pcm' IPC → helper stdin → ASIO / WASAPI device.
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('electron-log/main');

let ctx = null;
const inputs = new Map();  // id -> state
const outputs = new Map(); // key -> state
let listCache = null;

function init(c) { ctx = c; }
function toRenderer(ch, ...a) { const w = ctx && ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, ...a); }

/** path of the helper, or null when this build has none (non-Windows, or not built) */
function bin() {
  if (process.env.BTS_AUDIO_BIN && fs.existsSync(process.env.BTS_AUDIO_BIN)) return process.env.BTS_AUDIO_BIN;
  const exe = process.platform === 'win32' ? 'bts-audio.exe' : 'bts-audio';
  const cands = [];
  if (ctx && ctx.isPackaged) cands.push(path.join(ctx.resourcesPath, 'native', 'audio', exe));
  cands.push(path.join(ctx ? ctx.root : process.cwd(), 'vendor', 'native', `${process.platform}-x64`, 'audio', exe));
  cands.push(path.join(ctx ? ctx.root : process.cwd(), 'native', 'audio', 'build', 'Release', exe), path.join(ctx ? ctx.root : process.cwd(), 'native', 'audio', 'build', exe));
  return cands.find(p => fs.existsSync(p)) || null;
}

function status() { const b = bin(); return { available: !!b, path: b, platform: process.platform }; }

function list(force) {
  const b = bin();
  if (!b) return Promise.resolve({ available: false, hostApis: [], devices: [] });
  if (listCache && !force && Date.now() - listCache.t < 5000) return Promise.resolve(listCache.v);
  return new Promise((resolve) => execFile(b, ['--list'], { windowsHide: true, timeout: 20000, maxBuffer: 4e6 }, (err, so) => {
    let v = { available: true, hostApis: [], devices: [], error: err ? err.message : null };
    try { v = { available: true, ...JSON.parse(String(so).trim().split('\n').pop()) }; } catch { /* keep error */ }
    listCache = { t: Date.now(), v };
    resolve(v);
  }));
}

function vstInfo(file) {
  const b = bin();
  if (!b) return Promise.resolve({ ok: false, error: 'The pro audio helper is not installed (Windows installer only)' });
  return new Promise((resolve) => execFile(b, ['--vst-info', file], { windowsHide: true, timeout: 30000, maxBuffer: 4e6 }, (err, so) => {
    try { resolve(JSON.parse(String(so).trim().split('\n').pop())); } catch { resolve({ ok: false, error: err ? err.message : 'Plug-in could not be loaded' }); }
  }));
}

/** VST3 plug-ins installed in the standard folders (Common Files\VST3, user VST3 folder, ~/.vst3 …) */
function scanVst() {
  const os = require('os');
  const dirs = process.platform === 'win32'
    ? [path.join(process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files', 'VST3'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Common', 'VST3')]
    : process.platform === 'darwin' ? ['/Library/Audio/Plug-Ins/VST3', path.join(os.homedir(), 'Library/Audio/Plug-Ins/VST3')]
      : ['/usr/lib/vst3', '/usr/local/lib/vst3', path.join(os.homedir(), '.vst3')];
  if (process.env.BTS_VST3_PATH) dirs.unshift(...process.env.BTS_VST3_PATH.split(path.delimiter));
  const found = [];
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (/\.vst3$/i.test(e.name)) found.push({ path: p, name: e.name.replace(/\.vst3$/i, '') });
      else if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      if (found.length > 500) return;
    }
  };
  for (const d of dirs) if (d) walk(d, 0);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function lineReader(stream, onLine) {
  let buf = '';
  stream.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); } });
}

/* ---------------- inputs ---------------- */
function startIn(id, cfg) {
  stopIn(id);
  const b = bin();
  if (!b) return { ok: false, error: 'Pro audio needs the BTS Studio Windows installer (bts-audio helper not found)' };
  const st = { id, cfg, want: true, proc: null, restarts: 0 };
  inputs.set(id, st);
  spawnIn(st);
  return { ok: true };
}

function spawnIn(st) {
  if (!st.want) return;
  const c = st.cfg, b = bin();
  const args = c.device === 'test' ? ['--test-tone'] : ['--in', String(c.device)];
  if (c.channels) args.push('--channels', String(c.channels));
  if (c.mono != null && c.mono !== '' && c.mono >= 0) args.push('--mono', String(c.mono)); else args.push('--pair', String(c.pair || 0));
  if (c.exclusive) args.push('--exclusive');
  for (const p of c.vst || []) if (p && p.path) args.push('--vst', p.path);
  log.info(`[proaudio ${st.id}] ${b} ${args.join(' ')}`);
  let proc;
  try { proc = spawn(b, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { toRenderer('stream:status', { id: st.id, state: 'error', message: e.message }); return; }
  st.proc = proc;
  st.vstIndex = 0;
  let pend = [], size = 0;
  proc.stdout.on('data', (d) => {
    pend.push(d); size += d.length;
    if (size >= 3840) { // ~20 ms
      const out = Buffer.concat(pend); pend = []; size = 0;
      const usable = out.length - (out.length % 4);
      toRenderer('stream:audio', st.id, out.subarray(0, usable));
      if (usable < out.length) { pend = [out.subarray(usable)]; size = pend[0].length; }
    }
  });
  lineReader(proc.stderr, (l) => {
    let ev; try { ev = JSON.parse(l); } catch { return; }
    if (ev.event === 'started') { st.restarts = 0; toRenderer('stream:status', { id: st.id, state: 'live', device: ev.device, latencyMs: ev.latencyMs, channels: ev.channels }); }
    if (ev.event === 'error') log.warn(`[proaudio ${st.id}] ${ev.message}`);
    toRenderer('proaudio:event', { id: st.id, ...ev });
  });
  proc.stdin.on('error', () => {});
  proc.on('exit', (code) => {
    if (st.proc !== proc) return;
    st.proc = null;
    if (!st.want) return;
    st.restarts++;
    const delay = Math.min(10000, 2000 * st.restarts);
    toRenderer('stream:status', { id: st.id, state: 'reconnecting', message: `Audio device stopped (${code}) — retrying` });
    setTimeout(() => spawnIn(st), delay);
  });
}

function control(id, msg) {
  const st = inputs.get(id);
  if (!st || !st.proc || !st.proc.stdin.writable) return false;
  st.proc.stdin.write(JSON.stringify(msg) + '\n');
  return true;
}

function stopIn(id) {
  const st = inputs.get(id);
  if (!st) return;
  st.want = false; inputs.delete(id);
  if (st.proc) { try { st.proc.stdin.write('{"cmd":"quit"}\n'); st.proc.stdin.end(); } catch { /* noop */ } const p = st.proc; setTimeout(() => { try { p.kill(); } catch { /* noop */ } }, 1500); }
}

/* ---------------- outputs ---------------- */
function startOut(key, cfg) {
  stopOut(key);
  const b = bin();
  if (!b) return { ok: false, error: 'Pro audio needs the BTS Studio Windows installer (bts-audio helper not found)' };
  const args = ['--out', String(cfg.device), '--pair', String(cfg.pair || 0)];
  if (cfg.exclusive) args.push('--exclusive');
  log.info(`[proaudio out ${key}] ${b} ${args.join(' ')}`);
  const st = { key, cfg, proc: null, started: false, error: '' };
  try { st.proc = spawn(b, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }); } catch (e) { return { ok: false, error: e.message }; }
  st.proc.stdin.on('error', () => {});
  lineReader(st.proc.stderr, (l) => { let ev; try { ev = JSON.parse(l); } catch { return; } if (ev.event === 'started') st.started = true; if (ev.event === 'error') st.error = ev.message; toRenderer('proaudio:event', { out: key, ...ev }); });
  st.proc.on('exit', () => { if (outputs.get(key) === st) { outputs.delete(key); toRenderer('proaudio:event', { out: key, event: 'stopped', message: st.error }); } });
  outputs.set(key, st);
  return { ok: true };
}
function pcm(key, data) {
  const st = outputs.get(key);
  if (!st || !st.proc || !st.proc.stdin.writable) return;
  if (st.proc.stdin.writableLength > 192000) return; // device not keeping up: drop rather than add delay
  st.proc.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}
function stopOut(key) {
  const st = outputs.get(key);
  if (!st) return;
  outputs.delete(key);
  try { st.proc.stdin.end(); } catch { /* noop */ }
  const p = st.proc; setTimeout(() => { try { p.kill(); } catch { /* noop */ } }, 1500);
}

function stopAll() { for (const id of [...inputs.keys()]) stopIn(id); for (const k of [...outputs.keys()]) stopOut(k); }

function registerIpc(ipcMain) {
  ipcMain.handle('proaudio:status', () => status());
  ipcMain.handle('proaudio:list', (e, force) => list(force));
  ipcMain.handle('proaudio:vst-info', (e, file) => vstInfo(file));
  ipcMain.handle('proaudio:scan', () => scanVst());
  ipcMain.handle('proaudio:in', (e, id, cfg) => startIn(id, cfg));
  ipcMain.handle('proaudio:in-stop', (e, id) => stopIn(id));
  ipcMain.handle('proaudio:control', (e, id, msg) => control(id, msg));
  ipcMain.handle('proaudio:out', (e, key, cfg) => startOut(key, cfg));
  ipcMain.handle('proaudio:out-stop', (e, key) => stopOut(key));
  ipcMain.handle('proaudio:outputs', () => [...outputs.values()].map(o => ({ key: o.key, started: o.started, error: o.error })));
  ipcMain.on('proaudio:pcm', (e, key, data) => { try { pcm(key, data); } catch (err) { log.warn('[proaudio] pcm', err.message); } });
}

module.exports = { init, registerIpc, stopAll, status, list };
