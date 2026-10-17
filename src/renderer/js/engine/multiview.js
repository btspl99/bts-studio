'use strict';
/**
 * Multiview engine — up to 4 independent multiviews, each with its own layout, rendered only while something
 * shows it (the Multiview module or an external monitor). vMix-style layouts, tally borders, labels, audio meters,
 * on-air status, clock and safe areas. Cells can be re-assigned to any source.
 */
(function (BTS) {
  const U = BTS.U;

  // ---- layout presets → cells {x, y, w, h} in 0..1, plus default source per cell
  function grid(x0, y0, w0, h0, cols, rows, gap) {
    const cells = [];
    // keep 16:9 cells, centred in the area
    const aspect = 16 / 9 * (1080 / 1920); // cell w/h ratio expressed in normalised units
    let cw = (w0 - gap * (cols - 1)) / cols, ch = cw / aspect;
    if (ch * rows + gap * (rows - 1) > h0) { ch = (h0 - gap * (rows - 1)) / rows; cw = ch * aspect; }
    const ox = x0 + (w0 - (cw * cols + gap * (cols - 1))) / 2, oy = y0 + (h0 - (ch * rows + gap * (rows - 1))) / 2;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: ox + c * (cw + gap), y: oy + r * (ch + gap), w: cw, h: ch });
    return cells;
  }
  const G = 0.004;
  function ppPlus(cols, rows) {
    const bigW = 0.5 - 1.5 * G, bigH = bigW * (1920 / 1080) * (9 / 16);
    const top = [{ x: G, y: G, w: bigW, h: bigH, src: 'preview' }, { x: 0.5 + G / 2, y: G, w: bigW, h: bigH, src: 'program' }];
    return [...top, ...grid(G, bigH + 2 * G, 1 - 2 * G, 1 - bigH - 3 * G - 0.035, cols, rows, G).map(c => ({ ...c, src: 'auto' }))];
  }
  function gridN(n, monitors) {
    return grid(G, G, 1 - 2 * G, 1 - 2 * G - 0.035, n, n, G).map((c, i) => ({ ...c, src: monitors && i === 0 ? 'program' : monitors && i === 1 ? 'preview' : 'auto' }));
  }
  function programBig() {
    const pw = 0.74, ph = pw * (1920 / 1080) * (9 / 16);
    const cells = [{ x: G, y: G, w: pw, h: ph, src: 'program' }];
    const sw = 1 - pw - 3 * G, sh = sw * (1920 / 1080) * (9 / 16);
    cells.push({ x: pw + 2 * G, y: G, w: sw, h: sh, src: 'preview' });
    for (let i = 1; i < 3; i++) cells.push({ x: pw + 2 * G, y: G + i * (sh + G), w: sw, h: sh, src: 'auto' });
    grid(G, ph + 2 * G, 1 - 2 * G, 1 - ph - 3 * G - 0.035, 5, 1, G).forEach(c => cells.push({ ...c, src: 'auto' }));
    return cells;
  }
  const LAYOUTS = {
    pp8: { name: 'Preview + Output + 8', make: () => ppPlus(4, 2) },
    pp12: { name: 'Preview + Output + 12', make: () => ppPlus(6, 2) },
    pp16: { name: 'Preview + Output + 16', make: () => ppPlus(8, 2) },
    pp24: { name: 'Preview + Output + 24', make: () => ppPlus(8, 3) },
    pgm: { name: 'Big Output + Preview + 7', make: programBig },
    g2: { name: '2 × 2', make: () => gridN(2, true) },
    g3: { name: '3 × 3', make: () => gridN(3, true) },
    g4: { name: '4 × 4', make: () => gridN(4, true) },
    g5: { name: '5 × 5', make: () => gridN(5, true) },
    i4: { name: '2 × 2 inputs only', make: () => gridN(2, false) },
    i9: { name: '3 × 3 inputs only', make: () => gridN(3, false) },
    i16: { name: '4 × 4 inputs only', make: () => gridN(4, false) }
  };

  const DEFAULT = (n) => ({ name: `Multiview ${n}`, layout: n === 1 ? 'pp8' : n === 2 ? 'pp16' : n === 3 ? 'g3' : 'pgm', res: '1920x1080', labels: true, tally: true, meters: true, safe: false, status: true, offset: 0, assign: {}, skipAudioOnly: true });

  class Multiview {
    constructor(mgr, n, cfg) {
      this.mgr = mgr; this.n = n;
      this.cfg = { ...DEFAULT(n), ...(cfg || {}) };
      this.canvas = n === 1 && document.getElementById('multiviewCanvas') ? document.getElementById('multiviewCanvas') : document.createElement('canvas');
      this.users = 0; // external windows / streams using it
      this._resize();
    }
    get visible() { return this.n === this.mgr.moduleIndex && this.mgr.moduleVisible; }
    get active() { return this.users > 0 || this.visible; }
    _resize() {
      const [w, h] = (this.cfg.res || '1920x1080').split('x').map(Number);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.ctx = this.canvas.getContext('2d', { alpha: false }); this.ctx.imageSmoothingQuality = 'medium'; }
      if (!this.ctx) this.ctx = this.canvas.getContext('2d', { alpha: false });
    }
    cells() {
      const L = LAYOUTS[this.cfg.layout] || LAYOUTS.pp8;
      const st = this.mgr.studio;
      const cells = L.make();
      const pool = st.inputs.filter(i => !(this.cfg.skipAudioOnly && (i.type === 'audio' || i.type === 'audio-file')));
      let k = this.cfg.offset || 0;
      return cells.map((c, idx) => {
        const a = this.cfg.assign && this.cfg.assign[idx];
        let src = a || c.src;
        let inp = null;
        if (src === 'auto') { inp = pool[k++] || null; src = inp ? 'input:' + inp.id : 'none'; }
        else if (src.startsWith('input:')) inp = st.byId(src.slice(6));
        return { ...c, i: idx, src, inp };
      });
    }
    render() {
      this._resize();
      const st = this.mgr.studio, g = this.ctx, W = this.canvas.width, H = this.canvas.height, s = H / 1080;
      g.fillStyle = '#08090b'; g.fillRect(0, 0, W, H);
      const cells = this.cells();
      this._last = cells;
      for (const c of cells) {
        const x = Math.round(c.x * W), y = Math.round(c.y * H), w = Math.round(c.w * W), h = Math.round(c.h * H);
        g.fillStyle = '#000'; g.fillRect(x, y, w, h);
        let label = '', color = null, peak = null;
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
        try {
          if (c.src === 'program') { g.drawImage(st.programCanvas, x, y, w, h); label = 'OUTPUT' + (st.program ? ' — ' + st.program.title : ''); color = '#e2453c'; peak = st.audio.buses.M.peak; }
          else if (c.src === 'preview') { g.drawImage(st.previewCanvas, x, y, w, h); label = 'PREVIEW' + (st.preview ? ' — ' + st.preview.title : ''); color = '#2fbf62'; }
          else if (c.src === 'clock') { this._clock(g, x, y, w, h, s); label = ''; }
          else if (c.inp) {
            const i = c.inp;
            if (i.type === 'title' && !i.live) i.drawStatic(g, x, y, w, h); else i.draw(g, x, y, w, h);
            label = `${i.number}  ${i.title}`;
            color = st.liveSet.has(i) || i.id === st.programId ? '#e2453c' : i.id === st.previewId ? '#2fbf62' : null;
            if (i.channel) peak = i.channel.peak;
            if (i.status === 'error') { g.fillStyle = 'rgba(226,69,60,.25)'; g.fillRect(x, y, w, h); }
          }
        } catch (e) { /* one bad source never stops the multiview */ }
        if (this.cfg.safe && (c.src === 'program' || c.src === 'preview')) {
          g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.setLineDash([6 * s, 6 * s]);
          g.strokeRect(x + w * 0.05, y + h * 0.05, w * 0.9, h * 0.9); g.strokeRect(x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8); g.setLineDash([]);
        }
        g.restore();
        if (this.cfg.labels && label) {
          const lh = Math.max(16, Math.min(34, h * 0.12));
          g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(x, y + h - lh, w, lh);
          g.fillStyle = '#fff'; g.font = `600 ${Math.round(lh * 0.6)}px "Segoe UI", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(label.length > 48 ? label.slice(0, 46) + '…' : label, x + w / 2, y + h - lh / 2, w - 8);
        }
        if (this.cfg.tally && color) { g.strokeStyle = color; g.lineWidth = Math.max(3, 5 * s); g.strokeRect(x + g.lineWidth / 2, y + g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth); }
        if (this.cfg.meters && peak) this._meter(g, x + w - Math.max(10, 14 * s), y + 6 * s, Math.max(4, 5 * s), h - 6 * s - Math.max(16, Math.min(34, h * 0.12)) - 4, peak);
      }
      if (this.cfg.status) this._status(g, W, H, s);
    }
    _meter(g, x, y, bw, h, peak) {
      for (let ch = 0; ch < 2; ch++) {
        const v = U.clamp((U.db(peak[ch] || 0) + 60) / 60, 0, 1);
        const bx = x + ch * (bw + 2);
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(bx, y, bw, h);
        const hh = v * h;
        const grad = g.createLinearGradient(0, y + h, 0, y);
        grad.addColorStop(0, '#2fbf62'); grad.addColorStop(0.7, '#2fbf62'); grad.addColorStop(0.85, '#f5c344'); grad.addColorStop(1, '#e2453c');
        g.fillStyle = grad; g.fillRect(bx, y + h - hh, bw, hh);
      }
    }
    _status(g, W, H, s) {
      const st = this.mgr.studio, out = st.outputs;
      const bh = Math.round(34 * s), y = H - bh;
      g.fillStyle = '#121418'; g.fillRect(0, y, W, bh);
      g.font = `700 ${Math.round(18 * s)}px "Segoe UI", system-ui, sans-serif`; g.textBaseline = 'middle';
      let x = 12 * s;
      const pill = (text, on, col) => {
        const tw = g.measureText(text).width + 22 * s;
        g.fillStyle = on ? col : '#2a2d35'; g.beginPath(); g.roundRect(x, y + 5 * s, tw, bh - 10 * s, 6 * s); g.fill();
        g.fillStyle = on ? '#fff' : '#8b919c'; g.textAlign = 'center'; g.fillText(text, x + tw / 2, y + bh / 2 + 1);
        x += tw + 8 * s;
      };
      pill(out.isStreaming() ? `LIVE ${U.fmtTime(out.elapsed('stream'))}` : 'LIVE', out.isStreaming(), '#e2453c');
      pill(out.isRecording() ? `REC ${U.fmtTime(out.elapsed('record'))}` : 'REC', out.isRecording(), '#e2453c');
      if (st.replay) pill('REPLAY', st.replay.running, '#f5a524');
      pill(`${st.stats.fps.toFixed(0)} FPS`, st.stats.fps < st.fps * 0.9, '#f5a524');
      g.fillStyle = '#f0a53a'; g.textAlign = 'right'; g.font = `700 ${Math.round(22 * s)}px "Segoe UI", system-ui, sans-serif`;
      g.fillText(new Date().toLocaleTimeString(), W - 14 * s, y + bh / 2 + 1);
      g.fillStyle = '#8b919c'; g.font = `600 ${Math.round(15 * s)}px "Segoe UI", system-ui, sans-serif`;
      g.fillText(this.cfg.name, W - 140 * s, y + bh / 2 + 1);
    }
    _clock(g, x, y, w, h) {
      g.fillStyle = '#0d0f13'; g.fillRect(x, y, w, h);
      g.fillStyle = '#f0a53a'; g.font = `700 ${Math.round(h * 0.28)}px "Segoe UI", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(new Date().toLocaleTimeString(), x + w / 2, y + h / 2);
    }
    /** Hit test in canvas-relative 0..1 coordinates */
    hit(fx, fy) { return (this._last || this.cells()).find(c => fx >= c.x && fx <= c.x + c.w && fy >= c.y && fy <= c.y + c.h) || null; }
  }

  class MultiviewManager extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      const saved = (BTS.settings.multiviews || []);
      this.list = [1, 2, 3, 4].map(n => new Multiview(this, n, saved[n - 1]));
      this.moduleIndex = 1; this.moduleVisible = false;
    }
    get(n) { return this.list[(+n || 1) - 1] || this.list[0]; }
    get anyActive() { return this.list.some(m => m.active); }
    render(frameId, every) {
      for (const m of this.list) {
        if (!m.active) continue;
        // external monitors get every second frame at most; the module follows the governor
        const step = m.users ? Math.max(1, Math.min(every, 2)) : every;
        if (frameId % step === 0) { try { m.render(); } catch (e) { console.error('multiview', e); } }
      }
    }
    save() { BTS.settings.multiviews = this.list.map(m => m.cfg); return BTS.SettingsUI && BTS.SettingsUI.save ? BTS.SettingsUI.save() : null; }
  }

  BTS.MultiviewManager = MultiviewManager;
  BTS.Multiview = { LAYOUTS };
})(window.BTS);
