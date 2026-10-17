'use strict';
/**
 * FFmpeg-fed inputs.
 *
 *  - Network streams (RTSP, SRT, RTMP, HLS/HTTP, UDP/MPEG-TS, files). H.264 — and HEVC where the GPU can
 *    decode it — is passed through untouched (no re-compression) and decoded in the renderer with WebCodecs
 *    on the GPU. Other codecs fall back to an MJPEG preview.
 *  - Native capture (DirectShow / Blackmagic DeckLink / V4L2 / AVFoundation / test signal). FFmpeg opens
 *    the device with the exact input port, pixel format, resolution and frame rate, and sends raw NV12
 *    frames; embedded audio can carry 2, 8 or 16 channels and any pair is routed to the mixer.
 *
 * Video reaches the renderer through a private localhost pipe (see pipeServer.js); audio as 48 kHz stereo
 * s16 PCM over IPC into the mixer.
 */
const { spawn, execFile } = require('child_process');
const http = require('http');
const log = require('electron-log/main');
const pipeServer = require('./pipeServer');

let ctx = null;
const streams = new Map(); // id -> state

function init(c) { ctx = c; }
function outputs() { return require('./outputs'); }

function emit(id, payload) {
  const w = ctx.getWin();
  if (w && !w.isDestroyed()) w.webContents.send('stream:status', { id, ...payload });
}
function sendAudio(id, buf) {
  const w = ctx.getWin();
  if (w && !w.isDestroyed()) w.webContents.send('stream:audio', id, buf);
}

/* ---------------- arguments ---------------- */

