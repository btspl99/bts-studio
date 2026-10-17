'use strict';
/**
 * NDI® input and output, using the NDI runtime installed on this PC (NDI Tools or the free NDI Runtime).
 * BTS Studio does not ship the runtime; it loads Processing.NDI.Lib.x64.dll (Windows), libndi.so (Linux)
 * or libndi.dylib (macOS) at run time through koffi, so there is nothing to compile.
 *
 *  Receive: NDIlib_recv_capture_v3 runs on a worker thread (koffi async); video arrives as BGRX/BGRA and
 *           is passed to the renderer through a media pipe, audio is turned into 48 kHz stereo s16 for the
 *           mixer. Tally (program / preview) is sent back to the source.
 *  Send:    the renderer hands over program frames (BGRA) and mix-bus audio (s16 stereo); they are sent
 *           as an NDI source on the network, clocked to the frame rate.
 *
 * NDI® is a registered trademark of Vizrt NDI AB. https://ndi.video
 */
const path = require('path');
const fs = require('fs');
const log = require('electron-log/main');
const pipeServer = require('./pipeServer');

let ctx = null;
let lib = null, N = null, loadError = null;
let finder = null;
const receivers = new Map(); // id -> state
const senders = new Map();   // id -> state

function init(c) { ctx = c; }
function toRenderer(ch, ...a) { const w = ctx && ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, ...a); }

