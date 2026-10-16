'use strict';
/**
 * Output manager — each output (stream destination, programme recording, ISO recording)
 * receives a media container stream (WebM/MP4 from MediaRecorder) from the renderer over IPC
 * and pipes it into its own FFmpeg process which encodes/remuxes to RTMP(S)/SRT/UDP or a file.
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
  const payload = { id, state: p ? p.state : 'stopped', ...(p ? p.lastStats : {}), ...extra };
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
  const input = ['-hide_banner', '-loglevel', 'info', '-stats_period', '1', '-fflags', '+genpts+discardcorrupt', '-thread_queue_size', '2048', '-probesize', '1M', '-analyzeduration', '1500000', '-i', 'pipe:0'];
  const audioOnly = !!cfg.audioOnly;

  if (cfg.kind === 'stream') {
    const st = s.stream;
    const url = cfg.url;
    const fmt = containerFor(url);
    const v = audioOnly ? ['-vn'] : ['-fps_mode', 'cfr', '-r', String(fps), ...videoEncoderArgs(cfg.encoder || st.encoder, { bitrate: cfg.videoBitrate || st.videoBitrate, fps, keyint: st.keyint, preset: st.preset, cbr: true })];
    const a = ['-c:a', 'aac', '-b:a', `${cfg.audioBitrate || st.audioBitrate}k`, '-ar', '48000', '-ac', '2'];
    const out = fmt === 'flv' ? ['-flvflags', 'no_duration_filesize', '-f', 'flv', url]
      : fmt === 'mpegts' ? ['-f', 'mpegts', url]
        : fmt === 'rtsp' ? ['-f', 'rtsp', '-rtsp_transport', 'tcp', url]
          : ['-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_flags', 'delete_segments', url];
    return [...input, '-map', '0:v?', '-map', '0:a?', ...v, ...a, ...out];
  }

  // record / iso
  const r = s.record;
  const file = cfg.file;
  const ext = path.extname(file).slice(1).toLowerCase();
  const canCopy = cfg.passthrough && !audioOnly && (cfg.inputCodec === 'h264' || ext === 'mkv' || ext === 'webm');
  const q = cfg.quality || r.quality;
  const crf = q === 'lossless-ish' ? 14 : q === 'high' ? 18 : q === 'medium' ? 22 : 26;
  const v = audioOnly ? ['-vn']
    : canCopy ? ['-c:v', 'copy']
      : ['-fps_mode', 'cfr', '-r', String(fps), ...videoEncoderArgs(cfg.encoder || r.encoder, { bitrate: r.videoBitrate, fps, keyint: 2, preset: 'veryfast', crf, cbr: false })];
  const a = ext === 'webm' ? ['-c:a', 'libopus', '-b:a', '192k'] : ext === 'wav' ? ['-c:a', 'pcm_s16le'] : ext === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '320k'] : ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000'];
  const extra = ext === 'mp4' || ext === 'mov' ? ['-movflags', '+faststart'] : [];
  return [...input, '-map', '0:v?', '-map', '0:a?', ...v, ...a, ...extra, '-y', file];
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
    proc = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const p = { proc, cfg, state: 'starting', stopping: false, bytes: 0, buffered: 0, startedAt: Date.now(), lastStats: {}, tail: [] };
  procs.set(id, p);

  proc.stdin.on('error', (err) => { if (!p.stopping) log.warn(`[output ${id}] stdin error`, err.message); });
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
  try { p.proc.stdin.end(); } catch { /* noop */ }
  const killAfter = immediate ? 1500 : 15000;
  setTimeout(() => { try { if (p.proc.exitCode === null) p.proc.kill('SIGKILL'); } catch { /* noop */ } }, killAfter);
  return true;
}

function stopAll() { for (const id of [...procs.keys()]) stop(id, true); }
function anyActive() { return [...procs.values()].some(p => !p.stopping); }

function probeEncoders() {
  if (encoderCache) return encoderCache;
  const bin = ffmpegPath();
  const candidates = ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox'];
  encoderCache = new Promise((resolve) => {
    execFile(bin, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 15000 }, async (err, stdout) => {
      if (err) return resolve({ ffmpeg: false, list: [], error: err.message });
      const compiled = candidates.filter(c => new RegExp(`\\s${c}\\s`).test(stdout));
      const ok = [];
      for (const c of compiled) {
        if (c.startsWith('lib')) { ok.push(c); continue; }
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
  ipcMain.handle('output:stop', (e, id) => stop(id, false));
  ipcMain.handle('output:encoders', () => probeEncoders());
  ipcMain.handle('output:ffmpeg-version', () => ffmpegVersion());
  ipcMain.handle('output:list', () => [...procs.entries()].map(([id, p]) => ({ id, state: p.state, kind: p.cfg.kind, ...p.lastStats })));
}

module.exports = { init, registerIpc, start, stop, stopAll, anyActive, ffmpegPath, buildArgs };
