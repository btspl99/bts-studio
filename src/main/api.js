'use strict';
/**
 * HTTP control API (vMix-style function calls) + Web Controller + Tally.
 *   GET /api                         -> production state (JSON, or ?format=xml)
 *   GET /api/?Function=Cut&Input=2   -> run a function
 *   POST /api  {"Function":"SetText","Input":"Score","SelectedName":"Runs","Value":"120"}
 *   GET /api/functions               -> list of available functions
 *   GET /api/mjpeg?Input=program&fps=10&width=640 -> live MJPEG preview (program, preview, multiview or any input)
 *   GET /                            -> web controller, /tally/ -> tally light page
 *
 * TCP API (vMix-compatible text protocol, default port 8099), one command per line:
 *   FUNCTION Cut Input=2&Duration=500   -> FUNCTION OK Completed
 *   XML                                  -> XML <bytes>\r\n<xml>
 *   TALLY                                -> TALLY OK 0120   (0 off, 1 program, 2 preview per input)
 *   SUBSCRIBE TALLY | SUBSCRIBE ACTS     -> pushes TALLY / ACTS lines on change;  UNSUBSCRIBE TALLY|ACTS
 *   VERSION, QUIT
 */
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const log = require('electron-log/main');

let server = null;
let tcpServer = null;
const tcpClients = new Set();
const mjpeg = new Map(); // key -> { clients:Set<res>, timer, busy }
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

/** vMix-compatible state document (<vmix> root, same element / attribute names) so vMix tools, Companion,
 *  tally boxes and scripts written for vMix can read BTS Studio. */
