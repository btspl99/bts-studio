'use strict';
/**
 * Studio core — input list, preview/program bus, transitions & T-bar, stingers,
 * 4 overlay channels, fade-to-black, render loop, multiview, project (de)serialisation.
 */
(function (BTS) {
  const U = BTS.U;

  const TIMER_WORKER = `let id=null; onmessage=(e)=>{ if(id) clearInterval(id); if(e.data>0) id=setInterval(()=>postMessage(performance.now()), e.data); };`;

  class Studio extends BTS.Emitter {
    constructor(settings) {
      super();
      this.bus = this;
      this.settings = settings;
      this.W = settings.video.width; this.H = settings.video.height; this.fps = settings.video.fps;
      this.inputs = [];
      this.previewId = null; this.programId = null;
      this.frameId = 0;
      this.overlays = [0, 1, 2, 3].map(() => ({ inputId: null, state: 'off', t0: 0, dur: 0, type: 'Fade', duration: 500, preview: false }));
      this.ftb = { on: false, t0: 0, from: 0, value: 0, duration: 1000 };
      this.transitions = {
        quickPlay: { type: 'Fade', duration: 1000 },
        buttons: [{ type: 'Fade', duration: 500 }, { type: 'Merge', duration: 1000 }, { type: 'Wipe', duration: 800 }, { type: 'Stinger1', duration: 0 }],
        stingers: { Stinger1: { path: '', cutPoint: 500 }, Stinger2: { path: '', cutPoint: 500 } },
        lastType: 'Fade'
      };
      this.active = null;      // running transition
      this.tbar = { value: 0, reversed: false, dragging: false };
      this.stats = { fps: 0, renderMs: 0, dropped: 0, perfLevel: 0 };
      this.perf = { level: 0, previewEvery: 1, thumbEvery: 3, multiviewEvery: 2, healthy: 0 };
      this.liveSet = new Set();
      this.audio = new BTS.AudioEngine(settings.audio.sampleRate || 48000);
      this.gl = new BTS.GLProcessor(Math.max(1920, this.W), Math.max(1080, this.H));
      this.stingerEls = {};
      this.previewOverlays = false;
      this._setupCanvases();
      this._startLoop();
      // hot-plug: when a capture device comes back, reconnect inputs that lost it
      navigator.mediaDevices.addEventListener('devicechange', BTS.U.debounce(() => {
        for (const i of this.inputs) if (['camera', 'audio'].includes(i.type) && i.status === 'error') i.init();
        this.emit('devices');
      }, 800));
      this.on('input-ended', (inp) => {
        if (this.macros) this.macros.fire(inp, 'Completion');
        if (inp.id === this.programId && inp.props.onEnd === 'next' && this.previewId) this.quickPlay();
        if (inp.id === this.programId && inp.props.onEnd === 'next-input') { const n = this.inputs[this.inputs.indexOf(inp) + 1]; if (n) this.quickPlay(n.id); }
      });
    }

    _setupCanvases() {
      this.programCanvas = U.$('#programCanvas');
      this.previewCanvas = U.$('#previewCanvas');
      this.multiviewCanvas = U.$('#multiviewCanvas');
      this.programCanvas.width = this.W; this.programCanvas.height = this.H;
      const ps = Math.min(1, 1280 / this.W);
      this.previewCanvas.width = Math.round(this.W * ps); this.previewCanvas.height = Math.round(this.H * ps);
      this.multiviewCanvas.width = 1920; this.multiviewCanvas.height = 1080;
      this.pctx = this.programCanvas.getContext('2d', { alpha: false, desynchronized: false });
      this.vctx = this.previewCanvas.getContext('2d', { alpha: false });
      this.mctx = this.multiviewCanvas.getContext('2d', { alpha: false });
      this.pctx.imageSmoothingQuality = 'high'; this.vctx.imageSmoothingQuality = 'medium'; this.mctx.imageSmoothingQuality = 'low';
    }

    setVideoFormat(w, h, fps) {
      this.W = w; this.H = h; this.fps = fps;
      this.programCanvas.width = w; this.programCanvas.height = h;
      const ps = Math.min(1, 1280 / w);
      this.previewCanvas.width = Math.round(w * ps); this.previewCanvas.height = Math.round(h * ps);
      for (const i of this.inputs) if (['color', 'scene'].includes(i.type)) i.init();
      this._startLoop();
      this.emit('format');
    }

    /* ---------------- inputs ---------------- */
    byId(id) { return this.inputs.find(i => i.id === id) || null; }
    resolve(ref) {
      if (ref == null || ref === '') return null;
      if (typeof ref === 'object') return ref;
      const s = String(ref).trim();
      if (/^\d+$/.test(s)) return this.inputs[+s - 1] || null;
      return this.byId(s) || this.inputs.find(i => i.title.toLowerCase() === s.toLowerCase()) || null;
    }
    get preview() { return this.byId(this.previewId); }
    get program() { return this.byId(this.programId); }

    async addInput(data, { select = true } = {}) {
      const inp = BTS.Inputs.create(this, data);
      this.inputs.push(inp);
      inp.on('status', () => this.emit('input-status', inp));
      this.emit('inputs');
      try { await inp.init(); } catch (e) { console.error(e); inp.setStatus('error', e.message); }
      if (inp.channel) this.emit('mixer');
      if (select && !this.previewId) this.previewId = inp.id;
      if (!this.programId && this.inputs.length === 1 && !data.noAutoProgram) { this.programId = inp.id; this.previewId = inp.id; this._updateLive(); }
      this.emit('inputs'); this.emit('bus');
      return inp;
    }

    removeInput(ref) {
      const inp = this.resolve(ref);
      if (!inp) return;
      if (this.active && (this.active.from === inp.id || this.active.to === inp.id)) this._finishTransition();
      this.overlays.forEach((o) => { if (o.inputId === inp.id) { o.inputId = null; o.state = 'off'; } });
      for (const s of this.inputs) if (s.type === 'scene') s.cfg.layers = s.cfg.layers.filter(l => l.inputId !== inp.id);
      if (this.outputs) this.outputs.stopIso(inp.id);
      inp.setLive(false);
      inp.destroy();
      this.inputs.splice(this.inputs.indexOf(inp), 1);
      if (this.previewId === inp.id) this.previewId = null;
      if (this.programId === inp.id) this.programId = null;
      this._updateLive();
      this.emit('inputs'); this.emit('bus'); this.emit('mixer');
    }

    moveInput(ref, toIndex) {
      const inp = this.resolve(ref); if (!inp) return;
      const i = this.inputs.indexOf(inp);
      this.inputs.splice(i, 1);
      this.inputs.splice(U.clamp(toIndex, 0, this.inputs.length), 0, inp);
      this.emit('inputs'); this.emit('mixer');
    }

    async duplicateInput(ref) {
      const inp = this.resolve(ref); if (!inp) return;
      const d = inp.serialize(); d.id = undefined; d.title = inp.title + ' (copy)'; d.noAutoProgram = true;
      if (d.type === 'browser' || d.type === 'camera' || d.type === 'screen') { /* separate instance */ }
      return this.addInput(d, { select: false });
    }

    renameInput(ref, title) { const inp = this.resolve(ref); if (inp) { inp.title = title; this.emit('inputs'); this.emit('mixer'); this.emit('bus'); } }

    /* ---------------- switching ---------------- */
    setPreview(ref) {
      const inp = this.resolve(ref); if (!inp) return false;
      this.previewId = inp.id; this.emit('bus'); return true;
    }

    cut(ref) {
      if (ref != null) { const inp = this.resolve(ref); if (!inp) return false; if (inp.id === this.programId) return true; this.previewId = inp.id; }
      if (!this.previewId) return false;
      if (this.active) this._finishTransition();
      const from = this.programId;
      this.programId = this.previewId;
      this.previewId = from || this.previewId;
      this.transitions.lastType = 'Cut';
      this._resetTbar();
      this._updateLive();
      this.emit('bus'); this.emit('transition', { type: 'Cut' });
      return true;
    }

    /** Cut directly to program without touching preview (vMix CutDirect) */
    cutDirect(ref) {
      const inp = this.resolve(ref); if (!inp) return false;
      if (this.active) this._finishTransition();
      this.programId = inp.id; this._updateLive(); this.emit('bus'); return true;
    }

    transition(type, duration, ref) {
      if (ref != null) { const inp = this.resolve(ref); if (!inp) return false; if (inp.id === this.programId) return true; this.previewId = inp.id; }
      if (!this.previewId) return false;
      if (type === 'Cut' || !type) return this.cut();
      if (this.active) { this._finishTransition(); }
      const from = this.programId, to = this.previewId;
      if (from === to) return true;
      let dur = Math.max(0, duration ?? 1000);
      const stinger = BTS.Transitions.isStinger(type) ? this._stinger(type) : null;
      if (BTS.Transitions.isStinger(type) && !stinger) { BTS.U.toast(`${type} has no video assigned — using Fade`, 'error'); type = 'Fade'; }
      if (stinger) { dur = (stinger.el.duration || 1) * 1000; stinger.el.currentTime = 0; stinger.el.play().catch(() => {}); }
      if (dur === 0) return this.cut();
      this.active = { type, from, to, start: performance.now(), duration: dur, manual: false, stinger };
      this.transitions.lastType = type;
      this._updateLive();
      this.emit('transition', { type, duration: dur });
      return true;
    }

    quickPlay(ref) { const q = this.transitions.quickPlay; return this.transition(q.type, q.duration, ref); }
    transitionButton(n, ref) { const b = this.transitions.buttons[n - 1]; if (!b) return false; return this.transition(b.type, b.duration, ref); }

    _stinger(type) {
      const cfg = this.transitions.stingers[type];
      if (!cfg || !cfg.path) return null;
      let s = this.stingerEls[type];
      if (!s || s.path !== cfg.path) {
        const el = document.createElement('video');
        el.muted = false; el.preload = 'auto'; el.playsInline = true;
        window.bts.file.url(cfg.path).then(u => { el.src = u; el.load(); });
        s = this.stingerEls[type] = { el, path: cfg.path };
        try { const src = this.audio.ctx.createMediaElementSource(el); src.connect(this.audio.buses.M.sum); } catch { /* noop */ }
      }
      if (s.el.readyState < 2) return null;
      return { el: s.el, cutPoint: (cfg.cutPoint || 0) / 1000 };
    }
    preloadStingers() { for (const k of Object.keys(this.transitions.stingers)) this._stinger(k); }

    _finishTransition() {
      const a = this.active; if (!a) return;
      this.active = null;
      if (a.stinger) a.stinger.el.pause();
      this.programId = a.to;
      this.previewId = a.from || a.to;
      this._resetTbar();
      this._updateLive();
      this.emit('bus');
    }

    _resetTbar() { if (!this.tbar.dragging) { this.tbar.value = this.tbar.reversed ? 1 : 0; } this.emit('tbar'); }

    /** T-bar position 0..1 (physical). */
    setTbar(v, { release = false } = {}) {
      v = U.clamp(v, 0, 1);
      this.tbar.value = v;
      const p = this.tbar.reversed ? 1 - v : v;
      if (!this.active && p > 0.001 && this.previewId && this.previewId !== this.programId) {
        let type = this.transitions.lastType;
        if (!type || type === 'Cut' || BTS.Transitions.isStinger(type)) type = 'Fade';
        this.active = { type, from: this.programId, to: this.previewId, start: 0, duration: 1, manual: true };
        this._updateLive();
      }
      if (this.active && this.active.manual) {
        this.active.progress = p;
        if (p >= 0.999) { this.tbar.reversed = !this.tbar.reversed; this._finishTransition(); }
        else if (release && p <= 0.001) { this.active = null; this._updateLive(); }
      }
      this.emit('tbar');
    }

    fadeToBlack(force) {
      const on = force == null ? !this.ftb.on : !!force;
      if (on === this.ftb.on) return;
      this.ftb.on = on; this.ftb.t0 = performance.now(); this.ftb.from = this.ftb.value;
      this.emit('ftb', on);
    }

    /* ---------------- overlays ---------------- */
    overlay(n, ref, action = 'toggle') {
      const o = this.overlays[n - 1]; if (!o) return false;
      const inp = ref != null ? this.resolve(ref) : (action === 'off' || action === 'out' ? null : this.preview);
      if (action === 'off') { if (o.inputId) { const old = this.byId(o.inputId); o.inputId = null; o.state = 'off'; this._updateLive(); if (old) old.emit('state'); } this.emit('overlays'); return true; }
      if (action === 'out' || (action === 'toggle' && o.inputId && (!inp || o.inputId === inp.id) && (o.state === 'on' || o.state === 'in'))) { this._overlayOut(o); return true; }
      if (!inp) return false;
      if (action === 'preview') { o.preview = !o.preview; if (o.preview && !o.inputId) o.pvInputId = inp.id; this.emit('overlays'); return true; }
      if (o.inputId && o.inputId !== inp.id && o.state !== 'off') { o.inputId = null; o.state = 'off'; }
      o.inputId = inp.id;
      o.state = 'in'; o.t0 = performance.now();
      o.dur = inp.type === 'title' ? 0 : (o.type === 'Cut' ? 0 : o.duration);
      this._updateLive();
      this.emit('overlays');
      return true;
    }
    _overlayOut(o) {
      const inp = this.byId(o.inputId);
      if (!inp) { o.state = 'off'; o.inputId = null; this.emit('overlays'); return; }
      const titleDur = inp.animateOut();
      o.state = 'out'; o.t0 = performance.now();
      o.dur = inp.type === 'title' ? titleDur : (o.type === 'Cut' ? 0 : o.duration);
      o.titleOut = inp.type === 'title';
      this.emit('overlays');
    }
    overlayAllOff() { this.overlays.forEach((o, i) => { if (o.inputId) this.overlay(i + 1, null, 'out'); }); }

    /* ---------------- live set ---------------- */
    _collect(inp, set, depth = 0) {
      if (!inp || set.has(inp) || depth > 5) return;
      set.add(inp);
      if (inp.type === 'scene') for (const c of inp.children()) this._collect(c, set, depth + 1);
    }
    _updateLive() {
      const set = new Set();
      this._collect(this.program, set);
      if (this.active) { this._collect(this.byId(this.active.to), set); this._collect(this.byId(this.active.from), set); }
      for (const o of this.overlays) if (o.inputId && o.state !== 'off') this._collect(this.byId(o.inputId), set);
      for (const inp of this.inputs) inp.setLive(set.has(inp));
      this.liveSet = set;
    }

    /* ---------------- render loop ---------------- */
    _startLoop() {
      if (this.worker) this.worker.terminate();
      this.worker = new Worker(URL.createObjectURL(new Blob([TIMER_WORKER], { type: 'application/javascript' })));
      const interval = 1000 / this.fps;
      let last = 0, frames = 0, fpsT = performance.now(), meterFlip = 0;
      this.worker.onmessage = () => {
        const now = performance.now();
        // when the page falls behind, queued ticks arrive in a burst — drop them instead of rendering the backlog
        if (last && now - last < interval * 0.5) return;
        if (last && now - last > interval * 1.8) this.stats.dropped += Math.max(1, Math.round((now - last) / interval) - 1);
        last = now;
        const t0 = performance.now();
        try { this.renderFrame(now); } catch (e) { console.error('render', e); }
        const dt = performance.now() - t0;
        this.stats.renderMs = this.stats.renderMs * 0.9 + dt * 0.1;
        frames++;
        if (now - fpsT >= 1000) { this.stats.fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; this._governor(); this.emit('stats', this.stats); }
        if ((meterFlip = (meterFlip + 1) % 2) === 0) { this.audio.tickMeters(); this.emit('meters'); }
      };
      this.worker.postMessage(interval);
    }

    /** Adaptive load governor: protects the programme output by reducing preview / thumbnail / multiview rates under load. */
    _governor() {
      const P = this.perf, s = this.stats;
      if (this.settings.performance && this.settings.performance.governor === false) { P.level = 0; } else {
        const budget = 1000 / this.fps;
        const struggling = s.fps < this.fps * 0.88 || s.renderMs > budget * 0.7;
        if (struggling) { P.healthy = 0; if (P.level < 3) P.level++; }
        else if (++P.healthy >= 5 && P.level > 0) { P.level--; P.healthy = 0; }
      }
      const base = Math.max(1, Math.round(this.fps / ((this.settings.performance && this.settings.performance.thumbnailFps) || 10)));
      P.previewEvery = [1, 2, 3, 4][P.level];
      P.thumbEvery = base * [1, 2, 4, 8][P.level];
      P.multiviewEvery = [2, 3, 4, 6][P.level];
      s.perfLevel = P.level;
    }

    renderFrame(now) {
      this.frameId++;
      // transitions
      const a = this.active;
      let tp = 0;
      if (a) {
        if (a.manual) tp = a.progress || 0;
        else if (a.stinger) { tp = a.stinger.el.duration ? a.stinger.el.currentTime / a.stinger.el.duration : 1; if (a.stinger.el.ended || tp >= 0.999) { this._finishTransition(); } }
        else { tp = (now - a.start) / a.duration; if (tp >= 1) { this._finishTransition(); } }
      }
      // overlays state machine
      for (const o of this.overlays) {
        if (o.state === 'in' && now - o.t0 >= o.dur) { o.state = 'on'; this.emit('overlays'); }
        if (o.state === 'out' && now - o.t0 >= o.dur) { o.state = 'off'; o.inputId = null; this._updateLive(); this.emit('overlays'); }
      }
      // FTB
      const f = this.ftb;
      const target = f.on ? 1 : 0;
      if (f.value !== target) { const p = U.clamp((now - f.t0) / f.duration, 0, 1); f.value = U.lerp(f.from, target, p); }

      this._drawProgram(this.pctx, this.W, this.H, now, tp);
      if (this.frameId % this.perf.previewEvery === 0) this._drawPreview(this.vctx, this.previewCanvas.width, this.previewCanvas.height);
      if (this.multiviewVisible || this.multiviewPopout) { if (this.frameId % this.perf.multiviewEvery === 0) { try { this._drawMultiview(); } catch (e) { console.error(e); } } }
      this.emit('frame', now);
    }

    _drawInput(ctx, inp, W, H) { if (inp) inp.draw(ctx, 0, 0, W, H); }

    _drawProgram(ctx, W, H, now, tp) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const a = this.active;
      if (a) {
        const A = this.byId(a.from), B = this.byId(a.to);
        if (a.stinger) {
          const st = a.stinger;
          this._drawInput(ctx, st.el.currentTime < st.cutPoint ? A : B, W, H);
          if (st.el.readyState >= 2) { const r = U.fit(st.el.videoWidth, st.el.videoHeight, W, H, 'cover'); ctx.drawImage(st.el, r.x, r.y, r.w, r.h); }
        } else {
          BTS.Transitions.draw(a.type, ctx, W, H, U.clamp(tp, 0, 1), (c) => this._drawInput(c, A, W, H), (c) => this._drawInput(c, B, W, H));
        }
      } else this._drawInput(ctx, this.program, W, H);

      for (const o of this.overlays) {
        if (!o.inputId || o.state === 'off') continue;
        const inp = this.byId(o.inputId); if (!inp) continue;
        let p = 1;
        if (o.dur > 0 && !(o.titleOut && o.state === 'out')) {
          const lp = U.clamp((now - o.t0) / o.dur, 0, 1);
          p = o.state === 'in' ? U.ease.out(lp) : o.state === 'out' ? 1 - U.ease.in(lp) : 1;
        }
        if (inp.type === 'title') p = 1;
        this._drawOverlay(ctx, inp, o.type, p, W, H);
      }
      if (this.ftb.value > 0) { ctx.save(); ctx.globalAlpha = this.ftb.value; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    }

    _drawOverlay(ctx, inp, type, p, W, H) {
      if (p <= 0) return;
      ctx.save();
      switch (type) {
        case 'Zoom': ctx.globalAlpha = p; ctx.translate(W / 2, H / 2); ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p); ctx.translate(-W / 2, -H / 2); break;
        case 'Slide': ctx.translate(-(1 - p) * W, 0); break;
        case 'SlideRight': ctx.translate((1 - p) * W, 0); break;
        case 'SlideUp': ctx.translate(0, (1 - p) * H); break;
        case 'Wipe': ctx.beginPath(); ctx.rect(0, 0, W * p, H); ctx.clip(); break;
        case 'Cut': break;
        default: ctx.globalAlpha = p;
      }
      inp.draw(ctx, 0, 0, W, H);
      ctx.restore();
    }

    _drawPreview(ctx, W, H) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const pv = this.preview;
      if (pv) { if (pv.type === 'title' && !pv.live) pv.drawStatic(ctx, 0, 0, W, H); else pv.draw(ctx, 0, 0, W, H); }
      if (this.previewOverlays) {
        for (const o of this.overlays) { if (o.inputId && o.state !== 'off') { const i = this.byId(o.inputId); if (i) i.draw(ctx, 0, 0, W, H); } }
      }
      for (const o of this.overlays) { if (o.preview && o.pvInputId) { const i = this.byId(o.pvInputId); if (i) i.draw(ctx, 0, 0, W, H); } }
    }

    _drawMultiview() {
      const ctx = this.mctx, W = 1920, H = 1080;
      ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, W, H);
      const big = { w: W / 2 - 6, h: (W / 2 - 6) * 9 / 16 };
      const label = (x, y, w, h, text, color) => {
        ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(x, y + h - 30, w, 30);
        ctx.fillStyle = '#fff'; ctx.font = '600 20px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, x + w / 2, y + h - 15);
        if (color) { ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5); }
      };
      ctx.drawImage(this.previewCanvas, 4, 4, big.w, big.h);
      label(4, 4, big.w, big.h, 'PREVIEW — ' + (this.preview ? this.preview.title : '—'), '#2fbf62');
      ctx.drawImage(this.programCanvas, W / 2 + 2, 4, big.w, big.h);
      label(W / 2 + 2, 4, big.w, big.h, 'PROGRAM — ' + (this.program ? this.program.title : '—'), '#e2453c');
      const cols = 4, rows = 2, top = big.h + 12;
      const cw = (W - 8 - (cols - 1) * 6) / cols, chh = Math.min((H - top - 4 - (rows - 1) * 6) / rows, cw * 9 / 16);
      const ch = chh, cww = ch * 16 / 9;
      const offX = (W - (cww * cols + 6 * (cols - 1))) / 2;
      for (let i = 0; i < cols * rows; i++) {
        const inp = this.inputs[i];
        const x = offX + (i % cols) * (cww + 6), y = top + Math.floor(i / cols) * (ch + 6);
        ctx.fillStyle = '#000'; ctx.fillRect(x, y, cww, ch);
        if (!inp) continue;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, cww, ch); ctx.clip();
        if (inp.type === 'title' && !inp.live) inp.drawStatic(ctx, x, y, cww, ch); else inp.draw(ctx, x, y, cww, ch);
        ctx.restore();
        const color = inp.id === this.programId || this.liveSet.has(inp) ? '#e2453c' : inp.id === this.previewId ? '#2fbf62' : null;
        label(x, y, cww, ch, `${i + 1}  ${inp.title}`, color);
        if (inp.channel) {
          const pk = Math.max(...inp.channel.peak); const hgt = U.clamp((U.db(pk) + 60) / 60, 0, 1) * (ch - 36);
          ctx.fillStyle = pk > 0.89 ? '#e2453c' : pk > 0.5 ? '#f5c344' : '#2fbf62'; ctx.fillRect(x + cww - 12, y + ch - 32 - hgt, 6, hgt);
        }
      }
      // clock / status
      ctx.fillStyle = '#f0a53a'; ctx.font = '700 22px Segoe UI'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(new Date().toLocaleTimeString(), W - 14, H - 10);
    }

    snapshot() { return this.programCanvas.toDataURL('image/png'); }
    thumbOf(ref) {
      const c = document.createElement('canvas'); c.width = 480; c.height = 270;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 480, 270);
      if (ref === 'program') ctx.drawImage(this.programCanvas, 0, 0, 480, 270);
      else if (ref === 'preview') ctx.drawImage(this.previewCanvas, 0, 0, 480, 270);
      else { const i = this.resolve(ref); if (i) { if (i.type === 'title' && !i.live) i.drawStatic(ctx, 0, 0, 480, 270); else i.draw(ctx, 0, 0, 480, 270); } }
      return c.toDataURL('image/jpeg', 0.7);
    }

    /* ---------------- project ---------------- */
    serialize() {
      return {
        app: 'BTS Studio', version: 1,
        video: { width: this.W, height: this.H, fps: this.fps },
        inputs: this.inputs.map(i => i.serialize()),
        previewId: this.previewId, programId: this.programId,
        overlays: this.overlays.map(o => ({ type: o.type, duration: o.duration })),
        transitions: U.deepClone(this.transitions),
        master: { M: { volume: this.audio.buses.M.volume, muted: this.audio.buses.M.muted }, A: { volume: this.audio.buses.A.volume, muted: this.audio.buses.A.muted }, B: { volume: this.audio.buses.B.volume, muted: this.audio.buses.B.muted } },
        dataSources: this.data ? this.data.serialize() : [],
        macros: this.macros ? this.macros.serialize() : [],
        replay: this.replay ? this.replay.serialize() : null,
        playlist: this.sequencer ? this.sequencer.serialize() : null,
        previewOverlays: this.previewOverlays
      };
    }

    async clear() {
      if (this.active) this._finishTransition();
      for (const o of this.overlays) { o.inputId = null; o.state = 'off'; }
      for (const i of [...this.inputs]) { i.setLive(false); i.destroy(); }
      this.inputs = []; this.previewId = null; this.programId = null;
      this.ftb.on = false; this.ftb.value = 0;
      if (this.data) this.data.clear();
      if (this.sequencer) this.sequencer.stop();
      if (this.macros) this.macros.stopAll();
      if (this.replay && this.replay.running) this.replay.stop();
      this.emit('inputs'); this.emit('bus'); this.emit('mixer'); this.emit('overlays');
    }

    async load(p) {
      await this.clear();
      if (p.video && (p.video.width !== this.W || p.video.height !== this.H || p.video.fps !== this.fps)) this.setVideoFormat(p.video.width, p.video.height, p.video.fps);
      if (p.transitions) this.transitions = Object.assign(this.transitions, p.transitions);
      (p.overlays || []).forEach((o, i) => { if (this.overlays[i]) Object.assign(this.overlays[i], { type: o.type || 'Fade', duration: o.duration ?? 500 }); });
      if (p.master) for (const k of ['M', 'A', 'B']) if (p.master[k]) { this.audio.setBusVolume(k, p.master[k].volume ?? 1); this.audio.setBusMute(k, !!p.master[k].muted); }
      this.previewOverlays = !!p.previewOverlays;
      // add non-scene inputs first so scenes can reference them
      const list = p.inputs || [];
      const ordered = [...list.filter(d => d.type !== 'scene'), ...list.filter(d => d.type === 'scene')];
      const created = new Map();
      for (const d of ordered) { const inp = await this.addInput({ ...d, noAutoProgram: true }, { select: false }); created.set(d.id, inp); }
      // restore the original order
      this.inputs = list.map(d => created.get(d.id)).filter(Boolean);
      this.previewId = this.byId(p.previewId) ? p.previewId : null;
      this.programId = this.byId(p.programId) ? p.programId : null;
      if (this.data && p.dataSources) this.data.load(p.dataSources);
      if (this.macros) this.macros.load(p.macros || []);
      if (this.replay && p.replay) this.replay.loadCfg(p.replay);
      if (this.sequencer) this.sequencer.load(p.playlist);
      this.preloadStingers();
      this._updateLive();
      this.emit('inputs'); this.emit('bus'); this.emit('mixer'); this.emit('overlays'); this.emit('transitions-config');
    }

    /** compact state for API/web controller */
    apiState() {
      return {
        version: this.version || '1.0.0',
        inputs: this.inputs.map((i, n) => ({
          id: i.id, number: n + 1, type: i.type, title: i.title, state: i.isMedia ? (i.playing ? 'Running' : 'Paused') : 'Running',
          duration: i.duration, position: i.currentTime, loop: !!i.props.loop,
          muted: i.channel ? i.channel.s.muted : null, volume: i.channel ? Math.round(U.gainToFader(i.channel.s.volume) * 100) : null,
          fields: i.type === 'title' && i.renderer ? i.renderer.fields.filter(e => e.type !== 'rect').map(e => ({ name: e.name, type: e.type, value: e.type === 'image' ? e.src : e.text })) : undefined,
          items: i.type === 'playlist' ? i.cfg.items.map(x => U.baseName(x.path)) : undefined, index: i.type === 'playlist' ? i.index : undefined,
          live: i.live
        })),
        preview: this.preview ? this.preview.number : 0,
        active: this.program ? this.program.number : 0,
        previewId: this.previewId, programId: this.programId,
        overlays: this.overlays.map(o => (o.inputId && o.state !== 'off' ? this.byId(o.inputId)?.number || 0 : 0)),
        ftb: this.ftb.on,
        transitions: this.transitions.buttons.map(b => ({ type: b.type, duration: b.duration })),
        quickPlay: this.transitions.quickPlay,
        streaming: this.outputs ? this.outputs.isStreaming() : false,
        recording: this.outputs ? this.outputs.isRecording() : false,
        master: { volume: Math.round(U.gainToFader(this.audio.buses.M.volume) * 100), muted: this.audio.buses.M.muted },
        dataSources: this.data ? this.data.sources.map(s => ({ name: s.name, row: s.row, rows: s.rows.length })) : []
      };
    }
  }

  BTS.Studio = Studio;
})(window.BTS);
