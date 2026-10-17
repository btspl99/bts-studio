'use strict';
/**
 * Output manager — every output (stream destination, programme recording, ISO recording) is an FFmpeg process.
 *
 * Engine v2 (default): the renderer encodes the programme ONCE per profile on the GPU (WebCodecs H.264) and sends
 * encoded packets plus lossless 48 kHz PCM audio. Each output subscribes to a session; this module wraps the packets
 * in FLV on stdin (video) and raw s16le on fd 3 (audio), starting every output on a keyframe with its own timeline.
 * FFmpeg then either copies the GPU stream (single generation, no quality loss) or transcodes it with
 * x264 / x265 / NVENC / Quick Sync / AMF from a near-lossless mezzanine.
 *
 * Classic engine: a MediaRecorder container stream per output (kept as a fallback).
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('electron-log/main');

let ctx = null;
const procs = new Map(); // id -> {proc, cfg, state, stopping, bytes, startedAt, lastStats}
let encoderCache = null;

function init(c) { ctx = c; }

function ffmpegPath() {
  if (process.env.BTS_FFMPEG) return process.env.BTS_FFMPEG;
  if (process.platform === 'win32') {
    if (ctx && ctx.isPackaged) return path.join(ctx.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
    const dev = path.join(ctx ? ctx.root : process.cwd(), 'vendor', 'ffmpeg', 'win32-x64', 'ffmpeg.exe');
    if (fs.existsSync(dev)) return dev;
  }
  if (ctx && ctx.isPackaged) {
    const bundled = path.join(ctx.resourcesPath, 'ffmpeg', 'ffmpeg');
    if (fs.existsSync(bundled)) return bundled;
  }
  return 'ffmpeg';
}

function emit(id, extra) {
  const p = procs.get(id);
  const win = ctx.getWin();
  const payload = { id, state: p ? p.state : 'stopped', ...(p ? p.lastStats : {}), dropped: p ? p.dropped : 0, ...extra };
  if (win && !win.isDestroyed()) win.webContents.send('output:status', payload);
}

function containerFor(url) {
  if (/^rtmps?:/i.test(url)) return 'flv';
  if (/^(srt|udp|rtp):/i.test(url)) return 'mpegts';
  if (/^rtsp:/i.test(url)) return 'rtsp';
  if (/\.m3u8($|\?)/i.test(url)) return 'hls';
  return 'flv';
}

function videoEncoderArgs(enc, { bitrate, fps, keyint, preset, crf, cbr }) {
  const g = Math.max(1, Math.round(fps * (keyint || 2)));
  const common = ['-g', String(g), '-keyint_min', String(g), '-pix_fmt', 'yuv420p'];
  const rate = cbr
    ? ['-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate * 2}k`]
    : null;
  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', ...(cbr ? ['-rc', 'cbr', ...rate] : ['-rc', 'vbr', '-cq', String(crf || 19), '-b:v', '0']), '-profile:v', 'high', '-bf', '2', ...common];
    case 'hevc_nvenc':
      return ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', ...(cbr ? ['-rc', 'cbr', ...rate] : ['-rc', 'vbr', '-cq', String(crf || 21), '-b:v', '0']), ...common];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'faster', ...(cbr ? rate : ['-global_quality', String(crf || 20)]), '-profile:v', 'high', ...common];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'balanced', ...(cbr ? ['-rc', 'cbr', ...rate] : ['-rc', 'cqp', '-qp_i', String(crf || 20), '-qp_p', String((crf || 20) + 2)]), ...common];
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', ...(rate || ['-b:v', `${bitrate}k`]), ...common];
    case 'av1_nvenc':
      return ['-c:v', 'av1_nvenc', '-preset', 'p5', ...(cbr ? ['-rc', 'cbr', ...rate] : ['-rc', 'vbr', '-cq', String(crf || 24), '-b:v', '0']), ...common];
    case 'hevc_qsv':
      return ['-c:v', 'hevc_qsv', '-preset', 'faster', ...(cbr ? rate : ['-global_quality', String(crf || 22)]), ...common];
    case 'hevc_amf':
      return ['-c:v', 'hevc_amf', '-quality', 'balanced', ...(cbr ? ['-rc', 'cbr', ...rate] : ['-rc', 'cqp', '-qp_i', String(crf || 22), '-qp_p', String((crf || 22) + 2)]), ...common];
    case 'hevc_videotoolbox':
      return ['-c:v', 'hevc_videotoolbox', ...(rate || ['-b:v', `${bitrate}k`]), ...common];
    case 'prores_ks': // editing intermediate: ProRes 422 HQ, 10-bit 4:2:2
      return ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'];
    case 'dnxhd': // editing intermediate: DNxHR HQ 4:2:2
      return ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p'];
    case 'libx265':
      return ['-c:v', 'libx265', '-preset', preset || 'fast', ...(cbr ? rate : ['-crf', String(crf || 22)]), ...common];
    case 'libx264':
    default:
      return ['-c:v', 'libx264', '-preset', preset || 'veryfast', ...(cbr ? [...rate, '-x264-params', 'nal-hrd=cbr:force-cfr=1'] : ['-crf', String(crf || 18)]), '-profile:v', 'high', '-sc_threshold', '0', ...common];
  }
}

function buildArgs(cfg) {
  const s = ctx.getSettings();
  const fps = cfg.fps || s.video.fps;
  const audioOnly = !!cfg.audioOnly;
  const input = cfg.v2
    ? ['-hide_banner', '-loglevel', 'info', '-stats_period', '1', '-thread_queue_size', '4096', '-probesize', '32', '-analyzeduration', '0', '-f', 'flv', '-i', 'pipe:0',
      '-thread_queue_size', '4096', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:3']
    : ['-hide_banner', '-loglevel', 'info', '-stats_period', '1', '-fflags', '+genpts+discardcorrupt', '-thread_queue_size', '2048', '-probesize', '1M', '-analyzeduration', '1500000', '-i', 'pipe:0'];
  const map = cfg.v2 ? ['-map', '0:v:0', '-map', '1:a:0'] : ['-map', '0:v?', '-map', '0:a?'];

  if (cfg.kind === 'stream') {
    const st = s.stream;
    const url = cfg.url;
    const fmt = containerFor(url);
    const v = audioOnly ? ['-vn'] : cfg.videoCopy ? ['-c:v', 'copy']
      : ['-fps_mode', 'cfr', '-r', String(fps), ...videoEncoderArgs(cfg.encoder || st.encoder, { bitrate: cfg.videoBitrate || st.videoBitrate, fps, keyint: st.keyint, preset: st.preset, cbr: true }), ...scaleArgs(cfg)];
    const a = ['-c:a', 'aac', '-b:a', `${cfg.audioBitrate || st.audioBitrate}k`, '-ar', '48000', '-ac', '2'];
    const out = fmt === 'flv' ? ['-flvflags', 'no_duration_filesize', '-f', 'flv', url]
      : fmt === 'mpegts' ? ['-f', 'mpegts', url]
        : fmt === 'rtsp' ? ['-f', 'rtsp', '-rtsp_transport', 'tcp', url]
          : ['-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_flags', 'delete_segments', url];
    return [...input, ...map, ...v, ...a, ...out];
  }

  // record / iso
  const r = s.record;
  const file = cfg.file;
  const ext = path.extname(file).slice(1).toLowerCase();
  const canCopy = cfg.videoCopy || (cfg.passthrough && !audioOnly && (cfg.inputCodec === 'h264' || ext === 'mkv' || ext === 'webm'));
  const q = cfg.quality || r.quality;
  const crf = q === 'lossless-ish' ? 14 : q === 'high' ? 18 : q === 'medium' ? 22 : 26;
  const v = audioOnly ? ['-vn']
    : canCopy ? ['-c:v', 'copy']
      : ['-fps_mode', 'cfr', '-r', String(fps), ...videoEncoderArgs(cfg.encoder || r.encoder, { bitrate: cfg.videoBitrate || r.videoBitrate, fps, keyint: 2, preset: cfg.preset || 'veryfast', crf, cbr: false }), ...scaleArgs(cfg)];
  const pcm = cfg.audioCodec === 'pcm' && ['mov', 'mkv', 'wav'].includes(ext);
  const a = pcm ? ['-c:a', 'pcm_s24le'] : ext === 'webm' ? ['-c:a', 'libopus', '-b:a', '192k'] : ext === 'wav' ? ['-c:a', 'pcm_s16le'] : ext === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '320k'] : ['-c:a', 'aac', '-b:a', `${cfg.audioBitrate || 320}k`, '-ar', '48000'];
  // fragmented MP4 survives a crash or power cut; it is still a normal MP4 for editors and players
  const extra = ext === 'mp4' || ext === 'mov' ? ['-movflags', cfg.v2 && !pcm ? '+frag_keyframe+empty_moov+default_base_moof' : '+faststart'] : [];
  return [...input, ...map, ...v, ...a, ...extra, '-y', file];
}

function scaleArgs(cfg) {
  if (!cfg.scaleTo) return [];
  const [w, h] = cfg.scaleTo;
  return ['-vf', `scale=${w}:${h}:flags=lanczos`];
}

function parseStats(line, p) {
  const m = /frame=\s*(\d+).*?fps=\s*([\d.]+).*?time=\s*([\d:.\-]+).*?bitrate=\s*([\d.]+|N\/A)\s*kbits\/s.*?speed=\s*([\d.]+|N\/A)x?/.exec(line);
  const ma = !m && /size=\s*(\S+)\s+time=\s*([\d:.\-]+).*?bitrate=\s*([\d.]+|N\/A)/.exec(line);
  if (m) {
    p.lastStats = { frames: +m[1], fps: +m[2], time: m[3], kbps: m[4] === 'N/A' ? 0 : +m[4], speed: m[5] === 'N/A' ? 0 : +m[5], buffered: p.buffered };
    return true;
  }
  if (ma) { p.lastStats = { time: ma[2], kbps: ma[3] === 'N/A' ? 0 : +ma[3], speed: 1, buffered: p.buffered }; return true; }
  return false;
}

function start(id, cfg) {
  if (procs.has(id)) stop(id, true);
  if (cfg.kind !== 'stream') fs.mkdirSync(path.dirname(cfg.file), { recursive: true });
  const args = buildArgs(cfg);
  const bin = ffmpegPath();
  log.info(`[output ${id}] ${bin} ${args.map(a => (cfg.key && a.includes(cfg.key) ? a.replace(cfg.key, '****') : a)).join(' ')}`);
  let proc;
  try {
    proc = spawn(bin, args, { windowsHide: true, stdio: cfg.v2 ? ['pipe', 'ignore', 'pipe', 'pipe'] : ['pipe', 'ignore', 'pipe'] });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const p = { proc, cfg, state: 'starting', stopping: false, bytes: 0, buffered: 0, startedAt: Date.now(), lastStats: {}, tail: [], dropped: 0 };
  procs.set(id, p);

  proc.stdin.on('error', (err) => { if (!p.stopping) log.warn(`[output ${id}] stdin error`, err.message); });
  if (cfg.v2) {
    p.audio = proc.stdio[3];
    p.audio.on('error', (err) => { if (!p.stopping) log.warn(`[output ${id}] audio pipe error`, err.message); });
    attach(id, p, cfg.session);
  }
  let partial = '';
  proc.stderr.on('data', (d) => {
    partial += d.toString();
    const lines = partial.split(/\r|\n/);
    partial = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      if (parseStats(line, p)) {
        if (p.state === 'starting' || p.state === 'reconnecting') p.state = 'live';
        emit(id);
      } else {
        p.tail.push(line); if (p.tail.length > 40) p.tail.shift();
        if (/error|failed|invalid|refused|denied|not found/i.test(line)) log.warn(`[output ${id}] ${line}`);
      }
    }
  });
  proc.on('error', (err) => {
    log.error(`[output ${id}] spawn error`, err);
    p.state = 'error';
    emit(id, { message: err.code === 'ENOENT' ? 'FFmpeg was not found. Reinstall BTS Studio or set the FFmpeg path.' : err.message });
  });
  proc.on('exit', (code, signal) => {
    const wasStopping = p.stopping;
    if (procs.get(id) === p) procs.delete(id);
    detach(id, p);
    log.info(`[output ${id}] exited code=${code} signal=${signal}`);
    if (wasStopping) { emit(id, { state: 'stopped', file: cfg.file }); return; }
    const msg = p.tail.slice(-4).join(' | ');
    const s = ctx.getSettings();
    if (cfg.kind === 'stream' && s.stream.autoReconnect) {
      emit(id, { state: 'reconnecting', message: msg });
    } else {
      emit(id, { state: 'error', message: msg || `FFmpeg exited (${code})`, file: cfg.file });
    }
  });
  emit(id);
  return { ok: true, file: cfg.file || null };
}

function write(id, buf) {
  const p = procs.get(id);
  if (!p || p.stopping || !p.proc.stdin.writable) return;
  const b = Buffer.from(buf);
  p.bytes += b.length;
  p.buffered += b.length;
  p.proc.stdin.write(b, () => { p.buffered -= b.length; });
}

function stop(id, immediate) {
  const p = procs.get(id);
  if (!p) return false;
  p.stopping = true;
  p.state = 'stopping';
  emit(id);
  detach(id, p);
  try { p.proc.stdin.end(); } catch { /* noop */ }
  try { if (p.audio) p.audio.end(); } catch { /* noop */ }
  const killAfter = immediate ? 1500 : 15000;
  setTimeout(() => { try { if (p.proc.exitCode === null) p.proc.kill('SIGKILL'); } catch { /* noop */ } }, killAfter);
  return true;
}