const VMIX_TYPE = { camera: 'Capture', capture: 'Capture', ndi: 'NDI', stream: 'Stream', screen: 'Capture', video: 'Video', 'audio-file': 'AudioFile', image: 'Image', playlist: 'VideoList', color: 'Colour', browser: 'Browser', title: 'GT', scene: 'Virtual', audio: 'Audio', mix: 'Mix', delay: 'VideoDelay', replay: 'Replay', guest: 'VideoCall', slides: 'PowerPoint' };
function stateTree(s) {
  const E = (name, attrs = {}, kids = [], text) => ({ name, attrs, kids, text });
  const ms = (v) => Math.round((v || 0) * 1000);
  const inputs = s.inputs.map(i => E('input', {
    key: i.id, number: i.number, type: VMIX_TYPE[i.type] || i.type, title: i.title, shortTitle: i.title, state: i.state || 'Paused',
    position: ms(i.position), duration: ms(i.duration), loop: i.loop ? 'True' : 'False',
    ...(i.volume != null ? { muted: i.muted ? 'True' : 'False', volume: i.volume, balance: 0, solo: 'False', audiobusses: 'M' } : {}),
    ...(i.index != null ? { selectedIndex: i.index + 1 } : {})
  }, (i.fields || []).map((f, k) => E(f.type === 'image' ? 'image' : 'text', { index: k, name: f.name + (f.type === 'image' ? '.Source' : '.Text') }, [], f.value)), i.title));
  const overlays = (s.overlays || []).map((o, n) => E('overlay', { number: n + 1 }, [], o ? String(o) : ''));
  const trans = (s.transitions || []).map((t, n) => E('transition', { number: n + 1, effect: t.type, duration: t.duration }));
  return E('vmix', {}, [
    E('version', {}, [], '27.0.0.49'), E('edition', {}, [], 'BTS Studio ' + (s.version || '')),
    E('inputs', {}, inputs), E('overlays', {}, overlays),
    E('preview', {}, [], String(s.preview || 0)), E('active', {}, [], String(s.active || 0)),
    E('fadeToBlack', {}, [], s.ftb ? 'True' : 'False'), E('transitions', {}, trans),
    E('recording', {}, [], s.recording ? 'True' : 'False'), E('external', {}, [], 'False'), E('streaming', {}, [], s.streaming ? 'True' : 'False'),
    E('playList', {}, [], 'False'), E('multiCorder', {}, [], 'False'), E('fullscreen', {}, [], 'False'),
    E('audio', {}, [E('master', { volume: s.master ? s.master.volume : 100, muted: s.master && s.master.muted ? 'True' : 'False', headphonesVolume: 74 })])
  ]);
}
function toXml(s) {
  const esc = v => String(v ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const ser = (n) => `<${n.name}${Object.entries(n.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>${n.kids.map(ser).join('')}${n.text != null && !n.kids.length ? esc(n.text) : ''}</${n.name}>`;
  return `<?xml version="1.0" encoding="utf-8"?>` + ser(stateTree(s));
}
/** XMLTEXT: the XPath subset vMix users rely on, e.g. vmix/inputs/input[@number='2']/@title,
 *  vmix/inputs/input[2]/text[@name='Name.Text'], vmix/active, vmix/overlays/overlay[1] */
function xpath(s, expr) {
  const parts = String(expr || '').trim().replace(/^\/+/, '').split('/').filter(Boolean);
  let nodes = [stateTree(s)];
  if (!parts.length) return null;
  const first = parts.shift();
  if (first !== 'vmix' && first !== 'bts') return null;
  for (const part of parts) {
    if (part.startsWith('@')) { const v = nodes[0] && nodes[0].attrs[part.slice(1)]; return v == null ? null : String(v); }
    const m = /^([\w-]+)(?:\[(.+)\])?$/.exec(part); if (!m) return null;
    let next = nodes.flatMap(n => n.kids.filter(k => k.name === m[1]));
    if (m[2]) {
      const pr = m[2].trim(), a = /^@([\w-]+)\s*=\s*['"](.*)['"]$/.exec(pr);
      if (a) next = next.filter(n => String(n.attrs[a[1]]) === a[2]);
      else if (/^\d+$/.test(pr)) next = next[+pr - 1] ? [next[+pr - 1]] : [];
      else return null;
    }
    nodes = next;
    if (!nodes.length) return null;
  }
  const n = nodes[0];
  return n.kids.length ? null : String(n.text ?? '');
}

/* optional password for the web controller / HTTP API (HTTP Basic, like vMix). Requests from this PC are always allowed. */
function authorized(req) {
  const pw = opts && opts.password;
  if (!pw) return true;
  const ip = req.socket.remoteAddress || '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  const h = req.headers.authorization || '';
  const m = /^Basic\s+(.+)$/i.exec(h); if (!m) return false;
  const dec = Buffer.from(m[1], 'base64').toString('utf8');
  const given = dec.slice(dec.indexOf(':') + 1), user = dec.slice(0, dec.indexOf(':'));
  const a = Buffer.from(given), b = Buffer.from(pw);
  return (!opts.user || user === opts.user) && a.length === b.length && crypto.timingSafeEqual(a, b);
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
  if (!authorized(req) && !(opts.tallyOpen && p.startsWith('/tally'))) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="BTS Studio", charset="UTF-8"', 'Content-Type': 'text/plain' });
    return res.end('Password required');
  }

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
  if (p === '/api/mjpeg') {
    const input = url.searchParams.get('Input') || 'program';
    const fps = Math.max(1, Math.min(25, +url.searchParams.get('fps') || 10));
    const width = Math.max(160, Math.min(1280, +url.searchParams.get('width') || 640));
    const key = `${input}|${fps}|${width}`;
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=btsframe', 'Cache-Control': 'no-store, no-cache', Pragma: 'no-cache', Connection: 'close' });
    let m = mjpeg.get(key);
    if (!m) {
      m = { clients: new Set(), busy: false };
      m.timer = setInterval(async () => {
        if (m.busy) return; m.busy = true;
        try {
          const r = await callRenderer('__thumb', { Input: input, Width: width, Quality: 0.72 });
          if (r.ok && r.data) {
            const buf = Buffer.from(r.data.split(',')[1], 'base64');
            const head = `--btsframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`;
            for (const c of m.clients) { try { c.write(head); c.write(buf); c.write('\r\n'); } catch { /* client gone */ } }
          }
        } finally { m.busy = false; }
      }, 1000 / fps);
      mjpeg.set(key, m);
    }
    m.clients.add(res);
    req.on('close', () => { m.clients.delete(res); if (!m.clients.size) { clearInterval(m.timer); mjpeg.delete(key); } });
    return;
  }
  if (p === '/api/thumb') {
    const r = await callRenderer('__thumb', { Input: url.searchParams.get('Input') || 'program', Width: url.searchParams.get('width') || 480 });
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
    if (o.tcpPort) startTcp(o.tcpPort, o.allowRemote ? '0.0.0.0' : '127.0.0.1');
  });
}

function stop() {
  for (const m of mjpeg.values()) { clearInterval(m.timer); for (const c of m.clients) { try { c.end(); } catch { /* noop */ } } }
  mjpeg.clear();
  if (server) { try { server.close(); } catch { /* noop */ } server = null; }
  stopTcp();
}

