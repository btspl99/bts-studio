'use strict';
/**
 * Telestrator — draw over the live picture (sports analysis, teaching, highlighting).
 * Engine side: the "telestrator" input type, a transparent layer you put on an Overlay channel.
 * Strokes are stored in 0..1 coordinates so they match any output resolution.
 */
(function (BTS) {
  const U = BTS.U;
  const { Input, register } = BTS.Inputs;

  const TOOLS = ['pen', 'highlighter', 'arrow', 'line', 'ellipse', 'rect', 'spotlight'];

  function arrowHead(g, x1, y1, x2, y2, size) {
    const a = Math.atan2(y2 - y1, x2 - x1), l = size * 4;
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - l * Math.cos(a - 0.45), y2 - l * Math.sin(a - 0.45));
    g.lineTo(x2 - l * Math.cos(a + 0.45), y2 - l * Math.sin(a + 0.45));
    g.closePath(); g.fill();
  }

  /** draw strokes into ctx sized W×H. fadeMs: 0 = permanent */
  function drawStrokes(g, strokes, W, H, now = performance.now(), fadeMs = 0) {
    const spot = strokes.filter(s => s.tool === 'spotlight');
    if (spot.length) {
      // darken everything except the spotlight ellipses
      let alpha = 0;
      for (const s of spot) alpha = Math.max(alpha, fadeAlpha(s, now, fadeMs));
      if (alpha > 0) {
        g.save(); g.globalAlpha = alpha; g.fillStyle = 'rgba(0,0,0,0.6)';
        g.beginPath(); g.rect(0, 0, W, H);
        for (const s of spot) { const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]]; if (!b) continue; g.ellipse((a[0] + b[0]) / 2 * W, (a[1] + b[1]) / 2 * H, Math.abs(b[0] - a[0]) / 2 * W + 1, Math.abs(b[1] - a[1]) / 2 * H + 1, 0, 0, Math.PI * 2); }
        g.fill('evenodd');
        g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.85)';
        for (const s of spot) { const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]]; if (!b) continue; g.beginPath(); g.ellipse((a[0] + b[0]) / 2 * W, (a[1] + b[1]) / 2 * H, Math.abs(b[0] - a[0]) / 2 * W + 1, Math.abs(b[1] - a[1]) / 2 * H + 1, 0, 0, Math.PI * 2); g.stroke(); }
        g.restore();
      }
    }
    for (const s of strokes) {
      if (s.tool === 'spotlight' || !s.pts.length) continue;
      const a = fadeAlpha(s, now, fadeMs);
      if (a <= 0) continue;
      const lw = s.size * H / 1080;
      g.save();
      g.globalAlpha = a * (s.tool === 'highlighter' ? 0.45 : 1);
      g.strokeStyle = g.fillStyle = s.color;
      g.lineWidth = s.tool === 'highlighter' ? lw * 3.5 : lw;
      g.lineCap = s.tool === 'highlighter' ? 'butt' : 'round'; g.lineJoin = 'round';
      if (s.shadow !== false && s.tool !== 'highlighter') { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = lw * 0.8; g.shadowOffsetY = lw * 0.25; }
      const P = s.pts.map(p => [p[0] * W, p[1] * H]);
      const [x1, y1] = P[0], [x2, y2] = P[P.length - 1];
      g.beginPath();
      switch (s.tool) {
        case 'pen': case 'highlighter':
          g.moveTo(x1, y1);
          if (P.length < 3) g.lineTo(x2 + 0.01, y2);
          for (let i = 1; i < P.length - 1; i++) { const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2; g.quadraticCurveTo(P[i][0], P[i][1], mx, my); }
          if (P.length >= 3) g.lineTo(x2, y2);
          g.stroke(); break;
        case 'line': g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); break;
        case 'arrow': {
          const a2 = Math.atan2(y2 - y1, x2 - x1), back = lw * 2.5;
          g.moveTo(x1, y1); g.lineTo(x2 - back * Math.cos(a2), y2 - back * Math.sin(a2)); g.stroke();
          g.shadowColor = 'transparent'; arrowHead(g, x1, y1, x2, y2, lw); break;
        }
        case 'ellipse': g.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2 + 0.5, Math.abs(y2 - y1) / 2 + 0.5, 0, 0, Math.PI * 2); g.stroke(); break;
        case 'rect': g.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); g.stroke(); break;
      }
      g.restore();
    }
  }
  function fadeAlpha(s, now, fadeMs) {
    if (!fadeMs || !s.done) return 1;
    const age = now - s.done;
    if (age < fadeMs) return 1;
    return Math.max(0, 1 - (age - fadeMs) / 400);
  }

  class TelestratorInput extends Input {
    constructor(app, data) {
      super(app, data);
      this.strokes = [];
      this.canvas = document.createElement('canvas');
      this.dirty = true;
    }
    get hasVideo() { return true; }
    async init() { this.setStatus('ok'); this.dirty = true; }
    get fadeMs() { return (this.cfg.fadeSeconds || 0) * 1000; }
    begin(tool, color, size, x, y) { const s = { tool, color, size, pts: [[x, y]], done: 0 }; this.strokes.push(s); this.dirty = true; this.emit('strokes'); return s; }
    extend(s, x, y, replaceLast) { if (replaceLast && s.pts.length > 1) s.pts[s.pts.length - 1] = [x, y]; else s.pts.push([x, y]); this.dirty = true; }
    end(s) { s.done = performance.now(); this.dirty = true; this.emit('strokes'); }
    undo() { this.strokes.pop(); this.dirty = true; this.emit('strokes'); }
    clear() { this.strokes = []; this.dirty = true; this.emit('strokes'); }
    getFrame() {
      const W = this.app.W, H = this.app.H, c = this.canvas;
      const now = performance.now();
      if (this.fadeMs) {
        // drop fully faded strokes
        const before = this.strokes.length;
        this.strokes = this.strokes.filter(s => !s.done || now - s.done < this.fadeMs + 400);
        if (this.strokes.length !== before) this.emit('strokes');
        if (this.strokes.some(s => s.done)) this.dirty = true;
      }
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.dirty = true; }
      if (this.dirty) {
        const g = c.getContext('2d');
        g.clearRect(0, 0, W, H);
        drawStrokes(g, this.strokes, W, H, now, this.fadeMs);
        this.dirty = false;
      }
      return { src: c, w: W, h: H };
    }
    serialize() { const s = super.serialize(); return s; }
  }

  register('telestrator', TelestratorInput, { label: 'Telestrator', icon: '✍️' });
  BTS.Telestrator = { TOOLS, drawStrokes };
})(window.BTS);
