'use strict';
/** Workspace controller: module registry, app bar, themes, live status chips, stats module. */
(function (BTS) {
  const U = BTS.U;

  const THEMES = [['graphite', 'Graphite', '#13161b'], ['midnight', 'Midnight', '#0f1526'], ['carbon', 'Carbon', '#0a0a0b'], ['slate', 'Slate', '#2a2f38'], ['light', 'Light', '#f3f5f8']];
  const ACCENTS = ['#f5a524', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#eab308', '#f97316', '#e7e9ee'];

  function applyTheme() {
    const t = localStorage.getItem('bts.theme') || 'graphite';
    const a = localStorage.getItem('bts.accent') || ACCENTS[0];
    document.documentElement.dataset.theme = t;
    document.documentElement.style.setProperty('--accent', a);
    document.documentElement.style.setProperty('--accent2', `color-mix(in srgb, ${a} 70%, white)`);
    const lum = (() => { const [r, g, b] = U.hexToRgb(a); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; })();
    document.documentElement.style.setProperty('--accent-ink', lum > 0.55 ? '#141005' : '#ffffff');
  }
  applyTheme();

  class WorkspaceUI {
    constructor(studio) {
      this.studio = studio;
      const m = (title, icon, sel, extra = {}) => ({ title, icon, el: U.$(sel), ...extra });
      this.modules = {
        preview: m('Preview', '●', '#previewPanel'),
        transitions: m('Transitions', '⇄', '#transPanel'),
        output: m('Output', '●', '#programPanel'),
        inputs: m('Inputs', '▦', '#inputsArea'),
        mixer: m('Audio Mixer', '≋', '#mixer'),
        multiview: m('Multiview', '⊞', '#multiview', { onShow: () => { studio.multiviewVisible = true; BTS.ui && BTS.ui.updateButtons(); }, onHide: () => { studio.multiviewVisible = false; BTS.ui && BTS.ui.updateButtons(); } }),
        replay: m('Instant Replay', '⟲', '#replayModule', { onShow: () => BTS.replayUI && BTS.replayUI.setVisible(true), onHide: () => BTS.replayUI && BTS.replayUI.setVisible(false) }),
        playlist: m('Playlist', '☰', '#playlistModule'),
        scripts: m('Scripts', 'ϟ', '#scriptsModule'),
        stats: m('Statistics', '▤', '#statsModule', { onShow: () => { this.statsOn = true; this.renderStats(); }, onHide: () => { this.statsOn = false; } })
      };
      BTS.replayUI = new BTS.ReplayUI(studio, U.$('#replayModule'));
      this.layout = BTS.layout = new BTS.Layout(U.$('#workspace'), U.$('#moduleStash'), this.modules);
      this.layout.on('change', () => this.syncBar());
      this.layout.on('resize', () => BTS.ui && BTS.ui._fitSafe && BTS.ui._fitSafe());
      this._bar();
      this._statsModule();
      setInterval(() => this._chips(), 500);
      this.syncBar();
    }

    _bar() {
      const L = this.layout;
      const sel = U.$('#layoutSelect');
      sel.onchange = () => { if (sel.value === '__save') { sel.value = L.preset; this.saveLayout(); return; } if (sel.value === '__manage') { sel.value = L.preset; this.manageLayouts(); return; } L.applyPreset(sel.value); };
      U.$('#btnModules').onclick = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        BTS.Dialog.ctxMenu(r.left, r.bottom + 4, [
          ...Object.entries(this.modules).map(([id, mod]) => ({ label: `${L.isDocked(id) ? '✓' : '   '}  ${mod.icon}  ${mod.title}`, onClick: () => L.toggle(id) })),
          '-',
          { label: 'Reset to Classic layout', onClick: () => L.applyPreset('classic') }
        ]);
      };
      U.$('#btnSaveLayout').onclick = () => this.saveLayout();
      U.$('#btnLockLayout').onclick = () => L.setLocked(!L.locked);
      U.$('#btnTheme').onclick = () => this.themeDialog();
      U.$('#btnAppSettings').onclick = () => BTS.SettingsUI.open();
    }

    syncBar() {
      const L = this.layout, sel = U.$('#layoutSelect');
      const custom = L.customLayouts();
      sel.innerHTML = '';
      const og1 = U.el('optgroup', { label: 'Built-in workspaces' });
      for (const [k, p] of Object.entries(BTS.Layout.PRESETS)) og1.append(U.el('option', { value: k, text: p.name }));
      sel.append(og1);
      if (Object.keys(custom).length) { const og2 = U.el('optgroup', { label: 'My workspaces' }); for (const k of Object.keys(custom)) og2.append(U.el('option', { value: k, text: k })); sel.append(og2); }
      if (L.preset === 'custom') sel.append(U.el('option', { value: 'custom', text: 'Custom (unsaved)' }));
      sel.append(U.el('option', { value: '__save', text: '💾  Save current workspace as…' }));
      if (Object.keys(custom).length) sel.append(U.el('option', { value: '__manage', text: '🗑  Delete a saved workspace…' }));
      sel.value = L.preset;
      const lock = U.$('#btnLockLayout');
      lock.textContent = L.locked ? '🔒' : '🔓';
      lock.classList.toggle('on', L.locked);
      lock.title = L.locked ? 'Layout locked — click to unlock' : 'Lock layout (prevent accidental moves)';
      U.$('#btnMultiview')?.classList.toggle('on', this.layout.isVisible('multiview'));
    }

    async saveLayout() {
      const name = await BTS.Dialog.prompt('Save workspace', this.layout.preset in BTS.Layout.PRESETS || this.layout.preset === 'custom' ? 'My workspace' : this.layout.preset, { label: 'Name this layout. It appears in the Workspace list.' });
      if (!name) return;
      this.layout.saveCustom(name.trim());
      U.toast(`Workspace "${name}" saved`, 'ok');
    }
    manageLayouts() {
      const c = Object.keys(this.layout.customLayouts());
      const box = U.el('div', { class: 'list' });
      const dlg = BTS.Dialog.open({ title: 'Saved workspaces', body: box, width: 420 });
      for (const n of c) box.append(U.el('div', { class: 'li' }, [U.el('span', { class: 'grow', text: n }), U.el('button', { class: 'btn danger', text: 'Delete', onclick: () => { this.layout.deleteCustom(n); dlg.close(); this.syncBar(); } })]));
    }

    themeDialog() {
      const cur = localStorage.getItem('bts.theme') || 'graphite';
      const acc = localStorage.getItem('bts.accent') || ACCENTS[0];
      const cards = U.el('div', { class: 'theme-cards' });
      for (const [k, name, col] of THEMES) {
        const c = U.el('div', { class: 'theme-card' + (k === cur ? ' on' : '') }, [U.el('i', { style: { background: `linear-gradient(135deg, ${col} 60%, var(--accent))` } }), name]);
        c.onclick = () => { localStorage.setItem('bts.theme', k); applyTheme(); cards.querySelectorAll('.theme-card').forEach(x => x.classList.remove('on')); c.classList.add('on'); };
        cards.append(c);
      }
      const sw = U.el('div', { class: 'swatches' });
      for (const a of ACCENTS) {
        const s = U.el('div', { class: 'swatch' + (a === acc ? ' on' : ''), style: { background: a }, title: a });
        s.onclick = () => { localStorage.setItem('bts.accent', a); applyTheme(); sw.querySelectorAll('.swatch').forEach(x => x.classList.remove('on')); s.classList.add('on'); };
        sw.append(s);
      }
      const custom = U.el('input', { type: 'color', value: acc, title: 'Custom accent' });
      custom.oninput = () => { localStorage.setItem('bts.accent', custom.value); applyTheme(); };
      sw.append(custom);
      const density = U.el('select');
      for (const [v, l] of [['comfortable', 'Comfortable'], ['compact', 'Compact']]) density.append(U.el('option', { value: v, text: l, selected: (localStorage.getItem('bts.density') || 'comfortable') === v }));
      density.onchange = () => { localStorage.setItem('bts.density', density.value); document.body.classList.toggle('compact', density.value === 'compact'); };
      BTS.Dialog.open({
        title: 'Appearance', width: 560,
        body: U.el('div', {}, [U.el('h4', { class: 'sec', text: 'THEME' }), cards, U.el('h4', { class: 'sec', text: 'ACCENT COLOUR' }), sw, U.el('h4', { class: 'sec', text: 'DENSITY' }), density,
          U.el('p', { class: 'hint', style: { marginTop: '12px' }, text: 'Tally colours (red = Output, green = Preview, orange = Overlay) never change, so operators always read the switcher the same way.' })]),
        buttons: [{ label: 'Done', primary: true }]
      });
    }

    _chips() {
      const out = this.studio.outputs;
      const s = U.$('#chipStream'), r = U.$('#chipRec');
      s.classList.toggle('on', out.isStreaming()); r.classList.toggle('on', out.isRecording());
      if (out.isStreaming()) U.$('#chipStreamTime').textContent = U.fmtTime(out.elapsed('stream'));
      if (out.isRecording()) U.$('#chipRecTime').textContent = U.fmtTime(out.elapsed('record'));
      if (this.statsOn) this.renderStats();
    }

    _statsModule() {
      this.statsEl = U.el('div', { class: 'stat-grid' });
      this.outsEl = U.el('div', { class: 'list', style: { margin: '0 10px 10px' } });
      U.$('#statsModule').append(this.statsEl, this.outsEl);
    }
    renderStats() {
      const st = this.studio, s = st.stats;
      const card = (k, v, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
      this.statsEl.innerHTML = [
        card('Format', `${st.H}p${Math.round(st.fps)}`),
        card('Render FPS', s.fps.toFixed(1), s.fps < st.fps * 0.9 ? 'bad' : 'good'),
        card('Render time', s.renderMs.toFixed(1) + ' ms', s.renderMs > 1000 / st.fps * 0.8 ? 'bad' : ''),
        card('Dropped', s.dropped, s.dropped ? 'bad' : ''),
        card('Load level', ['Normal', 'Light', 'Medium', 'Heavy'][s.perfLevel || 0], s.perfLevel >= 2 ? 'bad' : 'good'),
        card('Inputs', st.inputs.length), card('Live sources', st.liveSet.size),
        card('GPU effects', st.gl.ok ? 'On' : 'Off', st.gl.ok ? 'good' : 'bad')
      ].join('');
      const outs = st.outputs.summary();
      this.outsEl.innerHTML = outs.length ? outs.map(o => `<div class="li"><b style="min-width:90px">${U.esc(o.id)}</b><span class="grow">${U.esc(o.state)}</span><span>${o.kbps ? Math.round(o.kbps) + ' kbps' : ''}</span><span style="min-width:70px;text-align:right">${U.esc(o.time || '')}</span></div>`).join('') : '<div class="li hint">No active outputs</div>';
    }
  }

  WorkspaceUI.applyTheme = applyTheme;
  BTS.WorkspaceUI = WorkspaceUI;
})(window.BTS);
