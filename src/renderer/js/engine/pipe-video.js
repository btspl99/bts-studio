/* BTS Studio — renderer side of the media pipe (see src/main/pipeServer.js).
 * Reads the framed stream with fetch(), decodes H.264/HEVC access units on the GPU with WebCodecs, or wraps
 * raw NV12/UYVY/BGRA frames in a VideoFrame. Keeps only the newest frame (closing older ones) so it never
 * adds delay, and counts received / decoded / dropped frames for the Statistics window.
 */
(function () {
  'use strict';
  const BTS = window.BTS = window.BTS || {};

  class PipeVideo {
    constructor(opts = {}) {
      this.onFrame = opts.onFrame || null;
      this.onError = opts.onError || null;
      this.frame = null;
      this.stats = { received: 0, decoded: 0, dropped: 0, errors: 0, lastAt: 0, fps: 0, codec: '', width: 0, height: 0, hw: '' };
      this._fpsN = 0; this._fpsT = performance.now();
      this.cfg = null; this.decoder = null; this.waitKey = true; this._ts = 0;
    }

    connect(port) {
      this.close(true);
      this.closed = false;
      this.port = port;
      this.abort = new AbortController();
      const signal = this.abort.signal;
      const go = async () => {
        while (!this.closed && !signal.aborted) {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/`, { signal, cache: 'no-store' });
            await this._read(res.body.getReader());
          } catch (e) { if (signal.aborted) return; }
          if (this.closed) return;
          await new Promise(r => setTimeout(r, 500)); // pipe restarted — reconnect
        }
      };
      go();
    }

    async _read(reader) {
      const q = []; let qLen = 0, qOff = 0; // queue of Uint8Array chunks, offset into q[0]
      const take = (n) => { // returns Uint8Array of n bytes (copies only when spanning chunks)
        const first = q[0];
        if (first.length - qOff >= n) { const out = first.subarray(qOff, qOff + n); qOff += n; qLen -= n; if (qOff === first.length) { q.shift(); qOff = 0; } return out; }
        const out = new Uint8Array(n); let w = 0;
        while (w < n) {
          const c = q[0], avail = c.length - qOff, k = Math.min(avail, n - w);
          out.set(c.subarray(qOff, qOff + k), w); w += k; qOff += k;
          if (qOff === c.length) { q.shift(); qOff = 0; }
        }
        qLen -= n; return out;
      };
      let hdr = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done || this.closed) return;
        q.push(value); qLen += value.length;
        for (;;) {
          if (!hdr) {
            if (qLen < 8) break;
            const h = take(8);
            hdr = { type: h[0], flags: h[1], len: (h[4] | (h[5] << 8) | (h[6] << 16)) + h[7] * 16777216 };
          }
          if (qLen < hdr.len) break;
          const body = take(hdr.len);
          const { type, flags } = hdr; hdr = null;
          try { this._message(type, flags, body); } catch (e) { this.stats.errors++; console.warn('[pipe]', e); }
        }
      }
    }

    _message(type, flags, body) {
      if (type === 1) { this._config(JSON.parse(new TextDecoder().decode(body))); return; }
      this.stats.received++;
      if (type === 2) this._decode(body, !!(flags & 1));
      else if (type === 3) this._raw(body);
    }

    _config(cfg) {
      this.cfg = cfg;
      this.stats.codec = cfg.codec || cfg.format || '';
      if (cfg.kind === 'au') this._makeDecoder();
    }

    _makeDecoder() {
      const cfg = this.cfg;
      if (this.decoder && this.decoder.state !== 'closed') { try { this.decoder.close(); } catch { /* noop */ } }
      const now = performance.now();
      this._errs = (this._errs || []).filter(t => now - t < 8000);
      if (this._errs.length >= 4) { this.decoder = null; if (this.onError) this.onError(new Error('unsupported')); return; }
      // prefer the GPU when the driver supports this profile; after a decoder error use whatever works
      const base = { codec: cfg.codec, optimizeForLatency: true };
      const dec = this.decoder = new VideoDecoder({
        output: (f) => this._present(f),
        error: (e) => { this.stats.errors++; this._errs.push(performance.now()); this.waitKey = true; console.warn('[pipe] decoder', e.message); setTimeout(() => { if (!this.closed && this.cfg === cfg) this._makeDecoder(); }, 50); }
      });
      this._pending = [];
      VideoDecoder.isConfigSupported({ ...base, hardwareAcceleration: 'prefer-hardware' }).catch(() => ({ supported: false })).then(async (r) => {
        let hw = r.supported && !this._errs.length ? 'prefer-hardware' : 'no-preference';
        if (hw === 'no-preference') { const r2 = await VideoDecoder.isConfigSupported(base).catch(() => ({ supported: false })); if (!r2.supported) { this.decoder = null; if (this.onError) this.onError(new Error('unsupported')); return; } }
        if (this.decoder !== dec || dec.state === 'closed') return;
        try { dec.configure({ ...base, hardwareAcceleration: hw }); } catch (e) { this._errs.push(performance.now()); if (this.onError) this.onError(e); return; }
        this.stats.hw = hw === 'prefer-hardware' ? 'gpu' : 'software';
        const q = this._pending; this._pending = null; // chunks that arrived while probing (from the key frame on)
        for (const [d, k] of q) this._decode(d, k);
      });
      this.waitKey = true;
    }

    _decode(data, key) {
      const d = this.decoder;
      if (d && d.state === 'unconfigured' && this._pending) { if (this._pending.length || key) { if (this._pending.length < 120) this._pending.push([data, key]); } return; }
      if (!d || d.state !== 'configured') { this.stats.dropped++; return; }
      if (this.waitKey) { if (!key) { this.stats.dropped++; return; } this.waitKey = false; }
      // decoder falling behind: skip to the next key frame rather than build up latency
      if (d.decodeQueueSize > 30) { this.waitKey = !key; if (!key) { this.stats.dropped++; return; } }
      this._ts += 33333;
      try { d.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: this._ts, data })); }
      catch (e) { this.stats.errors++; this.waitKey = true; }
    }

    _raw(data) {
      const c = this.cfg; if (!c) return;
      this._ts += Math.round(1e6 / (c.fps || 30));
      let f;
      try { f = new VideoFrame(data, { format: c.format, codedWidth: c.width, codedHeight: c.height, timestamp: this._ts }); }
      catch (e) { this.stats.errors++; return; }
      this._present(f);
    }

    _present(f) {
      if (this.closed) { f.close(); return; }
      const old = this.frame;
      this.frame = f;
      if (old) old.close();
      const now = performance.now();
      this.stats.decoded++; this.stats.lastAt = now; this.stats.width = f.displayWidth; this.stats.height = f.displayHeight;
      this._fpsN++;
      if (now - this._fpsT >= 1000) { this.stats.fps = Math.round(this._fpsN * 1000 / (now - this._fpsT) * 10) / 10; this._fpsN = 0; this._fpsT = now; }
      if (this.onFrame) this.onFrame(f);
    }

    /** frame for the compositor ({src,w,h}) or null */
    get() { const f = this.frame; return f ? { src: f, w: f.displayWidth, h: f.displayHeight } : null; }

    close(keepStats) {
      this.closed = true;
      if (this.abort) { try { this.abort.abort(); } catch { /* noop */ } this.abort = null; }
      if (this.decoder && this.decoder.state !== 'closed') { try { this.decoder.close(); } catch { /* noop */ } }
      this.decoder = null;
      if (this.frame) { this.frame.close(); this.frame = null; }
      if (!keepStats) this.stats.received = this.stats.decoded = this.stats.dropped = 0;
    }
  }

  BTS.PipeVideo = PipeVideo;
})();
