'use strict';
/**
 * HTTP control API (vMix-style function calls) + Web Controller + Tally.
 *   GET /api                         -> production state (JSON, or ?format=xml)
 *   GET /api/?Function=Cut&Input=2   -> run a function
 *   POST /api  {"Function":"SetText","Input":"Score","SelectedName":"Runs","Value":"120"}
 *   GET /api/functions               -> list of available functions
 *   GET /                            -> web controller, /tally/ -> tally light page
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const log = require('electron-log/main');

let server = null;
let state = { inputs: [], preview: null, active: null, overlays: [], streaming: false, recording: false };
let functions = [];
const pending = new Map();
let opts = null;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

function callRenderer(fn, params) {
  return new Promise((resolve) => {
    const win = opts && opts.getWin();
    if (!win || win.isDestroyed()) return resolve({ ok: false, error: 'Application window not available' });
    const reqId = crypto.randomUUID();
    const t = setTimeout(() => { pending.delete(reqId); resolve({ ok: false, error: 'Timeout' }); }, 5000);
    pending.set(reqId, (r) => { clearTimeout(t); resolve(r); });
    win.webContents.send('api:call', { reqId, fn, params });
  });
}

function toXml(s) {
  const esc = v => String(v ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const inputs = s.inputs.map(i => `<input key="${esc(i.id)}" number="${i.number}" type="${esc(i.type)}" title="${esc(i.title)}" state="${esc(i.state || 'Paused')}" muted="${i.muted ? 'True' : 'False'}" volume="${i.volume}" loop="${i.loop ? 'True' : 'False'}">${esc(i.title)}</input>`).join('');
  const overlays = (s.overlays || []).map((o, n) => `<overlay number="${n + 1}">${o || ''}</overlay>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><bts version="${esc(s.version)}"><inputs>${inputs}</inputs><overlays>${overlays}</overlays><preview>${s.preview || 0}</preview><active>${s.active || 0}</active><fadeToBlack>${s.ftb ? 'True' : 'False'}</fadeToBlack><recording>${s.recording ? 'True' : 'False'}</recording><streaming>${s.streaming ? 'True' : 'False'}</streaming></bts>`;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handle(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (p === '/api' || p === '/api/') {
    let params = Object.fromEntries(url.searchParams.entries());
    if (req.method === 'POST') {
      const body = await new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) req.destroy(); }); req.on('end', () => r(b)); });
      try { params = { ...params, ...JSON.parse(body || '{}') }; } catch { /* form? */ }
    }
    const fn = params.Function || params.function;
    if (fn) {
      delete params.Function; delete params.function;
      const r = await callRenderer(fn, params);
      res.writeHead(r.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(r));
    }
    if ((params.format || '').toLowerCase() === 'xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      return res.end(toXml(state));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(state));
  }
  if (p === '/api/functions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(functions));
  }
  if (p === '/api/thumb') {
    const r = await callRenderer('__thumb', { Input: url.searchParams.get('Input') || 'program' });
    if (!r.ok || !r.data) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    return res.end(Buffer.from(r.data.split(',')[1], 'base64'));
  }

  // static web controller
  let file = p === '/' ? 'index.html' : p.slice(1);
  if (file === 'tally') file = 'tally/index.html';
  const full = path.normalize(path.join(opts.webRoot, file));
  if (!full.startsWith(opts.webRoot)) { res.writeHead(403); return res.end(); }
  fs.readFile(fs.existsSync(full) && fs.statSync(full).isDirectory() ? path.join(full, 'index.html') : full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'text/html; charset=utf-8' });
    res.end(data);
  });
}

function start(o) {
  opts = o;
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => handle(req, res).catch(err => { log.error('API error', err); try { res.writeHead(500); res.end(String(err.message)); } catch { /* noop */ } }));
    server.on('error', (err) => { log.error('API server error', err.message); reject(err); });
    server.listen(o.port, o.allowRemote ? '0.0.0.0' : '127.0.0.1', () => { log.info(`API listening on ${o.port}`); resolve(); });
  });
}

function stop() { if (server) { try { server.close(); } catch { /* noop */ } server = null; } }

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

function registerIpc(ipcMain) {
  ipcMain.on('api:result', (e, { reqId, result }) => { const cb = pending.get(reqId); if (cb) { pending.delete(reqId); cb(result); } });
  ipcMain.on('state:update', (e, s) => { state = s; });
  ipcMain.on('api:functions', (e, list) => { functions = list; });
  ipcMain.handle('api:addresses', () => lanAddresses());
}

module.exports = { start, stop, registerIpc };
