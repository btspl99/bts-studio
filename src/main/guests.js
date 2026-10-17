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

/** a message from a guest (direct or through the relay): check the link and password, pass it to the renderer */
function incoming(msg) {
  const s = slots.get(msg.k);
  if (!s) return { code: 404, body: { ok: false, error: 'Link not active' } };
  if (s.password && msg.type === 'offer' && msg.password !== s.password) return { code: 403, body: { ok: false, error: 'Wrong password' } };
  if (!['offer', 'bye', 'chat', 'state'].includes(msg.type)) return { code: 400, body: { ok: false } };
  delete msg.password;
  msg.name = String(msg.name || 'Guest').slice(0, 40);
  toRenderer('guests:signal', msg);
  return { code: 200, body: { ok: true } };
}

/* ---------------- BTS Link relay (no port forwarding) ----------------
 * The guest page is served by studio.btspl.tech/link/; this studio registers its guest slots there and polls
 * for offers / chat. Only signalling passes through the relay — media flows directly by WebRTC. */
const relay = { timer: null, cloudSids: new Set(), lastHost: 0, failing: 0, state: 'off', error: '' };
function relayCfg() {
  const c = cfg();
  return { enabled: !!c.relay, server: (c.relayServer || 'https://studio.btspl.tech/link/').replace(/\/?$/, '/'), room: c.relayRoom || '', secret: c.relaySecret || '' };
}
function ensureRelayIds() {
  const s = ctx.getSettings(); s.guests = s.guests || {};
  const crypto = require('crypto');
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  if (!s.guests.relayRoom) s.guests.relayRoom = Array.from(crypto.randomBytes(20), b => abc[b % abc.length]).join('');
  if (!s.guests.relaySecret) s.guests.relaySecret = crypto.randomBytes(24).toString('base64url');
  if (ctx.saveSettings) ctx.saveSettings();
}
async function relayCall(action, body) {
  const c = relayCfg();
  const r = await fetch(`${c.server}api.php?a=${action}&r=${encodeURIComponent(c.room)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: c.secret, ...body }), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
  if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
async function relayHost() {
  const out = {};
  for (const [k, s] of slots) out[k] = { title: s.title, needsPassword: !!s.password };
  await relayCall('host', { slots: out, ice: iceServers() });
  relay.lastHost = Date.now();
}
async function relayTick() {
  relay.timer = null;
  let c = relayCfg();
  if (c.enabled && (!c.room || !c.secret)) { ensureRelayIds(); c = relayCfg(); }
  if (!c.enabled || !slots.size) { relay.state = c.enabled ? 'idle' : 'off'; return; }
  try {
    if (Date.now() - relay.lastHost > 20000 || relay.dirty) { relay.dirty = false; await relayHost(); }
    const j = await relayCall('recv', {});
    for (const m of j.msgs || []) {
      if (m.sid) relay.cloudSids.add(m.sid);
      if (m.type === 'bye' && m.sid) setTimeout(() => relay.cloudSids.delete(m.sid), 5000);
      incoming(m);
    }
    relay.failing = 0; relay.state = 'online'; relay.error = '';
  } catch (e) {
    relay.failing++; relay.state = 'error'; relay.error = e.message;
    if (relay.failing === 1 || relay.failing % 30 === 0) log.warn('[guests] relay', e.message);
  }
  relay.timer = setTimeout(relayTick, relay.failing ? Math.min(10000, 1000 * relay.failing) : 1000);
}
function relayKick() { relay.dirty = true; if (!relay.timer) relay.timer = setTimeout(relayTick, 50); }
function relayLinks() {
  const c = relayCfg();
  return c.enabled && c.room ? `${c.server}?r=${c.room}` : null;
}

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
    msg.ip = req.socket.remoteAddress;
    const r = incoming(msg);
    return json(res, r.code, r.body);
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
  if (relay.cloudSids.has(sid) && relayCfg().enabled) { relayCall('send', { to: sid, msg }).catch((e) => log.warn('[guests] relay send', e.message)); return true; }
  const c = clients.get(sid);
  if (!c) return false;
  c.res.write(`data: ${JSON.stringify(msg)}\n\n`);
  return true;
}

function registerIpc(ipcMain) {
  ipcMain.handle('guests:start', () => start());
  ipcMain.handle('guests:stop', () => stop());
  ipcMain.handle('guests:slot', (e, key, info) => { if (info) slots.set(key, info); else { slots.delete(key); for (const [sid, c] of clients) if (c.k === key) { sendToGuest(sid, { type: 'bye', reason: 'Removed by producer' }); } } relayKick(); return true; });
  ipcMain.handle('guests:relay', (e, on) => { if (on !== undefined) { const s = ctx.getSettings(); s.guests = s.guests || {}; s.guests.relay = !!on; if (on) ensureRelayIds(); if (ctx.saveSettings) ctx.saveSettings(); relayKick(); } return { enabled: relayCfg().enabled, state: relay.state, error: relay.error, link: relayLinks() }; });
  ipcMain.handle('guests:send', (e, sid, msg) => sendToGuest(sid, msg));
  ipcMain.handle('guests:urls', () => { const out = server ? urls() : []; const l = relayLinks(); if (l) out.unshift(l); return out; });
}

function settingsChanged() { relay.lastHost = 0; relayKick(); }

module.exports = { init, registerIpc, start, stop, settingsChanged };
