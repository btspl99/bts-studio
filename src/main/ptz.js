'use strict';
/**
 * PTZ camera control — VISCA over IP.
 *  - 'visca-udp': Sony VISCA-over-IP framing (8-byte header) on UDP 52381 — Sony SRG/BRC, BirdDog, Lumens, Panasonic (VISCA mode), Avonic…
 *  - 'visca-tcp': raw VISCA bytes on TCP (PTZOptics / many OEM cameras, port 5678)
 *  - 'visca-udp-raw': raw VISCA bytes on UDP (PTZOptics UDP 1259, generic Chinese PTZ)
 * Commands are fire-and-forget; replies are read and discarded (TCP) to keep the socket healthy.
 */
const dgram = require('dgram');
const net = require('net');
const log = require('electron-log/main');

const cams = new Map(); // key -> { proto, host, port, seq, udp, tcp, queue }
let udpSock = null;

function key(c) { return `${c.protocol || 'visca-udp'}|${c.host}|${c.port || ''}`; }
function defaultPort(p) { return p === 'visca-tcp' ? 5678 : p === 'visca-udp-raw' ? 1259 : 52381; }

function udp() {
  if (udpSock) return udpSock;
  udpSock = dgram.createSocket('udp4');
  udpSock.on('error', (e) => { log.warn('[ptz] udp', e.message); try { udpSock.close(); } catch { /* noop */ } udpSock = null; });
  udpSock.on('message', () => { /* ACK / completion — ignored */ });
  udpSock.bind(0);
  return udpSock;
}

function getCam(c) {
  const k = key(c);
  let cam = cams.get(k);
  if (!cam) { cam = { proto: c.protocol || 'visca-udp', host: c.host, port: +c.port || defaultPort(c.protocol), seq: 1, addr: Math.max(1, Math.min(7, +c.address || 1)) }; cams.set(k, cam); }
  cam.addr = Math.max(1, Math.min(7, +c.address || 1));
  return cam;
}

function send(c, bytes) {
  if (!c || !c.host) return Promise.reject(new Error('No camera address'));
  const cam = getCam(c);
  const payload = Buffer.from([0x80 + cam.addr, ...bytes, 0xff]);
  if (cam.proto === 'visca-tcp') {
    return new Promise((resolve, reject) => {
      const go = () => { cam.tcp.write(payload); resolve(true); };
      if (cam.tcp && !cam.tcp.destroyed && cam.tcpReady) return go();
      if (!cam.tcp || cam.tcp.destroyed) {
        cam.tcpReady = false;
        cam.tcp = net.connect({ host: cam.host, port: cam.port });
        cam.tcp.setNoDelay(true);
        cam.tcp.on('data', () => { /* replies ignored */ });
        cam.tcp.on('error', (e) => { log.warn('[ptz] tcp', cam.host, e.message); cam.tcp.destroy(); });
        cam.tcp.on('close', () => { cam.tcpReady = false; });
        cam.tcp.setTimeout(30000, () => cam.tcp.destroy());
      }
      const t = setTimeout(() => reject(new Error(`Cannot connect to ${cam.host}:${cam.port}`)), 3000);
      cam.tcp.once('connect', () => { clearTimeout(t); cam.tcpReady = true; go(); });
      cam.tcp.once('error', (e) => { clearTimeout(t); reject(e); });
    });
  }
  let msg = payload;
  if (cam.proto === 'visca-udp') {
    // Sony VISCA over IP header: payload type 0x0100 (command), length, sequence number
    const h = Buffer.alloc(8);
    h.writeUInt16BE(0x0100, 0); h.writeUInt16BE(payload.length, 2); h.writeUInt32BE(cam.seq++ >>> 0, 4);
    msg = Buffer.concat([h, payload]);
  }
  return new Promise((resolve, reject) => udp().send(msg, cam.port, cam.host, (err) => err ? reject(err) : resolve(true)));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

/** pan/tilt: x,y in -1..1 (joystick), speed scaled to VISCA ranges (pan 1-24, tilt 1-20) */
function move(c, x, y) {
  const ps = clamp(Math.abs(x) * 24, 1, 24), ts = clamp(Math.abs(y) * 20, 1, 20);
  const dx = Math.abs(x) < 0.05 ? 3 : x < 0 ? 1 : 2; // 1 left, 2 right, 3 stop
  const dy = Math.abs(y) < 0.05 ? 3 : y < 0 ? 1 : 2; // 1 up, 2 down
  return send(c, [0x01, 0x06, 0x01, ps, ts, dx, dy]);
}
const stop = (c) => send(c, [0x01, 0x06, 0x01, 0x01, 0x01, 0x03, 0x03]);
/** zoom: v in -1..1 (negative = wide) */
function zoom(c, v) {
  if (Math.abs(v) < 0.05) return send(c, [0x01, 0x04, 0x07, 0x00]);
  const sp = clamp(Math.abs(v) * 7, 0, 7);
  return send(c, [0x01, 0x04, 0x07, (v > 0 ? 0x20 : 0x30) + sp]);
}
function focus(c, mode) {
  const m = { auto: [0x01, 0x04, 0x38, 0x02], manual: [0x01, 0x04, 0x38, 0x03], near: [0x01, 0x04, 0x08, 0x03], far: [0x01, 0x04, 0x08, 0x02], stop: [0x01, 0x04, 0x08, 0x00], onepush: [0x01, 0x04, 0x18, 0x01] }[mode];
  if (!m) return Promise.reject(new Error('Unknown focus mode'));
  return send(c, m);
}
const home = (c) => send(c, [0x01, 0x06, 0x04]);
const recall = (c, n) => send(c, [0x01, 0x04, 0x3f, 0x02, clamp(n, 0, 127)]);
const store = (c, n) => send(c, [0x01, 0x04, 0x3f, 0x01, clamp(n, 0, 127)]);
const power = (c, on) => send(c, [0x01, 0x04, 0x00, on ? 0x02 : 0x03]);
/** Recall speed (Sony/PTZOptics extension, 1-24) */
const presetSpeed = (c, sp) => send(c, [0x01, 0x7e, 0x01, 0x0b, clamp(sp, 1, 24), clamp(sp, 1, 24)]);

function registerIpc(ipcMain) {
  const wrap = (fn) => async (e, ...a) => { try { await fn(...a); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; } };
  ipcMain.handle('ptz:move', wrap(move));
  ipcMain.handle('ptz:stop', wrap(stop));
  ipcMain.handle('ptz:zoom', wrap(zoom));
  ipcMain.handle('ptz:focus', wrap(focus));
  ipcMain.handle('ptz:home', wrap(home));
  ipcMain.handle('ptz:recall', wrap(recall));
  ipcMain.handle('ptz:store', wrap(store));
  ipcMain.handle('ptz:power', wrap(power));
  ipcMain.handle('ptz:preset-speed', wrap(presetSpeed));
}
function closeAll() {
  for (const c of cams.values()) if (c.tcp) { try { c.tcp.destroy(); } catch { /* noop */ } }
  cams.clear();
  if (udpSock) { try { udpSock.close(); } catch { /* noop */ } udpSock = null; }
}

module.exports = { registerIpc, closeAll, move, stop, zoom, recall, store, send };
