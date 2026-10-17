'use strict';
/** Multiview module toolbar, click-to-preview and the Multiview settings dialog. */
(function (BTS) {
  const U = BTS.U;

  class MultiviewUI {
    constructor(studio) {
      this.studio = studio;
      this.mgr = studio.multiviews;
      const root = U.$('#multiview');
      this.canvas = U.$('#multiviewCanvas');
      this.wrap = U.el('div', { class: 'mv-stage' });
      root.innerHTML = '';
      this.sel = U.el('select', { title: 'Multiview shown in this module', onchange: () => this.show(+this.sel.value) });
      this.layoutSel = U.el('select', { title: 'Layout', onchange: () => { this.cur.cfg.layout = this.layoutSel.value; this.cur.cfg.assign = {}; this.mgr.save(); } });
      for (const [k, v] of Object.entries(BTS.Multiview.LAYOUTS)) this.layoutSel.append(U.el('option', { value: k, text: v.name }));
      const bar = U.el('div', { class: 'mod-toolbar mv-bar' }, [
        this.sel, this.layoutSel, U.el('div', { class: 'spacer' }),
        U.el('button', { class: 'tbtn small', text: '⚙', title: 'Multiview settings', onclick: () => this.settings() }),
        U.el('button', { class: 'tbtn small', text: '⧉', title: 'Show on an external monitor', onclick: () => BTS.SettingsUI.external() })
      ]);
      root.append(bar, this.wrap);
      this.show(1);
      this.canvas.addEventListener('click', (e) => this._click(e, false));
      this.canvas.addEventListener('dblclick', (e) => this._click(e, true));
      this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this._assignMenu(e); });
    }
    get cur() { return this.mgr.get(this.mgr.moduleIndex); }
    refreshSel() {
      this.sel.innerHTML = '';
      for (const m of this.mgr.list) this.sel.append(U.el('option', { value: m.n, text: m.cfg.name + (m.users ? ' ●' : ''), selected: m.n === this.mgr.moduleIndex }));
      this.layoutSel.value = this.cur.cfg.layout;
    }
    show(n) {
      // module shows multiview n: give it the DOM canvas (others render into their own off-screen canvases)
      const prev = this.mgr.get(this.mgr.moduleIndex), next = this.mgr.get(n);
      if (prev !== next) {
        const dom = this.canvas;
        const prevCanvas = document.createElement('canvas');
        prevCanvas.width = dom.width; prevCanvas.height = dom.height;
        prev.canvas = prevCanvas; prev.ctx = null; prev._resize();
        next.canvas = dom; next.ctx = null; next._resize();
      }
      this.mgr.moduleIndex = n;
      this.wrap.innerHTML = ''; this.wrap.append(this.canvas);
      this.refreshSel();
    }
    _pos(e) { const r = this.canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
    _click(e, dbl) {
      const st = this.studio, c = this.cur.hit(...this._pos(e));
      if (!c) return;
      if (c.src === 'program' || c.src === 'preview') { if (dbl || c.src === 'preview') st.quickPlay(); return; }
      if (c.inp) { if (dbl) st.cut(c.inp.id); else st.setPreview(c.inp.id); }
    }
    _assignMenu(e) {
      const mv = this.cur, c = mv.hit(...this._pos(e)); if (!c) return;
      const set = (v) => { mv.cfg.assign = mv.cfg.assign || {}; if (v == null) delete mv.cfg.assign[c.i]; else mv.cfg.assign[c.i] = v; this.mgr.save(); };
      BTS.Dialog.ctxMenu(e.clientX, e.clientY, [
        { label: 'Automatic (next input)', onClick: () => set(null) },
        { label: 'Output', onClick: () => set('program') }, { label: 'Preview', onClick: () => set('preview') }, { label: 'Clock', onClick: () => set('clock') }, { label: 'Empty', onClick: () => set('none') },
        '-',
        ...this.studio.inputs.slice(0, 40).map(i => ({ label: `${i.number}. ${i.title}`, onClick: () => set('input:' + i.id) }))
      ]);
    }
    settings() {
      const box = U.el('div');
      const draw = () => {
        box.innerHTML = '';
        for (const m of this.mgr.list) {
          box.append(BTS.Dialog.form([
            { section: `${m.n}. ${m.cfg.name}${m.users ? ' — on an external monitor' : ''}` },
            { label: 'Name', key: 'name' },
            { label: 'Layout', key: 'layout', type: 'select', options: Object.entries(BTS.Multiview.LAYOUTS).map(([k, v]) => [k, v.name]), onChange: () => { m.cfg.assign = {}; } },
            { label: 'Resolution', key: 'res', type: 'select', options: [['1280x720', '720p (lightest)'], ['1920x1080', '1080p'], ['2560x1440', '1440p'], ['3840x2160', '4K (for 4K monitors)']] },
            { label: 'First input shown', key: 'offset', type: 'number', min: 0, max: 200, hint: 'Skip this many inputs — e.g. a second multiview showing inputs 9–16.' },
            { label: 'Labels', key: 'labels', type: 'checkbox' },
            { label: 'Tally borders', key: 'tally', type: 'checkbox' },
            { label: 'Audio meters', key: 'meters', type: 'checkbox' },
            { label: 'Safe areas on Output / Preview', key: 'safe', type: 'checkbox' },
            { label: 'Status bar (LIVE / REC / clock)', key: 'status', type: 'checkbox' },
            { label: 'Hide audio-only inputs', key: 'skipAudioOnly', type: 'checkbox' }
          ], m.cfg), U.el('div', { class: 'rp-row' }, [U.el('button', { class: 'btn', text: 'Reset cell assignments', onclick: () => { m.cfg.assign = {}; U.toast('Cells reset'); } })]));
        }
        box.append(U.el('p', { class: 'hint', text: 'Right-click any cell in the Multiview module to assign it to a specific input, Output, Preview or a clock. Click a cell to send it to Preview, double-click to cut it to Output.' }));
      };
      draw();
      BTS.Dialog.open({ title: 'Multiview settings', body: box, width: 640, buttons: [{ label: 'Done', primary: true, onClick: () => { this.mgr.save(); this.refreshSel(); return true; } }] });
    }
  }

  BTS.MultiviewUI = MultiviewUI;
})(window.BTS);
