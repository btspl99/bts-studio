'use strict';
/**
 * Network stream inputs — IP cameras (RTSP), SRT, RTMP, HLS/HTTP, UDP/MPEG-TS, NDI-to-RTSP bridges, or local files.
 * FFmpeg decodes the stream; video is served to the renderer as MJPEG on a private localhost port
 * (drawn like an <img>), audio is sent as 48 kHz stereo PCM over IPC into the mixer.
 */
const { spawn } = require('child_process');
const http = require('http');
const log = require('electron-log/main');

let ctx = null;
const streams = new Map(); // id -> state

function init(c) { ctx = c; }

function emit(id, payload) {
  const w = ctx.getWin();
  if (w && !w.isDestroyed()) w.webContents.send('stream:status', { id, ...payload });
}

function inputArgs(cfg) {
  const url = cfg.url.trim();
  const isFile = !/^[a-z]{2,}:/i.test(url) || /^file:/i.test(url);
  const a = ['-hide_banner', '-loglevel', 'warning', '-stats_period', '2'];
  // low-latency demuxing only for live network sources (breaks looping of local files)
  if (!isFile) a.push('-fflags', '+genpts+discardcorrupt' + (cfg.lowLatency !== false ? '+nobuffer' : ''), '-flags', 'low_delay');
  if (/^rtsps?:/i.test(url)) a.push('-rtsp_transport', cfg.transport || 'tcp', '-timeout', '8000000');
  else if (/^https?:/i.test(url) && !/\.(mp4|mov|mkv|webm)(\?|$)/i.test(url)) a.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  else if (isFile) a.push('-re', '-stream_loop', '-1'); // local file (testing / loops)
  if (/^rtmps?:/i.test(url) && cfg.listen) a.push('-listen', '1');
  a.push('-probesize', '4M', '-analyzeduration', '3000000', '-i', url.replace(/^file:\/\//, ''));
  return a;
}

function start(id, cfg) {
  stop(id);
  const st = { cfg, want: true, clients: new Set(), proc: null, server: null, port: 0, restarts: 0, frames: 0 };
  streams.set(id, st);
  st.server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace;boundary=btsframe',
      'Cache-Control': 'no-cache, no-store', 'Connection': 'close', 'Access-Control-Allow-Origin': '*'
    });
    const client = { res, synced: false };
    st.clients.add(client);
    req.on('close', () => st.clients.delete(client));
  });
  return new Promise((resolve) => {
    st.server.listen(0, '127.0.0.1', () => {
      st.port = st.server.address().port;
      spawnFF(id, st);
      resolve({ ok: true, port: st.port });
    });
    st.server.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

function spawnFF(id, st) {
  if (!st.want) return;
  const cfg = st.cfg;
  const w = Math.max(160, Math.min(3840, cfg.width || 1920));
  const fps = Math.max(1, Math.min(60, cfg.fps || 30));
  const args = [...inputArgs(cfg),
    '-map', '0:v:0?', '-vf', `scale='min(${w},iw)':-2:flags=bilinear,fps=${fps}`, '-c:v', 'mjpeg', '-q:v', String(cfg.quality || 4), '-f', 'mpjpeg', '-boundary_tag', 'btsframe', 'pipe:1'];
  if (cfg.audio !== false) args.push('-map', '0:a:0?', '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:3');
  const bin = require('./outputs').ffmpegPath();
  log.info(`[stream ${id}] ${bin} ${args.join(' ')}`);
  emit(id, { state: st.restarts ? 'reconnecting' : 'connecting', port: st.port });
  let proc;
  try { proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] }); } catch (e) { emit(id, { state: 'error', message: e.message }); return; }
  st.proc = proc;
  const MARK = Buffer.from('--btsframe');
  let live = false;
  proc.stdout.on('data', (buf) => {
    if (!live) { live = true; st.restarts = 0; emit(id, { state: 'live', port: st.port }); }
    for (const c of st.clients) {
      if (!c.synced) { const i = buf.indexOf(MARK); if (i < 0) continue; c.synced = true; c.res.write(buf.subarray(i)); }
      else c.res.write(buf);
    }
  });
  if (proc.stdio[3]) {
    let pend = [], size = 0;
    proc.stdio[3].on('data', (b) => {
      pend.push(b); size += b.length;
      if (size >= 7680) { // ~40 ms of 48k stereo s16
        const out = Buffer.concat(pend); pend = []; size = 0;
        const usable = out.length - (out.length % 4);
        const win = ctx.getWin();
        if (win && !win.isDestroyed()) win.webContents.send('stream:audio', id, out.subarray(0, usable));
      }
    });
    proc.stdio[3].on('error', () => {});
  }
  let tail = '';
  proc.stderr.on('data', (d) => { tail = (tail + d.toString()).slice(-600); });
  proc.on('exit', (code) => {
    if (st.proc !== proc) return;
    st.proc = null;
    for (const c of st.clients) c.synced = false;
    if (!st.want) return;
    st.restarts++;
    const delay = Math.min(10000, 1500 * st.restarts);
    log.warn(`[stream ${id}] exited ${code}: ${tail.split('\n').filter(Boolean).slice(-2).join(' | ')}`);
    emit(id, { state: 'reconnecting', message: tail.split('\n').filter(Boolean).slice(-1)[0] || `Stream ended (${code})`, retryIn: delay });
    setTimeout(() => spawnFF(id, st), delay);
  });
}

function stop(id) {
  const st = streams.get(id);
  if (!st) return;
  st.want = false;
  streams.delete(id);
  try { if (st.proc) st.proc.kill('SIGKILL'); } catch { /* noop */ }
  for (const c of st.clients) { try { c.res.end(); } catch { /* noop */ } }
  try { st.server.close(); } catch { /* noop */ }
}
function stopAll() { for (const id of [...streams.keys()]) stop(id); }

function registerIpc(ipcMain) {
  ipcMain.handle('stream:start', (e, id, cfg) => start(id, cfg));
  ipcMain.handle('stream:stop', (e, id) => stop(id));
}

module.exports = { init, registerIpc, stopAll };
