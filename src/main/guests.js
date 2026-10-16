'use strict';
/**
 * Remote Guests (vMix Call-style) — signalling server.
 *
 * Serves the guest web page over HTTPS (browsers only allow camera/mic on secure origins) using a
 * self-signed certificate generated on first use for this PC's LAN addresses. The media itself flows
 * peer-to-peer over WebRTC between the guest's browser and the BTS Studio renderer; this module only
 * relays the SDP offer/answer and small control messages.
 *
 *   GET  /guest/?k=KEY                 guest page
 *   GET  /guest/api/events?k=KEY&sid=S  Server-Sent Events: answer / control messages for the guest
 *   POST /guest/api/signal              {k, sid, type, ...} offer / bye / chat from the guest
 */
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');
const log = require('electron-log/main');

let ctx = null;
let server = null;
let serverPort = 0;
const slots = new Map();   // key -> { title, password }
const clients = new Map(); // sid -> { k, res }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function init(c) { ctx = c; }
function cfg() { const s = ctx.getSettings(); return { port: 8089, stun: 'stun:stun.l.google.com:19302', ...(s.guests || {}) }; }
function iceServers() {
  const c = cfg(); const out = [];
  if (c.stun) out.push({ urls: c.stun.split(/[\s,]+/).filter(Boolean) });
  if (c.turn) out.push({ urls: c.turn.split(/[\s,]+/).filter(Boolean), username: c.turnUser || undefined, credential: c.turnPass || undefined });
  return out;
}
function lan() { return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address); }
function toRenderer(ch, ...a) { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, ...a); }

async function certificate() {
  const file = path.join(app.getPath('userData'), 'guest-cert.json');
  const ips = lan();
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (ips.every(ip => c.ips.includes(ip)) && new Date(c.expires) > new Date(Date.now() + 86400e3)) return c;
  } catch { /* regenerate */ }
  const selfsigned = require('selfsigned');
  const notAfter = new Date(); notAfter.setFullYear(notAfter.getFullYear() + 2);
  const altNames = [{ type: 2, value: 'localhost' }, { type: 2, value: os.hostname() }, { type: 7, ip: '127.0.0.1' }, ...ips.map(ip => ({ type: 7, ip }))];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'BTS Studio Guest Link' }, { name: 'organizationName', value: 'BTS Studio' }], {
    keySize: 2048, algorithm: 'sha256', notAfterDate: notAfter,
    extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames }]
  });
  const c = { key: pems.private, cert: pems.cert, ips, expires: notAfter.toISOString(), fingerprint: pems.fingerprint };
  fs.writeFileSync(file, JSON.stringify(c));
  return c;
}

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', d => { b += d; if (b.length > 2e5) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

async function handle(req, res) {
  const url = new URL(req.url, 'https://localhost');
  const p = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (p === '/' || p === '/guest') { res.writeHead(302, { Location: '/guest/' + url.search }); return res.end(); }

  if (p === '/guest/api/info') {
    const k = url.searchParams.get('k');
    const s = slots.get(k);
    if (!s) return json(res, 404, { ok: false, error: 'This guest link is not active. Ask the producer for a new link.' });
    return json(res, 200, { ok: true, title: s.title, needsPassword: !!s.password, iceServers: iceServers(), show: s.show || 'Live' });
  }

  if (p === '/guest/api/events') {
    const k = url.searchParams.get('k'); const sid = url.searchParams.get('sid');
    if (!slots.has(k) || !sid) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.set(sid, { k, res });
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 15000);
    req.on('close', () => { clearInterval(ping); if (clients.get(sid)?.res === res) { clients.delete(sid); toRenderer('guests:signal', { k, sid, type: 'gone' }); } });
    return;
  }

  if (p === '/guest/api/signal' && req.method === 'POST') {
    const msg = await readBody(req);
    const s = slots.get(msg.k);
    if (!s) return json(res, 404, { ok: false, error: 'Link not active' });
    if (s.password && msg.password !== s.password) return json(res, 403, { ok: false, error: 'Wrong password' });
    if (!['offer', 'bye', 'chat', 'state'].includes(msg.type)) return json(res, 400, { ok: false });
    delete msg.password;
    msg.name = String(msg.name || 'Guest').slice(0, 40);
    msg.ip = req.socket.remoteAddress;
    toRenderer('guests:signal', msg);
    return json(res, 200, { ok: true });
  }

  // static guest page (web/guest/*)
  if (p.startsWith('/guest/')) {
    const root = path.join(ctx.webRoot, 'guest');
    const rel = p.slice('/guest/'.length) || 'index.html';
    const full = path.normalize(path.join(root, rel));
    if (!full.startsWith(root)) { res.writeHead(403); return res.end(); }
    return fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('Not found');
}

async function start() {
  if (server) return { port: serverPort, urls: urls() };
  const c = await certificate();
  const port = cfg().port || 8089;
  server = https.createServer({ key: c.key, cert: c.cert }, (req, res) => handle(req, res).catch(err => { log.error('[guests]', err); try { res.writeHead(500); res.end(); } catch { /* noop */ } }));
  await new Promise((resolve, reject) => {
    server.once('error', (err) => { server = null; reject(new Error(err.code === 'EADDRINUSE' ? `Port ${port} is in use — change it in Settings → Remote Guests` : err.message)); });
    server.listen(port, '0.0.0.0', resolve);
  });
  serverPort = port;
  log.info('[guests] signalling on https port', port);
  return { port, urls: urls() };
}
function urls() { return ['localhost', ...lan()].map(h => `https://${h}:${serverPort}/guest/`); }
function stop() {
  for (const { res } of clients.values()) { try { res.end(); } catch { /* noop */ } }
  clients.clear();
  if (server) { try { server.close(); } catch { /* noop */ } server = null; }
}

function sendToGuest(sid, msg) {
  const c = clients.get(sid);
  if (!c) return false;
  c.res.write(`data: ${JSON.stringify(msg)}\n\n`);
  return true;
}

function registerIpc(ipcMain) {
  ipcMain.handle('guests:start', () => start());
  ipcMain.handle('guests:stop', () => stop());
  ipcMain.handle('guests:slot', (e, key, info) => { if (info) slots.set(key, info); else { slots.delete(key); for (const [sid, c] of clients) if (c.k === key) { sendToGuest(sid, { type: 'bye', reason: 'Removed by producer' }); } } return true; });
  ipcMain.handle('guests:send', (e, sid, msg) => sendToGuest(sid, msg));
  ipcMain.handle('guests:urls', () => server ? urls() : []);
}

module.exports = { init, registerIpc, start, stop };
