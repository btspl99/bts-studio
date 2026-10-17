'use strict';
/**
 * Input types: Camera, Screen, Video/Audio file, Image, Playlist (List), Colour/Bars,
 * Web Browser (HTML overlay), Title, Scene (layers), Audio device.
 */
(function (BTS) {
  const U = BTS.U;

  const TYPE_INFO = {
    camera: { label: 'Camera', icon: '🎥' },
    stream: { label: 'Stream / IP Cam', icon: '📡' },
    capture: { label: 'Capture (native)', icon: '📼' },
    ndi: { label: 'NDI', icon: '📶' },
    replay: { label: 'Replay', icon: '⏪' },
    screen: { label: 'Desktop Capture', icon: '🖥️' },
    video: { label: 'Video', icon: '🎞️' },
    'audio-file': { label: 'Audio File', icon: '🎵' },
    image: { label: 'Image', icon: '🖼️' },
    playlist: { label: 'List', icon: '📃' },
    color: { label: 'Colour', icon: '🎨' },
    browser: { label: 'Web Browser', icon: '🌐' },
    title: { label: 'Title', icon: '🅃' },
    scene: { label: 'Scene', icon: '🧩' },
    audio: { label: 'Audio Input', icon: '🎙️' },
    proaudio: { label: 'Audio Device (Pro)', icon: '🎚️' },
    mix: { label: 'Mix', icon: '🔀' },
    delay: { label: 'Video Delay', icon: '⏱️' }
  };

  const DEFAULT_PROPS = () => ({
    position: { zoom: 1, panX: 0, panY: 0, rotate: 0, fit: 'contain', borderWidth: 0, borderColor: '#ffffff', shadow: false, radius: 0 },
    crop: { l: 0, r: 0, t: 0, b: 0 },
    effects: {
      color: { enabled: false, brightness: 0, contrast: 1, saturation: 1, hue: 0, gamma: 1, temperature: 0, tint: 0 },
      chroma: { enabled: false, color: '#00ff00', similarity: 400, smoothness: 80, spill: 100 },
      luma: { enabled: false, low: 0, high: 0.15, smooth: 0.03, invert: true }
    },
    opacity: 1,
    autoPlay: true, autoPause: true, autoRestart: false, loop: false,
    markIn: null, markOut: null
  });

  class Input extends BTS.Emitter {
    constructor(app, data = {}) {
      super();
      this.app = app;
      this.id = data.id || U.uid('in');
      this.type = data.type;
      this.title = data.title || TYPE_INFO[this.type]?.label || 'Input';
      this.props = Object.assign(DEFAULT_PROPS(), U.deepClone(data.props || {}));
      for (const k of ['position', 'crop']) this.props[k] = Object.assign(DEFAULT_PROPS()[k], data.props?.[k] || {});
      this.props.effects = Object.assign(DEFAULT_PROPS().effects, data.props?.effects || {});
      this.cfg = U.deepClone(data.cfg || {});
      this.status = 'loading'; this.statusMsg = '';
      this.live = false;
      this.channel = null;
      this.fxCanvas = document.createElement('canvas');
      this._fxFrame = -1; this._fxResult = null;
      this.iso = false;
      this._audioData = data.audio;
    }

    get info() { return TYPE_INFO[this.type] || { label: this.type, icon: '?' }; }
    get hasVideo() { return true; }
    get hasAudio() { return !!this.channel; }
    get isMedia() { return false; }
    get number() { return this.app.inputs.indexOf(this) + 1; }

    setStatus(s, msg = '') { this.status = s; this.statusMsg = msg; this.emit('status', s, msg); }
    ensureChannel() {
      if (!this.channel) { this.channel = this.app.audio.createChannel(this._audioData || {}); }
      return this.channel;
    }

    /** raw frame {src, w, h} */
    getFrame() { return null; }
    /** frame counters for the Statistics module (live sources only) */
    frameStats() {
      if (this._fc == null) return null;
      const now = performance.now(), dt = now - (this._fsT || now);
      if (!this._fsT || dt >= 1000) { this._fps = this._fsT ? Math.round((this._fc - this._fsN) * 10000 / dt) / 10 : 0; this._fsT = now; this._fsN = this._fc; }
      return { mode: 'device', fps: this._fps || 0, received: this._fc, decoded: this._fc, dropped: this._drops || 0, errors: 0, width: this.el ? this.el.videoWidth : 0, height: this.el ? this.el.videoHeight : 0 };
    }

    fxActive() {
      const fx = this.props.effects;
      return (fx.color && fx.color.enabled) || (fx.chroma && fx.chroma.enabled) || (fx.luma && fx.luma.enabled) || !!fx.deinterlace || (fx.sharpen > 0) || !!(fx.lut && fx.lut.enabled && fx.lut.path);
    }

    /** processed frame for this render tick */
    frame() {
      const fid = this.app.frameId;
      if (this._fxFrame === fid) return this._fxResult;
      this._fxFrame = fid;
      let f = this.getFrame();
      if (this.props.videoDelay > 0) f = this._delay(f);
      else if (this._ring) this._dropDelay();
      if (!f || !f.w || !f.h) return (this._fxResult = null);
      if (!f.processed && this.fxActive() && this.app.gl.ok) {
        // never process above what can be seen: output size × this input's zoom (keeps 4K sharp, saves GPU at 1080p)
        const z = Math.max(1, (this.props.position && this.props.position.zoom) || 1);
        const out = this.app.gl.process(f.src, f.w, f.h, this.props.effects, this.fxCanvas, [Math.ceil(this.app.W * z), Math.ceil(this.app.H * z)]);
        if (out) return (this._fxResult = this._post({ src: out, w: out.width, h: out.height, scaleBack: f.w / out.width }));
      }
      return (this._fxResult = this._post(f));
    }

    /** Digital PTZ: glide zoom / pan to a target over ms (ease in-out), on any input */
    moveTo(target, ms = 1000) {
      const P = this.props.position, from = { zoom: P.zoom ?? 1, panX: P.panX ?? 0, panY: P.panY ?? 0 };
      const to = { zoom: target.zoom ?? from.zoom, panX: target.panX ?? from.panX, panY: target.panY ?? from.panY };
      if (this._moveOff) this._moveOff();
      if (!(ms > 0)) { Object.assign(P, to); this.emit('position'); return; }
      const t0 = performance.now();
      this._moveOff = this.app.on('frame', (now) => {
        const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        // zoom moves geometrically so it feels even; pan linearly
        P.zoom = from.zoom * Math.pow(to.zoom / from.zoom, e); P.panX = from.panX + (to.panX - from.panX) * e; P.panY = from.panY + (to.panY - from.panY) * e;
        if (k >= 1) { this._moveOff(); this._moveOff = null; this.emit('position'); }
      });
    }
    ptzPreset(n, ms) {
      const pr = (this.props.dptz || [])[n - 1];
      if (!pr) return false;
      this.moveTo(pr, ms ?? pr.ms ?? 1500);
      return true;
    }

    /** 2D post effects: Gaussian blur and alpha mask (image), and layers drawn on top of this input */
    _post(f) {
      const fx = this.props.effects || {};
      const blur = fx.blur > 0 ? fx.blur : 0;
      const mask = fx.mask && fx.mask.enabled && fx.mask.path ? fx.mask : null;
      const layers = this.type !== 'scene' && this.props.layers && this.props.layers.some(l => l.visible !== false && l.inputId) ? this.props.layers : null;
      if (!blur && !mask && !layers) return f;
      const c = this._postCanvas || (this._postCanvas = document.createElement('canvas'));
      if (c.width !== f.w || c.height !== f.h) { c.width = f.w; c.height = f.h; c._g = c.getContext('2d'); c._g.imageSmoothingQuality = 'high'; }
      const g = c._g;
      g.clearRect(0, 0, f.w, f.h);
      g.filter = blur ? `blur(${(blur * f.w / 1920).toFixed(1)}px)` : 'none';
      g.drawImage(f.src, 0, 0, f.w, f.h);
      g.filter = 'none';
      if (mask) {
        const img = this._maskImg(mask);
        if (img) { g.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in'; g.drawImage(img, 0, 0, f.w, f.h); g.globalCompositeOperation = 'source-over'; }
      }
      if (layers && !this._inLayers) { // up to 10 other inputs drawn over this one (vMix "layers")
        this._inLayers = true;
        try {
          for (const l of layers.slice(0, 10)) {
            if (l.visible === false) continue;
            const inp = this.app.byId(l.inputId);
            if (!inp || inp === this || (inp.containsInput && inp.containsInput(this.id))) continue;
            g.save(); if (l.opacity != null && l.opacity < 1) g.globalAlpha = l.opacity;
            inp.draw(g, (l.x ?? 0) * f.w, (l.y ?? 0) * f.h, (l.w ?? 1) * f.w, (l.h ?? 1) * f.h);
            g.restore();
          }
        } finally { this._inLayers = false; }
      }
      return { src: c, w: f.w, h: f.h, scaleBack: f.scaleBack };
    }
    /** mask image (PNG with alpha, or a black-and-white picture used as luminance) */
    _maskImg(m) {
      if (this._mask && this._mask.key === m.path + '|' + m.mode) return this._mask.ready ? this._mask.c : null;
      const rec = this._mask = { key: m.path + '|' + m.mode, ready: false, c: null };
      (async () => {
        const img = new Image();
        img.src = /^(https?|file|data):/i.test(m.path) ? m.path : await window.bts.file.url(m.path);
        await img.decode().catch(() => {});
        if (!img.naturalWidth || this._mask !== rec) return;
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        if (m.mode === 'luma') { // white = visible, black = hidden
          const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
          for (let i = 0; i < p.length; i += 4) { p[i + 3] = (p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722) * (p[i + 3] / 255); }
          g.putImageData(d, 0, 0);
        }
        rec.c = c; rec.ready = true;
      })();
      return null;
    }
    containsInput(id) { return !!(this.props.layers && this.props.layers.some(l => l.inputId === id)); }
    /** inputs shown inside this one (tally, autoplay): its layers */
    children() { return (this.props.layers || []).filter(l => l.visible !== false).map(l => this.app.byId(l.inputId)).filter(Boolean); }

    /** Per-input video delay (lip-sync, up to 1 s): keeps recent frames in a ring of canvases */
    _delay(f) {
      const ms = Math.min(1000, this.props.videoDelay), now = performance.now();
      if (!this._ring) { this._ring = []; this._pool = []; this._delayOff = this.app.on('frame', () => { try { this.frame(); } catch { /* noop */ } }); }
      if (f && f.w && f.h && !f.processed) {
        const s = Math.min(1, this.app.W / f.w, this.app.H / f.h) || 1; // never store above project size
        const w = Math.max(2, Math.round(f.w * s)), h = Math.max(2, Math.round(f.h * s));
        let c = this._pool.pop();
        if (!c || c.width !== w || c.height !== h) { c = document.createElement('canvas'); c.width = w; c.height = h; c._g = c.getContext('2d', { alpha: true }); }
        c._g.clearRect(0, 0, w, h); c._g.drawImage(f.src, 0, 0, w, h);
        this._ring.push({ t: now, c });
      }
      let pick = null;
      while (this._ring.length > 1 && now - this._ring[1].t >= ms) this._pool.push(this._ring.shift().c);
      if (this._ring.length && now - this._ring[0].t >= ms - 1) pick = this._ring[0].c;
      if (this._pool.length > 4) this._pool.length = 4;
      return pick ? { src: pick, w: pick.width, h: pick.height } : null;
    }
    _dropDelay() { if (this._delayOff) this._delayOff(); this._delayOff = null; this._ring = null; this._pool = null; }

    /** Draw into ctx within target rect — fault-isolated so one bad source never stops the engine */
    draw(ctx, tx = 0, ty = 0, tw = ctx.canvas.width, th = ctx.canvas.height) {
      if (this._suspendUntil && performance.now() < this._suspendUntil) return this._slate(ctx, tx, ty, tw, th);
      try {
        const ok = this._draw(ctx, tx, ty, tw, th);
        this._faults = 0;
        if (!ok && this.wantsSlate && this.wantsSlate()) this._slate(ctx, tx, ty, tw, th);
        return ok;
      } catch (e) {
        try { ctx.restore(); } catch { /* noop */ }
        if (++this._faults > 20) { this._suspendUntil = performance.now() + 2000; this._faults = 0; console.error(`[input ${this.title}] suspended after repeated errors`, e); window.bts.log('error', `Input ${this.title}: ${e.message}`); }
        return false;
      }
    }
    /** "No signal" slate for live devices */
    _slate(ctx, x, y, w, h) {
      const c = Input._slateCanvas || (Input._slateCanvas = document.createElement('canvas'));
      if (c.width !== 640) { c.width = 640; c.height = 360; }
      const g = c.getContext('2d');
      g.fillStyle = '#0d0e11'; g.fillRect(0, 0, 640, 360);
      for (let i = 0; i < 640; i += 40) { g.fillStyle = i % 80 ? '#15171c' : '#111317'; g.fillRect(i, 0, 40, 360); }
      g.fillStyle = '#e2453c'; g.font = '700 38px Segoe UI'; g.textAlign = 'center'; g.fillText('NO SIGNAL', 320, 170);
      g.fillStyle = '#a9adb7'; g.font = '500 20px Segoe UI'; g.fillText(this.title + (this.statusMsg ? ' — ' + this.statusMsg.slice(0, 40) : ''), 320, 210);
      const r = BTS.U.fit(640, 360, w, h);
      ctx.drawImage(c, x + r.x, y + r.y, r.w, r.h);
      return false;
    }
    _draw(ctx, tx = 0, ty = 0, tw = ctx.canvas.width, th = ctx.canvas.height) {
      const f = this.frame();
      if (!f) return false;
      const P = this.props.position, C = this.props.crop;
      const w = f.w, h = f.h;
      const base = U.fit(w, h, tw, th, P.fit || 'contain');
      const z = P.zoom || 1;
      const bw = base.w * z, bh = base.h * z;
      const bx = tx + base.x + (base.w - bw) / 2 + (P.panX || 0) * tw;
      const by = ty + base.y + (base.h - bh) / 2 + (P.panY || 0) * th;
      const sx = (C.l || 0) * w, sy = (C.t || 0) * h;
      const sw = w * (1 - (C.l || 0) - (C.r || 0)), sh = h * (1 - (C.t || 0) - (C.b || 0));
      if (sw <= 1 || sh <= 1) return false;
      const dx = bx + (C.l || 0) * bw, dy = by + (C.t || 0) * bh, dw = bw * (sw / w), dh = bh * (sh / h);
      ctx.save();
      if (this.props.opacity < 1) ctx.globalAlpha *= this.props.opacity;
      if (P.rotate) { const cx = dx + dw / 2, cy = dy + dh / 2; ctx.translate(cx, cy); ctx.rotate(P.rotate * Math.PI / 180); ctx.translate(-cx, -cy); }
      if (P.flipH || P.flipV) { const cx = dx + dw / 2, cy = dy + dh / 2; ctx.translate(cx, cy); ctx.scale(P.flipH ? -1 : 1, P.flipV ? -1 : 1); ctx.translate(-cx, -cy); }
      if (P.shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = Math.max(8, tw * 0.012); ctx.shadowOffsetY = tw * 0.004; }
      if (P.radius) {
        const r = Math.min(P.radius * (tw / 1920), dw / 2, dh / 2);
        if (P.shadow) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, r); ctx.fill(); ctx.shadowColor = 'transparent'; }
        ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, r); ctx.clip();
      }
      try { ctx.drawImage(f.src, sx, sy, sw, sh, dx, dy, dw, dh); } catch { /* source not ready */ }
      ctx.restore();
      if (P.borderWidth > 0) {
        ctx.save();
        if (P.rotate) { const cx = dx + dw / 2, cy = dy + dh / 2; ctx.translate(cx, cy); ctx.rotate(P.rotate * Math.PI / 180); ctx.translate(-cx, -cy); }
        const lw = P.borderWidth * (tw / 1920);
        ctx.lineWidth = lw; ctx.strokeStyle = P.borderColor || '#fff';
        ctx.beginPath();
        if (P.radius) ctx.roundRect(dx - lw / 2, dy - lw / 2, dw + lw, dh + lw, Math.min(P.radius * (tw / 1920), dw / 2, dh / 2) + lw / 2); else ctx.rect(dx - lw / 2, dy - lw / 2, dw + lw, dh + lw);
        ctx.stroke(); ctx.restore();
      }
      return true;
    }

    // media controls (overridden)
    play() { } pause() { } restart() { } seek() { } next() { } prev() { } togglePlay() { this.playing ? this.pause() : this.play(); }
    get playing() { return false; }
    get duration() { return 0; }
    get currentTime() { return 0; }

    setLive(on) {
      if (this.live === on) return;
      this.live = on;
      if (this.channel) this.channel.setOnAir(on);
      if (this.isMedia) {
        if (on) { if (this.props.autoRestart) this.restart(); if (this.props.autoPlay) this.play(); }
        else if (this.props.autoPause) this.pause();
      }
      this.onLive(on);
      if (this.app.macros) this.app.macros.fire(this, on ? 'TransitionIn' : 'TransitionOut');
      this.emit('live', on);
    }
    onLive() { }
    /** time needed to animate out (titles) */
    animateOut() { return 0; }

    async init() { this.setStatus('ok'); }
    update(cfg) { Object.assign(this.cfg, cfg); return this.init(); }
    destroy() {
      this.destroyed = true;
      this._dropDelay();
      if (this.channel) { this.app.audio.removeChannel(this.channel); this.channel = null; }
      this.emit('destroy');
    }
    serialize() {
      return { id: this.id, type: this.type, title: this.title, props: U.deepClone(this.props), cfg: U.deepClone(this.cfg), audio: this.channel ? this.channel.serialize() : this._audioData };
    }
    /** stream for ISO recording */
    getMediaStream() { return null; }
  }

  /* ---------------- Colour / Bars ---------------- */
  class ColorInput extends Input {
    async init() {
      const c = this.canvas || (this.canvas = document.createElement('canvas'));
      const W = this.app.W, H = this.app.H;
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      const mode = this.cfg.mode || 'solid';
      ctx.clearRect(0, 0, W, H);
      if (mode === 'solid') { ctx.fillStyle = this.cfg.color || '#000000'; ctx.fillRect(0, 0, W, H); }
      else if (mode === 'gradient') { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, this.cfg.color || '#14161b'); g.addColorStop(1, this.cfg.color2 || '#3a2a12'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      else if (mode === 'bars') {
        const cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
        const bw = W / 7;
        cols.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(i * bw, 0, bw + 1, H * 0.67); });
        const cols2 = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
        cols2.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(i * bw, H * 0.67, bw + 1, H * 0.08); });
        const cols3 = ['#00214c', '#ffffff', '#32006a', '#131313', '#090909', '#131313', '#1d1d1d', '#131313'];
        const w3 = [1.25, 1.25, 1.25, 1.25, 1 / 3, 1 / 3, 1 / 3, 1];
        let x = 0; cols3.forEach((col, i) => { const ww = w3[i] * bw; ctx.fillStyle = col; ctx.fillRect(x, H * 0.75, ww + 1, H * 0.25); x += ww; });
        ctx.fillStyle = '#fff'; ctx.font = `600 ${H * 0.035}px Segoe UI`; ctx.textAlign = 'center'; ctx.fillText(this.cfg.label || 'BTS STUDIO', W / 2, H * 0.88);
      } else if (mode === 'checker') {
        const s = H / 12; for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) { ctx.fillStyle = ((x + y) / s) % 2 ? '#2a2a2a' : '#444'; ctx.fillRect(x, y, s, s); }
      }
      // transparent: leave cleared
      this.setStatus('ok');
    }
    getFrame() { return this.canvas ? { src: this.canvas, w: this.canvas.width, h: this.canvas.height } : null; }
  }

  /* ---------------- Image ---------------- */
  class ImageInput extends Input {
    async init() {
      this.setStatus('loading');
      const img = new Image();
      img.decoding = 'async';
      const src = /^(https?|file|data):/i.test(this.cfg.path || '') ? this.cfg.path : await window.bts.file.url(this.cfg.path);
      await new Promise((res) => { img.onload = res; img.onerror = res; img.src = src; });
      if (!img.naturalWidth) { this.setStatus('error', 'Cannot load image'); return; }
      this.img = img;
      this.isGif = /\.gif$/i.test(this.cfg.path || '');
      this.setStatus('ok');
    }
    getFrame() { return this.img ? { src: this.img, w: this.img.naturalWidth, h: this.img.naturalHeight } : null; }
  }

  /* ---------------- Auto-convert (AVI, WMV, MXF, MPEG-2, ProRes…) ---------------- */
  // Containers/codecs Chromium cannot decode are transcoded once to an H.264/AAC proxy by FFmpeg (cached).
  const CONVERT_EXT = /\.(avi|wmv|asf|mxf|mpg|mpeg|m2v|vob|ts|m2ts|mts|flv|f4v|3gp|3g2|divx|dv|rm|rmvb|ogv|gxf|mod|tod|qt|wma|aif|aiff|ac3|mp2)$/i;
  const PROBE_EXT = /\.(mov|mkv|mp4|m4v)$/i;
  const probeCache = new Map();
  async function playableUrl(input, file, force = false) {
    if (!file || /^(https?|data|blob|file|rtmp|rtsp|srt|udp):/i.test(file)) return file;
    const ms = (BTS.settings && BTS.settings.media) || {};
    if (window.bts.media && (force || ms.autoConvert !== false)) {
      let convert = force || CONVERT_EXT.test(file);
      if (!convert && PROBE_EXT.test(file)) {
        if (!probeCache.has(file)) probeCache.set(file, window.bts.media.needsConvert(file).then(r => r.convert).catch(() => false));
        convert = await probeCache.get(file);
      }
      if (convert) {
        input.setStatus('loading', 'Converting for playback…');
        const off = window.bts.media.onProgress((m) => { if (m.file === file && m.state === 'progress') input.setStatus('loading', `Converting ${Math.round(m.progress * 100)}%`); });
        try { file = await window.bts.media.convert(file, { quality: ms.convertQuality || 'fast' }); input.converted = file; }
        catch (e) { input.setStatus('error', String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); off(); return null; }
        off();
      }
    }
    return window.bts.file.url(file);
  }

  /* ---------------- Video / Audio file ---------------- */
  class VideoInput extends Input {
    get isMedia() { return true; }
    get isAudioOnly() { return this.type === 'audio-file'; }
    async init() {
      this.setStatus('loading');
      this._createEl();
      this._curPath = this.cfg.path; this._triedConvert = false;
      const src = await playableUrl(this, this.cfg.path);
      if (!src) return;
      if (this.el.src !== src) { this.el.src = src; this.el.load(); }
      this.el.loop = !!this.props.loop && this.props.markOut == null;
      if (this.isAudioOnly) this._initAudioVis();
    }
    _createEl() {
      if (!this.el) {
        const el = this.el = document.createElement(this.isAudioOnly ? 'audio' : 'video');
        el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
        el.addEventListener('ended', () => this._onEnded());
        el.preservesPitch = false;
        el.addEventListener('loadedmetadata', () => { el.playbackRate = this.props.speed || 1; });
        el.addEventListener('timeupdate', () => this._onTime());
        el.addEventListener('error', () => {
          // Unsupported codec inside a normally-playable container (e.g. HEVC without the extension, ProRes): convert once.
          if (el.error && (el.error.code === 4 || el.error.code === 3) && this._curPath && !this._triedConvert && !/^[a-z]+:/i.test(this._curPath)) {
            this._triedConvert = true;
            const t = el.currentTime;
            playableUrl(this, this._curPath, true).then(src => { if (src) { el.src = src; el.load(); if (t) this.seek(t); if (this.live && this.props.autoPlay) this.play(); } });
            return;
          }
          this.setStatus('error', el.error ? `Media error ${el.error.code}: ${el.error.message || ''}` : 'Media error');
        });
        el.addEventListener('loadeddata', () => this.setStatus('ok'));
        el.addEventListener('play', () => this.emit('state'));
        el.addEventListener('pause', () => this.emit('state'));
        const ch = this.ensureChannel();
        try { ch.setSource(this.app.audio.ctx.createMediaElementSource(el)); } catch (e) { console.warn(e); }
      }
    }
    _initAudioVis() {
      const c = this.vis || (this.vis = document.createElement('canvas'));
      c.width = 640; c.height = 360;
    }
    _onTime() {
      const { markIn, markOut } = this.props;
      if (markOut != null && this.el.currentTime >= markOut) {
        if (this.props.loop) this.el.currentTime = markIn || 0; else { this.el.pause(); this.el.currentTime = markOut; this.emit('ended'); }
      }
      this.emit('time');
    }
    _onEnded() { this.emit('ended'); this.emit('state'); this.app.bus.emit('input-ended', this); }
    getFrame() {
      if (this.isAudioOnly) {
        const c = this.vis, ctx = c.getContext('2d');
        ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, c.width, c.height);
        const pk = this.channel ? Math.max(...this.channel.peak) : 0;
        ctx.fillStyle = '#f0a53a';
        for (let i = 0; i < 32; i++) { const h = (Math.sin(i * 1.7 + performance.now() / 300) * 0.5 + 0.5) * pk * 260 + 4; ctx.fillRect(40 + i * 18, 200 - h / 2, 12, h); }
        ctx.fillStyle = '#ddd'; ctx.font = '600 24px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('♪ ' + U.baseName(this.cfg.path || ''), 320, 320);
        return { src: c, w: c.width, h: c.height };
      }
      const el = this.el;
      if (!el || el.readyState < 2 || !el.videoWidth) return null;
      return { src: el, w: el.videoWidth, h: el.videoHeight };
    }
    play() { if (this.el) { if (this.el.ended) this.el.currentTime = this.props.markIn || 0; this.el.play().catch(() => {}); } }
    pause() { if (this.el) this.el.pause(); }
    restart() { if (this.el) this.el.currentTime = this.props.markIn || 0; }
    seek(t) {
      if (!this.el || !isFinite(t)) return;
      if (this.el.readyState < 1 || !this.duration) { this.el.addEventListener('loadedmetadata', () => this.seek(t), { once: true }); return; } // defer until the media is known
      this.el.currentTime = U.clamp(t, 0, this.duration);
    }
    get playing() { return !!this.el && !this.el.paused && !this.el.ended; }
    get duration() { return this.el && isFinite(this.el.duration) ? this.el.duration : 0; }
    get currentTime() { return this.el ? this.el.currentTime : 0; }
    setLoop(v) { this.props.loop = v; if (this.el) this.el.loop = v && this.props.markOut == null; }
    setSpeed(v) { this.props.speed = v; if (this.el) this.el.playbackRate = v; this.emit('state'); }
    destroy() { if (this.el) { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); } super.destroy(); }
    getMediaStream() {
      if (!this.el || !this.el.captureStream) return null;
      if (!this._capStream || this._capStream.getTracks().every(t => t.readyState === 'ended')) this._capStream = this.el.captureStream();
      return this._capStream;
    }
  }

  /* ---------------- Playlist (List) ---------------- */
  class PlaylistInput extends VideoInput {
    get isAudioOnly() { return false; }
    async init() {
      this.cfg.items = this.cfg.items || [];
      this.index = U.clamp(this.cfg.index || 0, 0, Math.max(0, this.cfg.items.length - 1));
      this._createEl();
      this.img = this.img || new Image();
      this.imgTimer = null;
      await this.load(this.index, false);
    }
    get current() { return this.cfg.items[this.index]; }
    async load(i, autoplay) {
      const items = this.cfg.items;
      if (!items.length) { this.setStatus('error', 'List is empty'); return; }
      this.index = ((i % items.length) + items.length) % items.length;
      this.cfg.index = this.index;
      const it = items[this.index];
      const kind = U.kindOfFile(it.path);
      this._curPath = it.path; this._triedConvert = false;
      const url = kind === 'image' ? (/^(https?|file):/i.test(it.path) ? it.path : await window.bts.file.url(it.path)) : await playableUrl(this, it.path);
      if (!url) return;
      clearTimeout(this.imgTimer);
      this.curKind = kind;
      if (kind === 'image') {
        this.el.pause();
        await new Promise(res => { this.img.onload = res; this.img.onerror = res; this.img.src = url; });
        this.imgStart = performance.now();
        this.imgPaused = !autoplay;
        if (autoplay) this._scheduleImage();
      } else {
        this.el.src = url; this.el.load();
        this.el.loop = false;
        if (autoplay) this.el.play().catch(() => {});
      }
      this.setStatus('ok');
      this.emit('state'); this.emit('item', this.index);
    }
    _scheduleImage() {
      clearTimeout(this.imgTimer);
      const dur = (this.current.duration || 5) * 1000;
      this.imgTimer = setTimeout(() => this._onEnded(), dur);
    }
    _onEnded() {
      const last = this.index >= this.cfg.items.length - 1;
      if (this.cfg.shuffle) { this.load(Math.floor(Math.random() * this.cfg.items.length), true); return; }
      if (!last || this.props.loop) this.load(this.index + 1, true);
      else { this.emit('ended'); this.emit('state'); }
    }
    getFrame() {
      if (this.curKind === 'image') return this.img && this.img.naturalWidth ? { src: this.img, w: this.img.naturalWidth, h: this.img.naturalHeight } : null;
      const el = this.el; if (!el || el.readyState < 2 || !el.videoWidth) return null;
      return { src: el, w: el.videoWidth, h: el.videoHeight };
    }
    play() { if (this.curKind === 'image') { this.imgPaused = false; this._scheduleImage(); this.emit('state'); } else super.play(); }
    pause() { if (this.curKind === 'image') { this.imgPaused = true; clearTimeout(this.imgTimer); this.emit('state'); } else super.pause(); }
    restart() { this.load(0, this.playing); }
    next() { this.load(this.index + 1, this.playing || this.live); }
    prev() { this.load(this.index - 1, this.playing || this.live); }
    get playing() { return this.curKind === 'image' ? !this.imgPaused : super.playing; }
    get duration() { return this.curKind === 'image' ? (this.current?.duration || 5) : super.duration; }
    get currentTime() { return this.curKind === 'image' ? (this.imgPaused ? 0 : (performance.now() - this.imgStart) / 1000) : super.currentTime; }
    setLoop(v) { this.props.loop = v; }
    destroy() { clearTimeout(this.imgTimer); super.destroy(); }
  }

  /* ---------------- Camera / Capture card ---------------- */
  // Works with UVC webcams and capture cards exposed through Media Foundation / DirectShow:
  // Blackmagic DeckLink / UltraStudio / Intensity (WDM driver), AVerMedia Live Gamer, Elgato, Magewell, generic USB3/HDMI grabbers.
  const CARD_HINTS = [
    [/blackmagic|decklink|intensity|ultrastudio/i, 'Blackmagic: set the input format in Blackmagic Desktop Video Setup to match your source (e.g. 1080p50 or 1080i50). If the card is not listed, switch Settings → Devices → Capture backend to DirectShow.'],
    [/avermedia|live gamer|gc5\d\d|gc57/i, 'AVerMedia: close RECentral/Streaming Center before using the card here; choose the resolution and frame rate of your source.'],
    [/elgato|cam link|hd60/i, 'Elgato: close 4K Capture Utility; use the source\'s native resolution.'],
    [/magewell|usb capture/i, 'Magewell: native format recommended; audio appears as a separate device.'],
    [/usb3|hdmi|capture|video capture|ms2109|ms2130/i, 'HDMI capture device: select the source resolution/frame rate; audio is usually a separate "Digital Audio Interface" device.']
  ];
  const cardHint = (label) => (CARD_HINTS.find(([re]) => re.test(label || '')) || [])[1] || '';
  const tokens = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/).filter(t => t.length > 2 && !['video', 'audio', 'input', 'device', 'microphone', 'capture', 'usb'].includes(t));
  async function findPairedAudio(videoDev) {
    const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    if (!videoDev) return null;
    const same = list.find(d => d.groupId && d.groupId === videoDev.groupId);
    if (same) return same;
    const vt = tokens(videoDev.label);
    let best = null, score = 0;
    for (const d of list) { const sc = tokens(d.label).filter(t => vt.includes(t)).length; if (sc > score) { score = sc; best = d; } }
    if (best) return best;
    if (/usb3|hdmi|capture|ms21/i.test(videoDev.label)) return list.find(d => /digital audio interface|hdmi|capture|usb3/i.test(d.label)) || null;
    return null;
  }

  class CameraInput extends Input {
    wantsSlate() { return true; }
    async init() {
      this.setStatus('loading');
      this.stopStream();
      clearTimeout(this._retry);
      const c = this.cfg;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const vdev = devices.find(d => d.kind === 'videoinput' && d.deviceId === c.deviceId) || devices.find(d => d.kind === 'videoinput' && c.label && d.label === c.label);
      if (vdev && vdev.deviceId !== c.deviceId) c.deviceId = vdev.deviceId; // device IDs can change between sessions
      const video = { resizeMode: c.scale ? 'crop-and-scale' : 'none' };
      if (c.deviceId) video.deviceId = { exact: c.deviceId };
      if (c.width && c.height) { video.width = { ideal: c.width }; video.height = { ideal: c.height }; }
      if (c.fps) video.frameRate = { ideal: c.fps };
      let audioId = c.audioDeviceId;
      if (audioId === 'auto') { const pa = await findPairedAudio(vdev); audioId = pa ? pa.deviceId : 'none'; this.pairedAudio = pa ? pa.label : ''; }
      const audio = audioId && audioId !== 'none' ? { deviceId: { exact: audioId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: 48000 } : false;
      try {
        try { this.stream = await navigator.mediaDevices.getUserMedia({ video, audio }); }
        catch (e) {
          if (e.name !== 'OverconstrainedError' && e.name !== 'NotReadableError') throw e;
          // fall back to the device's default format (common with DeckLink when the format doesn't match the signal)
          this.stream = await navigator.mediaDevices.getUserMedia({ video: c.deviceId ? { deviceId: { exact: c.deviceId } } : true, audio });
          this.formatFallback = true;
        }
      } catch (e) {
        const msg = e.name === 'NotReadableError' ? 'Device busy or no signal (close other apps using it)' : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'Device not found — reconnect it' : (e.message || e.name);
        this.setStatus('error', msg);
        this._scheduleReconnect();
        return;
      }
      const el = this.el || (this.el = document.createElement('video'));
      el.muted = true; el.playsInline = true; el.srcObject = this.stream;
      await el.play().catch(() => {});
      this._lastFrameAt = performance.now();
      this._fc = 0; this._drops = 0; this._pf = null;
      const onFrame = (t, meta) => {
        this._lastFrameAt = performance.now(); this._fc++;
        // presentedFrames jumps when the browser skipped frames from the device
        if (meta && this._pf != null && meta.presentedFrames > this._pf + 1) this._drops += meta.presentedFrames - this._pf - 1;
        if (meta) this._pf = meta.presentedFrames;
        if (this.el === el && this.stream) el.requestVideoFrameCallback(onFrame);
      };
      if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(onFrame);
      const at = this.stream.getAudioTracks()[0];
      if (at) { const ch = this.ensureChannel(); ch.setSource(this.app.audio.ctx.createMediaStreamSource(new MediaStream([at]))); }
      else if (this.channel) this.channel.setSource(null);
      const vt = this.stream.getVideoTracks()[0];
      // "Auto" format: Chrome would open the device at 640×480. Pick the largest native mode that still runs at the show's frame rate.
      if (vt && !(c.width && c.height) && !this.formatFallback) await this._bestMode(vt);
      if (vt) {
        vt.addEventListener('ended', () => { this._grabLast(); this.setStatus('error', 'Signal lost / device disconnected'); this._scheduleReconnect(); });
        const s = vt.getSettings();
        this.trackInfo = `${s.width}×${s.height}@${Math.round(s.frameRate || 0)}${this.formatFallback ? ' (device default)' : ''}`;
        this.capabilities = vt.getCapabilities ? vt.getCapabilities() : null;
      }
      this.hint = cardHint(vdev && vdev.label);
      this._retries = 0;
      this.setStatus('ok');
    }
    async _bestMode(vt) {
      const cap = vt.getCapabilities ? vt.getCapabilities() : {};
      const maxW = (cap.width && cap.width.max) || 1920, maxH = (cap.height && cap.height.max) || 1080;
      const fpsMax = (cap.frameRate && cap.frameRate.max) || 30;
      const want = Math.min(this.app.fps || 30, fpsMax);
      const sizes = [[4096, 2160], [3840, 2160], [2560, 1440], [1920, 1200], [1920, 1080], [1600, 900], [1280, 720], [960, 540], [640, 360]]
        .filter(([w, h]) => w <= maxW && h <= maxH);
      for (const [w, h] of sizes) {
        try {
          await vt.applyConstraints({ width: { exact: w }, height: { exact: h }, frameRate: { min: Math.floor(want * 0.9), ideal: want }, resizeMode: 'none' });
          const got = vt.getSettings();
          if (!got.frameRate || got.frameRate >= want * 0.9) return true; // some drivers accept the mode but deliver fewer frames
        } catch { /* mode not offered at this frame rate — try the next size down */ }
      }
      try { await vt.applyConstraints({ width: { ideal: Math.min(maxW, 1920) }, height: { ideal: Math.min(maxH, 1080) }, frameRate: { ideal: want } }); } catch { /* keep device default */ }
      return false;
    }
    _scheduleReconnect() {
      if (this.destroyed || this.cfg.autoReconnect === false) return;
      clearTimeout(this._retry);
      this._retries = (this._retries || 0) + 1;
      this._retry = setTimeout(() => { if (!this.destroyed && this.status !== 'ok') this.init(); }, Math.min(15000, 2000 + this._retries * 1000));
    }
    _grabLast() {
      if (!this.el || !this.el.videoWidth || !this.cfg.keepLastFrame) return;
      const c = this.lastFrame || (this.lastFrame = document.createElement('canvas'));
      c.width = this.el.videoWidth; c.height = this.el.videoHeight;
      c.getContext('2d').drawImage(this.el, 0, 0);
    }
    get stalled() { return this.status === 'ok' && performance.now() - (this._lastFrameAt || 0) > 3000 && !!this.el.requestVideoFrameCallback; }
    getFrame() {
      const el = this.el;
      if (el && el.videoWidth && this.status === 'ok' && !this.stalled) return { src: el, w: el.videoWidth, h: el.videoHeight };
      if (this.cfg.keepLastFrame && this.lastFrame) return { src: this.lastFrame, w: this.lastFrame.width, h: this.lastFrame.height };
      return null;
    }
    fxActive() { return super.fxActive() || !!this.props.effects.deinterlace; }
    stopStream() { if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } }
    destroy() { clearTimeout(this._retry); this.stopStream(); super.destroy(); }
    getMediaStream() { return this.stream; }
  }

  /* ---------------- Screen / window capture ---------------- */
  class ScreenInput extends CameraInput {
    get stalled() { return false; } // desktop capture only sends frames when the screen changes
    async init() {
      this.setStatus('loading');
      this.stopStream();
      const c = this.cfg;
      try {
        const mandatory = { chromeMediaSource: 'desktop', chromeMediaSourceId: c.sourceId, maxWidth: 3840, maxHeight: 2160, maxFrameRate: c.fps || 30 };
        const audio = c.audio && navigator.userAgent.includes('Windows') ? { mandatory: { chromeMediaSource: 'desktop' } } : false;
        this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: { mandatory, cursor: c.cursor === false ? 'never' : 'always' } });
      } catch (e) {
        this.setStatus('error', 'Capture failed — reselect the screen/window. ' + (e.message || e.name));
        return;
      }
      const el = this.el || (this.el = document.createElement('video'));
      el.muted = true; el.srcObject = this.stream; await el.play().catch(() => {});
      const at = this.stream.getAudioTracks()[0];
      if (at) { const ch = this.ensureChannel(); ch.setSource(this.app.audio.ctx.createMediaStreamSource(new MediaStream([at]))); }
      this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.setStatus('error', 'Capture ended (window closed?)'));
      this.setStatus('ok');
    }
  }

  /* ---------------- Network stream (IP camera / SRT / RTMP / RTSP / HLS / UDP) ---------------- */
  // H.264 (and HEVC where the GPU supports it) is passed through untouched and decoded on the GPU with
  // WebCodecs; other codecs fall back to an MJPEG preview made by FFmpeg.
  let hevcOk = null;
  async function hevcSupported() {
    if (hevcOk === null) { try { hevcOk = !!(await VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L120.B0' })).supported; } catch { hevcOk = false; } }
    return hevcOk;
  }
  /** shared plumbing for inputs fed by FFmpeg/NDI through the media pipe */
  class PipeInput extends Input {
    wantsSlate() { return true; }
    async _audio() {
      if (this.cfg.audio === false) return;
      const ch = this.ensureChannel();
      const ok = await this.app.audio.workletReady;
      if (ok && !this.pcm) { this.pcm = new AudioWorkletNode(this.app.audio.ctx, 'bts-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }); ch.setSource(this.pcm); }
    }
    _pipe(port) {
      if (!this.pv) this.pv = new BTS.PipeVideo({ onError: (e) => this.onPipeError && this.onPipeError(e) });
      if (this.pv.port !== port || this.pv.closed) this.pv.connect(port);
    }
    onAudio(buf) { if (this.pcm) this.pcm.port.postMessage(buf, [buf.buffer]); }
    getFrame() {
      if (this.mode === 'mjpeg') { const i = this.img; return i && i.naturalWidth && this.status === 'ok' ? { src: i, w: i.naturalWidth, h: i.naturalHeight } : null; }
      if (!this.pv) return null;
      const f = this.pv.get();
      // hold the last frame briefly on a hiccup, then show the slate
      if (f && this.status !== 'ok' && !this.cfg.keepLastFrame && performance.now() - this.pv.stats.lastAt > 1500) return null;
      return f;
    }
    /** frame statistics for the Statistics window */
    frameStats() {
      const s = this.pv ? this.pv.stats : null;
      return s ? { mode: this.mode, codec: s.codec, fps: s.fps, received: s.received, decoded: s.decoded, dropped: s.dropped + (this._pipeDropped || 0), errors: s.errors, width: s.width, height: s.height } : { mode: this.mode };
    }
    destroy() { window.bts.stream.stop(this.id); if (this.img) this.img.src = ''; if (this.pv) this.pv.close(); super.destroy(); }
  }

  class StreamInput extends PipeInput {
    async init() {
      this.setStatus('loading', 'Connecting…');
      await window.bts.stream.stop(this.id);
      const cfg = { url: this.cfg.url, transport: this.cfg.transport || 'tcp', fps: this.cfg.fps || 30, width: this.cfg.width || 1920, quality: this.cfg.quality || 4, audio: this.cfg.audio !== false, lowLatency: this.cfg.lowLatency !== false, listen: !!this.cfg.listen,
        decode: this._forceMjpeg ? 'mjpeg' : (this.cfg.decode || 'auto'), hevc: await hevcSupported() };
      const r = await window.bts.stream.start(this.id, cfg);
      if (!r.ok) { this.setStatus('error', r.error); return; }
      this.port = r.port; this.mjpegPort = r.mjpegPort;
      this.mode = cfg.decode === 'mjpeg' ? 'mjpeg' : 'gpu';
      if (this.mode === 'gpu') this._pipe(this.port); else this._connectImg();
      await this._audio();
    }
    _connectImg() {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'sync';
      img.src = `http://127.0.0.1:${this.mjpegPort}/?t=${Date.now()}`;
      this.img = img;
    }
    onPipeError() { // GPU decoder can't handle this stream: switch to the compatibility path
      if (this._forceMjpeg) return;
      this._forceMjpeg = true;
      U.toast(`${this.title}: the GPU decoder can't play this stream — using compatibility mode`, 'info', 6000);
      this.init();
    }
    onStreamStatus(s) {
      if (s.state === 'live') {
        if (s.mode === 'mjpeg' && this.mode !== 'mjpeg') { this.mode = 'mjpeg'; if (this.pv) { this.pv.close(); this.pv = null; } }
        if (this.mode === 'mjpeg' && (this.status !== 'ok' || !this.img)) this._connectImg();
        this.codec = s.codec;
        this.setStatus('ok');
      }
      else if (s.state === 'reconnecting') this.setStatus('error', 'Reconnecting… ' + (s.message || ''));
      else if (s.state === 'error') this.setStatus('error', s.message || 'Stream error');
    }
  }

  /* ---------------- Native capture (DirectShow / DeckLink / V4L2 / AVFoundation) ---------------- */
  // FFmpeg opens the device with the exact port, format and mode; raw NV12 frames, no compression.
  class CaptureInput extends PipeInput {
    async init() {
      this.setStatus('loading', 'Opening device…');
      await window.bts.stream.stop(this.id);
      const c = this.cfg;
      if (!c.device) { this.setStatus('error', 'Choose a device'); return; }
      const r = await window.bts.stream.start(this.id, { kind: 'capture', backend: c.backend, device: c.device, audioDevice: c.audioDevice || '', audio: c.audio !== false,
        width: c.width || 0, height: c.height || 0, fps: c.fps || 0, outWidth: c.outWidth || c.width || this.app.W, outHeight: c.outHeight || c.height || this.app.H,
        devFormat: c.devFormat || 'auto', formatCode: c.formatCode || '', port: c.port ?? '', audioPort: c.audioPort ?? '', audioChannels: c.audioChannels || 2, audioPair: c.audioPair || 0, deinterlace: !!c.deinterlace });
      if (!r.ok) { this.setStatus('error', r.error); return; }
      this.mode = 'raw';
      this._pipe(r.port);
      await this._audio();
    }
    onStreamStatus(s) {
      if (s.state === 'live') { this.trackInfo = `${s.width}×${s.height} NV12 (native)`; this.setStatus('ok'); }
      else if (s.state === 'reconnecting') this.setStatus('error', (s.message || 'Reconnecting…'));
      else if (s.state === 'error') this.setStatus('error', s.message || 'Capture error');
    }
  }

  /* ---------------- NDI® source ---------------- */
  // Received through the NDI runtime installed on this PC; raw BGRA/BGRX frames, tally sent back to the source.
  class NdiInput extends PipeInput {
    async init() {
      this.setStatus('loading', 'Connecting to NDI source…');
      await window.bts.ndi.recvStop(this.id);
      if (!this.cfg.source) { this.setStatus('error', 'Choose an NDI source'); return; }
      const r = await window.bts.ndi.recv(this.id, { source: this.cfg.source, url: this.cfg.url || '', bandwidth: this.cfg.bandwidth || 'highest', audio: this.cfg.audio !== false, audioPair: this.cfg.audioPair || 0 });
      if (!r.ok) { this.setStatus('error', r.error); return; }
      this.mode = 'raw';
      this._pipe(r.port);
      await this._audio();
      if (!this._offBus) this._offBus = this.app.on('bus', () => this._tally());
      this._tally();
    }
    _tally() {
      const pgm = !!this.live, pvw = this.app.previewId === this.id;
      if (pgm === this._tp && pvw === this._tv) return;
      this._tp = pgm; this._tv = pvw;
      window.bts.ndi.tally(this.id, pgm, pvw);
    }
    onLive() { this._tally(); }
    onStreamStatus(s) {
      if (s.state === 'live') { this.trackInfo = `${s.width}×${s.height} @ ${s.fps} ${s.format} (NDI)`; this.setStatus('ok'); }
      else if (s.state === 'reconnecting') this.setStatus('error', s.message || 'NDI source offline');
      else if (s.state === 'error') this.setStatus('error', s.message || 'NDI error');
    }
    destroy() { if (this._offBus) this._offBus(); window.bts.ndi.recvStop(this.id); if (this.pv) this.pv.close(); Input.prototype.destroy.call(this); }
  }

  /* ---------------- Audio device ---------------- */
  class AudioDeviceInput extends Input {
    get hasVideo() { return false; }
    async init() {
      this.setStatus('loading');
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: this.cfg.deviceId ? { exact: this.cfg.deviceId } : undefined, echoCancellation: !!this.cfg.echo, noiseSuppression: !!this.cfg.noise, autoGainControl: false, channelCount: 2, sampleRate: 48000 } });
      } catch (e) { this.setStatus('error', e.message || e.name); return; }
      const ch = this.ensureChannel();
      ch.setSource(this.app.audio.ctx.createMediaStreamSource(this.stream));
      this.vis = this.vis || document.createElement('canvas'); this.vis.width = 640; this.vis.height = 360;
      this.setStatus('ok');
    }
    getFrame() {
      const c = this.vis; if (!c) return null;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#101216'; ctx.fillRect(0, 0, 640, 360);
      const [l, r] = this.channel ? this.channel.peak : [0, 0];
      const bar = (x, v) => { const h = U.clamp((U.db(v) + 60) / 60, 0, 1) * 240; const g = ctx.createLinearGradient(0, 300, 0, 60); g.addColorStop(0, '#2fbf62'); g.addColorStop(0.75, '#f5c344'); g.addColorStop(1, '#e2453c'); ctx.fillStyle = g; ctx.fillRect(x, 300 - h, 60, h); };
      bar(250, l); bar(330, r);
      ctx.fillStyle = '#ddd'; ctx.font = '600 22px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('🎙 ' + (this.cfg.label || this.title), 320, 340);
      return { src: c, w: 640, h: 360, processed: true };
    }
    destroy() { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); super.destroy(); }
    getMediaStream() { return this.stream; }
  }

  /* ---------------- Audio Device (Pro): ASIO / WASAPI exclusive / WDM-KS with VST3 effects ---------------- */
  // Runs in the native bts-audio helper; its 48 kHz stereo PCM arrives through the same path as stream audio.
  class ProAudioInput extends Input {
    get hasVideo() { return false; }
    async init() {
      this.setStatus('loading', 'Opening audio device…');
      this.cfg.vst = this.cfg.vst || [];
      await window.bts.proAudio.stop(this.id);
      if (this.cfg.device == null || this.cfg.device === '') { this.setStatus('error', 'Choose an audio device'); return; }
      const ch = this.ensureChannel();
      const ok = await this.app.audio.workletReady;
      if (ok && !this.pcm) { this.pcm = new AudioWorkletNode(this.app.audio.ctx, 'bts-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }); ch.setSource(this.pcm); }
      if (!this._offEv) this._offEv = window.bts.proAudio.onEvent((ev) => { if (ev.id === this.id) this._event(ev); });
      const r = await window.bts.proAudio.start(this.id, { device: this.cfg.device, pair: this.cfg.pair || 0, mono: this.cfg.mono ?? -1, channels: this.cfg.channels || 0, exclusive: !!this.cfg.exclusive, vst: this.cfg.vst.map(v => ({ path: v.path })) });
      if (!r.ok) { this.setStatus('error', r.error); return; }
      this.vis = this.vis || document.createElement('canvas'); this.vis.width = 640; this.vis.height = 360;
      clearInterval(this._stateTimer);
      this._stateTimer = setInterval(() => this.saveStates(), 15000); // keep plug-in settings in the preset
    }
    _event(ev) {
      if (ev.event === 'plugin') { // restore saved settings and bypass for each loaded plug-in
        const v = this.cfg.vst[ev.index]; if (!v) return;
        v.name = ev.name; v.loaded = true;
        if (v.state) window.bts.proAudio.control(this.id, { cmd: 'setState', index: ev.index, state: v.state });
        if (v.bypass) window.bts.proAudio.control(this.id, { cmd: 'bypass', index: ev.index, value: true });
        this.emit('vst');
      } else if (ev.event === 'state') { const v = this.cfg.vst[ev.index]; if (v) v.state = ev.state; }
      else if (ev.event === 'editor' && !ev.open) this.saveStates();
      else if (ev.event === 'error') { U.toast(`${this.title}: ${ev.message}`, 'error', 7000); if (this.status !== 'ok') this.setStatus('error', ev.message); }
    }
    onStreamStatus(s) {
      if (s.state === 'live') { this.deviceInfo = `${s.device} · ${s.channels} ch · ${s.latencyMs} ms`; this.setStatus('ok'); }
      else if (s.state === 'reconnecting') this.setStatus('error', s.message || 'Reconnecting…');
      else if (s.state === 'error') this.setStatus('error', s.message || 'Audio device error');
    }
    onAudio(buf) { if (this.pcm) this.pcm.port.postMessage(buf, [buf.buffer]); }
    saveStates() { this.cfg.vst.forEach((v, i) => { if (v.loaded) window.bts.proAudio.control(this.id, { cmd: 'getState', index: i }); }); }
    vstEditor(i) { return window.bts.proAudio.control(this.id, { cmd: 'editor', index: i }); }
    vstBypass(i, on) { const v = this.cfg.vst[i]; if (!v) return false; v.bypass = on == null ? !v.bypass : !!on; window.bts.proAudio.control(this.id, { cmd: 'bypass', index: i, value: v.bypass }); this.emit('vst'); return true; }
    getFrame() {
      const c = this.vis; if (!c) return null;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#101216'; ctx.fillRect(0, 0, 640, 360);
      const [l, r] = this.channel ? this.channel.peak : [0, 0];
      const bar = (x, v) => { const h = U.clamp((U.db(v) + 60) / 60, 0, 1) * 240; const g = ctx.createLinearGradient(0, 300, 0, 60); g.addColorStop(0, '#2fbf62'); g.addColorStop(0.75, '#f5c344'); g.addColorStop(1, '#e2453c'); ctx.fillStyle = g; ctx.fillRect(x, 300 - h, 60, h); };
      bar(250, l); bar(330, r);
      ctx.fillStyle = '#ddd'; ctx.font = '600 22px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('🎚 ' + this.title, 320, 340);
      return { src: c, w: 640, h: 360, processed: true };
    }
    serialize() { return super.serialize(); }
    destroy() { clearInterval(this._stateTimer); if (this._offEv) this._offEv(); window.bts.proAudio.stop(this.id); super.destroy(); }
  }

  /* ---------------- Web browser / HTML overlay ---------------- */
  class BrowserInput extends Input {
    constructor(app, data) {
      super(app, data);
      this.canvas = document.createElement('canvas');
      this.pending = null; this.last = null; this._fxSig = '';
    }
    async init() {
      this.setStatus('loading');
      const c = { url: this.cfg.url || 'about:blank', width: this.cfg.width || this.app.W, height: this.cfg.height || this.app.H, fps: this.cfg.fps || 30, css: this.cfg.css || '', audio: !!this.cfg.audio };
      await window.bts.browser.create(this.id, c);
    }
    async update(cfg) { Object.assign(this.cfg, cfg); await window.bts.browser.update(this.id, { url: this.cfg.url, width: this.cfg.width, height: this.cfg.height, fps: this.cfg.fps, css: this.cfg.css, audio: !!this.cfg.audio }); }
    onFrame(w, h, bytes) { this.pending = { w, h, bytes }; if (this.status !== 'ok') this.setStatus('ok'); }
    getFrame() {
      const sig = JSON.stringify(this.props.effects);
      if (!this.pending && this.last && sig !== this._fxSig) this.pending = this.last;
      if (this.pending) {
        const { w, h, bytes } = this.pending;
        this.last = this.pending; this.pending = null; this._fxSig = sig;
        if (this.app.gl.ok) { this.app.gl.uploadBGRA(bytes, w, h, this.fxActive() ? this.props.effects : null, this.canvas); window.bts.browser.ack(this.id); }
        else { // CPU fallback
          this.canvas.width = w; this.canvas.height = h;
          const id = new ImageData(w, h); const d = id.data;
          for (let i = 0; i < d.length; i += 4) { const a = bytes[i + 3] || 1; d[i] = bytes[i + 2] * 255 / a; d[i + 1] = bytes[i + 1] * 255 / a; d[i + 2] = bytes[i] * 255 / a; d[i + 3] = bytes[i + 3]; }
          this.canvas.getContext('2d').putImageData(id, 0, 0);
          window.bts.browser.ack(this.id);
        }
      }
      return this.last ? { src: this.canvas, w: this.canvas.width, h: this.canvas.height, processed: true } : null;
    }
    reload() { return window.bts.browser.reload(this.id); }
    exec(js) { return window.bts.browser.exec(this.id, js); }
    destroy() { window.bts.browser.destroy(this.id); super.destroy(); }
  }

  /* ---------------- Title ---------------- */
  class TitleInput extends Input {
    async init() {
      if (!this.cfg.template) this.cfg.template = BTS.Titles.TEMPLATES[this.cfg.templateId || 'lower-third']();
      if (!this.renderer) this.renderer = new BTS.Titles.TitleRenderer(this.cfg.template);
      else this.renderer.setTemplate(this.cfg.template);
      this.renderer.animate = this.cfg.animate !== false;
      if (!this.live) this.renderer.show();
      this.setStatus('ok');
    }
    getFrame() {
      if (!this.live && this.renderer.animDir === 0) this.renderer.progress = 1;
      const c = this.renderer.render(performance.now(), false);
      return { src: c, w: c.width, h: c.height };
    }
    onLive(on) { if (on) this.renderer.transitionIn(); }
    animateOut() { return this.renderer.transitionOut(); }
    /** preview (not live) shows the title fully */
    drawStatic(ctx, x, y, w, h) {
      const r = this.renderer;
      const save = [r.progress, r.animDir]; r.progress = 1; r.animDir = 0;
      const c = r.render(performance.now(), false);
      ctx.drawImage(c, x, y, w, h);
      [r.progress, r.animDir] = save;
    }
    setText(name, v) { const ok = this.renderer.setText(name, v); this.emit('fields'); return ok; }
    setImage(name, v) { const ok = this.renderer.setImage(name, v); this.emit('fields'); return ok; }
    /* ---- pages (storyboard): saved sets of field values, stepped through on air ---- */
    get pages() { return (this.cfg.pages = this.cfg.pages || []); }
    snapshotFields() { const v = {}; for (const e of this.renderer.t.elements) { if (e.type === 'text' || e.type === 'ticker') v[e.id] = e.text; if (e.type === 'image') v[e.id] = e.src || ''; } return v; }
    savePage(name, at) { const p = { name: name || `Page ${this.pages.length + 1}`, values: this.snapshotFields() }; if (at != null && this.pages[at]) this.pages[at] = p; else this.pages.push(p); this.emit('pages'); return p; }
    /** show page n (0-based); on air it animates out, swaps the text and animates back in */
    async goPage(n) {
      const p = this.pages[n]; if (!p) return false;
      this.cfg.page = n;
      const swap = () => { for (const [id, v] of Object.entries(p.values)) { const e = this.renderer.find(id); if (!e) continue; if (e.type === 'image') this.setImage(id, v); else this.setText(id, v); } };
      if (this.live && this.renderer.animate !== false && this.cfg.pageAnimate !== false) { const ms = this.renderer.transitionOut() || 0; await new Promise(r => setTimeout(r, ms)); swap(); this.renderer.transitionIn(); }
      else swap();
      this.emit('pages');
      return true;
    }
    nextPage() { const n = this.pages.length; return n ? this.goPage(((this.cfg.page ?? -1) + 1) % n) : false; }
    prevPage() { const n = this.pages.length; return n ? this.goPage(((this.cfg.page ?? 0) - 1 + n) % n) : false; }
    serialize() { const s = super.serialize(); s.cfg.template = U.deepClone(this.renderer ? this.renderer.t : this.cfg.template); return s; }
  }

  /* ---------------- Scene (layers / multiview / PiP) ---------------- */
  class SceneInput extends Input {
    async init() {
      this.cfg.layers = this.cfg.layers || [];
      this.cfg.background = this.cfg.background || 'transparent';
      this.canvas = this.canvas || document.createElement('canvas');
      this.canvas.width = this.app.W; this.canvas.height = this.app.H;
      this.ctx2 = this.canvas.getContext('2d'); this.ctx2.imageSmoothingQuality = 'high';
      this._rf = -1;
      this.setStatus('ok');
    }
    containsInput(id, depth = 0) {
      if (depth > 4) return true;
      return this.cfg.layers.some(l => l.inputId === id || (this.app.byId(l.inputId)?.type === 'scene' && this.app.byId(l.inputId).containsInput(id, depth + 1)));
    }
    children() { return this.cfg.layers.filter(l => l.visible !== false).map(l => this.app.byId(l.inputId)).filter(Boolean); }
    getFrame() {
      if (this._rf === this.app.frameId) return { src: this.canvas, w: this.canvas.width, h: this.canvas.height };
      this._rf = this.app.frameId;
      if (this._rendering) return null;
      this._rendering = true;
      const ctx = this.ctx2, W = this.canvas.width, H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (this.cfg.background && this.cfg.background !== 'transparent') { ctx.fillStyle = this.cfg.background; ctx.fillRect(0, 0, W, H); }
      for (const l of this.cfg.layers) {
        if (l.visible === false) continue;
        const inp = this.app.byId(l.inputId);
        if (!inp || inp === this) continue;
        ctx.save();
        if (l.opacity != null && l.opacity < 1) ctx.globalAlpha = l.opacity;
        inp.draw(ctx, (l.x ?? 0) * W, (l.y ?? 0) * H, (l.w ?? 1) * W, (l.h ?? 1) * H);
        ctx.restore();
      }
      this._rendering = false;
      return { src: this.canvas, w: W, h: H };
    }
    setLive(on) { super.setLive(on); }
  }

  /* ---------------- Mix input: an independent mini-switcher (own Preview / Output) ---------------- */
  class MixInput extends Input {
    async init() {
      this.cfg.programId = this.cfg.programId || null;
      this.cfg.previewId = this.cfg.previewId || null;
      this.cfg.transition = this.cfg.transition || 'Fade';
      this.cfg.duration = this.cfg.duration ?? 500;
      this.canvas = this.canvas || document.createElement('canvas');
      this.canvas.width = this.app.W; this.canvas.height = this.app.H;
      this.ctx2 = this.canvas.getContext('2d'); this.ctx2.imageSmoothingQuality = 'high';
      this.pvCanvas = this.pvCanvas || document.createElement('canvas');
      this.pvCanvas.width = 480; this.pvCanvas.height = 270;
      this.active = null; this._rf = -1;
      this.setStatus('ok');
    }
    get program() { return this.app.byId(this.cfg.programId); }
    get preview() { return this.app.byId(this.cfg.previewId); }
    _ok(i) { return i && i !== this && !(i.type === 'mix' && i.containsInput && i.containsInput(this.id)); }
    containsInput(id, depth = 0) {
      if (depth > 4) return true;
      return [this.cfg.programId, this.cfg.previewId].some(x => x === id || (this.app.byId(x)?.containsInput && this.app.byId(x).containsInput(id, depth + 1)));
    }
    children() { const out = [this.program]; if (this.active) out.push(this.app.byId(this.active.from)); return out.filter(Boolean); }
    setPreview(ref) { const i = this.app.resolve(ref); if (!this._ok(i)) return false; this.cfg.previewId = i.id; this.emit('mix'); return true; }
    cut(ref) {
      if (ref != null) { if (!this.setPreview(ref)) return false; }
      const from = this.cfg.programId; this.cfg.programId = this.cfg.previewId; this.cfg.previewId = from || this.cfg.previewId;
      this.active = null; this.app._updateLive(); this.emit('mix'); return true;
    }
    transition(type, duration, ref) {
      if (ref != null) { if (!this.setPreview(ref)) return false; }
      if (!this.cfg.previewId || this.cfg.previewId === this.cfg.programId) return false;
      type = type || this.cfg.transition; duration = duration ?? this.cfg.duration;
      if (type === 'Cut' || !duration) return this.cut();
      this.active = { type, from: this.cfg.programId, to: this.cfg.previewId, start: performance.now(), duration };
      this.cfg.programId = this.cfg.previewId;
      this.app._updateLive(); this.emit('mix'); return true;
    }
    getFrame() {
      if (this._rf === this.app.frameId) return { src: this.canvas, w: this.canvas.width, h: this.canvas.height };
      this._rf = this.app.frameId;
      if (this._rendering) return null;
      this._rendering = true;
      const ctx = this.ctx2, W = this.canvas.width, H = this.canvas.height;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const a = this.active;
      try {
        if (a) {
          const t = (performance.now() - a.start) / a.duration;
          if (t >= 1) { this.cfg.previewId = a.from || this.cfg.previewId; this.active = null; this.app._updateLive(); this.emit('mix'); this.program?.draw(ctx, 0, 0, W, H); }
          else { const A = this.app.byId(a.from), B = this.app.byId(a.to); BTS.Transitions.draw(a.type, ctx, W, H, t, (c) => A && A.draw(c, 0, 0, W, H), (c) => B && B.draw(c, 0, 0, W, H)); }
        } else if (this.program) this.program.draw(ctx, 0, 0, W, H);
      } finally { this._rendering = false; }
      return { src: this.canvas, w: W, h: H };
    }
    drawPreview() {
      const c = this.pvCanvas.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, 480, 270);
      const p = this.preview; if (p) { if (p.type === 'title' && !p.live) p.drawStatic(c, 0, 0, 480, 270); else p.draw(c, 0, 0, 480, 270); }
      return this.pvCanvas;
    }
  }

  /* ---------------- Video Delay input: delays another input's picture (and sound) ---------------- */
  class DelayInput extends Input {
    async init() {
      this.cfg.delayMs = U.clamp(this.cfg.delayMs ?? 2000, 40, 10000);
      this.cfg.height = this.cfg.height || 540;
      this.ring = this.ring || []; this._last = null; this._rf = -1; this._lastCap = 0;
      // capture continuously — the delay must keep recording even when nothing is showing this input
      if (!this._offFrame) this._offFrame = this.app.on('frame', (now) => { try { this._capture(now); } catch (e) { console.warn(e); } });
      const src = this.app.byId(this.cfg.sourceId);
      if (!src) { this.setStatus('error', 'Choose a source input'); return; }
      // audio: route the source's sound through this input's own channel with a matching delay
      const ms = src.getMediaStream && src.getMediaStream();
      if (ms && ms.getAudioTracks().length) {
        const ch = this.ensureChannel();
        try { ch.setSource(this.app.audio.ctx.createMediaStreamSource(new MediaStream(ms.getAudioTracks()))); ch.set({ delayMs: this.cfg.delayMs }); } catch (e) { console.warn(e); }
      }
      this.setStatus('ok');
    }
    get source() { return this.app.byId(this.cfg.sourceId); }
    children() { return [this.source].filter(Boolean); }
    containsInput(id) { return this.cfg.sourceId === id; }
    _capture(now) {
      const src = this.source; if (!src || src === this) return;
      const fps = this.app.fps || 30;
      if (now - this._lastCap < 1000 / fps - 2) return;
      this._lastCap = now;
      const h = this.cfg.height, w = Math.round(h * this.app.W / this.app.H);
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
      src.draw(g, 0, 0, w, h);
      const bmp = c.transferToImageBitmap();
      this.ring.push({ t: now, bmp });
      // release frames older than the delay (plus a little slack)
      while (this.ring.length > 2 && now - this.ring[1].t >= this.cfg.delayMs) { const old = this.ring.shift(); if (old.bmp !== this._last) old.bmp.close(); }
      const max = Math.ceil(this.cfg.delayMs / 1000 * fps) + fps;
      while (this.ring.length > max) { const old = this.ring.shift(); if (old.bmp !== this._last) old.bmp.close(); }
    }
    getFrame() {
      const now = performance.now();
      const target = now - this.cfg.delayMs;
      let pick = null;
      for (const f of this.ring) { if (f.t <= target) pick = f; else break; }
      if (pick) { if (this._last && this._last !== pick.bmp && !this.ring.some(f => f.bmp === this._last)) this._last.close(); this._last = pick.bmp; }
      if (!this._last) return null;
      return { src: this._last, w: this._last.width, h: this._last.height };
    }
    get buffered() { return this.ring.length ? (performance.now() - this.ring[0].t) / 1000 : 0; }
    destroy() { if (this._offFrame) this._offFrame(); for (const f of this.ring) try { f.bmp.close(); } catch { /* noop */ } this.ring = []; super.destroy(); }
  }

  const CLASSES = { mix: MixInput, delay: DelayInput, stream: StreamInput, capture: CaptureInput, ndi: NdiInput, replay: VideoInput, color: ColorInput, image: ImageInput, video: VideoInput, 'audio-file': VideoInput, playlist: PlaylistInput, camera: CameraInput, screen: ScreenInput, audio: AudioDeviceInput, proaudio: ProAudioInput, browser: BrowserInput, title: TitleInput, scene: SceneInput };

  function register(type, Cls, info) { CLASSES[type] = Cls; if (info) TYPE_INFO[type] = info; }
  function create(app, data) {
    const C = CLASSES[data.type];
    if (!C) throw new Error('Unknown input type ' + data.type);
    return new C(app, data);
  }

  BTS.Inputs = { create, register, playableUrl, VideoInput, PipeInput, TYPE_INFO, DEFAULT_PROPS, Input, cardHint, findPairedAudio };
})(window.BTS);
