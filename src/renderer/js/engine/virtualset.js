'use strict';
/**
 * 2D Virtual Sets — put green-screen presenters into a studio set.
 * A set = background + optional video-wall screen (any input) + up to 3 keyed presenters + foreground (desk),
 * viewed through animated virtual camera shots (Wide, Close 1-3) like vMix virtual sets.
 * Built-in sets are drawn procedurally (no third-party artwork); custom sets use your own background/foreground images.
 * Presenter inputs must have Chroma Key enabled in their Keying tab.
 */
(function (BTS) {
  const U = BTS.U;
  const { Input, register } = BTS.Inputs;

  /* ---------------- procedural sets ---------------- */
  function newsSet(g, W, H, accent) {
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#04122e'); gr.addColorStop(0.62, '#0a2a66'); gr.addColorStop(0.62, '#06153a'); gr.addColorStop(1, '#020812');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // wall panels
    for (let i = 0; i < 9; i++) { const x = i * W / 9; g.fillStyle = i % 2 ? 'rgba(80,140,255,.06)' : 'rgba(255,255,255,.03)'; g.fillRect(x + 4, H * 0.06, W / 9 - 8, H * 0.54); }
    // light strips
    g.fillStyle = accent; g.globalAlpha = 0.8; g.fillRect(0, H * 0.6, W, H * 0.008); g.globalAlpha = 0.35; g.fillRect(0, H * 0.035, W, H * 0.006); g.globalAlpha = 1;
    // floor reflections
    gr = g.createLinearGradient(0, H * 0.62, 0, H); gr.addColorStop(0, 'rgba(70,130,255,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, H * 0.62, W, H * 0.38);
    // video wall frame
    g.fillStyle = '#0b1530'; g.fillRect(W * 0.6 - 10, H * 0.13 - 10, W * 0.34 + 20, H * 0.34 + 20);
    return { screen: { x: W * 0.6, y: H * 0.13, w: W * 0.34, h: H * 0.34 } };
  }
  function newsDesk(g, W, H, accent) {
    const top = H * 0.7;
    g.save();
    let gr = g.createLinearGradient(0, top, 0, H);
    gr.addColorStop(0, '#dfe6f5'); gr.addColorStop(0.08, '#9fb0d0'); gr.addColorStop(0.09, '#14244a'); gr.addColorStop(1, '#070d1f');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(W * 0.12, top); g.quadraticCurveTo(W * 0.5, top - H * 0.03, W * 0.88, top); g.lineTo(W * 0.95, H); g.lineTo(W * 0.05, H); g.closePath(); g.fill();
    g.fillStyle = accent; g.fillRect(W * 0.2, top + H * 0.12, W * 0.6, H * 0.012);
    g.restore();
    return top;
  }
  function talkSet(g, W, H, accent) {
    let gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2b1708'); gr.addColorStop(1, '#5a3412');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += W / 40) { g.fillStyle = `rgba(255,200,140,${0.03 + (x / W) * 0.05})`; g.fillRect(x, 0, W / 80, H * 0.68); }
    g.save(); g.shadowColor = accent; g.shadowBlur = H * 0.05; g.strokeStyle = accent; g.lineWidth = H * 0.012;
    g.beginPath(); g.arc(W * 0.5, H * 0.36, H * 0.22, 0, Math.PI * 2); g.stroke(); g.restore();
    gr = g.createLinearGradient(0, H * 0.68, 0, H); gr.addColorStop(0, '#3a2210'); gr.addColorStop(1, '#120904');
    g.fillStyle = gr; g.fillRect(0, H * 0.68, W, H * 0.32);
    g.fillStyle = 'rgba(0,0,0,.35)'; for (let x = 0; x < W; x += W / 12) g.fillRect(x, H * 0.68, 2, H * 0.32);
    return { screen: null };
  }
  function talkTable(g, W, H, accent) {
    const top = H * 0.82;
    g.fillStyle = '#1c0f06'; g.beginPath(); g.ellipse(W * 0.5, top, W * 0.2, H * 0.05, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = accent; g.globalAlpha = 0.6; g.beginPath(); g.ellipse(W * 0.5, top, W * 0.2, H * 0.05, 0, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = accent; g.stroke(); g.globalAlpha = 1;
    g.fillStyle = '#120904'; g.fillRect(W * 0.49, top, W * 0.02, H - top);
  }
  function techSet(g, W, H, accent) {
    g.fillStyle = '#05060c'; g.fillRect(0, 0, W, H);
    const hz = H * 0.62;
    let gr = g.createRadialGradient(W / 2, hz, 10, W / 2, hz, W * 0.6); gr.addColorStop(0, 'rgba(0,200,255,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = accent; g.lineWidth = 1.5; g.globalAlpha = 0.55;
    for (let i = -20; i <= 20; i++) { g.beginPath(); g.moveTo(W / 2 + i * W * 0.02, hz); g.lineTo(W / 2 + i * W * 0.2, H); g.stroke(); }
    for (let k = 1; k < 14; k++) { const y = hz + (H - hz) * Math.pow(k / 14, 1.8); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.globalAlpha = 1;
    // floating screens
    g.fillStyle = 'rgba(0,180,255,.08)'; g.strokeStyle = accent;
    for (const [x, y, w, h] of [[0.05, 0.12, 0.22, 0.3], [0.73, 0.12, 0.22, 0.3]]) { g.fillRect(x * W, y * H, w * W, h * H); g.strokeRect(x * W, y * H, w * W, h * H); }
    return { screen: { x: W * 0.73, y: H * 0.12, w: W * 0.22, h: H * 0.3 } };
  }

  const SETS = {
    news: { name: 'News Desk', draw: newsSet, fg: newsDesk, accent: '#2f8cff', talent: [{ x: 0.36, y: 0.12, h: 0.72 }, { x: 0.62, y: 0.16, h: 0.66 }],
      shots: [{ name: 'Wide', cx: 0.5, cy: 0.5, z: 1 }, { name: 'Close 1', cx: 0.36, cy: 0.42, z: 1.9 }, { name: 'Close 2', cx: 0.62, cy: 0.44, z: 1.9 }, { name: 'Screen', cx: 0.74, cy: 0.33, z: 1.8 }] },
    talk: { name: 'Talk Show', draw: talkSet, fg: talkTable, accent: '#ff9d2e', talent: [{ x: 0.3, y: 0.18, h: 0.8 }, { x: 0.7, y: 0.18, h: 0.8 }, { x: 0.5, y: 0.14, h: 0.8 }],
      shots: [{ name: 'Wide', cx: 0.5, cy: 0.5, z: 1 }, { name: 'Close 1', cx: 0.3, cy: 0.45, z: 1.9 }, { name: 'Close 2', cx: 0.7, cy: 0.45, z: 1.9 }, { name: 'Two-shot', cx: 0.5, cy: 0.48, z: 1.3 }] },
    tech: { name: 'Tech Grid', draw: techSet, fg: null, accent: '#00d2ff', talent: [{ x: 0.4, y: 0.16, h: 0.84 }],
      shots: [{ name: 'Wide', cx: 0.5, cy: 0.5, z: 1 }, { name: 'Close 1', cx: 0.4, cy: 0.42, z: 1.8 }, { name: 'Screen', cx: 0.84, cy: 0.27, z: 2.2 }] },
    custom: { name: 'Custom (your images)', draw: null, fg: null, accent: '#f0a53a', talent: [{ x: 0.5, y: 0.15, h: 0.8 }],
      shots: [{ name: 'Wide', cx: 0.5, cy: 0.5, z: 1 }, { name: 'Close 1', cx: 0.5, cy: 0.42, z: 1.8 }] }
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  class VirtualSetInput extends Input {
    constructor(app, data) {
      super(app, data);
      const c = this.cfg;
      c.set = c.set || 'news';
      const def = SETS[c.set] || SETS.news;
      c.accent = c.accent || def.accent;
      c.talent = c.talent || def.talent.map(t => ({ ...t, inputId: '' }));
      c.shots = c.shots || U.deepClone(def.shots);
      c.shot = c.shot || 0;
      c.moveMs = c.moveMs ?? 1200;
      this.world = document.createElement('canvas');
      this.out = document.createElement('canvas');
      this.bgCache = null; this.fgCache = null;
      this.cam = { ...c.shots[c.shot] };
      this.anim = null;
    }
    async init() {
      this.bgCache = this.fgCache = null; this.screenRect = null;
      const c = this.cfg;
      this.bgImg = c.bg ? await this._img(c.bg) : null;
      this.fgImg = c.fg ? await this._img(c.fg) : null;
      this.setStatus('ok');
    }
    async _img(p) { const img = new Image(); img.src = /^(https?|file|data):/i.test(p) ? p : await window.bts.file.url(p); await img.decode().catch(() => {}); return img.naturalWidth ? img : null; }
    children() { return [...this.cfg.talent.map(t => this.app.byId(t.inputId)), this.app.byId(this.cfg.screenInputId)].filter(Boolean); }
    containsInput(id) { return this.children().some(i => i.id === id); }

    shot(n, ms) {
      const s = this.cfg.shots[n]; if (!s) return false;
      this.cfg.shot = n;
      const dur = ms ?? this.cfg.moveMs;
      if (!dur) { this.cam = { ...s }; this.anim = null; } else this.anim = { from: { ...this.cam }, to: { ...s }, t0: performance.now(), ms: dur };
      this.emit('state');
      return true;
    }

    _layers(W, H) {
      const c = this.cfg, def = SETS[c.set] || SETS.news;
      if (!this.bgCache || this.bgCache.width !== W) {
        const b = this.bgCache = document.createElement('canvas'); b.width = W; b.height = H;
        const g = b.getContext('2d');
        if (this.bgImg) { g.drawImage(this.bgImg, 0, 0, W, H); this.screenRect = c.screenRect ? { x: c.screenRect.x * W, y: c.screenRect.y * H, w: c.screenRect.w * W, h: c.screenRect.h * H } : null; }
        else if (def.draw) { const r = def.draw(g, W, H, c.accent) || {}; this.screenRect = r.screen; }
        else { g.fillStyle = '#222'; g.fillRect(0, 0, W, H); }
        const f = this.fgCache = document.createElement('canvas'); f.width = W; f.height = H;
        const fg = f.getContext('2d');
        if (this.fgImg) fg.drawImage(this.fgImg, 0, 0, W, H); else if (!this.bgImg && def.fg && c.desk !== false) def.fg(fg, W, H, c.accent);
      }
    }

    getFrame() {
      const W = this.app.W, H = this.app.H, c = this.cfg;
      const wc = this.world; if (wc.width !== W || wc.height !== H) { wc.width = W; wc.height = H; this.bgCache = null; }
      this._layers(W, H);
      const g = wc.getContext('2d');
      g.drawImage(this.bgCache, 0, 0);
      // video wall
      const scr = this.app.byId(c.screenInputId);
      if (scr && this.screenRect) { const r = this.screenRect; g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); scr.draw(g, r.x, r.y, r.w, r.h); g.restore(); g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 2; g.strokeRect(r.x, r.y, r.w, r.h); }
      // presenters (keyed by their own Keying settings), scaled by height, anchored at x centre
      for (const t of c.talent) {
        const inp = this.app.byId(t.inputId); if (!inp) continue;
        const f = inp.getFrame && inp.getFrame(); const ar = f && f.w ? f.w / f.h : 16 / 9;
        const h = t.h * H, w = h * ar;
        const x = t.x * W - w / 2, y = t.y * H;
        if (t.shadow !== false) { g.save(); g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(t.x * W, y + h * 0.985, w * 0.12, h * 0.02, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
        inp.draw(g, x, y, w, h);
      }
      g.drawImage(this.fgCache, 0, 0);
      // virtual camera
      if (this.anim) {
        const k = Math.min(1, (performance.now() - this.anim.t0) / this.anim.ms), e = ease(k), a = this.anim.from, b = this.anim.to;
        this.cam = { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, z: a.z + (b.z - a.z) * e };
        if (k >= 1) this.anim = null;
      }
      const z = Math.max(1, this.cam.z), sw = W / z, sh = H / z;
      const sx = U.clamp(this.cam.cx * W - sw / 2, 0, W - sw), sy = U.clamp(this.cam.cy * H - sh / 2, 0, H - sh);
      const o = this.out; if (o.width !== W || o.height !== H) { o.width = W; o.height = H; }
      const og = o.getContext('2d');
      og.imageSmoothingQuality = 'high';
      og.drawImage(wc, sx, sy, sw, sh, 0, 0, W, H);
      return { src: o, w: W, h: H };
    }
  }

  register('vset', VirtualSetInput, { label: 'Virtual Set', icon: '🏙️' });
  BTS.VirtualSets = { SETS };
})(window.BTS);
