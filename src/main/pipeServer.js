'use strict';
/**
 * Media pipe — a private localhost HTTP endpoint that streams video to the renderer without re-compression.
 *
 * Each message is an 8-byte header followed by a payload:
 *   byte 0     type   1 = config (UTF-8 JSON), 2 = compressed access unit (Annex B), 3 = raw frame
 *   byte 1     flags  bit 0 = key frame
 *   bytes 2-3  reserved
 *   bytes 4-7  payload length (uint32, little endian)
 *
 * The renderer reads it with fetch() and decodes compressed video with WebCodecs (GPU) or wraps raw frames
 * (NV12 / UYVY / BGRA…) in a VideoFrame. A client that connects late gets the last config and then waits
 * for the next key frame. A slow client drops frames instead of building up delay.
 */
const http = require('http');

const T_CONFIG = 1, T_AU = 2, T_RAW = 3;

function header(type, flags, len) {
  const h = Buffer.alloc(8);
  h[0] = type; h[1] = flags; h.writeUInt32LE(len, 4);
  return h;
}

function create() {
  const clients = new Set();
  let lastConfig = null;
  let gop = [], gopBytes = 0; // access units since the last key frame, so a late client can start at once
  const stats = { sent: 0, dropped: 0 };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-cache, no-store', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' });
    res.socket && res.socket.setNoDelay(true);
    const c = { res, waitKey: true };
    clients.add(c);
    if (lastConfig) { res.write(header(T_CONFIG, 0, lastConfig.length)); res.write(lastConfig); }
    if (gop.length) { for (const [b, k] of gop) { res.write(header(T_AU, k ? 1 : 0, b.length)); res.write(b); } c.waitKey = false; }
    req.on('close', () => clients.delete(c));
    res.on('error', () => clients.delete(c));
  });
  const p = {
    port: 0, stats,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { p.port = server.address().port; resolve(p.port); });
      });
    },
    get clients() { return clients.size; },
    config(obj) {
      lastConfig = Buffer.from(JSON.stringify(obj));
      gop = []; gopBytes = 0;
      for (const c of clients) { c.waitKey = true; try { c.res.write(header(T_CONFIG, 0, lastConfig.length)); c.res.write(lastConfig); } catch { /* closed */ } }
    },
    /** compressed access unit; clients that fell behind skip to the next key frame */
    au(buf, key) {
      if (key) { gop = []; gopBytes = 0; }
      if (gop.length || key) { if (gopBytes + buf.length < 48e6) { gop.push([buf, key]); gopBytes += buf.length; } else { gop = []; gopBytes = 0; } }
      for (const c of clients) {
        if (c.waitKey) { if (!key) { stats.dropped++; continue; } c.waitKey = false; }
        if (c.res.writableLength > 8e6) { c.waitKey = true; stats.dropped++; continue; } // ~seconds behind
        try { c.res.write(header(T_AU, key ? 1 : 0, buf.length)); c.res.write(buf); stats.sent++; } catch { /* closed */ }
      }
    },
    /** uncompressed frame; dropped for a client whose socket is still full */
    raw(buf) {
      for (const c of clients) {
        if (c.res.writableLength > buf.length * 2) { stats.dropped++; continue; } // keep at most ~2 frames queued
        try { c.res.write(header(T_RAW, 1, buf.length)); c.res.write(buf); stats.sent++; } catch { /* closed */ }
      }
    },
    close() {
      for (const c of clients) { try { c.res.end(); } catch { /* noop */ } }
      clients.clear();
      try { server.close(); } catch { /* noop */ }
    }
  };
  return p;
}

/* ---------------- Annex B helpers (H.264 / HEVC) ---------------- */

/** split an Annex B byte stream into NAL units; returns { nals, rest } where rest is the unfinished tail */
function splitNals(buf) {
  const starts = [];
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
      const sc = buf[i + 2] === 1 ? 3 : 4;
      starts.push({ at: i, data: i + sc });
      i += sc - 1;
    }
  }
  if (starts.length < 2) return { nals: [], rest: buf };
  const nals = [];
  for (let k = 0; k < starts.length - 1; k++) nals.push(buf.subarray(starts[k].data, starts[k + 1].at));
  return { nals, rest: buf.subarray(starts[starts.length - 1].at) };
}