function urlInputArgs(cfg) {
  const url = cfg.url.trim();
  const isFile = !/^[a-z]{2,}:/i.test(url) || /^file:/i.test(url);
  const a = ['-hide_banner', '-nostats', '-loglevel', 'info'];
  if (!isFile) a.push('-fflags', '+genpts+discardcorrupt' + (cfg.lowLatency !== false ? '+nobuffer' : ''), '-flags', 'low_delay');
  if (/^rtsps?:/i.test(url)) a.push('-rtsp_transport', cfg.transport || 'tcp', '-timeout', '8000000');
  else if (/^https?:/i.test(url) && !/\.(mp4|mov|mkv|webm)(\?|$)/i.test(url)) a.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  else if (isFile) a.push('-re', '-stream_loop', '-1');
  if (/^rtmps?:/i.test(url) && cfg.listen) a.push('-listen', '1');
  a.push('-probesize', '4M', '-analyzeduration', '3000000', '-i', url.replace(/^file:\/\//, ''));
  return a;
}

const evenUp = (n) => Math.max(2, Math.round(n / 2) * 2);

/** device input arguments for native capture */
function captureInputArgs(cfg) {
  const a = ['-hide_banner', '-nostats', '-loglevel', 'info'];
  const fps = cfg.fps ? String(cfg.fps) : null;
  const size = cfg.width && cfg.height ? `${cfg.width}x${cfg.height}` : null;
  const audioCh = Number(cfg.audioChannels) || 2;
  switch (cfg.backend) {
    case 'decklink': {
      if (cfg.formatCode) a.push('-format_code', cfg.formatCode);
      if (cfg.port) a.push('-video_input', cfg.port);
      if (cfg.audio !== false) a.push('-audio_input', cfg.audioPort || 'embedded', '-channels', String(audioCh));
      a.push('-raw_format', cfg.devFormat && cfg.devFormat !== 'auto' ? cfg.devFormat : 'uyvy422');
      a.push('-f', 'decklink', '-i', cfg.device);
      break;
    }
    case 'v4l2': {
      if (size) a.push('-video_size', size);
      if (fps) a.push('-framerate', fps);
      if (cfg.devFormat && cfg.devFormat !== 'auto') a.push('-input_format', cfg.devFormat);
      a.push('-thread_queue_size', '512', '-f', 'v4l2', '-i', cfg.device);
      if (cfg.audio !== false && cfg.audioDevice) a.push('-thread_queue_size', '512', '-f', 'alsa', '-channels', String(audioCh), '-i', cfg.audioDevice);
      break;
    }
    case 'avfoundation': {
      if (size) a.push('-video_size', size);
      if (fps) a.push('-framerate', fps);
      if (cfg.devFormat && cfg.devFormat !== 'auto') a.push('-pixel_format', cfg.devFormat);
      a.push('-f', 'avfoundation', '-i', `${cfg.device}:${cfg.audio !== false && cfg.audioDevice ? cfg.audioDevice : 'none'}`);
      break;
    }
    case 'test': { // built-in signal for checking the pipeline without hardware
      const s = size || '1920x1080', r = fps || '30';
      a.push('-re', '-f', 'lavfi', '-i', `testsrc2=size=${s}:rate=${r}`);
      if (cfg.audio !== false) {
        const tones = Array.from({ length: audioCh }, (_, i) => `sine=frequency=${220 * (i + 1)}:sample_rate=48000`);
        a.push('-f', 'lavfi', '-i', `${tones.map((t, i) => `${t}[s${i}]`).join(';')};${tones.map((_, i) => `[s${i}]`).join('')}amerge=inputs=${audioCh}`);
      }
      break;
    }
    default: { // dshow (Windows)
      a.push('-rtbufsize', '512M');
      if (size) a.push('-video_size', size);
      if (fps) a.push('-framerate', fps);
      if (cfg.devFormat && cfg.devFormat !== 'auto') {
        if (/^(mjpeg|h264)$/.test(cfg.devFormat)) a.push('-vcodec', cfg.devFormat); else a.push('-pixel_format', cfg.devFormat);
      }
      if (cfg.port !== undefined && cfg.port !== '' && cfg.port !== null) a.push('-crossbar_video_input_pin_number', String(cfg.port));
      if (cfg.audioPort !== undefined && cfg.audioPort !== '' && cfg.audioPort !== null) a.push('-crossbar_audio_input_pin_number', String(cfg.audioPort));
      if (cfg.audio !== false && cfg.audioDevice) a.push('-sample_rate', '48000', '-channels', String(audioCh));
      let spec = `video=${cfg.device}`;
      if (cfg.audio !== false && cfg.audioDevice) spec += `:audio=${cfg.audioDevice}`;
      a.push('-f', 'dshow', '-i', spec);
    }
  }
  return a;
}

/** audio output: chosen channel pair → stereo s16 48 kHz on pipe 3 */
function audioOutArgs(cfg, inputCount) {
  const pair = Math.max(0, Number(cfg.audioPair) || 0);
  const l = pair * 2, r = pair * 2 + 1;
  const map = inputCount > 1 ? '1:a:0?' : '0:a:0?'; // separate audio input (ALSA, test tones) comes second
  const af = [];
  if ((Number(cfg.audioChannels) || 2) > 2 || pair > 0) af.push(`pan=stereo|c0=c${l}|c1=c${r}`);
  af.push('aresample=48000:async=1');
  return ['-map', map, '-af', af.join(','), '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:3'];
}

function videoFilters(cfg, w, h) {
  const vf = [];
  if (cfg.deinterlace) vf.push('bwdif=mode=send_frame:parity=auto:deint=interlaced');
  vf.push(`scale=${w}:${h}:flags=bicubic`, 'format=nv12');
  return vf.join(',');
}

/* ---------------- lifecycle ---------------- */

async function start(id, cfg) {
  stop(id);
  const st = { cfg, want: true, proc: null, restarts: 0, codec: null, mode: null, pipe: null, mjpeg: null, port: 0, mjpegPort: 0, stats: { frames: 0, dropped: 0 } };
  streams.set(id, st);
  try {
    st.pipe = pipeServer.create();
    st.port = await st.pipe.listen();
    if (cfg.kind !== 'capture') { st.mjpeg = mjpegServer(st); st.mjpegPort = await st.mjpeg.listen(); }
  } catch (e) { return { ok: false, error: e.message }; }
  if (cfg.kind === 'capture') st.mode = 'raw';
  else st.mode = cfg.decode === 'mjpeg' ? 'mjpeg' : 'probe';
  spawnFF(id, st);
  return { ok: true, port: st.port, mjpegPort: st.mjpegPort };
}

/** legacy multipart-MJPEG endpoint (codecs the GPU decoder can't take) */
function mjpegServer(st) {
  const clients = new Set();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace;boundary=btsframe', 'Cache-Control': 'no-cache, no-store', 'Connection': 'close', 'Access-Control-Allow-Origin': '*' });
    const c = { res, synced: false };
    clients.add(c);
    req.on('close', () => clients.delete(c));
  });
  return {
    clients,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); }),
    close() { for (const c of clients) { try { c.res.end(); } catch { /* noop */ } } try { server.close(); } catch { /* noop */ } }
  };
}