/* ---------------- Engine v2: shared encode sessions -> FLV video + PCM audio per output ---------------- */
const sessions = new Map(); // sid -> { avcC, consumers: Map<id, p> }
function session(sid) { let s = sessions.get(sid); if (!s) { s = { avcC: null, consumers: new Map() }; sessions.set(sid, s); } return s; }
function attach(id, p, sid) {
  const s = session(sid);
  p.v2 = { sid, started: false, basePts: 0, nextSample: 0, wantKey: true };
  s.consumers.set(id, p);
  const win = ctx.getWin();
  if (win && !win.isDestroyed()) win.webContents.send('enc:need-key', sid);
}
function detach(id, p) {
  if (!p.v2) return;
  const s = sessions.get(p.v2.sid);
  if (s && s.consumers.get(id) === p) { s.consumers.delete(id); }
}

const u24 = (b, o, v) => { b[o] = (v >>> 16) & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = v & 255; };
function flvTag(type, ts, payload) {
  const n = payload.length;
  const b = Buffer.allocUnsafe(11 + n + 4);
  b[0] = type; u24(b, 1, n); u24(b, 4, ts & 0xffffff); b[7] = (ts >>> 24) & 255; u24(b, 8, 0);
  payload.copy(b, 11);
  b.writeUInt32BE(11 + n, 11 + n);
  return b;
}
const FLV_HEADER = Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x01, 0, 0, 0, 9, 0, 0, 0, 0]); // video-only FLV (audio travels as PCM)
function avcSeqTag(avcC) { return flvTag(9, 0, Buffer.concat([Buffer.from([0x17, 0, 0, 0, 0]), avcC])); }
function avcFrameTag(ts, key, data) { return flvTag(9, ts, Buffer.concat([Buffer.from([key ? 0x17 : 0x27, 1, 0, 0, 0]), data])); }