/** remove emulation-prevention bytes (00 00 03) */
function unescapeRbsp(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    if (i >= 2 && b[i] === 3 && b[i - 1] === 0 && b[i - 2] === 0) continue;
    out.push(b[i]);
  }
  return Buffer.from(out);
}

class Bits {
  constructor(b) { this.b = b; this.p = 0; }
  bit() { const v = (this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1; this.p++; return v; }
  ue() { let z = 0; while (this.p < this.b.length * 8 && this.bit() === 0) z++; let v = 0; for (let i = 0; i < z; i++) v = v * 2 + this.bit(); return (1 << z) - 1 + v; }
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

/**
 * Turns an Annex B elementary stream into access units. Expects access-unit delimiters
 * (FFmpeg h264_metadata/hevc_metadata aud=insert) so each AU ends where the next AUD starts.
 */
class AnnexBParser {
  constructor(codec, onAu, onCodec) {
    this.codec = codec; this.onAu = onAu; this.onCodec = onCodec;
    this.rest = Buffer.alloc(0); this.cur = []; this.codecString = null;
  }
  push(chunk) {
    const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    const { nals, rest } = splitNals(buf);
    this.rest = Buffer.from(rest);
    for (const n of nals) this._nal(n);
  }
  _type(n) { return this.codec === 'hevc' ? (n[0] >> 1) & 0x3f : n[0] & 0x1f; }
  _nal(n) {
    if (!n.length) return;
    const t = this._type(n);
    const isAud = this.codec === 'hevc' ? t === 35 : t === 9;
    if (isAud) {
      if (this.cur.some(x => this._vcl(x))) this._flush();
      else if (this.cur.length) return; // duplicate delimiter (stream already had AUDs): keep the first
    }
    if (!this.codecString) this._sps(n, t);
    this.cur.push(n);
  }
  _sps(n, t) {
    if (this.codec === 'h264' && t === 7 && n.length > 4) {
      this.codecString = `avc1.${hex2(n[1])}${hex2(n[2])}${hex2(n[3])}`;
      this.onCodec(this.codecString);
    } else if (this.codec === 'hevc' && t === 33 && n.length > 16) {
      const r = unescapeRbsp(n.subarray(2));
      const ptl = r[1];
      const space = ptl >> 6, tier = (ptl >> 5) & 1, profile = ptl & 0x1f;
      let compat = r.readUInt32BE(2), rev = 0;
      for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
      const level = r[12];
      const cons = [...r.subarray(6, 12)];
      while (cons.length && cons[cons.length - 1] === 0) cons.pop();
      this.codecString = `hvc1.${['', 'A', 'B', 'C'][space]}${profile}.${(rev >>> 0).toString(16)}.${tier ? 'H' : 'L'}${level}${cons.length ? '.' + cons.map(c => c.toString(16).toUpperCase()).join('.') : '.B0'}`;
      this.onCodec(this.codecString);
    }
  }
  _vcl(n) { const t = this._type(n); return this.codec === 'hevc' ? t < 32 : t >= 1 && t <= 5; }
  _isKey() {
    let sps = false, iSlice = false;
    for (const n of this.cur) {
      const t = this._type(n);
      if (this.codec === 'hevc') { if (t >= 16 && t <= 21) return true; continue; }
      if (t === 5) return true;
      if (t === 7) sps = true;
      if (t === 1 && sps && !iSlice) { // some IP cameras send I-slices without IDR: accept them when SPS precedes
        try { const b = new Bits(unescapeRbsp(n.subarray(1, 12))); b.ue(); const st = b.ue(); if (st % 5 === 2) iSlice = true; } catch { /* noop */ }
      }
    }
    return sps && iSlice;
  }
  _flush() {
    const parts = [];
    for (const n of this.cur) { parts.push(Buffer.from([0, 0, 0, 1]), n); }
    const key = this._isKey();
    this.cur = [];
    this.onAu(Buffer.concat(parts), key);
  }
}

module.exports = { create, AnnexBParser, T_CONFIG, T_AU, T_RAW };