function spawnFF(id, st) {
  if (!st.want) return;
  const cfg = st.cfg;
  let args, bin = outputs().ffmpegPath();
  const audio = cfg.audio !== false;
  if (cfg.kind === 'capture') {
    if (cfg.backend === 'decklink') bin = decklinkBin();
    const w = evenUp(cfg.outWidth || cfg.width || 1920), h = evenUp(cfg.outHeight || cfg.height || 1080);
    st.frameSize = w * h * 3 / 2; st.w = w; st.h = h;
    args = captureInputArgs(cfg);
    const nIn = args.filter(a => a === '-i').length;
    args.push('-map', '0:v:0', '-vf', videoFilters(cfg, w, h));
    if (cfg.fps) args.push('-fps_mode', 'cfr', '-r', String(cfg.fps));
    args.push('-f', 'rawvideo', '-pix_fmt', 'nv12', 'pipe:1');
    const embedded = cfg.backend === 'decklink' || cfg.backend === 'test';
    if (audio && (embedded || cfg.audioDevice)) args.push(...audioOutArgs(cfg, nIn));
    st.pipe.config({ kind: 'raw', format: 'NV12', width: w, height: h, fps: cfg.fps || 30 });
  } else {
    args = urlInputArgs(cfg);
    if (st.mode === 'mjpeg') {
      const w = Math.max(160, Math.min(3840, cfg.width || 1920));
      const fps = Math.max(1, Math.min(60, cfg.fps || 30));
      args.push('-map', '0:v:0?', '-vf', `scale='min(${w},iw)':-2:flags=bilinear,fps=${fps}`, '-c:v', 'mjpeg', '-q:v', String(cfg.quality || 4), '-f', 'mpjpeg', '-boundary_tag', 'btsframe', 'pipe:1');
    } else {
      const codec = st.codec === 'hevc' ? 'hevc' : 'h264';
      args.push('-map', '0:v:0?', '-c:v', 'copy', '-bsf:v', `${codec}_mp4toannexb,${codec}_metadata=aud=insert`, '-f', codec, 'pipe:1');
      st.parser = new pipeServer.AnnexBParser(codec, (au, key) => { st.stats.frames++; st.pipe.au(au, key); },
        (codecString) => st.pipe.config({ kind: 'au', codec: codecString, family: codec }));
    }
    if (audio) args.push('-map', '0:a:0?', '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:3');
  }
  log.info(`[stream ${id}] ${bin} ${args.join(' ')}`);
  emit(id, { state: st.restarts ? 'reconnecting' : 'connecting', port: st.port, mjpegPort: st.mjpegPort, mode: st.mode === 'probe' ? 'gpu' : st.mode });
  let proc;
  try { proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] }); } catch (e) { emit(id, { state: 'error', message: e.message }); return; }
  st.proc = proc;
  let live = false;
  const goLive = () => { if (live) return; live = true; st.restarts = 0; emit(id, { state: 'live', port: st.port, mjpegPort: st.mjpegPort, mode: st.mode === 'probe' ? 'gpu' : st.mode, codec: st.codec, width: st.w, height: st.h }); };

  if (st.mode === 'mjpeg') {
    const MARK = Buffer.from('--btsframe');
    proc.stdout.on('data', (buf) => {
      goLive();
      for (const c of st.mjpeg.clients) {
        if (!c.synced) { const i = buf.indexOf(MARK); if (i < 0) continue; c.synced = true; c.res.write(buf.subarray(i)); } else c.res.write(buf);
      }
    });
  } else if (st.mode === 'raw') {
    let pend = [], have = 0;
    proc.stdout.on('data', (b) => {
      goLive();
      pend.push(b); have += b.length;
      while (have >= st.frameSize) {
        const all = pend.length === 1 ? pend[0] : Buffer.concat(pend);
        st.pipe.raw(all.subarray(0, st.frameSize)); st.stats.frames++;
        const rest = all.subarray(st.frameSize);
        pend = rest.length ? [Buffer.from(rest)] : []; have = rest.length;
      }
    });
  } else {
    proc.stdout.on('data', (b) => { goLive(); st.parser.push(b); });
  }
  if (proc.stdio[3]) {
    let pend = [], size = 0;
    proc.stdio[3].on('data', (b) => {
      pend.push(b); size += b.length;
      if (size >= 7680) {
        const out = Buffer.concat(pend); pend = []; size = 0;
        const usable = out.length - (out.length % 4);
        sendAudio(id, out.subarray(0, usable));
      }
    });
    proc.stdio[3].on('error', () => {});
  }
  let tail = '', head = '';
  proc.stderr.on('data', (d) => {
    const s = d.toString();
    tail = (tail + s).slice(-1200);
    if (head.length < 8000) head += s;
    if (st.mode === 'probe' && !st.codec) {
      const m = /Stream #\d+:\d+[^:]*: Video: (\w+)/.exec(head);
      if (m) {
        const c = m[1].toLowerCase();
        const ok = c === 'h264' || (c === 'hevc' && cfg.hevc);
        st.codec = c;
        if (!ok) { // can't pass this codec through: preview it as MJPEG instead
          log.info(`[stream ${id}] codec ${c} → MJPEG preview`);
          st.mode = 'mjpeg'; st.switching = true;
          try { proc.kill('SIGKILL'); } catch { /* noop */ }
        } else if (c === 'hevc') { st.switching = true; try { proc.kill('SIGKILL'); } catch { /* noop */ } } else st.mode = 'gpu';
      }
    }
  });
  proc.on('exit', (code) => {
    if (st.proc !== proc) return;
    st.proc = null;
    if (st.mjpeg) for (const c of st.mjpeg.clients) c.synced = false;
    if (!st.want) return;
    if (st.switching) { st.switching = false; if (st.mode === 'probe') st.mode = 'gpu'; spawnFF(id, st); return; }
    st.restarts++;
    const delay = Math.min(10000, 1500 * st.restarts);
    const last = tail.split(/\r?\n/).filter(l => l.trim() && !/^\s*(Stream|Input|Output|Metadata|Duration|encoder|handler|Press)/.test(l)).slice(-2);
    log.warn(`[stream ${id}] exited ${code}: ${last.join(' | ')}`);
    emit(id, { state: 'reconnecting', message: friendlyError(last.join(' ')) || `Stream ended (${code})`, retryIn: delay });
    setTimeout(() => spawnFF(id, st), delay);
  });
}

