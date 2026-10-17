'use strict';
/**
 * Additional input types:
 *  - Slides: PDF, PowerPoint (.pptx/.ppt via PowerPoint or LibreOffice), Keynote/ODP, or a folder of exported slide images.
 *  - Remote Guest: a WebRTC caller joining from any browser (vMix Call-style) with program return + mix-minus audio.
 */
(function (BTS) {
  const U = BTS.U;
  const { Input, register } = BTS.Inputs;

  /* ======================================================================
   * Slides
   * ==================================================================== */
  let pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) {
      const base = new URL('vendor/pdfjs/', document.baseURI).href;
      pdfjsP = import(base + 'pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs'; return m; });
    }
    return pdfjsP;
  }

  class SlidesInput extends Input {
    constructor(app, data) {
      super(app, data);
      this.index = this.cfg.index || 0;
      this.count = 0;
      this.cache = new Map(); // index -> canvas
      this.out = document.createElement('canvas');
      this.trans = null; // { from: canvas, start, dir }
      this.timer = null; this.autoPlaying = false;
      this.thumbs = [];
    }
    get source() { return this.cfg.folder || this.cfg.path || ''; }

    async init() {
      this.setStatus('loading', 'Opening slides…');
      this._dispose();
      try {
        if (this.cfg.folder) {
          const files = await window.bts.media.listImages(this.cfg.folder);
          if (!files.length) throw new Error('No images in this folder. In PowerPoint use File → Export → PNG/JPEG, then pick the export folder.');
          this.images = files; this.count = files.length; this.kind = 'images';
        } else {
          let file = this.cfg.path;
          if (!file) throw new Error('Choose a PDF, PowerPoint file or a folder of slide images');
          if (!/\.pdf$/i.test(file)) {
            this.setStatus('loading', 'Converting presentation…');
            file = await window.bts.media.officeToPdf(file);
          }
          const lib = await pdfjs();
          const data = await window.bts.media.readBinary(file);
          this.pdf = await lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: false }).promise;
          this.count = this.pdf.numPages; this.kind = 'pdf';
        }
        this.index = U.clamp(this.index, 0, this.count - 1);
        await this._ensure(this.index);
        this.setStatus('ok');
        this._prefetch();
        this.emit('state'); this.emit('item', this.index);
        if (this.cfg.autoAdvance && this.live) this.play();
      } catch (e) {
        this.setStatus('error', String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
    }

    async _render(i) {
      const W = this.app.W, H = this.app.H;
      const c = document.createElement('canvas');
      if (this.kind === 'images') {
        const img = new Image();
        img.src = await window.bts.file.url(this.images[i]);
        await img.decode().catch(() => {});
        c.width = img.naturalWidth || W; c.height = img.naturalHeight || H;
        c.getContext('2d').drawImage(img, 0, 0);
        return c;
      }
      const page = await this.pdf.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(W / vp1.width, H / vp1.height) * (this.cfg.supersample || 1);
      const vp = page.getViewport({ scale });
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d');
      if (!this.cfg.transparent) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); }
      await page.render({ canvasContext: g, viewport: vp, background: this.cfg.transparent ? 'rgba(0,0,0,0)' : undefined }).promise;
      return c;
    }
    _ensure(i) {
      if (i < 0 || i >= this.count) return Promise.resolve(null);
      if (!this.cache.has(i)) this.cache.set(i, this._render(i).catch((e) => { this.cache.delete(i); throw e; }));
      return this.cache.get(i);
    }
    _prefetch() {
      // keep current ±2 rendered; drop the rest to bound memory on long decks
      for (const k of [...this.cache.keys()]) if (Math.abs(k - this.index) > 3) this.cache.delete(k);
      for (const d of [1, -1, 2]) this._ensure(this.index + d).catch(() => {});
    }
    async thumbnail(i, w = 192) {
      if (this.thumbs[i]) return this.thumbs[i];
      const src = await this._ensure(i);
      const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * src.height / src.width);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return (this.thumbs[i] = c.toDataURL('image/jpeg', 0.7));
    }

    async load(i, autoplay) {
      if (!this.count) return;
      const loop = this.props.loop || this.cfg.loop;
      if (i >= this.count) { if (!loop) { this.emit('ended'); this.pause(); return; } i = 0; }
      if (i < 0) i = loop ? this.count - 1 : 0;
      if (i === this.index && this.cache.has(i)) { if (autoplay) this.play(); return; }
      const prev = this.cache.get(this.index);
      const prevCanvas = prev ? await prev : null;
      const dir = i > this.index ? 1 : -1;
      this.index = i; this.cfg.index = i;
      await this._ensure(i);
      const ms = this.cfg.transitionMs ?? 300;
      if (prevCanvas && (this.cfg.transition || 'fade') !== 'cut' && ms > 0) this.trans = { from: prevCanvas, start: performance.now(), dir, ms };
      this._prefetch();
      this.emit('state'); this.emit('item', i);
      if (autoplay || this.autoPlaying) this._schedule();
    }
    next() { return this.load(this.index + 1); }
    prev() { return this.load(this.index - 1); }
    restart() { return this.load(0); }
    play() { this.autoPlaying = true; this._schedule(); this.emit('state'); }
    pause() { this.autoPlaying = false; clearTimeout(this.timer); this.emit('state'); }
    _schedule() { clearTimeout(this.timer); if (!this.autoPlaying) return; this.timer = setTimeout(() => this.next(), (this.cfg.slideSeconds || 5) * 1000); }
    get playing() { return this.autoPlaying; }
    onLive(on) { if (on && this.cfg.autoAdvance) this.play(); if (!on && this.cfg.autoAdvance) this.pause(); }

    getFrame() {
      const p = this.cache.get(this.index);
      if (!p || !p._v) { if (p && !p._hooked) { p._hooked = true; p.then(c => { p._v = c; }).catch(() => {}); } if (!this._last) return null; }
      const cur = (p && p._v) || this._last;
      this._last = cur;
      if (!this.trans) return { src: cur, w: cur.width, h: cur.height };
      const t = Math.min(1, (performance.now() - this.trans.start) / this.trans.ms);
      if (t >= 1) { this.trans = null; return { src: cur, w: cur.width, h: cur.height }; }
      const o = this.out, from = this.trans.from;
      o.width = cur.width; o.height = cur.height;
      const g = o.getContext('2d');
      g.clearRect(0, 0, o.width, o.height);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      if (this.cfg.transition === 'slide') {
        const dx = this.trans.dir * o.width;
        g.drawImage(from, -dx * e, 0, o.width, o.height);
        g.drawImage(cur, dx * (1 - e), 0, o.width, o.height);
      } else {
        g.globalAlpha = 1; g.drawImage(from, 0, 0, o.width, o.height);
        g.globalAlpha = e; g.drawImage(cur, 0, 0, o.width, o.height); g.globalAlpha = 1;
      }
      return { src: o, w: o.width, h: o.height };
    }
    _dispose() { clearTimeout(this.timer); this.cache.clear(); this.thumbs = []; this._last = null; this.trans = null; if (this.pdf) { try { this.pdf.destroy(); } catch { /* noop */ } this.pdf = null; } }
    destroy() { this._dispose(); super.destroy(); }
  }

  /* ======================================================================
   * Remote guests (WebRTC)
   * ==================================================================== */
  const Guests = {
    started: null, slots: new Map(), off: null,
    async ensure() {
      if (!this.off) this.off = window.bts.guests.onSignal((m) => { const g = this.slots.get(m.k); if (g) g.onSignal(m); });
      if (!this.started) this.started = window.bts.guests.start().catch((e) => { this.started = null; throw e; });
      return this.started;
    },
    async add(g) { await this.ensure(); this.slots.set(g.cfg.key, g); await window.bts.guests.slot(g.cfg.key, { title: g.cfg.show || BTS.studio?.projectName || 'BTS Studio', password: g.cfg.password || '' }); },
    remove(g) { if (this.slots.get(g.cfg.key) === g) { this.slots.delete(g.cfg.key); window.bts.guests.slot(g.cfg.key, null); } },
    async urls() { await this.ensure(); return window.bts.guests.urls(); }
  };
  const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

  class GuestInput extends Input {
    constructor(app, data) {
      super(app, data);
      if (!this.cfg.key) this.cfg.key = newKey();
      this.cfg.returnSource = this.cfg.returnSource || 'program';
      this.video = document.createElement('video');
      this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true;
      this.chat = [];
      this.guest = null; // { sid, name, ip, mic }
    }
    async init() {
      this.ensureChannel();
      try {
        await Guests.add(this);
        this.setStatus('ok', this.guest ? '' : 'Waiting for guest');
      } catch (e) { this.setStatus('error', String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    }
    async links() {
      const urls = await Guests.urls();
      return urls.map(u => `${u}${u.includes('?') ? '&' : '?'}k=${this.cfg.key}`);
    }
    async onSignal(m) {
      if (m.type === 'offer') return this._answer(m);
      if (this.guest && m.sid !== this.guest.sid) return;
      if (m.type === 'bye' || m.type === 'gone') { if (m.type === 'bye' || (this.pc && this.pc.connectionState !== 'connected')) this.hangup(false); return; }
      if (m.type === 'chat') { this.chat.push({ from: this.guest?.name || 'Guest', text: String(m.text).slice(0, 300), t: Date.now() }); this.emit('chat'); U.toast(`💬 ${this.guest?.name || 'Guest'}: ${String(m.text).slice(0, 80)}`); }
      if (m.type === 'state') { if (this.guest) this.guest.mic = m.mic; this.emit('state'); }
    }
    async _answer(m) {
      if (this.pc) this.hangup(true);
      const ice = [];
      const gs = (BTS.settings && BTS.settings.guests) || {};
      if (gs.stun) ice.push({ urls: gs.stun.split(/[\s,]+/).filter(Boolean) });
      if (gs.turn) ice.push({ urls: gs.turn.split(/[\s,]+/).filter(Boolean), username: gs.turnUser || undefined, credential: gs.turnPass || undefined });
      const pc = this.pc = new RTCPeerConnection({ iceServers: ice });
      this.guest = { sid: m.sid, name: m.name || 'Guest', ip: m.ip, mic: true, since: Date.now() };
      if (this.cfg.autoTitle !== false) this.title = this.guest.name;
      const inStream = new MediaStream();
      pc.ontrack = (e) => {
        inStream.addTrack(e.track);
        if (e.track.kind === 'video') { this.video.srcObject = inStream; this.video.play().catch(() => {}); }
        if (e.track.kind === 'audio') {
          // Chromium needs the remote stream attached to a media element before WebAudio receives samples.
          this._sink = this._sink || new Audio(); this._sink.muted = true; this._sink.srcObject = inStream; this._sink.play().catch(() => {});
          try { this.channel.setSource(this.app.audio.ctx.createMediaStreamSource(new MediaStream([e.track]))); } catch (err) { console.warn(err); }
        }
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'connected') { this.setStatus('ok'); this._sendTally(true); if (this.app.macros) this.app.macros.fire(this, 'GuestJoined'); }
        else if (s === 'failed') this.setStatus('error', 'Connection failed — guest may be behind a strict firewall (configure a TURN server in Settings → Remote Guests)');
        else if (s === 'disconnected') this.setStatus('loading', 'Reconnecting…');
        this.emit('state');
      };
      // Return feed: program (or chosen source) video + mix-minus audio
      this._ret = this._returnStream();
      this._mm = this.app.audio.createMixMinus(this.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      const vt = this._ret.getVideoTracks()[0], at = this._mm.stream.getAudioTracks()[0];
      // The guest adds its own tracks first, then one recvonly video + audio transceiver for the return feed,
      // so the last transceiver of each kind is the return path.
      const trs = pc.getTransceivers();
      const lastOf = (kind) => trs.filter(t => t.receiver.track.kind === kind).pop() || null;
      const vRet = lastOf('video'), aRet = lastOf('audio');
      if (vRet && vt) { await vRet.sender.replaceTrack(vt); vRet.direction = 'sendonly'; }
      if (aRet && at) { await aRet.sender.replaceTrack(at); aRet.direction = 'sendonly'; }
      await pc.setLocalDescription(await pc.createAnswer());
      await new Promise((res) => { if (pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, 3000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
      // limit the return feed so it does not starve the guest's upload
      for (const s of pc.getSenders()) if (s.track && s.track.kind === 'video') { const p = s.getParameters(); p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}]; p.encodings[0].maxBitrate = (this.cfg.returnKbps || 1500) * 1000; p.encodings[0].scaleResolutionDownBy = this.app.H > 720 ? this.app.H / 540 : 1; try { await s.setParameters(p); } catch { /* noop */ } }
      await window.bts.guests.send(m.sid, { type: 'answer', sdp: pc.localDescription.sdp });
      this.setStatus('loading', `Connecting ${this.guest.name}…`);
      U.toast(`📞 ${this.guest.name} joined ${this.title}`);
      this.emit('state'); this.app.bus && this.app.bus.emit('inputs-changed');
    }
    _returnStream() {
      const st = this.app;
      const src = this.cfg.returnSource;
      if (src === 'multiview' && BTS.ui) return BTS.ui._streamFor('multiview:1');
      const canvas = src === 'preview' ? st.previewCanvas : st.programCanvas;
      return canvas.captureStream(Math.min(30, st.fps || 30));
    }
    _sendTally(force) {
      if (!this.guest) return;
      const state = this.live ? 'program' : this.app.previewId === this.id ? 'preview' : 'idle';
      if (!force && state === this._tally) return;
      this._tally = state;
      window.bts.guests.send(this.guest.sid, { type: 'tally', state });
    }
    onLive() { this._sendTally(); }
    sendChat(text) {
      if (!this.guest) return false;
      this.chat.push({ from: 'You', text, t: Date.now() }); this.emit('chat');
      return window.bts.guests.send(this.guest.sid, { type: 'chat', from: 'Producer', text });
    }
    hangup(notify = true) {
      if (this.pc && this.app.macros) this.app.macros.fire(this, 'GuestLeft');
      if (notify && this.guest) window.bts.guests.send(this.guest.sid, { type: 'bye', reason: 'The producer ended the call' });
      if (this.pc) { try { this.pc.close(); } catch { /* noop */ } this.pc = null; }
      if (this._ret) { if (this._ret._off) this._ret._off(); this._ret.getTracks().forEach(t => t.stop()); this._ret = null; }
      if (this._mm) { this._mm.dispose(); this._mm = null; }
      if (this.channel) this.channel.setSource(null);
      this.video.srcObject = null;
      if (this._sink) this._sink.srcObject = null;
      const was = this.guest; this.guest = null; this._tally = null;
      if (was && !this.destroyed) { U.toast(`${was.name} left`); this.setStatus('ok', 'Waiting for guest'); }
      this.emit('state');
    }
    getFrame() {
      const v = this.video;
      if (!this.guest || v.readyState < 2 || !v.videoWidth) return null;
      if (this.app.previewId === this.id || this.live) this._sendTally();
      else if (this._tally && this._tally !== 'idle') this._sendTally();
      return { src: v, w: v.videoWidth, h: v.videoHeight };
    }
    getMediaStream() { return this.video.srcObject || null; }
    destroy() { this.hangup(true); Guests.remove(this); super.destroy(); }
  }
  // Tally: also refresh periodically for inputs that are not drawn (not live, not in preview)
  setInterval(() => { for (const g of Guests.slots.values()) if (g.guest) g._sendTally(); }, 1000);

  register('slides', SlidesInput, { label: 'Slides / PowerPoint', icon: '📑' });
  register('guest', GuestInput, { label: 'Remote Guest', icon: '📞' });
  BTS.Guests = Guests;
})(window.BTS);
