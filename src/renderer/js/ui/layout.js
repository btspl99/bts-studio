'use strict';
/**
 * Dockable workspace.
 * The workspace is a tree of splits (rows / columns with resizable gutters) whose leaves are tab groups.
 * Every module (Preview, Output, Transitions, Inputs, Mixer, Replay, …) is a persistent DOM element that is
 * re-parented into the leaf that shows it, so canvases, videos and state survive any layout change.
 * Drag a tab onto the edge of another group to split it, onto its centre to add a tab, or onto the
 * outer edge of the workspace to dock across the whole window.
 */
(function (BTS) {
  const U = BTS.U;
  const KEY = 'bts.layout.v2';
  const CUSTOM_KEY = 'bts.layouts.custom';

  const S = (dir, kids, sizes) => ({ t: 'split', dir, kids, sizes: sizes || kids.map(() => 1 / kids.length) });
  const T = (...panels) => ({ t: 'tabs', panels, active: panels[0] });

  const PRESETS = {
    classic: { name: 'Classic Switcher', tree: () => S('col', [S('row', [T('preview'), T('transitions'), T('output')], [0.44, 0.12, 0.44]), S('row', [T('inputs', 'playlist', 'scripts'), T('mixer')], [0.76, 0.24])], [0.57, 0.43]) },
    replay: { name: 'Sports & Replay', tree: () => S('col', [S('row', [T('preview'), T('transitions'), T('output')], [0.42, 0.11, 0.47]), S('row', [T('replay'), T('inputs', 'playlist'), T('mixer')], [0.52, 0.32, 0.16])], [0.5, 0.5]) },
    multiview: { name: 'Multiview Director', tree: () => S('row', [S('col', [T('multiview'), T('inputs', 'scripts')], [0.64, 0.36]), S('col', [T('transitions'), T('mixer', 'stats')], [0.42, 0.58])], [0.76, 0.24]) },
    audio: { name: 'Audio Focus', tree: () => S('col', [S('row', [T('preview'), T('transitions'), T('output')], [0.44, 0.12, 0.44]), S('row', [T('mixer'), T('inputs')], [0.62, 0.38])], [0.45, 0.55]) },
    compact: { name: 'Laptop / Compact', tree: () => S('col', [S('row', [T('preview'), T('transitions'), T('output')], [0.44, 0.12, 0.44]), T('inputs', 'mixer', 'replay', 'playlist', 'scripts', 'stats')], [0.55, 0.45]) },
    studio: { name: 'Broadcast Studio', tree: () => S('row', [S('col', [S('row', [T('preview'), T('transitions'), T('output')], [0.44, 0.12, 0.44]), T('inputs', 'playlist', 'scripts')], [0.6, 0.4]), S('col', [T('multiview'), T('mixer', 'replay', 'stats')], [0.4, 0.6])], [0.72, 0.28]) }
  };

  class Layout extends BTS.Emitter {
    constructor(root, stash, modules) {
      super();
      this.root = root;
      this.stash = stash;
      this.modules = modules; // id -> {title, icon, el, minW, minH, onShow, onHide}
      this.locked = localStorage.getItem('bts.layout.locked') === '1';
      this.preset = 'classic';
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
      if (saved && saved.tree && this._valid(saved.tree)) { this.tree = saved.tree; this.preset = saved.preset || 'custom'; }
      else this.tree = PRESETS.classic.tree();
      this.render();
      window.addEventListener('resize', U.debounce(() => this.emit('resize'), 100));
    }

    static get PRESETS() { return PRESETS; }

    /* ---------------- tree helpers ---------------- */
    _valid(n) { if (!n) return false; if (n.t === 'tabs') return Array.isArray(n.panels); if (n.t === 'split') return Array.isArray(n.kids) && n.kids.length && n.kids.every(k => this._valid(k)); return false; }
    _walk(fn, n = this.tree, parent = null, idx = -1) { if (fn(n, parent, idx) === false) return false; if (n.t === 'split') for (let i = 0; i < n.kids.length; i++) if (this._walk(fn, n.kids[i], n, i) === false) return false; return true; }
    _leafOf(id) { let r = null; this._walk((n, p, i) => { if (n.t === 'tabs' && n.panels.includes(id)) { r = { leaf: n, parent: p, index: i }; return false; } }); return r; }
    _find(node) { let r = null; this._walk((n, p, i) => { if (n === node) { r = { parent: p, index: i }; return false; } }); return r; }
    _leaves() { const out = []; this._walk(n => { if (n.t === 'tabs') out.push(n); }); return out; }
    visibleIds() { const s = new Set(); this._walk(n => { if (n.t === 'tabs') n.panels.forEach(p => s.add(p)); }); return s; }
    isVisible(id) { const l = this._leafOf(id); return !!l && l.leaf.active === id; }
    isDocked(id) { return !!this._leafOf(id); }

    _normalize(n = this.tree) {
      if (n.t === 'split') {
        n.kids = n.kids.map(k => this._normalize(k)).filter(Boolean);
        // drop empty, merge same-direction children
        const kids = [], sizes = [];
        const total = n.sizes.reduce((a, b) => a + b, 0) || 1;
        n.kids.forEach((k, i) => {
          const sz = (n.sizes[i] ?? 1 / n.kids.length) / total;
          if (k.t === 'split' && k.dir === n.dir) { const kt = k.sizes.reduce((a, b) => a + b, 0) || 1; k.kids.forEach((kk, j) => { kids.push(kk); sizes.push(sz * k.sizes[j] / kt); }); }
          else { kids.push(k); sizes.push(sz); }
        });
        n.kids = kids; n.sizes = sizes;
        if (!n.kids.length) return null;
        if (n.kids.length === 1) return n.kids[0];
        const s = n.sizes.reduce((a, b) => a + b, 0); n.sizes = n.sizes.map(x => x / s);
        return n;
      }
      if (n.t === 'tabs') {
        n.panels = n.panels.filter((p, i, a) => this.modules[p] && a.indexOf(p) === i);
        if (!n.panels.length) return null;
        if (!n.panels.includes(n.active)) n.active = n.panels[0];
        return n;
      }
      return null;
    }

    _removePanel(id) {
      const f = this._leafOf(id); if (!f) return;
      f.leaf.panels = f.leaf.panels.filter(p => p !== id);
      if (f.leaf.active === id) f.leaf.active = f.leaf.panels[0];
    }

    /* ---------------- public operations ---------------- */
    show(id, { focus = true } = {}) {
      if (!this.modules[id]) return;
      let f = this._leafOf(id);
      if (!f) {
        // add as a tab next to a sensible neighbour, else the largest leaf
        const pref = { replay: ['inputs', 'mixer'], playlist: ['inputs'], scripts: ['inputs'], stats: ['mixer'], multiview: ['output', 'preview'], mixer: ['inputs'] }[id] || ['inputs'];
        let target = null;
        for (const p of pref) { const l = this._leafOf(p); if (l) { target = l.leaf; break; } }
        if (!target) target = this._leaves()[0];
        if (!target) { this.tree = T(id); }
        else target.panels.push(id);
        f = this._leafOf(id);
      }
      if (focus && f) f.leaf.active = id;
      this.preset = 'custom';
      this.commit();
    }
    hide(id) {
      if (!this._leafOf(id)) return;
      if (this._leaves().length === 1 && this._leaves()[0].panels.length === 1) { U.toast('The workspace needs at least one module', 'error'); return; }
      this._removePanel(id);
      this.tree = this._normalize(this.tree) || T('preview');
      this.preset = 'custom';
      this.commit();
    }
    toggle(id) { if (this.isDocked(id)) this.hide(id); else this.show(id); }
    activate(id) { const f = this._leafOf(id); if (f) { f.leaf.active = id; this.commit(); } else this.show(id); }

    applyPreset(key) {
      const p = PRESETS[key];
      if (p) { this.tree = p.tree(); this.preset = key; }
      else {
        const c = this.customLayouts()[key];
        if (!c) return;
        this.tree = U.deepClone(c); this.preset = key;
      }
      this.tree = this._normalize(this.tree);
      this.commit();
    }
    customLayouts() { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'); } catch { return {}; } }
    saveCustom(name) {
      const all = this.customLayouts();
      all[name] = U.deepClone(this.tree);
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(all));
      this.preset = name;
      this.commit();
    }
    deleteCustom(name) { const all = this.customLayouts(); delete all[name]; localStorage.setItem(CUSTOM_KEY, JSON.stringify(all)); this.emit('change'); }
    setLocked(v) { this.locked = !!v; localStorage.setItem('bts.layout.locked', v ? '1' : '0'); this.root.classList.toggle('locked', this.locked); this.emit('change'); }

    commit() {
      this.tree = this._normalize(this.tree) || T('preview');
      try { localStorage.setItem(KEY, JSON.stringify({ tree: this.tree, preset: this.preset })); } catch { /* noop */ }
      this.render();
    }

    /** Move a panel: zone = 'center' | 'left' | 'right' | 'top' | 'bottom'; target = leaf node or 'root' */
    move(id, target, zone) {
      const src = this._leafOf(id);
      if (src && target === src.leaf && (zone === 'center' || src.leaf.panels.length === 1)) return;
      this._removePanel(id);
      const leaf = T(id);
      if (target === 'root') {
        const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
        const first = zone === 'left' || zone === 'top';
        const old = this.tree;
        this.tree = S(dir, first ? [leaf, old] : [old, leaf], first ? [0.25, 0.75] : [0.75, 0.25]);
      } else if (zone === 'center') {
        target.panels.push(id); target.active = id;
      } else {
        const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
        const first = zone === 'left' || zone === 'top';
        const loc = this._find(target);
        if (loc && loc.parent && loc.parent.dir === dir) {
          const p = loc.parent, i = loc.index, half = p.sizes[i] / 2;
          p.sizes[i] = half;
          p.kids.splice(first ? i : i + 1, 0, leaf);
          p.sizes.splice(first ? i : i + 1, 0, half);
        } else {
          const split = S(dir, first ? [leaf, target] : [target, leaf], first ? [0.4, 0.6] : [0.6, 0.4]);
          if (!loc || !loc.parent) this.tree = split;
          else loc.parent.kids[loc.index] = split;
        }
      }
      this.preset = 'custom';
      this.commit();
    }

    /* ---------------- rendering ---------------- */
    render() {
      // park every module, then mount the ones the tree shows
      for (const m of Object.values(this.modules)) this.stash.append(m.el);
      this.root.innerHTML = '';
      this.root.classList.toggle('locked', this.locked);
      this.root.append(this._renderNode(this.tree));
      const vis = this.visibleIds();
      for (const [id, m] of Object.entries(this.modules)) {
        const shown = this.isVisible(id);
        if (shown !== m._shown) { m._shown = shown; try { (shown ? m.onShow : m.onHide)?.(); } catch (e) { console.error(e); } }
        m.docked = vis.has(id);
      }
      this.emit('change');
      requestAnimationFrame(() => this.emit('resize'));
    }

    _renderNode(n) {
      if (n.t === 'split') {
        const el = U.el('div', { class: 'dk-split dk-' + n.dir });
        n.kids.forEach((k, i) => {
          const w = U.el('div', { class: 'dk-cell' });
          w.style.flex = `${n.sizes[i]} 1 0px`;
          w.append(this._renderNode(k));
          el.append(w);
          if (i < n.kids.length - 1) {
            const g = U.el('div', { class: 'dk-gutter dk-gutter-' + n.dir, title: 'Drag to resize' });
            g.addEventListener('pointerdown', (e) => this._gutterDrag(e, n, i, el));
            g.addEventListener('dblclick', () => { const s = (n.sizes[i] + n.sizes[i + 1]) / 2; n.sizes[i] = s; n.sizes[i + 1] = s; this.commit(); });
            el.append(g);
          }
        });
        return el;
      }
      const leaf = n;
      const el = U.el('div', { class: 'dk-leaf' });
      el._leaf = leaf;
      const head = U.el('div', { class: 'dk-tabs' });
      for (const id of leaf.panels) {
        const m = this.modules[id];
        const tab = U.el('div', { class: 'dk-tab' + (id === leaf.active ? ' on' : ''), 'data-id': id, title: m.title + (this.locked ? '' : ' — drag to move') }, [
          U.el('span', { class: 'dk-ico', text: m.icon || '▪' }), U.el('span', { class: 'dk-title', text: m.title }),
          U.el('button', { class: 'dk-x', title: 'Close module', text: '×', onclick: (e) => { e.stopPropagation(); this.hide(id); } })
        ]);
        tab.addEventListener('pointerdown', (e) => this._tabDown(e, id, tab));
        tab.addEventListener('contextmenu', (e) => { e.preventDefault(); this._tabMenu(e, id); });
        head.append(tab);
      }
      head.append(U.el('div', { class: 'dk-tabs-fill' }));
      const body = U.el('div', { class: 'dk-body' });
      const active = this.modules[leaf.active];
      if (active) body.append(active.el);
      el.append(head, body);
      return el;
    }

    _tabMenu(e, id) {
      const items = [
        { label: 'Close', onClick: () => this.hide(id) },
        '-',
        { label: 'Dock left of workspace', onClick: () => this.move(id, 'root', 'left') },
        { label: 'Dock right of workspace', onClick: () => this.move(id, 'root', 'right') },
        { label: 'Dock across the bottom', onClick: () => this.move(id, 'root', 'bottom') },
        { label: 'Dock across the top', onClick: () => this.move(id, 'root', 'top') }
      ];
      BTS.Dialog.ctxMenu(e.clientX, e.clientY, items);
    }

    _gutterDrag(e, node, i, container) {
      if (this.locked) return;
      e.preventDefault();
      const g = e.currentTarget; g.setPointerCapture(e.pointerId); g.classList.add('drag');
      const rect = container.getBoundingClientRect();
      const total = node.dir === 'row' ? rect.width : rect.height;
      const start = node.dir === 'row' ? e.clientX : e.clientY;
      const a0 = node.sizes[i], b0 = node.sizes[i + 1];
      const cells = [...container.children].filter(c => c.classList.contains('dk-cell'));
      const minF = 60 / total;
      const move = (ev) => {
        const d = ((node.dir === 'row' ? ev.clientX : ev.clientY) - start) / total;
        let a = a0 + d, b = b0 - d;
        if (a < minF) { b -= minF - a; a = minF; }
        if (b < minF) { a -= minF - b; b = minF; }
        node.sizes[i] = a; node.sizes[i + 1] = b;
        cells[i].style.flex = `${a} 1 0px`; cells[i + 1].style.flex = `${b} 1 0px`;
        this.emit('resize');
      };
      const up = () => { g.releasePointerCapture(e.pointerId); g.classList.remove('drag'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); this.preset = this.preset in PRESETS ? 'custom' : this.preset; this.commit(); };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
    }

    _tabDown(e, id, tab) {
      if (e.button !== 0 || e.target.closest('.dk-x')) return;
      const f = this._leafOf(id);
      if (f && f.leaf.active !== id) { f.leaf.active = id; this.commit(); return; }
      if (this.locked) return;
      const sx = e.clientX, sy = e.clientY;
      let dragging = false, ghost = null, ind = null, drop = null;
      const move = (ev) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          dragging = true;
          ghost = U.el('div', { class: 'dk-ghost', text: this.modules[id].title });
          ind = U.el('div', { class: 'dk-drop' });
          document.body.append(ghost, ind);
          document.body.classList.add('dk-dragging');
        }
        ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 12 + 'px';
        drop = this._dropTarget(ev.clientX, ev.clientY);
        if (drop) { const r = drop.rect; Object.assign(ind.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); }
        else ind.style.display = 'none';
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (!dragging) return;
        ghost.remove(); ind.remove(); document.body.classList.remove('dk-dragging');
        if (drop) this.move(id, drop.target, drop.zone);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }

    _dropTarget(x, y) {
      const R = this.root.getBoundingClientRect();
      const edge = 18;
      if (x >= R.left && x <= R.right && y >= R.top && y <= R.bottom) {
        if (x - R.left < edge) return { target: 'root', zone: 'left', rect: { x: R.left, y: R.top, w: R.width * 0.25, h: R.height } };
        if (R.right - x < edge) return { target: 'root', zone: 'right', rect: { x: R.right - R.width * 0.25, y: R.top, w: R.width * 0.25, h: R.height } };
        if (R.bottom - y < edge) return { target: 'root', zone: 'bottom', rect: { x: R.left, y: R.bottom - R.height * 0.3, w: R.width, h: R.height * 0.3 } };
      }
      const el = document.elementFromPoint(x, y);
      const leafEl = el && el.closest('.dk-leaf');
      if (!leafEl || !this.root.contains(leafEl)) return null;
      const r = leafEl.getBoundingClientRect();
      const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
      const onTabs = el.closest('.dk-tabs');
      let zone = 'center';
      if (!onTabs) {
        const m = Math.min(fx, 1 - fx, fy, 1 - fy);
        if (m < 0.28) zone = m === fx ? 'left' : m === 1 - fx ? 'right' : m === fy ? 'top' : 'bottom';
      }
      const rect = zone === 'center' ? { x: r.left, y: r.top, w: r.width, h: r.height }
        : zone === 'left' ? { x: r.left, y: r.top, w: r.width / 2, h: r.height }
          : zone === 'right' ? { x: r.left + r.width / 2, y: r.top, w: r.width / 2, h: r.height }
            : zone === 'top' ? { x: r.left, y: r.top, w: r.width, h: r.height / 2 }
              : { x: r.left, y: r.top + r.height / 2, w: r.width, h: r.height / 2 };
      return { target: leafEl._leaf, zone, rect };
    }
  }

  BTS.Layout = Layout;
})(window.BTS);
