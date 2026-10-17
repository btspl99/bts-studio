'use strict';
/**
 * BTS Title Editor — a GT-Designer-style workspace for broadcast graphics.
 *   Toolbar (file, undo/redo, add objects, align/distribute, order, view) · Layers · Canvas (move / resize / rotate
 *   with smart guides, marquee, nudge) · Inspector (transform, text, fill, outline, shadow, image, data field,
 *   per-object In/Out animation) · Timeline (drag bars to set each object's delay and duration, scrub, play In/Out).
 * Output is a normal title template: it works with SetText / data sources / overlays exactly like built-in titles.
 */
(function (BTS) {
  const U = BTS.U;

  const FONTS = ['Segoe UI', 'Segoe UI Semibold', 'Segoe UI Black', 'Bahnschrift', 'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel', 'Franklin Gothic Medium', 'Georgia', 'Impact', 'Lucida Sans Unicode', 'Palatino Linotype', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Nirmala UI', 'Mangal', 'Inter', 'Roboto', 'Montserrat', 'Poppins', 'Oswald', 'Bebas Neue', 'Anton', 'Open Sans', 'Lato'];
  const ANIMS = [['none', 'None (appear)'], ['fade', 'Fade'], ['slide-left', 'Slide from left'], ['slide-right', 'Slide from right'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['nudge-left', 'Nudge left'], ['nudge-right', 'Nudge right'], ['nudge-up', 'Nudge up'], ['wipe-right', 'Wipe →'], ['wipe-left', 'Wipe ←'], ['wipe-down', 'Wipe ↓'], ['wipe-up', 'Wipe ↑'], ['reveal', 'Reveal from centre'], ['zoom', 'Zoom'], ['pop', 'Pop'], ['stretch', 'Stretch'], ['flip', 'Flip'], ['spin', 'Spin'], ['blur', 'Blur'], ['drop', 'Drop in'], ['typewriter', 'Typewriter (text)']];
  const EASES = [['out', 'Ease out'], ['in', 'Ease in'], ['inout', 'Ease in-out'], ['linear', 'Linear'], ['back', 'Back (overshoot)'], ['bounce', 'Bounce'], ['elastic', 'Elastic']];
  const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['lighter', 'Add'], ['soft-light', 'Soft light'], ['difference', 'Difference']];
  const ICON = { text: 'T', rect: '▭', ellipse: '◯', line: '╱', image: '🖼', clock: '🕒', countdown: '⏱', ticker: '⇆', crawl: '⇅' };
  const TEXTY = ['text', 'clock', 'countdown', 'ticker', 'crawl'];
  let fontList = null;
  async function systemFonts() {
    if (fontList) return fontList;
    let names = [];
    try { if (window.queryLocalFonts) names = [...new Set((await window.queryLocalFonts()).map(f => f.family))]; } catch { /* permission denied */ }
    fontList = [...new Set([...FONTS, ...names])].sort((a, b) => a.localeCompare(b));
    return fontList;
  }

  class TitleEditor {
    constructor(inp) {
      this.inp = inp || null;
      this.tpl = U.deepClone(inp ? inp.renderer.t : BTS.Titles.TEMPLATES.blank());
      this.tpl.elements.forEach(e => { if (!e.id) e.id = BTS.Titles.newElement({}).id; });
      this.r = new BTS.Titles.TitleRenderer(this.tpl);
      this.sel = new Set(this.tpl.elements.length ? [this.tpl.elements.at(-1).id] : []);
      this.hist = []; this.future = []; this.dirty = false;
      this.view = { zoom: 'fit', grid: false, snap: true, safe: true, bg: 'checker' };
      try { Object.assign(this.view, JSON.parse(localStorage.getItem('bts-te-view') || '{}')); } catch { /* noop */ }
      this.tl = { dir: 1, t: null, playing: false };
      this.guides = [];
      this._build();
      this._push(true);
      this.refresh();
      this._loop();
      systemFonts().then(() => this.refreshProps());
    }

    /* ================= DOM ================= */
    _build() {
      const root = this.root = U.el('div', { class: 'te-root', tabindex: -1 });
      const bar = U.el('div', { class: 'te-bar' });
      const b = (text, title, fn, cls = '') => U.el('button', { class: 'te-btn ' + cls, text, title, onclick: fn });
      const sep = () => U.el('span', { class: 'te-sep' });
      this.nameIn = U.el('input', { class: 'te-name', value: this.tpl.name || 'Title', title: 'Title name', onchange: () => { this.tpl.name = this.nameIn.value; this.commit(); } });
      const add = (type) => () => this.add(type);
      this.zoomSel = U.el('select', { title: 'Zoom', onchange: () => { this.view.zoom = this.zoomSel.value; this._saveView(); this.layoutStage(); } }, [['fit', 'Fit'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%']].map(([v, l]) => U.el('option', { value: v, text: l })));
      this.bgSel = U.el('select', { title: 'Background', onchange: () => { this.view.bg = this.bgSel.value; this._saveView(); } }, [['checker', 'Checker'], ['black', 'Black'], ['grey', 'Grey'], ['program', 'Live output'], ['preview', 'Preview']].map(([v, l]) => U.el('option', { value: v, text: l })));
      this.zoomSel.value = String(this.view.zoom); this.bgSel.value = this.view.bg;
      const tog = (key, text, title) => { const btn = b(text, title, () => { this.view[key] = !this.view[key]; btn.classList.toggle('on', this.view[key]); this._saveView(); }); btn.classList.toggle('on', !!this.view[key]); return btn; };
      bar.append(
        U.el('span', { class: 'te-logo', text: 'Title Editor' }), this.nameIn, sep(),
        b('New', 'New blank title', () => this.newTitle()), b('Open…', 'Open .btstitle', () => this.openFile()), b('Save…', 'Save as .btstitle (Ctrl+S)', () => this.saveFile()), b('PSD…', 'Import a Photoshop file', () => this.importPsd()), sep(),
        b('↶', 'Undo (Ctrl+Z)', () => this.undo()), b('↷', 'Redo (Ctrl+Y)', () => this.redo()), sep(),
        b('T', 'Add text (T)', add('text')), b('▭', 'Add rectangle (R)', add('rect')), b('◯', 'Add ellipse (E)', add('ellipse')), b('╱', 'Add line (L)', add('line')), b('🖼', 'Add image', add('image')),
        b('🕒', 'Add clock', add('clock')), b('⏱', 'Add countdown / timer', add('countdown')), b('⇆', 'Add ticker', add('ticker')), b('⇅', 'Add crawl / credits', add('crawl')), sep(),
        b('⫷', 'Align left', () => this.align('l')), b('⫼', 'Align centre', () => this.align('c')), b('⫸', 'Align right', () => this.align('r')),
        b('⊤', 'Align top', () => this.align('t')), b('⊝', 'Align middle', () => this.align('m')), b('⊥', 'Align bottom', () => this.align('b')),
        b('↔', 'Distribute horizontally', () => this.distribute('h')), b('↕', 'Distribute vertically', () => this.distribute('v')), sep(),
        b('⤒', 'Bring to front ( ] )', () => this.order(1)), b('⤓', 'Send to back ( [ )', () => this.order(-1)), b('⧉', 'Duplicate (Ctrl+D)', () => this.duplicate()), b('🗑', 'Delete (Del)', () => this.remove()), sep(),
        tog('grid', '#', 'Grid'), tog('snap', '🧲', 'Snapping and smart guides'), tog('safe', '▣', 'Title / action safe'), this.bgSel, this.zoomSel,
        U.el('span', { class: 'spacer' }),
        b('▶ In', 'Play In animation', () => this.play(1)), b('▶ Out', 'Play Out animation', () => this.play(-1)), sep(),
        ...(this.inp ? [b('Apply', 'Update the title input (Ctrl+Enter)', () => this.apply(), 'primary')] : []),
        b(this.inp ? 'Save as new input' : 'Add as input', 'Create a Title input from this design', () => this.addAsInput(), this.inp ? '' : 'primary'),
        b('✕', 'Close (Esc)', () => this.close())
      );
      this.layers = U.el('div', { class: 'te-layers' });
      const left = U.el('div', { class: 'te-left' }, [U.el('div', { class: 'te-h', text: 'LAYERS' }), this.layers, U.el('div', { class: 'te-hint', text: 'Top of the list is in front. Drag to reorder · double-click to rename. The layer name is the data field name (SetText, data sources).' })]);
      this.stage = U.el('canvas', { class: 'te-canvas' });
      this.overlay = U.el('canvas', { class: 'te-overlay', tabindex: 0 });
      this.stageWrap = U.el('div', { class: 'te-stagewrap' }, [this.stage, this.overlay]);
      this.center = U.el('div', { class: 'te-center' }, [this.stageWrap]);
      this.props = U.el('div', { class: 'te-props' });
      this.timeline = U.el('div', { class: 'te-timeline' });
      const main = U.el('div', { class: 'te-main' }, [left, this.center, this.props]);
      this.status = U.el('div', { class: 'te-status' });
      root.append(bar, main, this.timeline, this.status);
      document.body.append(root);
      this.sctx = this.stage.getContext('2d');
      this.octx = this.overlay.getContext('2d');
      this._events();
      new ResizeObserver(() => this.layoutStage()).observe(this.center);
      setTimeout(() => this.overlay.focus(), 50);
    }
    _saveView() { try { localStorage.setItem('bts-te-view', JSON.stringify(this.view)); } catch { /* noop */ } }

    layoutStage() {
      const W = this.tpl.width || 1920, H = this.tpl.height || 1080;
      if (this.stage.width !== W || this.stage.height !== H) { this.stage.width = W; this.stage.height = H; this.r.setTemplate(this.tpl); }
      const box = this.center.getBoundingClientRect();
      const z = this.view.zoom === 'fit' ? Math.min((box.width - 40) / W, (box.height - 40) / H) : +this.view.zoom;
      this.scale = Math.max(0.05, z);
      const dw = Math.round(W * this.scale), dh = Math.round(H * this.scale);
      Object.assign(this.stageWrap.style, { width: dw + 'px', height: dh + 'px' });
      const dpr = window.devicePixelRatio || 1;
      this.overlay.width = dw * dpr; this.overlay.height = dh * dpr;
      this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* ================= model helpers ================= */
    get elements() { return this.tpl.elements; }
    get one() { return this.sel.size === 1 ? this.elements.find(e => e.id === [...this.sel][0]) : null; }
    get selected() { return this.elements.filter(e => this.sel.has(e.id)); }
    byId(id) { return this.elements.find(e => e.id === id); }
    uniqueName(base) { let n = 1, name = base; const has = (x) => this.elements.some(e => (e.name || '').toLowerCase() === x.toLowerCase()); while (has(name)) name = base + (++n); return name; }
    _push(initial) {
      const snap = JSON.stringify(this.tpl);
      if (this.hist.length && this.hist[this.hist.length - 1] === snap) return;
      this.hist.push(snap); if (this.hist.length > 200) this.hist.shift();
      this.future = [];
      if (!initial) this.dirty = true;
    }
    commit() { this.r.setTemplate(this.tpl); this._push(); this.refresh(); }
    commitSoon() { clearTimeout(this._ct); this.r.setTemplate(this.tpl); this.refreshLayers(); this.refreshTimeline(); this._ct = setTimeout(() => { this._push(); }, 350); }
    undo() { if (this.hist.length < 2) return; this.future.push(this.hist.pop()); this._restore(this.hist[this.hist.length - 1]); }
    redo() { if (!this.future.length) return; const s = this.future.pop(); this.hist.push(s); this._restore(s); }
    _restore(s) { const t = JSON.parse(s); Object.keys(this.tpl).forEach(k => delete this.tpl[k]); Object.assign(this.tpl, t); for (const id of [...this.sel]) if (!this.byId(id)) this.sel.delete(id); this.r.setTemplate(this.tpl); this.nameIn.value = this.tpl.name || ''; this.dirty = true; this.refresh(); }

    add(type) {
      const B = BTS.Titles.BASE_TEXT, W = this.tpl.width || 1920, H = this.tpl.height || 1080, k = W / 1920;
      const mk = {
        text: () => ({ type: 'text', name: this.uniqueName('Text'), x: 160 * k, y: H * 0.42, w: 900 * k, h: 100 * k, text: 'Double-click to edit', size: 60 * k, ...B }),
        rect: () => ({ type: 'rect', name: this.uniqueName('Box'), x: 140 * k, y: H * 0.4, w: 960 * k, h: 140 * k, fill: '#14161b', fill2: '', radius: 10 * k, opacity: 0.95 }),
        ellipse: () => ({ type: 'ellipse', name: this.uniqueName('Circle'), x: W / 2 - 120 * k, y: H / 2 - 120 * k, w: 240 * k, h: 240 * k, fill: '#f0a53a' }),
        line: () => ({ type: 'line', name: this.uniqueName('Line'), x: 160 * k, y: H * 0.6, w: 800 * k, h: 0, stroke: '#ffffff', strokeWidth: 6 * k }),
        image: () => ({ type: 'image', name: this.uniqueName('Image'), x: 100 * k, y: 100 * k, w: 300 * k, h: 300 * k, src: '', fit: 'contain' }),
        clock: () => ({ type: 'clock', name: this.uniqueName('Clock'), x: W - 360 * k, y: 60 * k, w: 300 * k, h: 80 * k, format: 'HH:mm:ss', size: 48 * k, ...B, align: 'center' }),
        countdown: () => ({ type: 'countdown', name: this.uniqueName('Timer'), x: W / 2 - 250 * k, y: H / 2 - 110 * k, w: 500 * k, h: 220 * k, seconds: 300, size: 160 * k, ...B, align: 'center' }),
        ticker: () => ({ type: 'ticker', name: this.uniqueName('Ticker'), x: 0, y: H - 80 * k, w: W, h: 64 * k, text: 'Breaking news • Scores • Updates', separator: '   •   ', speed: 140, size: 34 * k, ...B, weight: 500 }),
        crawl: () => ({ type: 'crawl', name: this.uniqueName('Credits'), x: W * 0.2, y: 60 * k, w: W * 0.6, h: H - 120 * k, text: 'PRODUCED BY\nName\n\nDIRECTED BY\nName', speed: 70, size: 46 * k, ...B, weight: 500, align: 'center', loop: true })
      }[type];
      if (!mk) return;
      const e = BTS.Titles.newElement(mk());
      this.elements.push(e);
      this.sel = new Set([e.id]);
      if (type === 'image') this.commit(), this.pickImage(e); else this.commit();
    }
    async pickImage(e) {
      const f = await window.bts.dialog.open({ properties: ['openFile'], filters: [{ name: 'Images', extensions: U.IMAGE_EXT }] });
      if (!f) return;
      e.src = f[0];
      const img = BTS.Titles.loadImage(e.src);
      img.onload = () => { if (img.naturalWidth && e.w && e.h) { const r = img.naturalWidth / img.naturalHeight; e.h = e.w / r; } this.commit(); };
      this.commit();
    }
    remove() { if (!this.sel.size) return; this.tpl.elements = this.elements.filter(e => !this.sel.has(e.id)); this.sel.clear(); this.commit(); }
    duplicate() {
      const copies = this.selected.map(e => BTS.Titles.newElement({ ...U.deepClone(e), id: undefined, name: this.uniqueName(e.name || e.type), x: e.x + 20, y: e.y + 20 }));
      if (!copies.length) return;
      this.elements.push(...copies); this.sel = new Set(copies.map(c => c.id)); this.commit();
    }
    copy() { this._clip = this.selected.map(e => U.deepClone(e)); }
    paste() {
      if (!this._clip || !this._clip.length) return;
      const n = this._clip.map(e => BTS.Titles.newElement({ ...U.deepClone(e), id: undefined, name: this.uniqueName(e.name || e.type), x: e.x + 30, y: e.y + 30 }));
      this.elements.push(...n); this.sel = new Set(n.map(x => x.id)); this.commit();
    }
    order(d) {
      const els = this.elements, picked = els.filter(e => this.sel.has(e.id)), rest = els.filter(e => !this.sel.has(e.id));
      this.tpl.elements = d > 0 ? [...rest, ...picked] : [...picked, ...rest]; this.commit();
    }
    align(how) {
      const list = this.selected; if (!list.length) return;
      const W = this.tpl.width, H = this.tpl.height;
      // one object aligns to the canvas, several align to their combined bounds
      const bx = list.length > 1 ? { l: Math.min(...list.map(e => e.x)), t: Math.min(...list.map(e => e.y)), r: Math.max(...list.map(e => e.x + e.w)), b: Math.max(...list.map(e => e.y + e.h)) } : { l: 0, t: 0, r: W, b: H };
      for (const e of list) {
        if (how === 'l') e.x = bx.l; if (how === 'r') e.x = bx.r - e.w; if (how === 'c') e.x = (bx.l + bx.r) / 2 - e.w / 2;
        if (how === 't') e.y = bx.t; if (how === 'b') e.y = bx.b - e.h; if (how === 'm') e.y = (bx.t + bx.b) / 2 - e.h / 2;
      }
      this.commit();
    }
    distribute(axis) {
      const list = [...this.selected]; if (list.length < 3) return U.toast('Select 3 or more objects to distribute');
      const k = axis === 'h' ? 'x' : 'y', s = axis === 'h' ? 'w' : 'h';
      list.sort((a, b) => a[k] - b[k]);
      const first = list[0], last = list[list.length - 1];
      const total = list.reduce((a, e) => a + e[s], 0), span = last[k] + last[s] - first[k];
      const gap = (span - total) / (list.length - 1);
      let pos = first[k];
      for (const e of list) { e[k] = pos; pos += e[s] + gap; }
      this.commit();
    }

    /* ================= files ================= */
    newTitle() { if (this.dirty && !confirm('Discard changes?')) return; const t = BTS.Titles.TEMPLATES.blank(); Object.keys(this.tpl).forEach(k => delete this.tpl[k]); Object.assign(this.tpl, t); this.sel.clear(); this.nameIn.value = this.tpl.name; this.commit(); this.layoutStage(); }
    async openFile() {
      const f = await window.bts.dialog.open({ filters: [{ name: 'BTS Title', extensions: ['btstitle', 'json'] }] }); if (!f) return;
      try { const t = JSON.parse(await window.bts.file.readText(f[0])); if (!Array.isArray(t.elements)) throw new Error('not a title file'); Object.keys(this.tpl).forEach(k => delete this.tpl[k]); Object.assign(this.tpl, t); this.sel.clear(); this.nameIn.value = this.tpl.name || ''; this.commit(); this.layoutStage(); }
      catch (e) { U.toast('Invalid title file: ' + e.message, 'error'); }
    }
    async saveFile() { const f = await window.bts.dialog.save({ defaultPath: (this.tpl.name || 'title').replace(/[\\/:*?"<>|]/g, '_') + '.btstitle', filters: [{ name: 'BTS Title', extensions: ['btstitle'] }] }); if (f) { await window.bts.project.write(f, this.tpl); this.dirty = false; U.toast('Title saved', 'ok'); } }
    async importPsd() {
      const f = await window.bts.dialog.open({ properties: ['openFile'], filters: [{ name: 'Photoshop', extensions: ['psd', 'psb'] }] }); if (!f) return;
      try { const r = await BTS.PsdImport.importPsd(f[0]); const t = r.template; Object.keys(this.tpl).forEach(k => delete this.tpl[k]); Object.assign(this.tpl, t); this.sel.clear(); this.nameIn.value = t.name; this.commit(); this.layoutStage(); U.toast(`Imported ${t.elements.length} layers`, 'ok'); }
      catch (e) { U.toast('PSD import failed: ' + e.message, 'error'); }
    }
    apply() {
      if (!this.inp) return;
      this.inp.cfg.template = U.deepClone(this.tpl);
      if (this.inp.init) this.inp.init(); else this.inp.renderer.setTemplate(this.inp.cfg.template);
      this.inp.emit('fields'); BTS.studio.emit('inputs');
      this.dirty = false;
      U.toast('Title updated', 'ok');
    }
    async addAsInput() {
      const inp = await BTS.studio.addInput({ type: 'title', title: this.tpl.name || 'Title', cfg: { template: U.deepClone(this.tpl) } }, { select: true });
      BTS.studio.setPreview(inp.id);
      if (!this.inp) { this.inp = inp; this.dirty = false; }
      U.toast(`Added "${inp.title}" — it is in Preview`, 'ok');
    }
    close() {
      if (this.dirty && this.inp && confirm('Apply your changes to the title input before closing?')) this.apply();
      else if (this.dirty && !this.inp && !confirm('Close without adding this title as an input? Unsaved changes will be lost.')) return;
      cancelAnimationFrame(this._raf); this.root.remove(); document.removeEventListener('keydown', this._keyH, true);
      TitleEditor.current = null;
    }

    /* ================= rendering ================= */
    _loop() {
      let last = 0; const tick = (t) => { if (!this.root.isConnected) return; if (t - last >= 30 || this.drag) { last = t; try { this.draw(); } catch (e) { console.error(e); } } this._raf = requestAnimationFrame(tick); };
      this._raf = requestAnimationFrame(tick);
    }
    draw() {
      const g = this.sctx, W = this.stage.width, H = this.stage.height, st = BTS.studio;
      g.save();
      if (this.view.bg === 'checker') {
        if (!this._checker || this._checkerW !== W) { const s = Math.round(24 * (W / 1920)), c = document.createElement('canvas'); c.width = c.height = s * 2; const cg = c.getContext('2d'); cg.fillStyle = '#23252a'; cg.fillRect(0, 0, s * 2, s * 2); cg.fillStyle = '#2b2d33'; cg.fillRect(s, 0, s, s); cg.fillRect(0, s, s, s); this._checker = g.createPattern(c, 'repeat'); this._checkerW = W; }
        g.fillStyle = this._checker; g.fillRect(0, 0, W, H);
      }
      else if (this.view.bg === 'program' || this.view.bg === 'preview') { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.drawImage(this.view.bg === 'program' ? st.programCanvas : st.previewCanvas, 0, 0, W, H); }
      else { g.fillStyle = this.view.bg === 'grey' ? '#5a5d66' : '#000'; g.fillRect(0, 0, W, H); }
      g.restore();
      // animation playback / scrub
      if (this.tl.playing) {
        const ms = performance.now() - this.tl.start;
        this.tl.t = ms;
        if (ms > this.r.totalTime(this.tl.dir) + 300) { this.tl.playing = false; this.tl.t = null; }
      }
      const frame = this.tl.t != null ? this.r.renderAt(this.tl.dir, this.tl.t) : this.r.render(performance.now(), true);
      g.drawImage(frame, 0, 0);
      this.drawOverlay();
      if (this.tl.t != null || this._tlDirty) this.drawPlayhead();
    }
    drawOverlay() {
      const g = this.octx, s = this.scale, W = this.tpl.width, H = this.tpl.height;
      g.clearRect(0, 0, this.overlay.width, this.overlay.height);
      if (this.view.grid) { g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; const step = 40 * (W / 1920); g.beginPath(); for (let x = step; x < W; x += step) { g.moveTo(x * s + 0.5, 0); g.lineTo(x * s + 0.5, H * s); } for (let y = step; y < H; y += step) { g.moveTo(0, y * s + 0.5); g.lineTo(W * s, y * s + 0.5); } g.stroke(); }
      if (this.view.safe) { g.strokeStyle = 'rgba(255,255,255,.25)'; g.setLineDash([6, 6]); g.strokeRect(W * 0.05 * s, H * 0.05 * s, W * 0.9 * s, H * 0.9 * s); g.strokeRect(W * 0.1 * s, H * 0.1 * s, W * 0.8 * s, H * 0.8 * s); g.setLineDash([]); }
      // hover outline
      if (this.hover && !this.sel.has(this.hover.id) && !this.drag) this._outline(g, this.hover, 'rgba(80,160,255,.6)');
      for (const e of this.selected) this._outline(g, e, '#3b82f6');
      const one = this.one;
      if (one && !one.locked) {
        for (const h of this._handles(one)) { g.fillStyle = '#fff'; g.strokeStyle = '#3b82f6'; g.lineWidth = 1.5; g.beginPath(); if (h.k === 'rot') g.arc(h.x, h.y, 5, 0, Math.PI * 2); else g.rect(h.x - 4.5, h.y - 4.5, 9, 9); g.fill(); g.stroke(); }
      }
      // guides
      g.strokeStyle = '#ff3d9a'; g.lineWidth = 1;
      for (const gd of this.guides) { g.beginPath(); if (gd.v != null) { g.moveTo(gd.v * s + 0.5, 0); g.lineTo(gd.v * s + 0.5, H * s); } else { g.moveTo(0, gd.h * s + 0.5); g.lineTo(W * s, gd.h * s + 0.5); } g.stroke(); }
      if (this.marquee) { const m = this.marquee; g.fillStyle = 'rgba(59,130,246,.12)'; g.strokeStyle = '#3b82f6'; g.fillRect(m.x * s, m.y * s, m.w * s, m.h * s); g.strokeRect(m.x * s, m.y * s, m.w * s, m.h * s); }
    }
    _corners(e) {
      const s = this.scale, cx = (e.x + e.w / 2) * s, cy = (e.y + e.h / 2) * s, a = (e.rotation || 0) * Math.PI / 180;
      const rot = (x, y) => { const dx = x * s - cx, dy = y * s - cy; return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]; };
      return { rot, cx, cy, a };
    }
    _outline(g, e, color) {
      const { rot } = this._corners(e);
      const h = e.type === 'line' ? Math.max(e.h, 1) : e.h;
      const pts = [rot(e.x, e.y), rot(e.x + e.w, e.y), rot(e.x + e.w, e.y + h), rot(e.x, e.y + h)];
      g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.stroke();
    }
    _handles(e) {
      const { rot } = this._corners(e);
      const xs = [e.x, e.x + e.w / 2, e.x + e.w], ys = [e.y, e.y + e.h / 2, e.y + e.h];
      const keys = [['nw', 0, 0], ['n', 1, 0], ['ne', 2, 0], ['e', 2, 1], ['se', 2, 2], ['s', 1, 2], ['sw', 0, 2], ['w', 0, 1]];
      const hs = keys.map(([k, i, j]) => { const [x, y] = rot(xs[i], ys[j]); return { k, x, y }; });
      const [rx, ry] = rot(e.x + e.w / 2, e.y - 28 / this.scale);
      hs.push({ k: 'rot', x: rx, y: ry });
      return hs;
    }

    /* ================= hit testing ================= */
    _toTpl(ev) { const r = this.overlay.getBoundingClientRect(); return [(ev.clientX - r.left) / this.scale, (ev.clientY - r.top) / this.scale, ev.clientX - r.left, ev.clientY - r.top]; }
    _hit(x, y) {
      for (let i = this.elements.length - 1; i >= 0; i--) {
        const e = this.elements[i]; if (e.hidden) continue;
        const a = -(e.rotation || 0) * Math.PI / 180, cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        const dx = x - cx, dy = y - cy, lx = cx + dx * Math.cos(a) - dy * Math.sin(a), ly = cy + dx * Math.sin(a) + dy * Math.cos(a);
        const pad = e.type === 'line' ? 10 / this.scale : 0;
        if (lx >= e.x - pad && lx <= e.x + e.w + pad && ly >= e.y - pad && ly <= e.y + Math.max(e.h, 0) + pad) return e;
      }
      return null;
    }

    /* ================= events ================= */
    _events() {
      const ov = this.overlay;
      ov.addEventListener('pointerdown', (ev) => this._down(ev));
      ov.addEventListener('pointermove', (ev) => this._move(ev));
      ov.addEventListener('pointerup', (ev) => this._up(ev));
      ov.addEventListener('dblclick', (ev) => { const [x, y] = this._toTpl(ev); const e = this._hit(x, y); if (e && TEXTY.includes(e.type)) { this.sel = new Set([e.id]); this.refresh(); setTimeout(() => { const ta = this.props.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); } }, 30); } else if (e && e.type === 'image') this.pickImage(e); });
      ov.addEventListener('wheel', (ev) => { if (!ev.ctrlKey) return; ev.preventDefault(); const cur = this.view.zoom === 'fit' ? this.scale : +this.view.zoom; const z = U.clamp(cur * (ev.deltaY < 0 ? 1.1 : 0.9), 0.1, 2); this.view.zoom = String(Math.round(z * 100) / 100); this.layoutStage(); }, { passive: false });
      this._keyH = (ev) => this._key(ev);
      document.addEventListener('keydown', this._keyH, true);
    }
    _key(ev) {
      if (!this.root.isConnected) return;
      const t = ev.target, typing = t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable);
      const k = ev.key.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey;
      if (k === 'escape' && !typing) { ev.preventDefault(); ev.stopPropagation(); if (this.sel.size) { this.sel.clear(); this.refresh(); } else this.close(); return; }
      if (ctrl && k === 's') { ev.preventDefault(); ev.stopPropagation(); this.inp ? this.apply() : this.saveFile(); return; }
      if (ctrl && k === 'enter') { ev.preventDefault(); ev.stopPropagation(); this.inp ? this.apply() : this.addAsInput(); return; }
      if (typing) return;
      ev.stopPropagation();
      if (ctrl && k === 'z') { ev.preventDefault(); ev.shiftKey ? this.redo() : this.undo(); return; }
      if (ctrl && k === 'y') { ev.preventDefault(); this.redo(); return; }
      if (ctrl && k === 'd') { ev.preventDefault(); this.duplicate(); return; }
      if (ctrl && k === 'c') { this.copy(); return; }
      if (ctrl && k === 'v') { ev.preventDefault(); this.paste(); return; }
      if (ctrl && k === 'a') { ev.preventDefault(); this.sel = new Set(this.elements.map(e => e.id)); this.refresh(); return; }
      if (k === 'delete' || k === 'backspace') { ev.preventDefault(); this.remove(); return; }
      if (k === ']') return this.order(1);
      if (k === '[') return this.order(-1);
      const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[k] && this.sel.size) { ev.preventDefault(); const st = ev.shiftKey ? 10 : 1; for (const e of this.selected) { e.x += arrows[k][0] * st; e.y += arrows[k][1] * st; } this.commitSoon(); this.refreshProps(); return; }
      if (!ctrl && { t: 1, r: 1, e: 1, l: 1 }[k]) this.add({ t: 'text', r: 'rect', e: 'ellipse', l: 'line' }[k]);
    }
    _down(ev) {
      this.overlay.focus();
      try { this.overlay.setPointerCapture(ev.pointerId); } catch { /* synthetic */ }
      const [x, y, px, py] = this._toTpl(ev);
      const one = this.one;
      if (one && !one.locked) {
        const h = this._handles(one).find(hh => Math.hypot(hh.x - px, hh.y - py) < 8);
        if (h) { this.drag = { mode: h.k === 'rot' ? 'rot' : 'resize', k: h.k, x, y, orig: U.deepClone(one) }; return; }
      }
      const e = this._hit(x, y);
      if (e) {
        if (ev.shiftKey || ev.ctrlKey) { if (this.sel.has(e.id)) this.sel.delete(e.id); else this.sel.add(e.id); }
        else if (!this.sel.has(e.id)) this.sel = new Set([e.id]);
        this.refresh();
        if (this.selected.some(s => s.locked)) return;
        this.drag = { mode: 'move', x, y, primary: e.id, orig: this.selected.map(s => ({ id: s.id, x: s.x, y: s.y })) };
        if (ev.altKey) { this.duplicate(); this.drag.orig = this.selected.map(s => ({ id: s.id, x: s.x, y: s.y })); this.drag.primary = [...this.sel][0]; }
      } else {
        if (!ev.shiftKey) this.sel.clear();
        this.drag = { mode: 'marquee', x, y, base: new Set(this.sel) };
        this.refresh();
      }
    }
    _move(ev) {
      const [x, y] = this._toTpl(ev);
      if (!this.drag) { const h = this._hit(x, y); if (h !== this.hover) this.hover = h; this.overlay.style.cursor = this.one && this._handles(this.one).find(hh => { const [, , px, py] = this._toTpl(ev); return Math.hypot(hh.x - px, hh.y - py) < 8; }) ? 'crosshair' : h ? 'move' : 'default'; return; }
      const d = this.drag;
      if (d.mode === 'move') {
        let dx = x - d.x, dy = y - d.y;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const prim = d.orig.find(o => o.id === d.primary), pe = this.byId(d.primary);
        if (this.view.snap && pe && !ev.ctrlKey) { const sn = this._snap(pe, prim.x + dx, prim.y + dy); dx = sn.x - prim.x; dy = sn.y - prim.y; }
        else this.guides = [];
        for (const o of d.orig) { const e = this.byId(o.id); if (e) { e.x = Math.round(o.x + dx); e.y = Math.round(o.y + dy); } }
        this.r.setTemplate(this.tpl);
        this._liveProps();
      } else if (d.mode === 'resize') {
        const e = this.one, o = d.orig; if (!e) return;
        // work in the object's own (unrotated) axes
        const a = -(o.rotation || 0) * Math.PI / 180, ddx = x - d.x, ddy = y - d.y;
        const lx = ddx * Math.cos(a) - ddy * Math.sin(a), ly = ddx * Math.sin(a) + ddy * Math.cos(a);
        let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
        if (d.k.includes('e')) nw = o.w + lx; if (d.k.includes('w')) { nw = o.w - lx; nx = o.x + lx; }
        if (d.k.includes('s')) nh = o.h + ly; if (d.k.includes('n')) { nh = o.h - ly; ny = o.y + ly; }
        if (ev.shiftKey && o.w && o.h && d.k.length === 2) { const r = o.w / o.h; if (Math.abs(nw / o.w) > Math.abs(nh / o.h)) { const h2 = nw / r; if (d.k.includes('n')) ny += nh - h2; nh = h2; } else { const w2 = nh * r; if (d.k.includes('w')) nx += nw - w2; nw = w2; } }
        if (ev.altKey) { nx = o.x - (nw - o.w) / 2; ny = o.y - (nh - o.h) / 2; }
        if (e.type !== 'line') { nw = Math.max(4, nw); nh = Math.max(4, nh); }
        Object.assign(e, { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) });
        if (TEXTY.includes(e.type) && ev.ctrlKey) e.size = Math.max(6, Math.round((o.size || 40) * nh / o.h));
        this.r.setTemplate(this.tpl);
        this._liveProps();
      } else if (d.mode === 'rot') {
        const e = this.one; if (!e) return;
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        let ang = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;
        if (ev.shiftKey) ang = Math.round(ang / 15) * 15;
        e.rotation = Math.round(((ang % 360) + 540) % 360 - 180);
        this._liveProps();
      } else if (d.mode === 'marquee') {
        const m = this.marquee = { x: Math.min(d.x, x), y: Math.min(d.y, y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) };
        this.sel = new Set(d.base);
        for (const e of this.elements) if (!e.hidden && !e.locked && e.x < m.x + m.w && e.x + e.w > m.x && e.y < m.y + m.h && e.y + Math.max(e.h, 1) > m.y) this.sel.add(e.id);
      }
    }
    _up() {
      const d = this.drag; this.drag = null; this.guides = []; this.marquee = null;
      if (!d) return;
      if (d.mode === 'marquee') { this.refresh(); return; }
      this.commit();
    }
    /** Smart guides: snap the moving object's edges / centre to the canvas, safe areas and other objects. */
    _snap(e, x, y) {
      const W = this.tpl.width, H = this.tpl.height, th = 8 / this.scale;
      const vx = [0, W / 2, W, W * 0.05, W * 0.95, W * 0.1, W * 0.9], hy = [0, H / 2, H, H * 0.05, H * 0.95, H * 0.1, H * 0.9];
      for (const o of this.elements) { if (this.sel.has(o.id) || o.hidden) continue; vx.push(o.x, o.x + o.w / 2, o.x + o.w); hy.push(o.y, o.y + o.h / 2, o.y + o.h); }
      this.guides = [];
      const best = (vals, cand) => { let r = null; for (const [off, c] of cand) for (const v of vals) { const dd = Math.abs(v - c); if (dd < th && (!r || dd < r.d)) r = { d: dd, to: v - off }; } return r; };
      const bx = best(vx, [[0, x], [e.w / 2, x + e.w / 2], [e.w, x + e.w]]);
      const by = best(hy, [[0, y], [e.h / 2, y + e.h / 2], [e.h, y + e.h]]);
      if (bx) { x = bx.to; for (const v of vx) for (const c of [x, x + e.w / 2, x + e.w]) if (Math.abs(v - c) < 0.5) this.guides.push({ v }); }
      if (by) { y = by.to; for (const v of hy) for (const c of [y, y + e.h / 2, y + e.h]) if (Math.abs(v - c) < 0.5) this.guides.push({ h: v }); }
      return { x, y };
    }

    /* ================= panels ================= */
    refresh() { this.refreshLayers(); this.refreshProps(); this.refreshTimeline(); this._status(); }
    _status() {
      const one = this.one;
      this.status.textContent = `${this.tpl.width}×${this.tpl.height} · ${this.elements.length} objects` + (one ? ` · ${one.name} (${one.type}) ${Math.round(one.x)}, ${Math.round(one.y)} — ${Math.round(one.w)}×${Math.round(one.h)}${one.rotation ? ' · ' + one.rotation + '°' : ''}` : this.sel.size > 1 ? ` · ${this.sel.size} selected` : '') + ' · Drag to move · handles resize (Shift = keep ratio, Alt = from centre) · ⟲ rotate (Shift = 15°) · Ctrl = no snapping';
    }
    refreshLayers() {
      const L = this.layers; L.innerHTML = '';
      [...this.elements].reverse().forEach((e) => {
        const row = U.el('div', { class: 'te-layer' + (this.sel.has(e.id) ? ' on' : '') + (e.hidden ? ' off' : ''), draggable: true }, [
          U.el('button', { class: 'te-ico', text: e.hidden ? '◌' : '👁', title: 'Show / hide', onclick: (ev) => { ev.stopPropagation(); e.hidden = !e.hidden; this.commit(); } }),
          U.el('button', { class: 'te-ico', text: e.locked ? '🔒' : '🔓', title: 'Lock', onclick: (ev) => { ev.stopPropagation(); e.locked = !e.locked; this.commit(); } }),
          U.el('span', { class: 'te-type', text: ICON[e.type] || '?' }),
          U.el('span', { class: 'te-lname', text: e.name || e.type })
        ]);
        row.onclick = (ev) => { if (ev.shiftKey || ev.ctrlKey) { this.sel.has(e.id) ? this.sel.delete(e.id) : this.sel.add(e.id); } else this.sel = new Set([e.id]); this.refresh(); };
        row.ondblclick = () => { const nm = row.querySelector('.te-lname'); nm.contentEditable = 'true'; nm.focus(); document.getSelection().selectAllChildren(nm); nm.onblur = () => { nm.contentEditable = 'false'; const v = nm.textContent.trim(); if (v && v !== e.name) { e.name = this.elements.some(o => o !== e && (o.name || '').toLowerCase() === v.toLowerCase()) ? this.uniqueName(v) : v; this.commit(); } }; nm.onkeydown = (k) => { if (k.key === 'Enter') { k.preventDefault(); nm.blur(); } }; };
        row.ondragstart = (ev) => { ev.dataTransfer.setData('text/plain', e.id); row.classList.add('dragging'); };
        row.ondragend = () => row.classList.remove('dragging');
        row.ondragover = (ev) => { ev.preventDefault(); row.classList.add('dropto'); };
        row.ondragleave = () => row.classList.remove('dropto');
        row.ondrop = (ev) => {
          ev.preventDefault(); row.classList.remove('dropto');
          const id = ev.dataTransfer.getData('text/plain'); if (!id || id === e.id) return;
          const els = this.elements, from = els.findIndex(o => o.id === id); const [m] = els.splice(from, 1);
          const to = els.findIndex(o => o.id === e.id); els.splice(to + 1, 0, m); // dropped above this row = in front of it
          this.commit();
        };
        L.append(row);
      });
      if (!this.elements.length) L.append(U.el('div', { class: 'te-hint', text: 'Empty — add objects from the toolbar.' }));
    }
    _liveProps() {
      // cheap update while dragging: only the transform numbers
      const e = this.one; if (!e || !this._tf) return;
      for (const [k, inp] of Object.entries(this._tf)) if (document.activeElement !== inp) inp.value = Math.round(e[k] || 0);
      this._status();
    }
    refreshProps() {
      const P = this.props; P.innerHTML = ''; this._tf = null;
      const F = (rows, obj, onChange) => BTS.Dialog.form(rows, obj, onChange || (() => this.commitSoon()));
      const sec = (title, body, open = true) => { const d = U.el('details', { class: 'te-sec', open }); d.append(U.el('summary', { text: title }), body); P.append(d); return d; };
      const sel = this.selected, e = this.one;
      if (!sel.length) {
        // title-level settings
        const sizes = [['1920x1080', 'HD 1920×1080'], ['3840x2160', '4K 3840×2160'], ['1280x720', '720p 1280×720'], ['1080x1920', 'Vertical 1080×1920'], ['1080x1080', 'Square 1080×1080']];
        const o = { size: `${this.tpl.width}x${this.tpl.height}`, inType: (this.tpl.animIn || {}).type || 'fade', inDur: (this.tpl.animIn || {}).duration ?? 500, outType: (this.tpl.animOut || {}).type || 'fade', outDur: (this.tpl.animOut || {}).duration ?? 400 };
        sec('Title', F([
          { label: 'Canvas', key: 'size', type: 'select', options: sizes, onChange: (v) => { const [w, h] = v.split('x').map(Number); const sx = w / this.tpl.width, sy = h / this.tpl.height; for (const el of this.elements) { el.x *= sx; el.w *= sx; el.y *= sy; el.h *= sy; if (el.size) el.size *= Math.min(sx, sy); } this.tpl.width = w; this.tpl.height = h; this.commit(); this.layoutStage(); } },
          { section: 'Default animation (objects without their own)' },
          { label: 'In', key: 'inType', type: 'select', options: ANIMS, onChange: (v) => { this.tpl.animIn = { ...(this.tpl.animIn || {}), type: v }; this.commitSoon(); } },
          { label: 'In duration (ms)', key: 'inDur', type: 'number', min: 0, max: 10000, step: 50, onChange: (v) => { this.tpl.animIn = { ...(this.tpl.animIn || {}), duration: v }; this.commitSoon(); } },
          { label: 'Out', key: 'outType', type: 'select', options: ANIMS, onChange: (v) => { this.tpl.animOut = { ...(this.tpl.animOut || {}), type: v }; this.commitSoon(); } },
          { label: 'Out duration (ms)', key: 'outDur', type: 'number', min: 0, max: 10000, step: 50, onChange: (v) => { this.tpl.animOut = { ...(this.tpl.animOut || {}), duration: v }; this.commitSoon(); } }
        ], o, () => {}));
        P.append(U.el('div', { class: 'te-hint', text: 'Select an object to edit it. Shift-click or drag a box to select several.' }));
        return;
      }
      if (!e) {
        sec(`${sel.length} objects`, U.el('div', { class: 'te-hint', text: 'Use the toolbar to align, distribute, order, duplicate or delete them. Animation settings below apply to all selected objects.' }));
        this._animSection(sec, sel);
        return;
      }
      // transform
      const tf = U.el('div', { class: 'te-grid4' });
      this._tf = {};
      for (const [k, lbl] of [['x', 'X'], ['y', 'Y'], ['w', 'W'], ['h', 'H'], ['rotation', '⟲°']]) {
        const inp = U.el('input', { type: 'number', value: Math.round(e[k] || 0), step: 1 });
        inp.oninput = () => { e[k] = +inp.value; this.commitSoon(); };
        this._tf[k] = inp;
        tf.append(U.el('label', {}, [U.el('span', { text: lbl }), inp]));
      }
      const op = { opacity: e.opacity ?? 1, blend: e.blend || 'normal', name: e.name };
      sec('Object', U.el('div', {}, [F([
        { label: 'Name / data field', key: 'name', onChange: (v) => { e.name = v.trim() || e.name; this.commit(); } },
      ], op, () => {}), tf, F([
        { label: 'Opacity', key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, format: (v) => Math.round(v * 100) + '%', onChange: (v) => { e.opacity = v; this.commitSoon(); } },
        { label: 'Blend', key: 'blend', type: 'select', options: BLENDS, onChange: (v) => { e.blend = v; this.commitSoon(); } }
      ], op, () => {})]));
      if (TEXTY.includes(e.type)) {
        const box = U.el('div');
        if (e.type === 'text' || e.type === 'ticker' || e.type === 'crawl') {
          const ta = U.el('textarea', { rows: e.type === 'crawl' ? 6 : 3, class: 'te-text' }); ta.value = e.text ?? '';
          ta.oninput = () => { e.text = ta.value; this.commitSoon(); };
          box.append(ta);
        }
        const fonts = fontList || FONTS;
        const fontSel = U.el('input', { list: 'te-fonts', value: e.font || 'Segoe UI', class: 'te-font' });
        fontSel.onchange = () => { e.font = fontSel.value; this.commitSoon(); };
        if (!document.getElementById('te-fonts')) document.body.append(U.el('datalist', { id: 'te-fonts' }, fonts.map(f => U.el('option', { value: f }))));
        box.append(F([
          { label: 'Font', custom: fontSel },
          { label: 'Size', key: 'size', type: 'number', min: 4, max: 2000 },
          { label: 'Weight', key: 'weight', type: 'select', number: true, options: [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']] },
          { label: 'Italic', key: 'italic', type: 'checkbox' },
          { label: 'UPPERCASE', key: 'uppercase', type: 'checkbox' },
          { label: 'Colour', key: 'color', type: 'color' },
          { label: 'Gradient to', key: 'color2', type: 'color', hint: 'Leave unset for a solid colour — click Clear below to remove.' },
          { label: 'Align', key: 'align', type: 'select', options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
          { label: 'Vertical', key: 'valign', type: 'select', options: [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']] },
          ...(e.type === 'text' ? [{ label: 'Wrap lines', key: 'wrap', type: 'checkbox' }, { label: 'Line height', key: 'lineHeight', type: 'number', min: 0.6, max: 3, step: 0.05 }] : []),
          { label: 'Letter spacing', key: 'letterSpacing', type: 'number', min: -20, max: 100, step: 0.5 },
          { label: 'Shrink to fit', key: 'autoFit', type: 'checkbox' },
          ...(e.type === 'text' ? [{ label: 'Typewriter on In', key: 'typewriter', type: 'checkbox' }] : [])
        ], e));
        if (e.type === 'clock') box.append(F([{ label: 'Format', key: 'format', placeholder: 'HH:mm:ss', hint: 'HH hh mm ss A dd MM yyyy' }], e));
        if (e.type === 'countdown') box.append(F([{ label: 'Seconds', key: 'seconds', type: 'number', min: 0, onChange: (v) => { this.r.setTimer(e, v); this.commitSoon(); } }, { label: 'Count up (stopwatch)', key: 'countUp', type: 'checkbox' }], e));
        if (e.type === 'ticker') box.append(F([{ label: 'Speed (px/s)', key: 'speed', type: 'number', min: 10, max: 2000 }, { label: 'Separator', key: 'separator' }, { label: 'Direction', key: 'direction', type: 'select', options: [['rtl', 'Right → left'], ['ltr', 'Left → right']] }], e));
        if (e.type === 'crawl') box.append(F([{ label: 'Speed (px/s)', key: 'speed', type: 'number', min: 5, max: 1000 }, { label: 'Loop', key: 'loop', type: 'checkbox' }], e));
        box.append(U.el('button', { class: 'btn small', text: 'Clear gradient', onclick: () => { delete e.color2; this.commit(); } }));
        sec('Text', box);
        sec('Background box', F([
          { label: 'Box colour', key: 'bg', type: 'color' },
          { label: 'Padding', key: 'pad', type: 'number', min: 0, max: 400 },
          { label: 'Corner radius', key: 'bgRadius', type: 'number', min: 0, max: 400 },
          { label: 'Full width', key: 'bgFull', type: 'checkbox' },
          { custom: U.el('button', { class: 'btn small', text: 'Remove box', onclick: () => { delete e.bg; this.commit(); } }) }
        ], e), !!e.bg);
      }
      if (e.type === 'rect' || e.type === 'ellipse') {
        sec('Fill', U.el('div', {}, [F([
          { label: 'Colour', key: 'fill', type: 'color' },
          { label: 'Gradient to', key: 'fill2', type: 'color' },
          { label: 'Gradient', key: 'gradType', type: 'select', options: [['linear', 'Linear'], ['radial', 'Radial']] },
          { label: 'Angle', key: 'gradAngle', type: 'range', min: 0, max: 360, step: 1, format: (v) => Math.round(v) + '°' },
          ...(e.type === 'rect' ? [{ label: 'Corner radius', key: 'radius', type: 'number', min: 0, max: 2000 }] : []),
          { label: 'No fill (outline only)', key: 'noFill', type: 'checkbox' }
        ], e), U.el('button', { class: 'btn small', text: 'Solid colour', onclick: () => { e.fill2 = ''; this.commit(); } })]));
      }
      if (e.type === 'image') {
        sec('Image', U.el('div', {}, [F([
          { label: 'File', key: 'src', type: 'file', filters: [{ name: 'Images', extensions: U.IMAGE_EXT }] },
          { label: 'Fit', key: 'fit', type: 'select', options: [['contain', 'Fit'], ['cover', 'Fill (crop)'], ['stretch', 'Stretch']] },
          { label: 'Corner radius', key: 'radius', type: 'number', min: 0, max: 2000 }
        ], e)]));
      }
      if (e.type === 'line') sec('Line', F([{ label: 'Colour', key: 'stroke', type: 'color' }, { label: 'Width', key: 'strokeWidth', type: 'number', min: 1, max: 200 }, { label: 'Ends', key: 'cap', type: 'select', options: [['round', 'Round'], ['butt', 'Flat'], ['square', 'Square']] }], e));
      if (e.type !== 'line' && e.type !== 'image') sec('Outline', F([{ label: 'Colour', key: 'stroke', type: 'color' }, { label: 'Width', key: 'strokeWidth', type: 'number', min: 0, max: 200 }], e), !!e.strokeWidth);
      sec('Shadow', U.el('div', {}, [F([
        { label: 'Colour', key: 'shadowColor', type: 'color' },
        { label: 'Blur', key: 'shadowBlur', type: 'number', min: 0, max: 200 },
        { label: 'Offset X', key: 'shadowX', type: 'number', min: -200, max: 200 },
        { label: 'Offset Y', key: 'shadowY', type: 'number', min: -200, max: 200 }
      ], e), U.el('button', { class: 'btn small', text: 'No shadow', onclick: () => { delete e.shadowColor; e.shadow = false; this.commit(); } })]), !!(e.shadowColor || e.shadow));
      this._animSection(sec, [e]);
    }
    _animSection(sec, list) {
      const e = list[0];
      const a = { inType: (e.animIn && e.animIn.type) || '', inDur: e.animIn && e.animIn.duration, inDelay: e.animIn ? e.animIn.delay : e.delay, inEase: (e.animIn && e.animIn.ease) || 'out', outType: (e.animOut && e.animOut.type) || '', outDur: e.animOut && e.animOut.duration, outDelay: e.animOut && e.animOut.delay, outEase: (e.animOut && e.animOut.ease) || 'in' };
      const put = (dir, k, v) => { for (const el of list) { const key = dir > 0 ? 'animIn' : 'animOut'; el[key] = { ...(el[key] || {}), [k]: v }; if (k === 'type' && v === '') delete el[key]; } this.commitSoon(); this.refreshTimeline(); };
      const opts = [['', 'Title default'], ...ANIMS];
      sec('Animation', BTS.Dialog.form([
        { section: 'In' },
        { label: 'Effect', key: 'inType', type: 'select', options: opts, onChange: (v) => put(1, 'type', v) },
        { label: 'Duration (ms)', key: 'inDur', type: 'number', min: 0, max: 20000, step: 50, onChange: (v) => put(1, 'duration', v) },
        { label: 'Delay (ms)', key: 'inDelay', type: 'number', min: 0, max: 60000, step: 50, onChange: (v) => put(1, 'delay', v) },
        { label: 'Easing', key: 'inEase', type: 'select', options: EASES, onChange: (v) => put(1, 'ease', v) },
        { section: 'Out' },
        { label: 'Effect', key: 'outType', type: 'select', options: opts, onChange: (v) => put(-1, 'type', v) },
        { label: 'Duration (ms)', key: 'outDur', type: 'number', min: 0, max: 20000, step: 50, onChange: (v) => put(-1, 'duration', v) },
        { label: 'Delay (ms)', key: 'outDelay', type: 'number', min: 0, max: 60000, step: 50, onChange: (v) => put(-1, 'delay', v) },
        { label: 'Easing', key: 'outEase', type: 'select', options: EASES, onChange: (v) => put(-1, 'ease', v) }
      ], a, () => {}));
    }

    /* ================= timeline ================= */
    play(dir) { this.tl.dir = dir; this.tl.playing = true; this.tl.start = performance.now(); this.refreshTimeline(); }
    refreshTimeline() {
      const T = this.timeline; T.innerHTML = '';
      const dir = this.tl.dir;
      const total = Math.max(1500, this.r.totalTime(dir) + 500);
      this._tlTotal = total;
      const head = U.el('div', { class: 'te-tl-head' }, [
        U.el('button', { class: 'te-btn' + (dir > 0 ? ' on' : ''), text: 'In', onclick: () => { this.tl.dir = 1; this.tl.t = null; this.refreshTimeline(); } }),
        U.el('button', { class: 'te-btn' + (dir < 0 ? ' on' : ''), text: 'Out', onclick: () => { this.tl.dir = -1; this.tl.t = null; this.refreshTimeline(); } }),
        U.el('button', { class: 'te-btn', text: '▶', title: 'Play', onclick: () => this.play(dir) }),
        U.el('button', { class: 'te-btn', text: '■', title: 'Stop / show final frame', onclick: () => { this.tl.playing = false; this.tl.t = null; } }),
        U.el('span', { class: 'te-hint', text: `Total ${(this.r.totalTime(dir) / 1000).toFixed(2)} s · drag a bar to change delay, its right edge to change duration · click the ruler to scrub` })
      ]);
      const ruler = this.ruler = U.el('div', { class: 'te-ruler' });
      for (let ms = 0; ms <= total; ms += total > 6000 ? 1000 : 250) ruler.append(U.el('span', { class: 'te-tick' + (ms % 1000 === 0 ? ' major' : ''), style: { left: (ms / total * 100) + '%' }, text: ms % 1000 === 0 ? (ms / 1000) + 's' : '' }));
      const scrub = (ev) => { const r = ruler.getBoundingClientRect(); this.tl.playing = false; this.tl.t = U.clamp((ev.clientX - r.left) / r.width, 0, 1) * total; };
      ruler.onpointerdown = (ev) => { scrub(ev); const mv = (e2) => scrub(e2); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); };
      const rows = U.el('div', { class: 'te-tl-rows' });
      [...this.elements].reverse().forEach((e) => {
        const a = this.r._anim(e, dir);
        const bar = U.el('div', { class: 'te-bar-anim' + (a.type === 'none' ? ' none' : ''), style: { left: (a.delay / total * 100) + '%', width: (Math.max(a.type === 'none' ? 0 : a.duration, 30) / total * 100) + '%' }, title: `${a.type} · delay ${a.delay} ms · ${a.duration} ms` }, [U.el('span', { text: a.type }), U.el('i', { class: 'te-bar-end' })]);
        bar.onpointerdown = (ev) => {
          ev.stopPropagation();
          const r = rows.getBoundingClientRect(), x0 = ev.clientX, edge = ev.target.classList.contains('te-bar-end');
          const key = dir > 0 ? 'animIn' : 'animOut', start = { delay: a.delay, duration: a.duration };
          const mv = (e2) => {
            const dms = Math.round((e2.clientX - x0) / r.width * total / 10) * 10;
            e[key] = { ...(e[key] || {}), type: e[key] && e[key].type ? e[key].type : a.type, ease: e[key] && e[key].ease ? e[key].ease : a.ease };
            if (edge) e[key].duration = Math.max(0, start.duration + dms); else e[key].delay = Math.max(0, start.delay + dms);
            if (!edge && e[key].duration == null) e[key].duration = start.duration;
            this.r.setTemplate(this.tpl);
            bar.style.left = ((e[key].delay ?? start.delay) / total * 100) + '%'; bar.style.width = (Math.max(e[key].duration ?? start.duration, 30) / total * 100) + '%';
          };
          const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); this.commit(); };
          addEventListener('pointermove', mv); addEventListener('pointerup', up);
          if (!this.sel.has(e.id)) { this.sel = new Set([e.id]); this.refreshLayers(); this.refreshProps(); }
        };
        rows.append(U.el('div', { class: 'te-tl-row' + (this.sel.has(e.id) ? ' on' : '') }, [U.el('span', { class: 'te-tl-name', text: e.name || e.type, onclick: () => { this.sel = new Set([e.id]); this.refresh(); } }), U.el('div', { class: 'te-tl-track' }, [bar])]));
      });
      this.playhead = U.el('div', { class: 'te-playhead' });
      const body = U.el('div', { class: 'te-tl-body' }, [U.el('div', { class: 'te-tl-rulerrow' }, [U.el('span', { class: 'te-tl-name' }), ruler]), rows, this.playhead]);
      T.append(head, body);
      this._tlDirty = true;
    }
    drawPlayhead() {
      if (!this.playhead || !this.ruler) return;
      const r = this.ruler.getBoundingClientRect(), b = this.playhead.parentElement.getBoundingClientRect();
      if (this.tl.t == null) { this.playhead.style.display = 'none'; this._tlDirty = false; return; }
      this.playhead.style.display = 'block';
      this.playhead.style.left = (r.left - b.left + U.clamp(this.tl.t / this._tlTotal, 0, 1) * r.width) + 'px';
    }
  }

  function open(inp) {
    if (TitleEditor.current) TitleEditor.current.close();
    TitleEditor.current = new TitleEditor(inp);
    return TitleEditor.current;
  }

  BTS.TitleEditor = { open, TitleEditor, ANIMS, EASES };
  BTS.TitleDesigner = { open }; // the old entry point now opens the new editor
})(window.BTS);
