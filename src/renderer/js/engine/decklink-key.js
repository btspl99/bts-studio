/* BTS Studio — Blackmagic DeckLink key + fill (hardware keyer).
 * Sends a source WITH transparency (default: Overlays only — titles and logos) to the native helper, which
 * plays it out with the card's keyer: External = fill + key on two connectors for a downstream vision mixer,
 * Internal = the card keys over its own input. Frames are read back from the GPU as BGRA (alpha kept).
 */
(function (BTS) {
  'use strict';
  const U = BTS.U;
  const SLOTS = 2;
  const FPS = { '1080p2398': 23.976, '1080p24': 24, '1080p25': 25, '1080p2997': 29.97, '1080p30': 30, '1080p50': 50, '1080p5994': 59.94, '1080p60': 60, '1080i50': 25, '1080i5994': 29.97, '1080i60': 30, '720p50': 50, '720p5994': 59.94, '720p60': 60, '2160p25': 25, '2160p2997': 29.97, '2160p30': 30, '2160p50': 50, '2160p5994': 59.94, '2160p60': 60 };
  const MODES = Object.keys(FPS);

  class DecklinkKey {
    constructor(studio) {
      this.studio = studio;
      this.live = new Map(); // slot -> rec
      studio.on('frame', (now) => { for (const r of this.live.values()) { try { this._tick(r, now); } catch { r.errors++; } } });
      window.bts.decklinkKey.onStatus((m) => {
        const slot = +String(m.id).replace(/^dlk-/, '');
        const r = this.live.get(slot);
        if (r) { if (m.type === 'ready') r.ready = true; if (m.type === 'stats') r.stats = m; }
        if (m.type === 'error') U.toast(`Blackmagic key ${slot + 1}: ${m.message}`, 'error', 9000);
        if (m.type === 'warn') U.toast(`Blackmagic key ${slot + 1}: ${m.message}`, 'info', 7000);
        if (m.type === 'exit' && r) { this._release(slot); studio.emit('decklink-key'); }
      });
    }
    static get MODES() { return MODES; }
    cfg() {
      const s = BTS.settings; s.decklinkKey = s.decklinkKey || { outputs: [] };
      for (let i = 0; i < SLOTS; i++) s.decklinkKey.outputs[i] = { device: '0', mode: '1080p25', key: 'external', level: 255, source: 'overlays', audio: false, premultiply: true, ...(s.decklinkKey.outputs[i] || {}) };
      return s.decklinkKey;
    }
    isLive(slot) { return this.live.has(slot); }
    status(slot) { const r = this.live.get(slot); return r ? { frames: r.frames, dropped: r.dropped, ready: !!r.ready, stats: r.stats } : null; }

    async start(slot) {
      const c = this.cfg().outputs[slot];
      this.stop(slot);
      const id = `dlk-${slot}`;
      const r = await window.bts.decklinkKey.start(id, { device: c.device, mode: c.mode, key: c.key, level: c.level, audio: !!c.audio, premultiply: c.premultiply !== false });
      if (!r.ok) { U.toast(`Blackmagic key ${slot + 1}: ${r.error}`, 'error', 9000); return false; }
      const st = this.studio;
      const rec = { slot, id, cfg: c, w: r.width, h: r.height, fps: FPS[c.mode] || st.fps, last: 0, busy: false, frames: 0, dropped: 0, errors: 0 };
      st.useSource(c.source === 'clean' || c.source === 'overlays' ? c.source : null, true);
      if (c.audio) await this._audio(rec, c.bus || 'M');
      this.live.set(slot, rec);
      st.emit('decklink-key');
      return true;
    }
    _release(slot) {
      const rec = this.live.get(slot); if (!rec) return;
      this.live.delete(slot);
      this.studio.useSource(rec.cfg.source === 'clean' || rec.cfg.source === 'overlays' ? rec.cfg.source : null, false);
      if (rec.tap) { try { rec.tapSrc.disconnect(rec.tap); rec.tap.disconnect(); } catch { /* noop */ } }
    }
    stop(slot) { if (!this.live.has(slot)) return; this._release(slot); window.bts.decklinkKey.stop(`dlk-${slot}`); this.studio.emit('decklink-key'); }
    stopAll() { for (const s of [...this.live.keys()]) this.stop(s); }

    async _audio(rec, bus) {
      const enc = this.studio.outputs && this.studio.outputs.encoder;
      if (!enc || !(await enc.tapReady)) return;
      const a = this.studio.audio, b = a.buses[bus] || a.buses.M;
      const src = bus === 'M' || !a.buses[bus] ? a.limiter : b.post;
      const node = new AudioWorkletNode(a.ctx, 'bts-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      const mute = a.ctx.createGain(); mute.gain.value = 0;
      src.connect(node); node.connect(mute); mute.connect(a.ctx.destination);
      node.port.onmessage = (e) => window.bts.decklinkKey.audio(rec.id, e.data.data);
      rec.tap = node; rec.tapSrc = src;
    }

    _source(rec) {
      const st = this.studio, s = rec.cfg.source || 'overlays';
      if (s === 'overlays' || s === 'clean') return st.sourceCanvas(s);
      if (s === 'program') return st.programCanvas;
      if (String(s).startsWith('input:')) { // one input with its own transparency (e.g. a title or a keyed camera)
        const i = st.byId(s.slice(6)); if (!i) return null;
        const c = rec.scratch || (rec.scratch = document.createElement('canvas'));
        if (c.width !== rec.w || c.height !== rec.h) { c.width = rec.w; c.height = rec.h; rec.sg = c.getContext('2d', { alpha: true }); }
        rec.sg.clearRect(0, 0, rec.w, rec.h);
        if (i.type === 'title' && !i.live) i.drawStatic(rec.sg, 0, 0, rec.w, rec.h); else i.draw(rec.sg, 0, 0, rec.w, rec.h);
        return c;
      }
      return null;
    }

    _tick(rec, now) {
      if (now - rec.last < 1000 / rec.fps - 2) return;
      if (rec.busy) { rec.dropped++; return; }
      let src = this._source(rec); if (!src) return;
      rec.last = now;
      if (src.width !== rec.w || src.height !== rec.h) {
        const c = rec.canvas || (rec.canvas = document.createElement('canvas'));
        if (c.width !== rec.w || c.height !== rec.h) { c.width = rec.w; c.height = rec.h; rec.g = c.getContext('2d', { alpha: true }); rec.g.imageSmoothingQuality = 'high'; }
        rec.g.clearRect(0, 0, rec.w, rec.h); rec.g.drawImage(src, 0, 0, rec.w, rec.h); src = c;
      }
      let vf;
      try { vf = new VideoFrame(src, { timestamp: Math.round(now * 1000), alpha: 'keep' }); } catch { rec.errors++; return; }
      const buf = new Uint8Array(rec.w * rec.h * 4);
      rec.busy = true;
      const send = () => { rec.busy = false; rec.frames++; window.bts.decklinkKey.frame(rec.id, buf); };
      vf.copyTo(buf, { format: 'BGRA' }).then(() => { vf.close(); send(); }).catch(() => {
        try { vf.close(); } catch { /* noop */ }
        // fallback: canvas readback (RGBA) swapped to BGRA
        const c = rec.rb || (rec.rb = document.createElement('canvas'));
        if (c.width !== rec.w || c.height !== rec.h) { c.width = rec.w; c.height = rec.h; rec.rg = c.getContext('2d', { willReadFrequently: true }); }
        rec.rg.clearRect(0, 0, rec.w, rec.h); rec.rg.drawImage(src, 0, 0);
        const d = rec.rg.getImageData(0, 0, rec.w, rec.h).data;
        for (let i = 0; i < d.length; i += 4) { buf[i] = d[i + 2]; buf[i + 1] = d[i + 1]; buf[i + 2] = d[i]; buf[i + 3] = d[i + 3]; }
        send();
      });
    }
  }

  DecklinkKey.SLOTS = SLOTS;
  BTS.DecklinkKey = DecklinkKey;
})(window.BTS);
