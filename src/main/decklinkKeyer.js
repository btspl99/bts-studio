'use strict';
/**
 * Blackmagic DeckLink key + fill — drives the native helper bts-decklink.exe (native/decklink), which plays
 * BGRA frames out with the card's hardware keyer: external keying puts the fill and the key on two connectors
 * (SDI A / SDI B) for a downstream vision mixer, internal keying keys over the card's own input.
 *
 * The renderer sends BGRA frames (straight alpha) of the mode's size; frames are dropped rather than queued
 * when the helper is behind. Stereo s16le 48 kHz audio goes to the helper's fd 3 when enabled.
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('electron-log/main');

let ctx = null;
const outs = new Map(); // id -> { proc, frameBytes, dropped, written, ready, cfg }

function init(c) { ctx = c; }
function toRenderer(ch, ...a) { const w = ctx && ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, ...a); }

function helperPath() {
  if (process.env.BTS_DECKLINK_BIN) return process.env.BTS_DECKLINK_BIN;
  const exe = process.platform === 'win32' ? 'bts-decklink.exe' : 'bts-decklink';
  const cands = [];
  if (ctx && ctx.isPackaged) cands.push(path.join(ctx.resourcesPath, 'native', 'decklink', exe));
  cands.push(path.join(ctx ? ctx.root : process.cwd(), 'vendor', 'native', 'win32-x64', 'decklink', exe));
  return cands.find(p => fs.existsSync(p)) || null;
}

/** split a helper path that may be "node script.js" (used by tests) into command + args */
function command(bin, args) {
  if (/\.js$/i.test(bin)) return [process.execPath, [bin, ...args], { ELECTRON_RUN_AS_NODE: '1' }];
  return [bin, args, {}];
}

function list() {
  const bin = helperPath();
  if (!bin) return Promise.resolve({ helper: false, driver: false, devices: [] });
  const [cmd, args, env] = command(bin, ['--list']);
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 15000, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
    try { resolve({ helper: true, ...JSON.parse(String(stdout).trim().split(/\r?\n/).pop()) }); }
    catch { resolve({ helper: true, driver: false, devices: [], error: (err && err.message) || String(stderr).slice(0, 300) }); }
  }));
}

const MODE_SIZE = { '1080': [1920, 1080], '720p': [1280, 720], '2160': [3840, 2160] };
function modeSize(mode) { return mode.startsWith('2160') ? MODE_SIZE['2160'] : mode.startsWith('720') ? MODE_SIZE['720p'] : MODE_SIZE['1080']; }

function start(id, cfg) {
  stop(id);
  const bin = helperPath();
  if (!bin) return { ok: false, error: 'The DeckLink keyer helper is not installed with this build of BTS Studio.' };
  const [w, h] = modeSize(cfg.mode || '1080p25');
  const args = ['--out', String(cfg.device ?? '0'), '--mode', cfg.mode || '1080p25', '--key', cfg.key || 'external', '--level', String(cfg.level ?? 255)];
  if (cfg.premultiply !== false) args.push('--premultiply');
  if (cfg.audio) args.push('--audio');
  const [cmd, cargs, env] = command(bin, args);
  log.info(`[decklink-key ${id}] ${cmd} ${cargs.join(' ')}`);
  let proc;
  try { proc = spawn(cmd, cargs, { windowsHide: true, env: { ...process.env, ...env }, stdio: ['pipe', 'ignore', 'pipe', cfg.audio ? 'pipe' : 'ignore'] }); }
  catch (e) { return { ok: false, error: e.message }; }
  const o = { proc, cfg, frameBytes: w * h * 4, w, h, dropped: 0, written: 0, ready: false, stats: {} };
  outs.set(id, o);
  proc.stdin.on('error', () => {});
  if (proc.stdio[3]) proc.stdio[3].on('error', () => {});
  let partial = '';
  proc.stderr.on('data', (d) => {
    partial += d.toString();
    const lines = partial.split(/\r?\n/); partial = lines.pop();
    for (const line of lines) {
      let m = null; try { m = JSON.parse(line); } catch { if (line.trim()) log.info(`[decklink-key ${id}] ${line}`); continue; }
      if (m.type === 'ready') { o.ready = true; o.w = m.width || o.w; o.h = m.height || o.h; o.frameBytes = o.w * o.h * 4; }
      if (m.type === 'stats') o.stats = m;
      if (m.type === 'error' || m.type === 'warn') log.warn(`[decklink-key ${id}] ${m.message}`);
      toRenderer('dlk:status', { id, ...m, dropped: o.dropped });
    }
  });
  proc.on('exit', (code) => {
    if (outs.get(id) === o) outs.delete(id);
    toRenderer('dlk:status', { id, type: 'exit', code });
  });
  proc.on('error', (e) => toRenderer('dlk:status', { id, type: 'error', message: e.message }));
  return { ok: true, width: w, height: h };
}

function frame(id, data) {
  const o = outs.get(id);
  if (!o || !o.proc.stdin.writable) return;
  if (data.byteLength !== o.frameBytes) { o.dropped++; return; }
  if (o.proc.stdin.writableLength > o.frameBytes * 2) { o.dropped++; return; } // helper behind: drop, never queue
  o.proc.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  o.written++;
}
function audio(id, data) {
  const o = outs.get(id);
  const s = o && o.proc.stdio[3];
  if (!s || !s.writable || s.writableLength > 192000) return;
  s.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

function stop(id) {
  const o = outs.get(id);
  if (!o) return;
  outs.delete(id);
  try { o.proc.stdin.end(); } catch { /* noop */ }
  try { if (o.proc.stdio[3]) o.proc.stdio[3].end(); } catch { /* noop */ }
  setTimeout(() => { try { if (o.proc.exitCode === null) o.proc.kill(); } catch { /* noop */ } }, 3000);
}
function stopAll() { for (const id of [...outs.keys()]) stop(id); }
function status() { return [...outs.entries()].map(([id, o]) => ({ id, ready: o.ready, written: o.written, dropped: o.dropped, ...o.stats })); }

function registerIpc(ipcMain) {
  ipcMain.handle('dlk:list', () => list());
  ipcMain.handle('dlk:start', (e, id, cfg) => start(id, cfg));
  ipcMain.handle('dlk:stop', (e, id) => stop(id));
  ipcMain.handle('dlk:status', () => status());
  ipcMain.on('dlk:frame', (e, id, data) => { try { frame(id, data); } catch (err) { log.warn('[decklink-key] frame', err.message); } });
  ipcMain.on('dlk:audio', (e, id, data) => { try { audio(id, data); } catch { /* noop */ } });
}

module.exports = { init, registerIpc, stopAll, list, helperPath };
