'use strict';
/**
 * Media helpers run in the main process:
 *  - Auto-convert formats Chromium cannot decode (AVI, WMV, MXF, MPEG-2, VOB, FLV, M2TS, ProRes/DNxHD MOV…)
 *    into an H.264/AAC MP4 proxy using the bundled FFmpeg. Proxies are cached by path + size + mtime.
 *  - Convert PowerPoint / Keynote / ODP decks to PDF for the Slides input
 *    (Microsoft PowerPoint via COM on Windows when installed, otherwise LibreOffice).
 *  - List the images in a folder (exported slides).
 */
const { app } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const log = require('electron-log/main');

let ctx = null;
const jobs = new Map(); // key -> Promise
const IMG_RX = /\.(png|jpe?g|gif|bmp|webp)$/i;

function init(c) { ctx = c; }
function cacheDir(sub) { const d = path.join(app.getPath('userData'), 'cache', sub); fs.mkdirSync(d, { recursive: true }); return d; }
function keyFor(file) {
  const st = fs.statSync(file);
  return crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
}
function notify(info) { const w = ctx && ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send('media:progress', info); }

/** Probe codecs with ffmpeg -i (no ffprobe shipped). */
function probe(file) {
  return new Promise((resolve) => {
    execFile(require('./outputs').ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true, timeout: 15000 }, (err, so, se) => {
      const txt = String(se || '');
      const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(txt);
      const v = /Stream #[^\n]*Video: ([a-z0-9_]+)/i.exec(txt);
      const a = /Stream #[^\n]*Audio: ([a-z0-9_]+)/i.exec(txt);
      const res = /Video: [^\n]*?, (\d{2,5})x(\d{2,5})/.exec(txt);
      const fps = /([\d.]+) fps/.exec(txt);
      resolve({
        duration: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0,
        video: v ? v[1].toLowerCase() : null, audio: a ? a[1].toLowerCase() : null,
        width: res ? +res[1] : 0, height: res ? +res[2] : 0, fps: fps ? parseFloat(fps[1]) : 0,
        interlaced: /\b(top|bottom) first\b|tff|bff/i.test(txt)
      });
    });
  });
}

// Codecs Chromium plays natively inside MP4/WebM/MOV/MKV containers.
const NATIVE_V = new Set(['h264', 'vp8', 'vp9', 'av1', 'hevc', 'theora']);
const NATIVE_A = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_f32le', 'pcm_s24le', 'alac']);
const NATIVE_EXT = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;

async function needsConversion(file) {
  const p = await probe(file);
  if (!p.video && !p.audio) return { convert: false, probe: p, reason: 'unreadable' };
  const vOk = !p.video || NATIVE_V.has(p.video);
  const aOk = !p.audio || NATIVE_A.has(p.audio);
  const extOk = NATIVE_EXT.test(file);
  return { convert: !(vOk && aOk && extOk) || p.interlaced, probe: p };
}

/**
 * Convert to an editing/playback-friendly MP4 proxy. Returns the output path.
 * opts.quality: 'fast' | 'high'; opts.force: reconvert even if cached.
 */
function convert(file, opts = {}) {
  if (!fs.existsSync(file)) return Promise.reject(new Error('File not found: ' + file));
  const key = keyFor(file) + (opts.quality === 'high' ? 'h' : '');
  const out = path.join(cacheDir('proxies'), `${path.parse(file).name.replace(/[^\w.-]+/g, '_').slice(0, 60)}-${key}.mp4`);
  if (!opts.force && fs.existsSync(out) && fs.statSync(out).size > 1024) return Promise.resolve(out);
  if (jobs.has(out)) return jobs.get(out);

  const job = (async () => {
    const p = await probe(file);
    const tmp = out + '.part.mp4';
    const vf = [];
    if (p.interlaced) vf.push('bwdif=mode=send_frame:parity=auto:deint=interlaced');
    vf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2', 'format=yuv420p');
    const args = ['-hide_banner', '-y', '-i', file, '-map', '0:v:0?', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', opts.quality === 'high' ? 'medium' : 'veryfast', '-crf', opts.quality === 'high' ? '16' : '19',
      '-g', '30', '-vf', vf.join(','), '-c:a', 'aac', '-b:a', '256k', '-ac', '2', '-ar', '48000',
      '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', tmp];
    log.info('[media] converting', file, '->', out);
    notify({ file, state: 'start', progress: 0 });
    await new Promise((resolve, reject) => {
      const proc = spawn(require('./outputs').ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let errTail = '';
      let last = 0;
      proc.stdout.on('data', (d) => {
        const m = /out_time_(?:us|ms)=(\d+)/.exec(String(d));
        if (m && p.duration) {
          const prog = Math.min(0.99, (+m[1] / 1e6) / p.duration);
          if (Date.now() - last > 400) { last = Date.now(); notify({ file, state: 'progress', progress: prog }); }
        }
      });
      proc.stderr.on('data', d => { errTail = (errTail + d).slice(-2000); });
      proc.on('error', reject);
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('FFmpeg conversion failed: ' + errTail.split('\n').filter(Boolean).slice(-2).join(' '))));
    });
    fs.renameSync(tmp, out);
    notify({ file, state: 'done', progress: 1, out });
    return out;
  })();
  jobs.set(out, job);
  job.catch(err => notify({ file, state: 'error', error: err.message })).finally(() => jobs.delete(out));
  return job;
}