function pipeWrite(p, stream, buf, counts) {
  if (!stream || !stream.writable) return;
  if (counts) { p.bytes += buf.length; p.buffered += buf.length; stream.write(buf, () => { p.buffered -= buf.length; }); } else stream.write(buf);
}

function onConfig(sid, avcC) {
  const s = session(sid);
  s.avcC = Buffer.from(avcC);
  // a new encoder configuration (resolution change, encoder restart): every output re-syncs on the next keyframe
  for (const p of s.consumers.values()) if (p.v2.started) { p.v2.resync = true; }
}

function onVideo(sid, pts, key, data) {
  const s = sessions.get(sid);
  if (!s || !s.avcC) return;
  const buf = Buffer.from(data);
  for (const p of s.consumers.values()) {
    if (p.stopping) continue;
    const c = p.v2;
    const limit = p.cfg.kind === 'stream' ? 24e6 : 256e6;
    if (!c.started) {
      if (!key) continue;
      c.started = true; c.basePts = pts; c.nextSample = Math.round(pts * 48);
      pipeWrite(p, p.proc.stdin, FLV_HEADER, true);
      pipeWrite(p, p.proc.stdin, avcSeqTag(s.avcC), true);
    } else if (c.resync && key) { c.resync = false; pipeWrite(p, p.proc.stdin, avcSeqTag(s.avcC), true); }
    // back-pressure: a slow network or disk drops whole GOPs instead of building an ever-growing queue
    if (c.dropping) { if (!key || p.buffered > limit / 4) { p.dropped++; continue; } c.dropping = false; }
    if (p.buffered > limit) { c.dropping = true; p.dropped++; log.warn(`[output] ${p.cfg.name || p.cfg.kind}: output is behind (${Math.round(p.buffered / 1e6)} MB queued) — dropping frames until the next keyframe`); continue; }
    pipeWrite(p, p.proc.stdin, avcFrameTag(Math.max(0, Math.round(pts - c.basePts)), key, buf), true);
  }
}

