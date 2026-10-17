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
        scopes: m('Scopes', '◫', '#scopesModule', { onShow: () => BTS.scopesUI && BTS.scopesUI.setVisible(true), onHide: () => BTS.scopesUI && BTS.scopesUI.setVisible(false) }),
        ptz: m('PTZ Control', '✥', '#ptzModule'),
        stats: m('Statistics', '▤', '#statsModule', { onShow: () => { this.statsOn = true; this.renderStats(); }, onHide: () => { this.statsOn = false; } })
      };
      BTS.replayUI = new BTS.ReplayUI(studio, U.$('#replayModule'));
      BTS.scopesUI = new BTS.ScopesUI(studio, U.$('#scopesModule'));
      BTS.ptzUI = new BTS.PtzUI(studio, U.$('#ptzModule'));
      BTS.multiviewUI = new BTS.MultiviewUI(studio);
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
      this.graph = U.el('canvas', { class: 'stat-graph', width: 600, height: 90 });
      this.encEl = U.el('div', { class: 'list', style: { margin: '0 10px 8px' } });
      this.outsEl = U.el('div', { class: 'list', style: { margin: '0 10px 8px' } });
      this.procEl = U.el('div', { class: 'list', style: { margin: '0 10px 10px' } });
      const h = (t) => U.el('div', { class: 'stat-h', text: t });
      U.$('#statsModule').append(this.statsEl, h('FRAME RATE (last 2 min)'), this.graph, h('ENCODERS'), this.encEl, h('OUTPUTS'), this.outsEl, h('PROCESSES'), this.procEl);
      if (BTS.health) BTS.health.on('sample', () => { if (this.statsOn) this.renderStats(); });
    }
    renderStats() {
      const st = this.studio, s = st.stats, H = BTS.health && BTS.health.last;
      const card = (k, v, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
      const gpuEnc = H && H.gpuStatus ? H.gpuStatus.video_encode : '';
      this.statsEl.innerHTML = [
        card('Format', `${st.W}×${st.H} ${Math.round(st.fps)}p`),
        card('Render FPS', s.fps.toFixed(1), s.fps < st.fps * 0.9 ? 'bad' : 'good'),
        card('Frame time', s.renderMs.toFixed(1) + ' ms', s.renderMs > 1000 / st.fps * 0.8 ? 'bad' : ''),
        card('Dropped', s.dropped, s.dropped ? 'bad' : ''),
        card('Load level', ['Normal', 'Light', 'Medium', 'Heavy'][s.perfLevel || 0], s.perfLevel >= 2 ? 'bad' : 'good'),
        card('CPU', H ? H.cpu.toFixed(0) + ' %' : '—', H && H.cpu > 85 ? 'bad' : ''),
        card('App memory', H ? (H.memMB / 1024).toFixed(2) + ' GB' : '—'),
        card('Free RAM', H && H.totalMB ? (H.freeMB / 1024).toFixed(1) + ' GB' : '—', H && H.freeMB / H.totalMB < 0.1 ? 'bad' : ''),
        card('GPU memory', H ? Math.round(H.gpuMB) + ' MB' : '—'),
        card('GPU encode', gpuEnc ? (/enabled/.test(gpuEnc) ? 'Available' : gpuEnc) : '—', /enabled/.test(gpuEnc || '') ? 'good' : ''),
        card('GPU effects', st.gl.ok ? 'On' : 'Off', st.gl.ok ? 'good' : 'bad'),
        card('Inputs', `${st.inputs.length} (${st.liveSet.size} live)`)
      ].join('');
      // fps graph
      const g = this.graph.getContext('2d'), W = this.graph.width, Hh = this.graph.height;
      g.clearRect(0, 0, W, Hh);
      const smp = BTS.health ? BTS.health.samples.slice(-60) : [];
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(0, Hh * 0.1); g.lineTo(W, Hh * 0.1); g.stroke();
      if (smp.length > 1) {
        g.lineWidth = 2; g.strokeStyle = '#22c55e'; g.beginPath();
        smp.forEach((x, i) => { const px = i / 59 * W, py = Hh - (Math.min(x.fps, x.target) / x.target) * Hh * 0.9; i ? g.lineTo(px, py) : g.moveTo(px, py); });
        g.stroke();
        g.strokeStyle = '#f5a524'; g.beginPath();
        smp.forEach((x, i) => { const px = i / 59 * W, py = Hh - Math.min(1, x.renderMs / (1000 / x.target)) * Hh * 0.9; i ? g.lineTo(px, py) : g.moveTo(px, py); });
        g.stroke();
      }
      const enc = st.outputs.encoder ? st.outputs.encoder.stats() : [];
      this.encEl.innerHTML = enc.length ? enc.map(e => `<div class="li"><b style="min-width:110px">${e.w}×${e.h} ${e.fps}p</b><span class="grow">${e.hardware ? 'GPU' : 'CPU'} H.264 · ${U.esc(e.mode || '')} · ${e.users} output${e.users > 1 ? 's' : ''}</span><span>${e.mbps.toFixed(1)} Mb/s</span><span style="min-width:90px;text-align:right" class="${e.dropped ? 'bad' : ''}">${e.dropped} dropped</span></div>`).join('') : '<div class="li hint">No encoders running</div>';
      const outs = H ? H.outs : [];
      this.outsEl.innerHTML = outs.length ? outs.map(o => `<div class="li"><b style="min-width:90px">${U.esc(o.id)}</b><span class="grow">${U.esc(o.state)}${o.speed ? ' · ' + o.speed + '×' : ''}</span><span>${o.kbps ? Math.round(o.kbps) + ' kbps' : ''}</span><span style="min-width:80px;text-align:right">${o.buffered > 1e6 ? (o.buffered / 1e6).toFixed(1) + ' MB queued' : U.esc(o.time || '')}</span></div>`).join('') : '<div class="li hint">No active outputs</div>';
      const procs = H && BTS.health.lastProcs ? BTS.health.lastProcs : [];
      this.procEl.innerHTML = procs.length ? procs.map(p => `<div class="li"><b style="min-width:90px">${U.esc(p.type)}</b><span class="grow">${U.esc(p.name || '')}</span><span>${p.cpu.toFixed(1)} % CPU</span><span style="min-width:80px;text-align:right">${p.memMB} MB</span></div>`).join('') : '<div class="li hint">—</div>';
    }
  }

  WorkspaceUI.applyTheme = applyTheme;
  BTS.WorkspaceUI = WorkspaceUI;
})(window.BTS);