function candidates() {
  const out = [];
  const env = process.env;
  if (process.platform === 'win32') {
    for (const k of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5', 'NDI_RUNTIME_DIR_V4']) if (env[k]) out.push(path.join(env[k], 'Processing.NDI.Lib.x64.dll'));
    const pf = env.ProgramFiles || 'C:\\Program Files';
    out.push(path.join(pf, 'NDI', 'NDI 6 Runtime', 'v6', 'Processing.NDI.Lib.x64.dll'), path.join(pf, 'NDI', 'NDI 6 Tools', 'Runtime', 'Processing.NDI.Lib.x64.dll'),
      path.join(pf, 'NDI', 'NDI 5 Runtime', 'v5', 'Processing.NDI.Lib.x64.dll'), 'Processing.NDI.Lib.x64.dll');
  } else if (process.platform === 'darwin') {
    out.push('/Library/NDI SDK for Apple/lib/macOS/libndi.dylib', '/usr/local/lib/libndi.dylib', 'libndi.dylib');
  } else {
    if (env.NDI_RUNTIME_DIR_V6) out.push(path.join(env.NDI_RUNTIME_DIR_V6, 'libndi.so.6'));
    out.push('/usr/lib/libndi.so.6', '/usr/local/lib/libndi.so.6', '/usr/lib/x86_64-linux-gnu/libndi.so.6', 'libndi.so.6', 'libndi.so.5', 'libndi.so');
  }
  const custom = ctx && ctx.getSettings && (ctx.getSettings().ndi || {}).runtime;
  if (custom) out.unshift(custom);
  return out;
}

/** load the runtime once; returns true when NDI is usable */
function load() {
  if (lib) return true;
  if (loadError && Date.now() - loadError.at < 15000) return false;
  let koffi;
  try { koffi = require('koffi'); } catch (e) { loadError = { at: Date.now(), message: 'koffi missing: ' + e.message }; return false; }
  let handle = null, used = null;
  for (const p of candidates()) {
    if (path.isAbsolute(p) && !fs.existsSync(p)) continue;
    try { handle = koffi.load(p); used = p; break; } catch { /* next */ }
  }
  if (!handle) { loadError = { at: Date.now(), message: 'NDI runtime not found' }; return false; }
  try {
    const source = koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char *', p_url_address: 'const char *' });
    const findCreate = koffi.struct('NDIlib_find_create_t', { show_local_sources: 'bool', p_groups: 'const char *', p_extra_ips: 'const char *' });
    const recvCreate = koffi.struct('NDIlib_recv_create_v3_t', { source_to_connect_to: source, color_format: 'int', bandwidth: 'int', allow_video_fields: 'bool', p_ndi_recv_name: 'const char *' });
    const video = koffi.struct('NDIlib_video_frame_v2_t', { xres: 'int', yres: 'int', FourCC: 'uint32', frame_rate_N: 'int', frame_rate_D: 'int', picture_aspect_ratio: 'float', frame_format_type: 'int', timecode: 'int64', p_data: 'void *', line_stride_in_bytes: 'int', p_metadata: 'const char *', timestamp: 'int64' });
    const audio = koffi.struct('NDIlib_audio_frame_v3_t', { sample_rate: 'int', no_channels: 'int', no_samples: 'int', timecode: 'int64', FourCC: 'uint32', p_data: 'void *', channel_stride_in_bytes: 'int', p_metadata: 'const char *', timestamp: 'int64' });
    const meta = koffi.struct('NDIlib_metadata_frame_t', { length: 'int', timecode: 'int64', p_data: 'char *' });
    const tally = koffi.struct('NDIlib_tally_t', { on_program: 'bool', on_preview: 'bool' });
    const sendCreate = koffi.struct('NDIlib_send_create_t', { p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' });
    N = {
      koffi, video, audio, source,
      initialize: handle.func('bool NDIlib_initialize()'),
      version: handle.func('const char *NDIlib_version()'),
      find_create: handle.func('void *NDIlib_find_create_v2(const NDIlib_find_create_t *p)'),
      find_wait: handle.func('bool NDIlib_find_wait_for_sources(void *p, uint32 timeout)'),
      find_sources: handle.func('const NDIlib_source_t *NDIlib_find_get_current_sources(void *p, _Out_ uint32 *n)'),
      find_destroy: handle.func('void NDIlib_find_destroy(void *p)'),
      recv_create: handle.func('void *NDIlib_recv_create_v3(const NDIlib_recv_create_v3_t *p)'),
      recv_capture: handle.func('int NDIlib_recv_capture_v3(void *r, _Out_ NDIlib_video_frame_v2_t *v, _Out_ NDIlib_audio_frame_v3_t *a, _Out_ NDIlib_metadata_frame_t *m, uint32 timeout)'),
      recv_free_video: handle.func('void NDIlib_recv_free_video_v2(void *r, const NDIlib_video_frame_v2_t *v)'),
      recv_free_audio: handle.func('void NDIlib_recv_free_audio_v3(void *r, const NDIlib_audio_frame_v3_t *a)'),
      recv_free_meta: handle.func('void NDIlib_recv_free_metadata(void *r, const NDIlib_metadata_frame_t *m)'),
      recv_set_tally: handle.func('bool NDIlib_recv_set_tally(void *r, const NDIlib_tally_t *t)'),
      recv_destroy: handle.func('void NDIlib_recv_destroy(void *r)'),
      send_create: handle.func('void *NDIlib_send_create(const NDIlib_send_create_t *p)'),
      send_video: handle.func('void NDIlib_send_send_video_v2(void *s, const NDIlib_video_frame_v2_t *v)'),
      send_audio: handle.func('void NDIlib_send_send_audio_v3(void *s, const NDIlib_audio_frame_v3_t *a)'),
      send_connections: handle.func('int NDIlib_send_get_no_connections(void *s, uint32 timeout)'),
      send_destroy: handle.func('void NDIlib_send_destroy(void *s)'),
      _structs: { findCreate, recvCreate, meta, tally, sendCreate }
    };
    if (!N.initialize()) throw new Error('NDIlib_initialize failed (CPU without SSE4.2?)');
    lib = handle;
    log.info(`[ndi] loaded ${used} — ${N.version()}`);
    return true;
  } catch (e) {
    loadError = { at: Date.now(), message: e.message }; N = null;
    log.warn('[ndi] load failed', e.message);
    return false;
  }
}

const fourcc = (s) => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24) >>> 0;
const FCC = { BGRA: fourcc('BGRA'), BGRX: fourcc('BGRX'), RGBA: fourcc('RGBA'), RGBX: fourcc('RGBX'), UYVY: fourcc('UYVY'), FLTP: fourcc('FLTp') };

function status() {
  const ok = load();
  return { available: ok, version: ok ? N.version() : null, error: ok ? null : (loadError && loadError.message), receivers: receivers.size, senders: [...senders.values()].map(s => ({ id: s.id, name: s.name, connections: s.connections || 0 })) };
}

/** sources on the network: [{name, url}] */
async function sources(wait = 1500) {
  if (!load()) return { available: false, error: loadError && loadError.message, sources: [] };
  if (!finder) finder = N.find_create({ show_local_sources: true, p_groups: (ctx.getSettings().ndi || {}).groups || null, p_extra_ips: (ctx.getSettings().ndi || {}).extraIps || null });
  await new Promise((resolve) => N.find_wait.async(finder, wait, () => resolve()));
  const count = [0];
  const p = N.find_sources(finder, count);
  const list = [];
  if (p && count[0]) {
    const arr = N.koffi.decode(p, N.koffi.array(N.source, count[0]));
    for (const s of arr) list.push({ name: s.p_ndi_name, url: s.p_url_address });
  }
  return { available: true, sources: list };
}

/* ---------------- receive ---------------- */

async function startRecv(id, cfg) {
  stopRecv(id);
  if (!load()) return { ok: false, error: loadError ? (loadError.message === 'NDI runtime not found' ? 'NDI runtime not installed — install NDI Tools (free) from ndi.video' : loadError.message) : 'NDI unavailable' };
  const st = { id, cfg, want: true, recv: null, pipe: pipeServer.create(), port: 0, w: 0, h: 0, fmt: '', frames: 0, dropped: 0, audioFrames: 0, lastAt: 0, tally: { on_program: false, on_preview: false } };
  st.port = await st.pipe.listen();
  receivers.set(id, st);
  const bw = cfg.bandwidth === 'lowest' ? 0 : 100; // lowest = proxy stream for multiview
  st.recv = N.recv_create({ source_to_connect_to: { p_ndi_name: cfg.source, p_url_address: cfg.url || null }, color_format: 0 /* BGRX_BGRA */, bandwidth: bw, allow_video_fields: false, p_ndi_recv_name: 'BTS Studio' });
  if (!st.recv) { receivers.delete(id); st.pipe.close(); return { ok: false, error: 'Could not create the NDI receiver' }; }
  toRenderer('stream:status', { id, state: 'connecting', port: st.port, mode: 'raw' });
  loop(st);
  return { ok: true, port: st.port };
}

function loop(st) {
  if (!st.want) return;
  const v = {}, a = {}, m = {};
  N.recv_capture.async(st.recv, v, a, m, 200, (err, type) => {
    if (!st.want) { // stopped while waiting: release whatever arrived, then destroy
      try { if (type === 1) N.recv_free_video(st.recv, v); else if (type === 2) N.recv_free_audio(st.recv, a); else if (type === 3) N.recv_free_meta(st.recv, m); } catch { /* noop */ }
      try { N.recv_destroy(st.recv); } catch { /* noop */ }
      return;
    }
    try {
      if (err) throw err;
      if (type === 1) onVideo(st, v);
      else if (type === 2) onAudio(st, a);
      else if (type === 3) N.recv_free_meta(st.recv, m);
      else if (type === 0 && st.lastAt && Date.now() - st.lastAt > 3000 && !st.lost) { st.lost = true; toRenderer('stream:status', { id: st.id, state: 'reconnecting', message: 'No NDI video — source offline?' }); }
    } catch (e) { log.warn('[ndi] capture', e.message); }
    setImmediate(() => loop(st));
  });
}

function onVideo(st, v) {
  try {
    const w = v.xres, h = v.yres, stride = v.line_stride_in_bytes || w * 4;
    const fmt = v.FourCC === FCC.BGRA ? 'BGRA' : v.FourCC === FCC.BGRX ? 'BGRX' : v.FourCC === FCC.RGBA ? 'RGBA' : v.FourCC === FCC.RGBX ? 'RGBX' : null;
    if (!fmt || !v.p_data) { st.dropped++; return; }
    if (w !== st.w || h !== st.h || fmt !== st.fmt) {
      st.w = w; st.h = h; st.fmt = fmt;
      st.pipe.config({ kind: 'raw', format: fmt, width: w, height: h, fps: v.frame_rate_D ? v.frame_rate_N / v.frame_rate_D : 30 });
    }
    st.frames++;
    st.lastAt = Date.now();
    if (st.lost || st.frames === 1) { st.lost = false; toRenderer('stream:status', { id: st.id, state: 'live', port: st.port, mode: 'raw', width: w, height: h, fps: v.frame_rate_D ? Math.round(v.frame_rate_N / v.frame_rate_D * 100) / 100 : 0, format: fmt }); }
    if (!st.pipe.clients) return;
    const arr = N.koffi.decode(v.p_data, N.koffi.array('uint8', stride * h)); // copy out of NDI's buffer (Electron forbids external buffers)
    const src = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    let buf = src;
    if (stride !== w * 4) { buf = Buffer.allocUnsafe(w * 4 * h); for (let y = 0; y < h; y++) src.copy(buf, y * w * 4, y * stride, y * stride + w * 4); }
    st.pipe.raw(buf);
  } finally { N.recv_free_video(st.recv, v); }
}

function onAudio(st, a) {
  try {
    if (!st.cfg.audio && st.cfg.audio !== undefined) return;
    const n = a.no_samples, chs = a.no_channels, rate = a.sample_rate;
    if (!n || !a.p_data || a.FourCC !== FCC.FLTP) return;
    const strideF = (a.channel_stride_in_bytes || n * 4) / 4;
    const all = N.koffi.decode(a.p_data, N.koffi.array('float', strideF * chs));
    const pair = Math.max(0, Number(st.cfg.audioPair) || 0);
    const cl = Math.min(chs - 1, pair * 2), cr = Math.min(chs - 1, pair * 2 + 1);
    const L = all.subarray(cl * strideF, cl * strideF + n), R = all.subarray(cr * strideF, cr * strideF + n);
    const outN = rate === 48000 ? n : Math.round(n * 48000 / rate);
    const out = Buffer.allocUnsafe(outN * 4);
    for (let i = 0; i < outN; i++) {
      const si = rate === 48000 ? i : Math.min(n - 1, Math.floor(i * rate / 48000));
      const l = L[si], r = R[si];
      out.writeInt16LE(l >= 1 ? 32767 : l <= -1 ? -32768 : (l * 32767) | 0, i * 4);
      out.writeInt16LE(r >= 1 ? 32767 : r <= -1 ? -32768 : (r * 32767) | 0, i * 4 + 2);
    }
    st.audioFrames++;
    toRenderer('stream:audio', st.id, out);
  } finally { N.recv_free_audio(st.recv, a); }
}

function tally(id, program, preview) {
  const st = receivers.get(id);
  if (!st || !st.recv) return;
  st.tally = { on_program: !!program, on_preview: !!preview };
  try { N.recv_set_tally(st.recv, st.tally); } catch { /* noop */ }
}

function stopRecv(id) {
  const st = receivers.get(id);
  if (!st) return;
  st.want = false; // the capture loop destroys the receiver when its pending call returns
  receivers.delete(id);
  st.pipe.close();
}

/* ---------------- send ---------------- */

function startSend(id, cfg) {
  stopSend(id);
  if (!load()) return { ok: false, error: loadError ? (loadError.message === 'NDI runtime not found' ? 'NDI runtime not installed — install NDI Tools (free) from ndi.video' : loadError.message) : 'NDI unavailable' };
  const name = String(cfg.name || 'BTS Studio').slice(0, 60);
  const s = N.send_create({ p_ndi_name: name, p_groups: cfg.groups || null, clock_video: false, clock_audio: false });
  if (!s) return { ok: false, error: 'Could not create the NDI sender' };
  senders.set(id, { id, name, s, fps: cfg.fps || 30, frames: 0, busy: false, connections: 0, t: 0 });
  log.info(`[ndi] sending "${name}"`);
  return { ok: true, name };
}

function sendVideo(id, w, h, data, fmt) {
  const st = senders.get(id);
  if (!st) return;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  // koffi copies the struct; the pixel buffer must stay alive for the synchronous call (clock_video=false)
  N.send_video(st.s, { xres: w, yres: h, FourCC: FCC[fmt] || FCC.BGRX, frame_rate_N: Math.round(st.fps * 1000), frame_rate_D: 1000, picture_aspect_ratio: w / h, frame_format_type: 1, timecode: 0x7fffffffffffffffn, p_data: buf, line_stride_in_bytes: w * 4, p_metadata: null, timestamp: 0n });
  st.frames++;
  if (Date.now() - st.t > 2000) { st.t = Date.now(); try { st.connections = N.send_connections(st.s, 0); } catch { /* noop */ } }
}

function sendAudio(id, data) { // s16 interleaved stereo 48 kHz
  const st = senders.get(id);
  if (!st) return;
  const s16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength >> 1);
  const n = s16.length >> 1;
  const planar = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { planar[i] = s16[i * 2] / 32768; planar[n + i] = s16[i * 2 + 1] / 32768; }
  N.send_audio(st.s, { sample_rate: 48000, no_channels: 2, no_samples: n, timecode: 0x7fffffffffffffffn, FourCC: FCC.FLTP, p_data: Buffer.from(planar.buffer), channel_stride_in_bytes: n * 4, p_metadata: null, timestamp: 0n });
}

function stopSend(id) {
  const st = senders.get(id);
  if (!st) return;
  senders.delete(id);
  try { N.send_destroy(st.s); } catch { /* noop */ }
}

function stopAll() { for (const id of [...receivers.keys()]) stopRecv(id); for (const id of [...senders.keys()]) stopSend(id); if (finder && N) { try { N.find_destroy(finder); } catch { /* noop */ } finder = null; } }

function registerIpc(ipcMain) {
  ipcMain.handle('ndi:status', () => status());
  ipcMain.handle('ndi:sources', (e, wait) => sources(wait));
  ipcMain.handle('ndi:recv', (e, id, cfg) => startRecv(id, cfg));
  ipcMain.handle('ndi:recv-stop', (e, id) => stopRecv(id));
  ipcMain.on('ndi:tally', (e, id, pgm, pvw) => tally(id, pgm, pvw));
  ipcMain.handle('ndi:send', (e, id, cfg) => startSend(id, cfg));
  ipcMain.handle('ndi:send-stop', (e, id) => stopSend(id));
  ipcMain.on('ndi:video', (e, id, w, h, data, fmt) => { try { sendVideo(id, w, h, data, fmt); } catch (err) { log.warn('[ndi] send video', err.message); } });
  ipcMain.on('ndi:audio', (e, id, data) => { try { sendAudio(id, data); } catch (err) { log.warn('[ndi] send audio', err.message); } });
}

module.exports = { init, registerIpc, stopAll, status, sources };