const SILENCE = Buffer.alloc(48000 * 4 * 2);
function onAudio(sid, sample, data) {
  const s = sessions.get(sid);
  if (!s) return;
  const buf = Buffer.from(data);
  const frames = buf.length >> 2; // s16 stereo
  for (const p of s.consumers.values()) {
    const c = p.v2;
    if (p.stopping || !c.started || !p.audio) continue;
    let start = sample, off = 0;
    if (start + frames <= c.nextSample) continue; // entirely before this output's start
    if (start < c.nextSample) { off = (c.nextSample - start) * 4; start = c.nextSample; }
    if (start > c.nextSample) { // gap (e.g. audio glitch): fill with silence to keep lip-sync
      let gap = Math.min(start - c.nextSample, 96000) * 4;
      while (gap > 0) { const n = Math.min(gap, SILENCE.length); pipeWrite(p, p.audio, SILENCE.subarray(0, n), false); gap -= n; }
    }
    pipeWrite(p, p.audio, off ? buf.subarray(off) : buf, false);
    c.nextSample = sample + frames;
  }
}

function stopAll() { for (const id of [...procs.keys()]) stop(id, true); }
function anyActive() { return [...procs.values()].some(p => !p.stopping); }

function probeEncoders() {
  if (encoderCache) return encoderCache;
  const bin = ffmpegPath();
  const candidates = ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_amf', 'hevc_amf', 'h264_videotoolbox', 'hevc_videotoolbox', 'prores_ks', 'dnxhd'];
  encoderCache = new Promise((resolve) => {
    execFile(bin, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 15000 }, async (err, stdout) => {
      if (err) return resolve({ ffmpeg: false, list: [], error: err.message });
      const compiled = candidates.filter(c => new RegExp(`\\s${c}\\s`).test(stdout));
      const ok = [];
      for (const c of compiled) {
        if (c.startsWith('lib') || c === 'prores_ks' || c === 'dnxhd') { ok.push(c); continue; }
        // hardware encoders: verify a GPU is actually present
        const works = await new Promise(res => execFile(bin, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30', '-frames:v', '3', '-c:v', c, '-f', 'null', '-'],
          { windowsHide: true, timeout: 8000 }, (e) => res(!e)));
        if (works) ok.push(c);
      }
      resolve({ ffmpeg: true, list: ok });
    });
  });
  return encoderCache;
}

