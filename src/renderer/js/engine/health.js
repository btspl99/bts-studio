'use strict';
/**
 * Health monitor / watchdog — keeps a live show running.
 *  - Samples render FPS, frame time, encoder queues, output back-pressure and per-process CPU / memory every 2 s.
 *  - Warns the operator early (once per condition) and protects Output automatically:
 *      * low memory → frees caches (thumbnails, title images, slide renders) before the system starts paging
 *      * encoder falling behind → reported with the fix (lower resolution / GPU encoder)
 *      * output backlog (network) → reported per destination
 *  - Records the last minutes of samples for the Statistics module graph.
 */
(function (BTS) {
  const U = BTS.U;

  class Health extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.samples = [];
      this.warned = new Map();
      this.last = null; this._lowFps = 0;
      this.timer = setInterval(() => this.sample().catch((e) => console.warn('health', e)), 2000);
    }
    _warn(key, msg, level = 'error', everyMs = 120000) {
      const t = this.warned.get(key) || 0;
      if (Date.now() - t < everyMs) return;
      this.warned.set(key, Date.now());
      U.toast(msg, level, 9000);
      window.bts.log('warn', '[health] ' + msg);
    }
    async sample() {
      const st = this.studio, s = st.stats;
      const m = await window.bts.metrics().catch(() => null);
      const enc = st.outputs && st.outputs.encoder ? st.outputs.encoder.stats() : [];
      const outs = await window.bts.output.list().catch(() => []);
      const heap = performance.memory ? { used: performance.memory.usedJSHeapSize / 1048576, limit: performance.memory.jsHeapSizeLimit / 1048576 } : null;
      const proc = (t) => (m ? m.procs.filter(p => p.type === t) : []);
      const sum = (arr, k) => arr.reduce((a, p) => a + (p[k] || 0), 0);
      const x = {
        t: Date.now(), fps: s.fps, target: st.fps, renderMs: s.renderMs, dropped: s.dropped, level: s.perfLevel,
        cpu: m ? sum(m.procs, 'cpu') / Math.max(1, m.sys.cpus) : 0,
        memMB: m ? sum(m.procs, 'memMB') : 0,
        gpuMB: sum(proc('GPU'), 'memMB'), rendererMB: sum(proc('Tab'), 'memMB'),
        freeMB: m ? m.sys.freeMB : 0, totalMB: m ? m.sys.totalMB : 0,
        heap, enc, outs, gpuStatus: m && m.gpu
      };
      this.last = x; this.lastProcs = m ? m.procs.slice().sort((a, b) => b.memMB - a.memMB).slice(0, 8) : [];
      this.samples.push(x); if (this.samples.length > 300) this.samples.shift();

      // --- protections & warnings ---
      if (x.fps && x.fps < st.fps * 0.85 && performance.now() - (st._lastLoadT || 0) > 5000 && this._lowFps++ >= 2) this._warn('fps', `Rendering at ${x.fps.toFixed(0)} of ${st.fps} fps. Close unused inputs/modules, lower the output resolution, or enable GPU rendering in Settings → Devices & Performance.`, 'error');
      else if (x.fps >= st.fps * 0.85) this._lowFps = 0;
      for (const e of enc) {
        if (e.frames > 60 && e.dropped / Math.max(1, e.frames + e.dropped) > 0.08) this._warn('enc-' + e.sid, `Video encoder ${e.w}×${e.h} is dropping frames (${e.hardware ? 'GPU' : 'CPU'} encoder). ${e.hardware ? 'Too many encodes at once — share one profile between outputs.' : 'Update the graphics driver so the GPU encoder can be used, or lower the resolution.'}`);
      }
      for (const o of outs) {
        if (o.buffered > 8e6) this._warn('buf-' + o.id, `${o.id}: ${Math.round(o.buffered / 1e6)} MB waiting to be sent — the internet upload or the disk is too slow for this bitrate.`);
        if (o.dropped > (this._prevDropped?.[o.id] || 0)) this._warn('drop-' + o.id, `${o.id}: dropping frames to stay live (slow connection or disk).`);
      }
      this._prevDropped = Object.fromEntries(outs.map(o => [o.id, o.dropped || 0]));
      // per-input frame drops (capture cards, streams, NDI): warn when a source keeps losing frames
      this._inDrops = this._inDrops || new Map();
      for (const i of st.inputs) {
        const f = i.frameStats && i.frameStats(); if (!f) continue;
        const prev = this._inDrops.get(i.id) || 0; this._inDrops.set(i.id, f.dropped || 0);
        if (f.dropped - prev > Math.max(10, st.fps)) this._warn('in-drop-' + i.id, `Input ${i.number} (${i.title}) is losing frames — ${f.mode === 'gpu' ? 'the network stream is unstable or the GPU decoder is overloaded' : 'the device, cable or USB port cannot keep up (try a lower mode or another USB port)'}.`, 'error', 300000);
      }
      const lowMem = (x.freeMB && x.totalMB && x.freeMB / x.totalMB < 0.06) || (heap && heap.used / heap.limit > 0.82);
      if (lowMem) { this.freeMemory(); this._warn('mem', 'Memory is running low — cleared caches. Close other programs or remove unused inputs.'); }
      this.emit('sample', x);
    }
    /** Release caches that can be rebuilt on demand. */
    freeMemory() {
      const st = this.studio;
      for (const i of st.inputs) {
        if (i.cache && i.type === 'slides' && i._prefetch) { for (const k of [...i.cache.keys()]) if (k !== i.index) i.cache.delete(k); i.thumbs = []; }
        if (i._thumbCache) i._thumbCache = null;
      }
      if (BTS.Titles && BTS.Titles.clearImageCache) BTS.Titles.clearImageCache();
      this.emit('freed');
    }
  }

  BTS.Health = Health;
})(window.BTS);
