'use strict';
/**
 * Scopes module: Waveform (luma), Waveform RGB, RGB Parade, Vectorscope, Histogram, or a 4-up split.
 * Source: Output, Preview or any input. Analysed from a down-scaled copy ~10× per second so it costs little.
 */
(function (BTS) {
  const U = BTS.U;
  const SW = 320, SH = 180; // analysis resolution

  class ScopesUI {
    constructor(studio, root) {
      this.studio = studio;
      this.root = root;
      this.mode = localStorage.getItem('bts.scope.mode') || 'split';
      this.source = 'program';
      this.visible = false;
      this.sample = document.createElement('canvas'); this.sample.width = SW; this.sample.height = SH;
      this.sctx = this.sample.getContext('2d', { willReadFrequently: true });
      this.build();
      let n = 0;
      studio.on('frame', () => { if (this.visible && (++n % Math.max(2, Math.round(studio.fps / 10)) === 0)) this.draw(); });
      studio.on('inputs', () => this.fillSources());
    }

    build() {
      this.root.innerHTML = '';
      const modeSel = U.el('select');
      for (const [v, l] of [['split', 'Split (4-up)'], ['wave', 'Waveform (Luma)'], ['wavergb', 'Waveform RGB'], ['parade', 'RGB Parade'], ['vector', 'Vectorscope'], ['hist', 'Histogram']]) modeSel.append(U.el('option', { value: v, text: l, selected: v === this.mode }));
      modeSel.onchange = () => { this.mode = modeSel.value; try { localStorage.setItem('bts.scope.mode', this.mode); } catch { /* noop */ } };
      this.srcSel = U.el('select', { onchange: (e) => { this.source = e.target.value; } });
      this.fillSources();
      this.canvas = U.el('canvas', { class: 'scope-canvas' });
      const wrap = U.el('div', { class: 'scope-wrap' }, [this.canvas]);
      this.root.append(U.el('div', { class: 'mod-toolbar' }, [U.el('span', { class: 'hint', text: 'Source' }), this.srcSel, U.el('span', { class: 'hint', text: 'Scope' }), modeSel]), wrap);
      new ResizeObserver(() => { const r = wrap.getBoundingClientRect(); this.canvas.width = Math.max(200, Math.floor(r.width)); this.canvas.height = Math.max(120, Math.floor(r.height)); }).observe(wrap);
    }
    fillSources() {
      const cur = this.source;
      this.srcSel.innerHTML = '';
      for (const [v, l] of [['program', 'Output'], ['preview', 'Preview'], ...this.studio.inputs.filter(i => i.hasVideo).map(i => [i.id, `${i.number}. ${i.title}`])]) this.srcSel.append(U.el('option', { value: v, text: l, selected: v === cur }));
    }
    setVisible(v) { this.visible = v; }

    grab() {
      const st = this.studio, g = this.sctx;
      g.fillStyle = '#000'; g.fillRect(0, 0, SW, SH);
      if (this.source === 'program') g.drawImage(st.programCanvas, 0, 0, SW, SH);
      else if (this.source === 'preview') g.drawImage(st.previewCanvas, 0, 0, SW, SH);
      else { const i = st.byId(this.source); if (i) { if (i.type === 'title' && !i.live) i.drawStatic(g, 0, 0, SW, SH); else i.draw(g, 0, 0, SW, SH); } }
      return g.getImageData(0, 0, SW, SH).data;
    }

    draw() {
      const c = this.canvas, ctx = c.getContext('2d'), W = c.width, H = c.height;
      if (!W || !H) return;
      let d;
      try { d = this.grab(); } catch { return; }
      ctx.fillStyle = '#07080a'; ctx.fillRect(0, 0, W, H);
      const pad = 6;
      if (this.mode === 'split') {
        const w2 = (W - pad * 3) / 2, h2 = (H - pad * 3) / 2;
        this.wave(ctx, d, pad, pad, w2, h2, 'luma');
        this.parade(ctx, d, pad * 2 + w2, pad, w2, h2);
        this.vector(ctx, d, pad, pad * 2 + h2, w2, h2);
        this.hist(ctx, d, pad * 2 + w2, pad * 2 + h2, w2, h2);
      } else if (this.mode === 'wave') this.wave(ctx, d, pad, pad, W - pad * 2, H - pad * 2, 'luma');
      else if (this.mode === 'wavergb') this.wave(ctx, d, pad, pad, W - pad * 2, H - pad * 2, 'rgb');
      else if (this.mode === 'parade') this.parade(ctx, d, pad, pad, W - pad * 2, H - pad * 2);
      else if (this.mode === 'vector') this.vector(ctx, d, pad, pad, W - pad * 2, H - pad * 2);
      else this.hist(ctx, d, pad, pad, W - pad * 2, H - pad * 2);
    }

    _frame(ctx, x, y, w, h, label, grid = true) {
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (grid) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = '9px Segoe UI'; ctx.textAlign = 'left'; for (const v of [0, 25, 50, 75, 100]) { const yy = y + h - (v / 100) * (h - 1); ctx.fillRect(x, Math.round(yy), w, 1); ctx.fillText(String(v), x + 2, yy - 2); } ctx.fillStyle = 'rgba(255,255,255,.04)'; }
      ctx.fillStyle = '#a8aebb'; ctx.font = '700 10px Segoe UI'; ctx.textAlign = 'right'; ctx.fillText(label, x + w - 4, y + 12);
    }

    /** waveform via a density image: x = column, y = level */
    _density(cols, h, plot) {
      const img = new ImageData(cols, h);
      return { img, plot };
    }
    wave(ctx, d, x, y, w, h, kind) {
      const cols = Math.min(SW, Math.floor(w)), rows = Math.max(32, Math.floor(h));
      const acc = new Float32Array(cols * rows * 3);
      for (let py = 0; py < SH; py++) for (let px = 0; px < SW; px++) {
        const i = (py * SW + px) * 4, col = Math.floor(px * cols / SW);
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (kind === 'luma') { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; const row = rows - 1 - Math.floor(l / 256 * rows); const k = (row * cols + col) * 3; acc[k] += 1; acc[k + 1] += 1; acc[k + 2] += 1; }
        else { for (let ch = 0; ch < 3; ch++) { const v = ch === 0 ? r : ch === 1 ? g : b; const row = rows - 1 - Math.floor(v / 256 * rows); acc[(row * cols + col) * 3 + ch] += 1; } }
      }
      const img = new ImageData(cols, rows), gain = 255 * cols / SW * 0.9;
      for (let k = 0, j = 0; k < acc.length; k += 3, j += 4) {
        if (kind === 'luma') { const v = Math.min(255, acc[k] * gain * 0.6); img.data[j] = v * 0.55; img.data[j + 1] = v; img.data[j + 2] = v * 0.6; }
        else { img.data[j] = Math.min(255, acc[k] * gain); img.data[j + 1] = Math.min(255, acc[k + 1] * gain); img.data[j + 2] = Math.min(255, acc[k + 2] * gain); }
        img.data[j + 3] = 255;
      }
      this._blit(ctx, img, x, y, w, h);
      this._frame(ctx, x, y, w, h, kind === 'luma' ? 'WAVEFORM' : 'WAVEFORM RGB');
    }
    parade(ctx, d, x, y, w, h) {
      const cols = Math.min(SW, Math.floor(w / 3)), rows = Math.max(32, Math.floor(h));
      const img = new ImageData(cols * 3, rows), acc = new Float32Array(cols * 3 * rows);
      for (let py = 0; py < SH; py++) for (let px = 0; px < SW; px++) {
        const i = (py * SW + px) * 4, col = Math.floor(px * cols / SW);
        for (let ch = 0; ch < 3; ch++) { const row = rows - 1 - Math.floor(d[i + ch] / 256 * rows); acc[row * cols * 3 + ch * cols + col] += 1; }
      }
      const gain = 255 * cols / SW * 0.9;
      for (let k = 0; k < acc.length; k++) { const ch = Math.floor((k % (cols * 3)) / cols), v = Math.min(255, acc[k] * gain), j = k * 4; img.data[j] = ch === 0 ? v : v * 0.15; img.data[j + 1] = ch === 1 ? v : v * 0.15; img.data[j + 2] = ch === 2 ? v : v * 0.15; img.data[j + 3] = 255; }
      this._blit(ctx, img, x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(x + w / 3, y, 1, h); ctx.fillRect(x + 2 * w / 3, y, 1, h);
      this._frame(ctx, x, y, w, h, 'RGB PARADE');
    }
    vector(ctx, d, x, y, w, h) {
      const S = Math.floor(Math.min(w, h)), cx = x + w / 2, cy = y + h / 2;
      const N = 256, acc = new Float32Array(N * N);
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const cb = -0.168736 * r - 0.331264 * g + 0.5 * b, cr = 0.5 * r - 0.418688 * g - 0.081312 * b; // -128..128
        const u = Math.floor(N / 2 + cb), v = Math.floor(N / 2 - cr);
        if (u >= 0 && u < N && v >= 0 && v < N) acc[v * N + u] += 1;
      }
      const img = new ImageData(N, N);
      for (let k = 0; k < acc.length; k++) { const v = Math.min(255, acc[k] * 40); const j = k * 4; img.data[j] = v * 0.6; img.data[j + 1] = v; img.data[j + 2] = v * 0.7; img.data[j + 3] = 255; }
      const sx = cx - S / 2, sy = cy - S / 2;
      this._blit(ctx, img, sx, sy, S, S);
      // graticule: circle, skin-tone line, 75% colour targets
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(cx, cy, S / 2 - 1, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - S / 2, cy); ctx.lineTo(cx + S / 2, cy); ctx.moveTo(cx, cy - S / 2); ctx.lineTo(cx, cy + S / 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(245,165,36,.6)'; ctx.beginPath(); const a = -123 * Math.PI / 180; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * S / 2, cy + Math.sin(a) * S / 2); ctx.stroke();
      ctx.font = '700 9px Segoe UI'; ctx.textAlign = 'center';
      for (const [lab, col] of [['R', [191, 0, 0]], ['Mg', [191, 0, 191]], ['B', [0, 0, 191]], ['Cy', [0, 191, 191]], ['G', [0, 191, 0]], ['Yl', [191, 191, 0]]]) {
        const [r, g, b] = col; const cb = -0.168736 * r - 0.331264 * g + 0.5 * b, cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
        const px = cx + cb / 128 * S / 2, py = cy - cr / 128 * S / 2;
        ctx.strokeStyle = `rgb(${r},${g},${b})`; ctx.strokeRect(px - 5, py - 5, 10, 10); ctx.fillStyle = '#ddd'; ctx.fillText(lab, px, py - 8);
      }
      this._frame(ctx, x, y, w, h, 'VECTORSCOPE', false);
    }
    hist(ctx, d, x, y, w, h) {
      const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      for (let i = 0; i < d.length; i += 4) { bins[0][d[i]]++; bins[1][d[i + 1]]++; bins[2][d[i + 2]]++; bins[3][Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++; }
      const max = Math.max(1, ...bins.map(b => Math.max(...b.slice(2, 254))));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const cols = ['rgba(239,68,68,.55)', 'rgba(34,197,94,.55)', 'rgba(59,130,246,.55)', 'rgba(220,220,220,.35)'];
      bins.forEach((b, ch) => { ctx.fillStyle = cols[ch]; ctx.beginPath(); ctx.moveTo(x, y + h); for (let k = 0; k < 256; k++) ctx.lineTo(x + k / 255 * w, y + h - Math.min(1, b[k] / max) * (h - 14)); ctx.lineTo(x + w, y + h); ctx.fill(); });
      ctx.restore();
      // clipping warnings
      const total = d.length / 4, lo = bins[3][0] / total, hi = bins[3][255] / total;
      ctx.font = '700 10px Segoe UI'; ctx.textAlign = 'left';
      if (hi > 0.01) { ctx.fillStyle = '#ef4444'; ctx.fillText(`CLIP ${(hi * 100).toFixed(1)}%`, x + 4, y + 12); }
      if (lo > 0.05) { ctx.fillStyle = '#3b82f6'; ctx.fillText(`CRUSH ${(lo * 100).toFixed(1)}%`, x + 4, y + 24); }
      this._frame(ctx, x, y, w, h, 'HISTOGRAM', false);
    }
    _blit(ctx, img, x, y, w, h) {
      const t = this._tmp || (this._tmp = document.createElement('canvas'));
      if (t.width !== img.width || t.height !== img.height) { t.width = img.width; t.height = img.height; }
      t.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(t, x, y, w, h);
    }
  }

  BTS.ScopesUI = ScopesUI;
})(window.BTS);
