/* BTS Studio — NDI® outputs.
 * Up to 4 NDI senders. Each takes a source (Output, Clean feed, Preview, a multiview or an input), reads the
 * frame back from the GPU as BGRA with VideoFrame.copyTo (asynchronous, never blocks rendering) and hands it to
 * the main process, which sends it through the installed NDI runtime. Audio comes from the chosen mix bus.
 */
(function (BTS) {
  'use strict';
  const U = BTS.U;
  const SLOTS = 4;

  const TAP = 'bts-tap'; // AudioWorklet registered by the encode engine (s16 stereo blocks)

  class NdiOut {
    constructor(studio) {
      this.studio = studio;
      this.live = new Map(); // slot -> rec
      studio.on('frame', (now) => { for (const r of this.live.values()) { try { this._tick(r, now); } catch (e) { r.errors++; } } });
    }
    cfg() {
      const s = BTS.settings; s.ndi = s.ndi || {};
      const n = s.ndi;
      n.outputs = n.outputs || [];
      for (let i = 0; i < SLOTS; i++) n.outputs[i] = { enabled: false, name: i ? `BTS Studio ${i + 1}` : 'BTS Studio', source: i ? 'clean' : 'program', size: 'project', fps: 0, bus: 'M', ...(n.outputs[i] || {}) };
      return n;
    }
    save() { return window.bts.settings.set(BTS.settings); }
    isLive(slot) { return this.live.has(slot); }
    status(slot) { const r = this.live.get(slot); return r ? { frames: r.frames, dropped: r.dropped, name: r.name, w: r.w, h: r.h } : null; }

    async start(slot) {
      const c = this.cfg().outputs[slot];
      this.stop(slot);
      const st = this.studio;
      const fps = c.fps || st.fps;
      const id = `ndi-out-${slot}`;
      const r = await window.bts.ndi.send(id, { name: c.name, fps, groups: this.cfg().groups || '' });
      if (!r.ok) { U.toast(`NDI output ${slot + 1}: ${r.error}`, 'error', 8000); return false; }
      const size = c.size === '1080' ? [1920, 1080] : c.size === '720' ? [1280, 720] : c.size === '2160' ? [3840, 2160] : [st.W, st.H];
      const rec = { slot, id, cfg: c, name: r.name, w: size[0], h: size[1], fps, last: 0, busy: false, frames: 0, dropped: 0, errors: 0, canvas: null };
      if (c.source === 'clean') { st.cleanUsers = (st.cleanUsers || 0) + 1; rec.clean = true; }
      if (c.source === 'overlays') { st.useSource('overlays', true); rec.ovl = true; rec.alpha = true; } // send with transparency
      if (String(c.source).startsWith('multiview:')) { rec.mv = st.multiviews.get(c.source.slice(10)); if (rec.mv) rec.mv.users++; }
      await this._audio(rec, c.bus || 'M');
      this.live.set(slot, rec);
      this.studio.emit('ndi-out');
      return true;
    }
    stop(slot) {
      const rec = this.live.get(slot);
      if (!rec) return;
      this.live.delete(slot);
      if (rec.clean) this.studio.cleanUsers = Math.max(0, (this.studio.cleanUsers || 1) - 1);
      if (rec.ovl) this.studio.useSource('overlays', false);
      if (rec.mv) rec.mv.users = Math.max(0, rec.mv.users - 1);
      if (rec.tap) { try { rec.tapSrc.disconnect(rec.tap); rec.tap.disconnect(); } catch { /* noop */ } }
      window.bts.ndi.sendStop(rec.id);
      this.studio.emit('ndi-out');
    }
    async startAll() { const c = this.cfg(); for (let i = 0; i < SLOTS; i++) if (c.outputs[i].enabled && !this.isLive(i)) await this.start(i); }
    stopAll() { for (const s of [...this.live.keys()]) this.stop(s); }

    async _audio(rec, bus) {
      const enc = this.studio.outputs && this.studio.outputs.encoder;
      if (!enc || !(await enc.tapReady)) return;
      const a = this.studio.audio, b = a.buses[bus] || a.buses.M;
      const src = bus === 'M' || !a.buses[bus] ? a.limiter : b.post;
      const node = new AudioWorkletNode(a.ctx, TAP, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      const mute = a.ctx.createGain(); mute.gain.value = 0;
      src.connect(node); node.connect(mute); mute.connect(a.ctx.destination);
      node.port.onmessage = (e) => window.bts.ndi.audio(rec.id, e.data.data);
      rec.tap = node; rec.tapSrc = src;
    }

    _source(rec) {
      const st = this.studio, s = rec.cfg.source;
      if (s === 'program') return st.programCanvas;
      if (s === 'clean') return st.cleanCanvas || st.programCanvas;
      if (s === 'overlays') return st.overlayCanvas || null;
      if (s === 'preview') return st.previewCanvas;
      if (String(s).startsWith('multiview:')) return rec.mv ? rec.mv.canvas : null;
      if (String(s).startsWith('input:')) {
        const i = st.byId(s.slice(6)); if (!i) return null;
        const sc = rec.scratch || (rec.scratch = document.createElement('canvas'));
        if (sc.width !== rec.w || sc.height !== rec.h) { sc.width = rec.w; sc.height = rec.h; rec.sg = sc.getContext('2d', { alpha: false }); }
        rec.sg.fillStyle = '#000'; rec.sg.fillRect(0, 0, rec.w, rec.h);
        if (i.type === 'title' && !i.live) i.drawStatic(rec.sg, 0, 0, rec.w, rec.h); else i.draw(rec.sg, 0, 0, rec.w, rec.h);
        return sc;
      }
      return null;
    }

    _tick(rec, now) {
      if (now - rec.last < 1000 / rec.fps - 2) return;
      if (rec.busy) { rec.dropped++; return; }
      let src = this._source(rec); if (!src) return;
      rec.last = now;
      if (src.width !== rec.w || src.height !== rec.h) { // scale to the output size
        const c = rec.canvas || (rec.canvas = document.createElement('canvas'));
        if (c.width !== rec.w || c.height !== rec.h) { c.width = rec.w; c.height = rec.h; rec.g = c.getContext('2d', { alpha: !!rec.alpha }); rec.g.imageSmoothingQuality = 'high'; }
        if (rec.alpha) rec.g.clearRect(0, 0, rec.w, rec.h);
        rec.g.drawImage(src, 0, 0, rec.w, rec.h); src = c;
      }
      let vf;
      try { vf = new VideoFrame(src, { timestamp: Math.round(now * 1000), alpha: rec.alpha ? 'keep' : 'discard' }); } catch { rec.errors++; return; }
      const size = rec.w * rec.h * 4;
      const buf = new Uint8Array(size);
      rec.busy = true;
      const done = (fmt) => { rec.busy = false; rec.frames++; window.bts.ndi.video(rec.id, rec.w, rec.h, buf, fmt); };
      vf.copyTo(buf, { format: 'BGRA' }).then(() => { vf.close(); done(rec.alpha ? 'BGRA' : 'BGRX'); }).catch(() => {
        // older drivers: no conversion on readback — fall back to the canvas pixels (RGBA)
        try { vf.close(); } catch { /* noop */ }
        const c = rec.rb || (rec.rb = document.createElement('canvas'));
        if (c.width !== rec.w || c.height !== rec.h) { c.width = rec.w; c.height = rec.h; rec.rg = c.getContext('2d', { willReadFrequently: true }); }
        rec.rg.drawImage(src, 0, 0); buf.set(rec.rg.getImageData(0, 0, rec.w, rec.h).data);
        done(rec.alpha ? 'RGBA' : 'RGBX');
      });
    }
  }

  NdiOut.SLOTS = SLOTS;
  BTS.NdiOut = NdiOut;
})(window.BTS);