function friendlyError(s) {
  if (!s) return '';
  if (/Could not find video device|Could not enumerate|I\/O error/i.test(s)) return 'Device not found or busy — close other apps using it (OBS, vMix, the card\'s own software).';
  if (/Could not set video options|Could not set .*format/i.test(s)) return 'The device does not accept this resolution / frame rate / format. Try Auto or another mode.';
  if (/crossbar/i.test(s)) return 'This device has no input port with that number.';
  if (/No signal|Cannot Autodetect input stream|Format detection/i.test(s)) return 'No signal on the input.';
  if (/Connection refused|timed out|Connection timed out/i.test(s)) return 'Cannot reach the stream (connection refused / timed out).';
  return s.replace(/^\[[^\]]+\]\s*/, '').slice(0, 160);
}

function stop(id) {
  const st = streams.get(id);
  if (!st) return;
  st.want = false;
  streams.delete(id);
  try { if (st.proc) st.proc.kill('SIGKILL'); } catch { /* noop */ }
  if (st.pipe) st.pipe.close();
  if (st.mjpeg) st.mjpeg.close();
}
function stopAll() { for (const id of [...streams.keys()]) stop(id); }

function stats() {
  const out = {};
  for (const [id, st] of streams) out[id] = { mode: st.mode, codec: st.codec, frames: st.stats.frames, pipeDropped: st.pipe ? st.pipe.stats.dropped : 0, restarts: st.restarts, live: !!st.proc };
  return out;
}

/* ---------------- device discovery ---------------- */

function decklinkBin() {
  const s = ctx.getSettings ? ctx.getSettings() : {};
  const custom = s.decklink && s.decklink.ffmpeg;
  return custom && require('fs').existsSync(custom) ? custom : outputs().ffmpegPath();
}
function run(bin, args, timeout = 12000) {
  return new Promise(res => execFile(bin, args, { windowsHide: true, timeout, maxBuffer: 4e6 }, (e, so, se) => res(String(so || '') + String(se || ''))));
}