function ffmpegVersion() {
  return new Promise(res => execFile(ffmpegPath(), ['-version'], { windowsHide: true, timeout: 8000 }, (e, out) => res(e ? null : out.split('\n')[0])));
}

function registerIpc(ipcMain) {
  ipcMain.handle('output:start', (e, id, cfg) => start(id, cfg));
  ipcMain.on('output:chunk', (e, id, buf) => write(id, buf));
  ipcMain.on('enc:config', (e, sid, avcC) => onConfig(sid, avcC));
  ipcMain.on('enc:video', (e, sid, pts, key, data) => onVideo(sid, pts, key, data));
  ipcMain.on('enc:audio', (e, sid, sample, data) => onAudio(sid, sample, data));
  ipcMain.handle('enc:sessions', () => [...sessions.entries()].map(([sid, s]) => ({ sid, consumers: [...s.consumers.keys()] })));
  ipcMain.handle('output:stop', (e, id) => stop(id, false));
  ipcMain.handle('output:encoders', () => probeEncoders());
  ipcMain.handle('output:ffmpeg-version', () => ffmpegVersion());
  ipcMain.handle('output:list', () => [...procs.entries()].map(([id, p]) => ({ id, state: p.state, kind: p.cfg.kind, dropped: p.dropped, buffered: p.buffered, ...p.lastStats })));
}

module.exports = { init, registerIpc, start, stop, stopAll, anyActive, ffmpegPath, buildArgs };