/* ---------- Office decks → PDF ---------- */
function run(bin, args, timeout = 180000) {
  return new Promise((resolve, reject) => execFile(bin, args, { windowsHide: true, timeout }, (err, so, se) => err ? reject(new Error(String(se || err.message).trim().slice(-400))) : resolve(String(so))));
}

function sofficePath() {
  const cands = process.platform === 'win32'
    ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
    : process.platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice'] : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice'];
  return cands.find(f => fs.existsSync(f)) || null;
}

async function officeToPdf(file) {
  const key = keyFor(file);
  const out = path.join(cacheDir('slides'), `${path.parse(file).name.replace(/[^\w.-]+/g, '_').slice(0, 60)}-${key}.pdf`);
  if (fs.existsSync(out)) return out;
  const errors = [];
  if (process.platform === 'win32' && /\.(pptx?|ppsx?|potx?)$/i.test(file)) {
    // Microsoft PowerPoint (if installed) gives the most faithful result. ppSaveAsPDF = 32.
    const esc = s => s.replace(/'/g, "''");
    const ps = `$ErrorActionPreference='Stop'; $p = New-Object -ComObject PowerPoint.Application; ` +
      `try { $d = $p.Presentations.Open('${esc(path.resolve(file))}', $true, $false, $false); $d.SaveAs('${esc(out)}', 32); $d.Close() } finally { $p.Quit() }`;
    try { await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]); if (fs.existsSync(out)) return out; } catch (e) { errors.push('PowerPoint: ' + e.message); }
  }
  const soffice = sofficePath();
  if (soffice) {
    const tmpDir = fs.mkdtempSync(path.join(cacheDir('slides'), 'conv-'));
    try {
      await run(soffice, ['--headless', '--norestore', `-env:UserInstallation=file:///${tmpDir.replace(/\\/g, '/')}/profile`, '--convert-to', 'pdf', '--outdir', tmpDir, file]);
      const pdf = fs.readdirSync(tmpDir).find(f => f.toLowerCase().endsWith('.pdf'));
      if (pdf) { fs.renameSync(path.join(tmpDir, pdf), out); return out; }
      errors.push('LibreOffice produced no PDF');
    } catch (e) { errors.push('LibreOffice: ' + e.message); } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
  }
  throw new Error('Could not convert this presentation. Install Microsoft PowerPoint or LibreOffice, or export the deck as PDF / images and add that instead.' + (errors.length ? '\n' + errors.join('\n') : ''));
}

function listImages(dir) {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return fs.readdirSync(dir).filter(f => IMG_RX.test(f)).sort(coll.compare).map(f => path.join(dir, f));
}

function registerIpc(ipcMain) {
  ipcMain.handle('media:probe', (e, file) => probe(file));
  ipcMain.handle('media:needs-convert', (e, file) => needsConversion(file));
  ipcMain.handle('media:convert', (e, file, opts) => convert(file, opts));
  ipcMain.handle('media:office-to-pdf', (e, file) => officeToPdf(file));
  ipcMain.handle('media:list-images', (e, dir) => listImages(dir));
  ipcMain.handle('media:read-binary', (e, file) => fs.readFileSync(file));
  ipcMain.handle('media:clear-cache', () => { for (const s of ['proxies', 'slides']) fs.rmSync(path.join(app.getPath('userData'), 'cache', s), { recursive: true, force: true }); return true; });
}

module.exports = { init, registerIpc, probe, convert, needsConversion, officeToPdf, listImages };