/** [{name, kind:'video'|'audio'}] for the backend */
async function listDevices(backend) {
  const bin = backend === 'decklink' ? decklinkBin() : outputs().ffmpegPath();
  const devices = [];
  if (backend === 'decklink') {
    let out = await run(bin, ['-hide_banner', '-sources', 'decklink']);
    out += '\n' + await run(bin, ['-hide_banner', '-f', 'decklink', '-list_devices', '1', '-i', 'dummy']);
    const names = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s+\*?\s*(.+?)\s+\[(.+)\]\s*$/.exec(line); if (m && !/Auto-detected/.test(line)) names.add(m[2].trim() || m[1].trim());
      const q = /\[decklink @ [^\]]+\]\s+'([^']+)'/.exec(line); if (q) names.add(q[1].trim());
    }
    for (const n of names) if (n.length < 80) devices.push({ name: n, kind: 'video' });
    const noSupport = /Unknown input format|format 'decklink' is not known/i.test(out);
    return { devices, error: devices.length ? null : noSupport ? 'nosupport' : 'none', ffmpeg: bin };
  }
  if (backend === 'v4l2') {
    const fs = require('fs');
    try { for (const f of fs.readdirSync('/dev').filter(f => /^video\d+$/.test(f)).sort()) devices.push({ name: '/dev/' + f, kind: 'video' }); } catch { /* noop */ }
    return { devices, error: devices.length ? null : 'none' };
  }
  if (backend === 'avfoundation') {
    const out = await run(bin, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
    let kind = 'video';
    for (const line of out.split(/\r?\n/)) {
      if (/video devices/i.test(line)) kind = 'video'; else if (/audio devices/i.test(line)) kind = 'audio';
      const m = /\]\s*\[(\d+)\]\s*(.+)$/.exec(line); if (m) devices.push({ name: m[1], label: m[2].trim(), kind });
    }
    return { devices, error: devices.length ? null : 'none' };
  }
  if (backend === 'test') return { devices: [{ name: 'Test signal', kind: 'video' }], error: null };
  // dshow
  const out = await run(bin, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  let kind = 'video';
  for (const line of out.split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) { kind = 'video'; continue; }
    if (/DirectShow audio devices/i.test(line)) { kind = 'audio'; continue; }
    const m = /\]\s+"([^"]+)"\s*(\((video|audio|none)\))?/.exec(line);
    if (m && !/Alternative name/i.test(line)) devices.push({ name: m[1], kind: m[3] === 'audio' ? 'audio' : m[3] === 'video' ? 'video' : kind });
  }
  const noSupport = /Unknown input format: 'dshow'/i.test(out);
  return { devices, error: devices.length ? null : noSupport ? 'nosupport' : 'none' };
}

/** modes the device offers: [{format, width, height, fps}] and, for DeckLink, format codes */
async function listModes(backend, device) {
  const modes = [];
  if (backend === 'decklink') {
    const out = await run(decklinkBin(), ['-hide_banner', '-f', 'decklink', '-list_formats', '1', '-i', device]);
    for (const line of out.split(/\r?\n/)) {
      const m = /\]\s+(\w{2,4})\s+(\d+)x(\d+) at (\d+)\/(\d+) fps(?:\s*\((\w+)\))?/.exec(line);
      if (m) modes.push({ code: m[1], width: +m[2], height: +m[3], fps: Math.round(+m[4] / +m[5] * 100) / 100, interlaced: /interlaced/i.test(m[6] || '') });
    }
    return { modes };
  }
  if (backend === 'dshow') {
    const out = await run(outputs().ffmpegPath(), ['-hide_banner', '-list_options', 'true', '-f', 'dshow', '-i', `video=${device}`]);
    for (const line of out.split(/\r?\n/)) {
      const m = /(pixel_format|vcodec)=(\w+)\s+min s=(\d+)x(\d+) fps=([\d.]+)\s+max s=(\d+)x(\d+) fps=([\d.]+)/.exec(line);
      if (m) modes.push({ format: m[2], width: +m[6], height: +m[7], fps: Math.round(+m[8] * 100) / 100, minFps: +m[5] });
    }
    const seen = new Set();
    const uniq = modes.filter(m => { const k = `${m.format}${m.width}${m.height}${m.fps}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const crossbar = /crossbar/i.test(out);
    return { modes: uniq, crossbar };
  }
  return { modes };
}

function registerIpc(ipcMain) {
  ipcMain.handle('stream:start', (e, id, cfg) => start(id, cfg));
  ipcMain.handle('stream:stop', (e, id) => stop(id));
  ipcMain.handle('stream:stats', () => stats());
  ipcMain.handle('capture:devices', (e, backend) => listDevices(backend));
  ipcMain.handle('capture:modes', (e, backend, device) => listModes(backend, device));
}

module.exports = { init, registerIpc, stopAll, stats, start, stop, captureInputArgs, audioOutArgs };