/* ---------------- TCP API ---------------- */
function tallyString(s) {
  const ovl = new Set((s.overlays || []).filter(Boolean));
  return (s.inputs || []).map(i => (i.number === s.active || ovl.has(i.number) || (i.live && i.type !== 'audio')) ? '1' : i.number === s.preview ? '2' : '0').join('');
}
function actsLines(prev, s) {
  const out = [];
  const add = (name, val, n) => out.push(`ACTS OK ${name} ${n != null ? n + ' ' : ''}${val}`);
  if (!prev || prev.active !== s.active) add('Input', 1, s.active);
  if (!prev || prev.preview !== s.preview) add('InputPreview', 1, s.preview);
  (s.overlays || []).forEach((v, k) => { if (!prev || (prev.overlays || [])[k] !== v) add(`Overlay${k + 1}`, v ? 1 : 0, v || 0); });
  if (!prev || prev.recording !== s.recording) add('Recording', s.recording ? 1 : 0);
  if (!prev || prev.streaming !== s.streaming) add('Streaming', s.streaming ? 1 : 0);
  if (!prev || prev.ftb !== s.ftb) add('FadeToBlack', s.ftb ? 1 : 0);
  return out;
}
function startTcp(port, host) {
  stopTcp();
  tcpServer = net.createServer((sock) => {
    const c = { sock, tally: false, acts: false, buf: '' };
    tcpClients.add(c);
    sock.setNoDelay(true);
    const send = (line) => { try { sock.write(line + '\r\n'); } catch { /* noop */ } };
    sock.on('data', async (d) => {
      c.buf += d.toString('utf8');
      if (c.buf.length > 1e6) { sock.destroy(); return; }
      let i;
      while ((i = c.buf.indexOf('\n')) >= 0) {
        const line = c.buf.slice(0, i).replace(/\r$/, '').trim(); c.buf = c.buf.slice(i + 1);
        if (!line) continue;
        const sp = line.indexOf(' ');
        const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
        const arg = sp < 0 ? '' : line.slice(sp + 1).trim();
        try {
          if (cmd === 'FUNCTION') {
            const fsp = arg.indexOf(' ');
            const fn = fsp < 0 ? arg : arg.slice(0, fsp);
            const params = Object.fromEntries(new URLSearchParams(fsp < 0 ? '' : arg.slice(fsp + 1)).entries());
            if (!fn) { send('FUNCTION ER Missing function name'); continue; }
            const r = await callRenderer(fn, params);
            send(r.ok ? `FUNCTION OK ${r.data !== undefined && typeof r.data !== 'object' ? r.data : 'Completed'}` : `FUNCTION ER ${String(r.error || 'Error').replace(/[\r\n]+/g, ' ')}`);
          } else if (cmd === 'XML') {
            const x = Buffer.from(toXml(state), 'utf8');
            send(`XML ${x.length}`); sock.write(x);
          } else if (cmd === 'XMLTEXT') {
            const v = xpath(state, arg);
            send(v == null ? 'XMLTEXT ER Not found' : `XMLTEXT OK ${v}`);
          } else if (cmd === 'TALLY') send(`TALLY OK ${tallyString(state)}`);
          else if (cmd === 'SUBSCRIBE') {
            const what = arg.toUpperCase();
            if (what === 'TALLY') { c.tally = true; send('SUBSCRIBE OK TALLY'); send(`TALLY OK ${tallyString(state)}`); }
            else if (what === 'ACTS') { c.acts = true; send('SUBSCRIBE OK ACTS'); for (const l of actsLines(null, state)) send(l); }
            else send('SUBSCRIBE ER Unknown subscription');
          } else if (cmd === 'UNSUBSCRIBE') {
            const what = arg.toUpperCase(); if (what === 'TALLY') c.tally = false; if (what === 'ACTS') c.acts = false; send(`UNSUBSCRIBE OK ${what}`);
          } else if (cmd === 'VERSION') send(`VERSION OK ${state.version || ''}`);
          else if (cmd === 'QUIT') { send('QUIT OK Bye'); sock.end(); }
          else send(`${cmd} ER Unknown command`);
        } catch (e) { send(`${cmd} ER ${e.message}`); }
      }
    });
    sock.on('close', () => tcpClients.delete(c));
    sock.on('error', () => tcpClients.delete(c));
    send('VERSION OK ' + (state.version || ''));
  });
  tcpServer.on('error', (err) => log.error('TCP API error', err.message));
  tcpServer.listen(port, host, () => log.info(`TCP API listening on ${port}`));
}
function stopTcp() {
  for (const c of tcpClients) { try { c.sock.destroy(); } catch { /* noop */ } }
  tcpClients.clear();
  if (tcpServer) { try { tcpServer.close(); } catch { /* noop */ } tcpServer = null; }
}
let lastPushed = null;
function pushSubscriptions(s) {
  if (!tcpClients.size) { lastPushed = s; return; }
  const t = tallyString(s), tPrev = lastPushed ? tallyString(lastPushed) : null;
  const acts = actsLines(lastPushed, s);
  for (const c of tcpClients) {
    if (c.tally && t !== tPrev) { try { c.sock.write(`TALLY OK ${t}\r\n`); } catch { /* noop */ } }
    if (c.acts && acts.length) { try { c.sock.write(acts.join('\r\n') + '\r\n'); } catch { /* noop */ } }
  }
  lastPushed = s;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

function registerIpc(ipcMain) {
  ipcMain.on('api:result', (e, { reqId, result }) => { const cb = pending.get(reqId); if (cb) { pending.delete(reqId); cb(result); } });
  ipcMain.on('state:update', (e, s) => { state = s; pushSubscriptions(s); });
  ipcMain.on('api:functions', (e, list) => { functions = list; });
  ipcMain.handle('api:addresses', () => lanAddresses());
}

module.exports = { start, stop, registerIpc };
