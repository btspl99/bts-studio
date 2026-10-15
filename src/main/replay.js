'use strict';
/**
 * Instant Replay — each replay camera is encoded by FFmpeg into a rolling buffer of short MPEG-TS
 * segments (keyframe every 0.5 s). Clips are cut from the buffer on demand (last N seconds or
 * Mark In → Mark Out) and saved as MP4 for slow-motion playback in a Replay input.
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('electron-log/main');

let ctx = null;
const bufs = new Map(); // id -> state
const SEG = 1; // seconds per segment (shorter = replays available sooner)

function init(c) { ctx = c; }

function start(id, cfg) {
  stop(id);
  const seconds = Math.max(20, Math.min(600, cfg.seconds || 120));
  const dir = path.join(os.tmpdir(), 'bts-studio-replay', id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.ceil(seconds / SEG) + 2;
  const fps = cfg.fps || 30;
  const enc = cfg.encoder && cfg.encoder !== 'libx264'
    ? (cfg.encoder.includes('nvenc') ? ['-c:v', 'h264_nvenc', '-preset', 'p3', '-rc', 'vbr', '-cq', '21'] : cfg.encoder.includes('qsv') ? ['-c:v', 'h264_qsv', '-global_quality', '22'] : ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22'])
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21'];
  const args = ['-hide_banner', '-loglevel', 'warning', '-fflags', '+genpts+discardcorrupt', '-probesize', '1M', '-analyzeduration', '1000000', '-i', 'pipe:0',
    '-map', '0:v?', '-map', '0:a?', '-vf', `scale=-2:'min(${cfg.height || 1080},ih)'`, '-fps_mode', 'cfr', '-r', String(fps), ...enc,
    '-g', String(Math.max(1, Math.round(fps / 2))), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-f', 'segment', '-segment_time', String(SEG), '-segment_wrap', String(n), '-segment_list', path.join(dir, 'list.csv'), '-segment_list_type', 'csv',
    '-segment_list_size', String(n - 1), '-segment_format', 'mpegts', path.join(dir, 'seg%04d.ts')];
  const proc = spawn(require('./outputs').ffmpegPath(), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const st = { proc, dir, seconds, startWall: Date.now(), firstWrite: 0, tail: '' };
  proc.stdin.on('error', () => {});
  proc.stderr.on('data', d => { st.tail = (st.tail + d).slice(-500); });
  proc.on('exit', (code) => { log.info(`[replay ${id}] exit ${code} ${st.tail.slice(-200)}`); if (bufs.get(id) === st) st.dead = true; });
  bufs.set(id, st);
  return { ok: true };
}

function write(id, buf) {
  const st = bufs.get(id);
  if (!st || st.dead || !st.proc.stdin.writable) return;
  if (!st.firstWrite) st.firstWrite = Date.now();
  st.proc.stdin.write(Buffer.from(buf));
}

function segments(st) {
  try {
    return fs.readFileSync(path.join(st.dir, 'list.csv'), 'utf8').split(/\r?\n/).filter(Boolean)
      .map(l => { const [file, s, e] = l.split(','); return { file: path.join(st.dir, file), start: +s, end: +e }; })
      .filter(x => fs.existsSync(x.file));
  } catch { return []; }
}

function status(id) {
  const st = bufs.get(id);
  if (!st) return { active: false };
  const segs = segments(st);
  return { active: !st.dead, buffered: segs.length ? segs.at(-1).end - segs[0].start : 0, latest: segs.length ? segs.at(-1).end : 0, wallOffset: st.firstWrite, error: st.dead ? st.tail.slice(-200) : '' };
}

/** opts: { last: seconds } or { inWall, outWall } (ms timestamps) */
async function clip(id, opts) {
  const st = bufs.get(id);
  if (!st) return { ok: false, error: 'Replay buffer not running' };
  // the segment being written is not in the list yet — wait (briefly) until the buffer covers the out point
  if (opts.inWall && st.firstWrite) {
    const want = ((opts.outWall || Date.now()) - st.firstWrite) / 1000 - 0.3;
    for (let i = 0; i < 16; i++) { const sg = segments(st); if (sg.length && sg.at(-1).end >= want - 0.05) break; await new Promise(r => setTimeout(r, 250)); }
  }
  return cut(st, opts);
}

function cut(st, opts) {
  const segs = segments(st);
  if (!segs.length) return Promise.resolve({ ok: false, error: 'Buffer is still filling — try again in a few seconds' });
  const latest = segs.at(-1).end;
  let a, b;
  if (opts.inWall) {
    const toStream = (w) => (w - st.firstWrite) / 1000 - 0.3;
    a = toStream(opts.inWall); b = opts.outWall ? toStream(opts.outWall) : latest;
  } else { b = latest; a = latest - (opts.last || 8); }
  a = Math.max(segs[0].start, a); b = Math.min(latest, Math.max(a + 0.5, b));
  const use = segs.filter(s => s.end > a && s.start < b);
  if (!use.length) return Promise.resolve({ ok: false, error: 'That moment is no longer in the buffer' });
  const folder = path.join(ctx.getSettings().record.folder, 'Replays');
  fs.mkdirSync(folder, { recursive: true });
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  const out = path.join(folder, `Replay-${opts.label ? opts.label.replace(/[\\/:*?"<>|]/g, '_') + '-' : ''}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.round((b - a) * 10) / 10}s.mp4`);
  const args = ['-hide_banner', '-loglevel', 'error', '-i', 'concat:' + use.map(s => s.file).join('|'), '-ss', String(Math.max(0, a - use[0].start)), '-t', String(b - a), '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', '-y', out];
  return new Promise((resolve) => execFile(require('./outputs').ffmpegPath(), args, { windowsHide: true, timeout: 30000 }, (err, so, se) => {
    if (err) resolve({ ok: false, error: (se || err.message).toString().slice(-300) });
    else resolve({ ok: true, file: out, duration: b - a });
  }));
}

function stop(id) {
  const st = bufs.get(id); if (!st) return;
  bufs.delete(id);
  try { st.proc.stdin.end(); } catch { /* noop */ }
  setTimeout(() => { try { st.proc.kill('SIGKILL'); } catch { /* noop */ } fs.rm(st.dir, { recursive: true, force: true }, () => {}); }, 1500);
}
function stopAll() { for (const id of [...bufs.keys()]) stop(id); }

function registerIpc(ipcMain) {
  ipcMain.handle('replay:start', (e, id, cfg) => start(id, cfg));
  ipcMain.on('replay:chunk', (e, id, buf) => write(id, buf));
  ipcMain.handle('replay:stop', (e, id) => stop(id));
  ipcMain.handle('replay:clip', (e, id, opts) => clip(id, opts));
  ipcMain.handle('replay:status', (e, id) => status(id));
  ipcMain.handle('replay:delete-clip', (e, file) => { const folder = path.join(ctx.getSettings().record.folder, 'Replays'); if (path.resolve(file).startsWith(path.resolve(folder))) fs.rmSync(file, { force: true }); return true; });
}

module.exports = { init, registerIpc, stopAll };
