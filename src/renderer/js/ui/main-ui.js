'use strict';
/** Main window wiring: transition panel, T-bar, monitors, status bar, shortcuts, menus, DnD, projects, pop-outs. */
(function (BTS) {
  const U = BTS.U;

  class MainUI {
    constructor(studio) {
      this.studio = studio;
      this.currentFile = null;
      this.shortcuts = [];
      this.externals = []; // up to 6 external / fullscreen outputs: {win, display, source, label}
      this.multiviewWin = null;
      this._transPanel();
      this._tbar();
      this._monitors();
      this._statusbar();
      this._dnd();
      this._keys();
      this.loadShortcuts();
      this.updateFormatInfo();
      studio.on('bus', () => this.updateMonitors());
      studio.on('overlays', () => this.updateOverlays());
      studio.on('ftb', (on) => { U.$('#btnFTB').classList.toggle('on', on); U.$('#ftbBadge').classList.toggle('on', on); });
      studio.on('transitions-config', () => this._renderTransButtons());
      studio.on('transition', () => this._flashTrans());
      studio.on('stats', (s) => this._stats(s));
      studio.on('format', () => this.updateFormatInfo());
      studio.outputs.on('change', () => this.updateButtons());
      setInterval(() => this._tick(), 500);
      this.updateMonitors(); this.updateOverlays(); this.updateButtons();
    }

    /* ---------- transitions ---------- */
    _transPanel() {
      U.$('#btnQuickPlay').onclick = () => this.studio.quickPlay();
      U.$('#btnCut').onclick = () => this.studio.cut();
      U.$('#btnFTB').onclick = () => this.studio.fadeToBlack();
      U.$('#btnQuickPlay').oncontextmenu = (e) => { e.preventDefault(); this._effectMenu(e, this.studio.transitions.quickPlay, 'Quick Play'); };
      this._renderTransButtons();
    }
    _renderTransButtons() {
      const box = U.$('#transButtons');
      box.innerHTML = '';
      this.studio.transitions.buttons.forEach((b, i) => {
        const name = BTS.Transitions.list.find(t => t.id === b.type)?.name || b.type;
        const btn = U.el('button', { text: name, title: `Transition ${i + 1}: ${name} — right-click to change effect` });
        btn.onclick = () => this.studio.transitionButton(i + 1);
        btn.oncontextmenu = (e) => { e.preventDefault(); this._effectMenu(e, b, `Transition ${i + 1}`); };
        const dur = U.el('input', { type: 'number', value: b.duration, min: 0, step: 100, title: 'Duration (ms)' });
        dur.onchange = () => { b.duration = Math.max(0, +dur.value || 0); };
        dur.onkeydown = (e) => e.stopPropagation();
        box.append(U.el('div', { class: 'tr-btn', 'data-i': i }, [btn, dur]));
      });
      const q = this.studio.transitions.quickPlay;
      U.$('#btnQuickPlay').title = `Quick Play: ${q.type} ${q.duration} ms — right-click to change`;
    }
    _effectMenu(e, target, label) {
      const items = BTS.Transitions.list.map(t => ({ label: (t.id === target.type ? '● ' : '   ') + t.name, onClick: () => { target.type = t.id; if (BTS.Transitions.isStinger(t.id)) this.studio.preloadStingers(); this._renderTransButtons(); } }));
      items.push('-', { label: 'Transition settings…', onClick: () => BTS.SettingsUI.open('transitions') });
      BTS.Dialog.ctxMenu(e.clientX, e.clientY, items);
    }
    _flashTrans() {
      const a = this.studio.active;
      U.$$('.tr-btn').forEach(el => el.classList.remove('running'));
      if (!a) return;
      const i = this.studio.transitions.buttons.findIndex(b => b.type === a.type);
      if (i >= 0) { const el = U.$(`.tr-btn[data-i="${i}"]`); el.classList.add('running'); setTimeout(() => el.classList.remove('running'), Math.min(a.duration, 3000)); }
    }

    _tbar() {
      const track = U.$('#tbarTrack'), handle = U.$('#tbarHandle'), fill = U.$('#tbarFill');
      const st = this.studio;
      const draw = () => {
        const v = st.tbar.value;
        handle.style.bottom = (v * 100) + '%';
        const p = st.active && st.active.manual ? st.active.progress : 0;
        fill.style.height = `calc(${(p) * 100}% - 6px)`;
        fill.style.bottom = st.tbar.reversed ? 'auto' : '3px';
        fill.style.top = st.tbar.reversed ? '3px' : 'auto';
      };
      if (BTS.settings.ui.tbarReverse) { st.tbar.reversed = true; st.tbar.value = 1; }
      st.on('tbar', draw);
      const posToValue = (ev) => { const r = track.getBoundingClientRect(); return U.clamp(1 - (ev.clientY - r.top) / r.height, 0, 1); };
      track.addEventListener('pointerdown', (ev) => {
        st.tbar.dragging = true; track.setPointerCapture(ev.pointerId);
        st.setTbar(posToValue(ev));
        const move = (e) => st.setTbar(posToValue(e));
        const up = (e) => { st.tbar.dragging = false; track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); st.setTbar(posToValue(e), { release: true }); if (!st.active) st._resetTbar(); draw(); };
        track.addEventListener('pointermove', move);
        track.addEventListener('pointerup', up);
      });
      track.addEventListener('wheel', (e) => { e.preventDefault(); st.setTbar(st.tbar.value - Math.sign(e.deltaY) * 0.04); }, { passive: false });
      draw();
    }

    /* ---------- monitors ---------- */
    _monitors() {
      const st = this.studio;
      const ovl = U.$('#overlayStatus');
      for (let n = 1; n <= 8; n++) {
        const b = U.el('div', { class: 'ovl-ind', text: String(n), title: `Overlay ${n} — click: toggle Preview input • right-click: options` });
        b.onclick = () => { const o = st.overlays[n - 1]; if (o.inputId && o.state !== 'off') st.overlay(n, null, 'out'); else st.overlay(n, st.previewId, 'in'); };
        b.oncontextmenu = (e) => {
          e.preventDefault();
          const o = st.overlays[n - 1];
          BTS.Dialog.ctxMenu(e.clientX, e.clientY, [
            { label: 'Overlay Preview input', onClick: () => st.overlay(n, st.previewId, 'in') },
            { label: 'Transition out', onClick: () => st.overlay(n, null, 'out') },
            { label: 'Off (cut)', onClick: () => st.overlay(n, null, 'off') },
            '-',
            ...['Fade', 'Cut', 'Zoom', 'Slide', 'SlideRight', 'SlideUp', 'Wipe'].map(t => ({ label: (o.type === t ? '● ' : '   ') + t, onClick: () => { o.type = t; } }))
          ]);
        };
        ovl.append(b);
      }
      U.$('#pvTransport').addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
        const pv = st.preview;
        if (act === 'pv-settings' && pv) return BTS.ui.inputSettings(pv);
        if (!pv) return;
        if (act === 'pv-play') pv.togglePlay();
        if (act === 'pv-restart') pv.restart();
        if (act === 'pv-loop') { BTS.Functions.call('Loop', { Input: pv.id }); }
        if (act === 'pv-next') pv.next();
        if (act === 'pv-prev') pv.prev();
        this._transport();
      });
      const seek = U.$('#pvSeek');
      seek.addEventListener('input', () => { const pv = st.preview; if (pv && pv.duration) { this._seeking = true; pv.seek(+seek.value / 1000 * pv.duration); } });
      seek.addEventListener('change', () => { this._seeking = false; });
      U.$('#pgFoot').addEventListener('click', async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'snapshot') { const f = await window.bts.snapshot(st.snapshot()); U.toast('Snapshot saved: ' + f, 'ok'); }
        if (act === 'fullscreen') this.toggleExternal();
        if (act === 'safe') { U.$('#pgSafe').classList.toggle('on'); U.$('#pvSafe').classList.toggle('on'); this._fitSafe(); e.target.classList.toggle('on'); }
      });
      U.$('#previewCanvas').addEventListener('dblclick', () => st.quickPlay());
      U.$('#programCanvas').addEventListener('dblclick', () => this.toggleExternal());
      U.$('#multiviewCanvas').addEventListener('click', (e) => this._multiviewClick(e));
      new ResizeObserver(() => this._fitSafe()).observe(U.$('#programPanel'));
      setInterval(() => this._transport(), 200);
    }
    _fitSafe() {
      for (const [canvas, safe] of [['#programCanvas', '#pgSafe'], ['#previewCanvas', '#pvSafe']]) {
        const c = U.$(canvas), s = U.$(safe), p = c.parentElement.getBoundingClientRect(), r = c.getBoundingClientRect();
        Object.assign(s.style, { left: (r.left - p.left) + 'px', top: (r.top - p.top) + 'px', width: r.width + 'px', height: r.height + 'px' });
      }
    }
    _multiviewClick(e) {
      const st = this.studio, c = e.currentTarget, r = c.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * 1920, y = (e.clientY - r.top) / r.height * 1080;
      const bigH = (960 - 6) * 9 / 16;
      if (y < bigH + 8) { if (x < 960) st.quickPlay(); return; }
      const cols = 4, ch = Math.min((1080 - bigH - 16 - 6) / 2, ((1920 - 8 - 18) / 4) * 9 / 16), cw = ch * 16 / 9, offX = (1920 - (cw * cols + 18)) / 2;
      const col = Math.floor((x - offX) / (cw + 6)), row = Math.floor((y - bigH - 12) / (ch + 6));
      const inp = st.inputs[row * cols + col];
      if (inp && col >= 0 && col < cols) st.setPreview(inp.id);
    }
    updateMonitors() {
      const st = this.studio;
      U.$('#pvName').textContent = st.preview ? `${st.preview.number}. ${st.preview.title}` : '—';
      U.$('#pgName').textContent = st.program ? `${st.program.number}. ${st.program.title}` : '—';
      this._transport();
    }
    updateFormatInfo() {
      const st = this.studio;
      const lbl = `${st.W}×${st.H} ${st.fps}p`;
      U.$('#pgInfo').textContent = lbl; U.$('#pvInfo').textContent = lbl;
      U.$('#stRes').textContent = `${st.H > st.W ? st.W : st.H}p${Math.round(st.fps)}`;
    }
    _transport() {
      const pv = this.studio.preview;
      const media = pv && pv.isMedia;
      U.$$('#pvTransport .tbtn, #pvSeek').forEach(b => { if (b.dataset.act !== 'pv-settings') b.disabled = !media; });
      U.$('#pvTransport').style.opacity = pv ? 1 : 0.6;
      if (!media) { U.$('#pvTime').textContent = '--:--:-- / --:--:--'; U.$('#pvSeek').value = 0; return; }
      U.$('#pvPlayBtn').textContent = pv.playing ? '❚❚' : '▶';
      U.$('#pvLoopBtn').classList.toggle('on', !!pv.props.loop);
      U.$('#pvTime').textContent = `${U.fmtTime(pv.currentTime)} / ${U.fmtTime(pv.duration)}`;
      if (!this._seeking && pv.duration) U.$('#pvSeek').value = Math.round(pv.currentTime / pv.duration * 1000);
    }
    updateOverlays() {
      const st = this.studio;
      U.$$('.ovl-ind').forEach((b, i) => {
        const o = st.overlays[i];
        const on = o.inputId && o.state !== 'off';
        b.classList.toggle('on', !!on);
        b.title = on ? `Overlay ${i + 1}: ${st.byId(o.inputId)?.title}` : `Overlay ${i + 1} (off)`;
      });
    }

    /* ---------- status bar ---------- */
    _statusbar() {
      const st = this.studio, out = st.outputs;
      U.$('#btnAddInput').onclick = () => BTS.AddInput.open();
      U.$('#btnRecord').onclick = () => out.toggleRecording();
      U.$('#btnStream').onclick = async () => {
        if (out.isStreaming()) { if (await BTS.Dialog.confirm('Stop streaming to all destinations?', { ok: 'Stop streaming', danger: true })) out.stopStreaming(); }
        else out.startStreaming();
      };
      U.$('#btnRecordCfg').onclick = () => BTS.SettingsUI.open('record');
      U.$('#btnStreamCfg').onclick = () => BTS.SettingsUI.open('stream');
      U.$('#btnExternal').onclick = () => this.toggleExternal();
      U.$('#btnMultiCorder').onclick = () => out.toggleMultiCorder();
      U.$('#btnMultiview').onclick = () => this.toggleMultiview();
      U.$('#btnTelestrator').onclick = () => BTS.TelestratorUI.open();
      U.$('#btnSettings').onclick = (e) => BTS.Dialog.ctxMenu(e.clientX, e.clientY - 220, [
        { label: 'Settings…', onClick: () => BTS.SettingsUI.open() },
        { label: 'Data Sources…', onClick: () => BTS.SettingsUI.dataSources() },
        { label: 'Title Designer…', onClick: () => BTS.TitleDesigner.open() },
        { label: 'Telestrator…', onClick: () => BTS.TelestratorUI.open() },
        { label: 'Statistics', onClick: () => BTS.SettingsUI.stats() },
        { label: 'Toggle Audio Mixer', key: 'F9', onClick: () => this.toggleMixer() },
        '-',
        { label: 'Check for updates', onClick: () => window.bts.update.check() },
        { label: 'About', onClick: () => BTS.SettingsUI.about() }
      ]);
      out.on('need-stream-settings', () => BTS.SettingsUI.open('stream'));
    }
    updateButtons() {
      const out = this.studio.outputs;
      const states = out.summary();
      const streamStates = states.filter(s => s.id.startsWith('stream'));
      const sb = U.$('#btnStream');
      sb.classList.toggle('on', out.isStreaming() && streamStates.every(s => s.state === 'live'));
      sb.classList.toggle('warn', out.isStreaming() && streamStates.some(s => s.state !== 'live'));
      U.$('#btnRecord').classList.toggle('on', out.isRecording());
      U.$('#btnMultiCorder').classList.toggle('on', out.isMultiCorder());
      U.$('#btnExternal').classList.toggle('on', this.externals.some(x => x && x.win && !x.win.closed));
      U.$('#btnMultiview').classList.toggle('on', !!(BTS.layout && BTS.layout.isVisible('multiview')));
      const parts = states.filter(s => s.kbps).map(s => `${s.id.replace('stream-', 'S').replace('record', 'REC').replace(/^iso-.*/, 'ISO')} ${Math.round(s.kbps)}k`);
      U.$('#stOut').textContent = parts.slice(0, 4).join(' • ');
    }
    _stats(s) {
      U.$('#stFps').textContent = s.fps.toFixed(0);
      U.$('#stFps').classList.toggle('bad', s.fps < this.studio.fps * 0.9);
      U.$('#stRender').textContent = s.renderMs.toFixed(1);
      U.$('#stRender').classList.toggle('bad', s.renderMs > 1000 / this.studio.fps * 0.8);
      U.$('#stDrop').textContent = s.dropped;
      this.updateButtons();
    }
    _tick() {
      const d = new Date();
      U.$('#clock').textContent = d.toLocaleTimeString('en-GB');
      const out = this.studio.outputs;
      U.$('#recTime').textContent = out.isRecording() ? U.fmtTime(out.elapsed('record')) : '';
      U.$('#streamTime').textContent = out.isStreaming() ? U.fmtTime(out.elapsed('stream')) : '';
    }

    /* ---------- layout ---------- */
    toggleMixer() { BTS.layout.toggle('mixer'); }
    toggleMultiview() {
      const L = BTS.layout;
      if (L.isVisible('multiview')) L.hide('multiview'); else L.activate('multiview');
      this.updateButtons();
    }

    /* ---------- pop-out windows ---------- */
    _streamFor(source) {
      const st = this.studio;
      if (source === 'multiview') { st.multiviewPopout = (st.multiviewPopout || 0) + 1; return st.multiviewCanvas.captureStream(st.fps); }
      if (source === 'preview') return st.previewCanvas.captureStream(st.fps);
      if (source && source.startsWith('input:')) {
        // a dedicated canvas for one input, redrawn every frame
        const id = source.slice(6);
        const c = document.createElement('canvas'); c.width = st.W; c.height = st.H;
        const g = c.getContext('2d');
        const off = st.on('frame', () => { const i = st.byId(id); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); if (i) { if (i.type === 'title' && !i.live) i.drawStatic(g, 0, 0, c.width, c.height); else i.draw(g, 0, 0, c.width, c.height); } });
        const ms = c.captureStream(st.fps); ms._off = off;
        return ms;
      }
      return st.programCanvas.captureStream(st.fps);
    }
    /** slot 0..5; displayId = monitor id or null for a window */
    openExternal(displayId, source = 'program', slot = null) {
      if (slot == null) { slot = this.externals.findIndex(x => !x || !x.win || x.win.closed); if (slot < 0) slot = this.externals.length; }
      if (slot > 5) { U.toast('Maximum 6 external outputs', 'error'); return; }
      this.closeExternal(slot);
      const w = window.open(`external.html?display=${displayId || ''}&source=${encodeURIComponent(source)}`, 'external' + (slot + 1));
      if (!w) return U.toast('Could not open external window', 'error');
      const ms = this._streamFor(source);
      const rec = this.externals[slot] = { win: w, display: displayId, source, stream: ms };
      const attach = () => {
        if (w.closed) return;
        const v = w.document.querySelector('video');
        if (!v) return setTimeout(attach, 50);
        if (v.srcObject !== ms) { v.srcObject = ms; v.play().catch(() => {}); }
        w.document.title = `BTS Studio — External ${slot + 1} (${this._sourceLabel(source)})`;
        this.updateButtons();
      };
      w.addEventListener('load', attach);
      setTimeout(attach, 300);
      rec.iv = setInterval(() => { if (w.closed) this._cleanupExternal(slot); }, 500);
    }
    _cleanupExternal(slot) {
      const x = this.externals[slot]; if (!x) return;
      clearInterval(x.iv);
      if (x.stream) { if (x.stream._off) x.stream._off(); x.stream.getTracks().forEach(t => t.stop()); }
      if (x.source === 'multiview') this.studio.multiviewPopout = Math.max(0, (this.studio.multiviewPopout || 1) - 1);
      this.externals[slot] = null;
      this.updateButtons();
      BTS.SettingsUI && BTS.SettingsUI.refreshExternals && BTS.SettingsUI.refreshExternals();
    }
    closeExternal(slot) { const x = this.externals[slot]; if (x && x.win && !x.win.closed) x.win.close(); this._cleanupExternal(slot); }
    _sourceLabel(src) { if (src === 'program') return 'Output'; if (src === 'preview') return 'Preview'; if (src === 'multiview') return 'Multiview'; if (src && src.startsWith('input:')) return this.studio.byId(src.slice(6))?.title || 'Input'; return src; }
    toggleExternal() { BTS.SettingsUI.external(); }
    popoutMultiview() { this.openExternal(null, 'multiview'); }

    /* ---------- drag & drop files ---------- */
    _dnd() {
      const area = U.$('#inputsArea .inputs-scroll');
      const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
      area.addEventListener('dragover', (e) => { if (isFiles(e)) { e.preventDefault(); area.classList.add('drag'); } });
      area.addEventListener('dragleave', () => area.classList.remove('drag'));
      area.addEventListener('drop', async (e) => {
        if (!isFiles(e)) return;
        e.preventDefault(); area.classList.remove('drag');
        for (const f of e.dataTransfer.files) {
          const p = window.bts.file.pathOf(f);
          const kind = U.kindOfFile(p);
          if (kind === 'project') { this.openProject(p); return; }
          if (!kind) { U.toast('Unsupported file: ' + f.name, 'error'); continue; }
          const data = kind === 'browser' ? { type: 'browser', title: f.name, cfg: { url: p, width: this.studio.W, height: this.studio.H, fps: 30 } } : { type: kind, title: f.name.replace(/\.[^.]+$/, ''), cfg: { path: p } };
          const inp = await this.studio.addInput(data);
          this.studio.setPreview(inp.id);
        }
      });
      // prevent navigation on stray drops
      document.addEventListener('dragover', (e) => e.preventDefault());
      document.addEventListener('drop', (e) => e.preventDefault());
    }

    /* ---------- keyboard ---------- */
    loadShortcuts() { this.shortcuts = BTS.settings.shortcuts || BTS.SettingsUI.DEFAULT_SHORTCUTS; }
    _keys() {
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const t = e.target;
        if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
        if (U.$('#modalRoot').children.length) { if (e.key === 'Escape' && BTS.Dialog.top) BTS.Dialog.top.close(); return; }
        if (e.key === 'F8') { e.preventDefault(); return this.toggleMultiview(); }
        if (e.key === 'F9') { e.preventDefault(); return this.toggleMixer(); }
        const k = BTS.SettingsUI.keyName(e);
        const sc = this.shortcuts.find(s => s.key === k);
        if (sc) { e.preventDefault(); BTS.Functions.call(sc.fn, sc.params || {}).then(r => { if (!r.ok) U.toast(`${sc.fn}: ${r.error}`, 'error', 2500); }); }
      });
    }

    /* ---------- projects ---------- */
    async newProject() {
      if (this.studio.inputs.length && !(await BTS.Dialog.confirm('Start a new preset? Unsaved changes will be lost.', { ok: 'New preset' }))) return;
      await this.studio.clear(); this.currentFile = null; this._title();
    }
    async openProject(file) {
      if (!file) { const f = await window.bts.dialog.open({ filters: [{ name: 'BTS Studio Preset', extensions: ['btsproj'] }] }); if (!f) return; file = f[0]; }
      try {
        const { data } = await window.bts.project.read(file);
        if (data.app !== 'BTS Studio') throw new Error('Not a BTS Studio preset');
        await this.studio.load(data);
        this.currentFile = file; this._title(); this.updateFormatInfo();
        U.toast('Opened ' + U.baseName(file), 'ok');
      } catch (e) { U.toast('Could not open preset: ' + e.message, 'error'); }
    }
    async saveProject(file, saveAs = false) {
      if (!file && (saveAs || !this.currentFile)) {
        file = await window.bts.dialog.save({ defaultPath: this.currentFile || 'Production.btsproj', filters: [{ name: 'BTS Studio Preset', extensions: ['btsproj'] }] });
        if (!file) return;
      }
      file = file || this.currentFile;
      await window.bts.project.write(file, this.studio.serialize());
      this.currentFile = file; this._title();
      U.toast('Saved ' + U.baseName(file), 'ok');
    }
    async saveAutosave() { try { await window.bts.project.autosave(this.studio.serialize()); } catch (e) { console.warn('autosave', e); } }
    _title() { document.title = `BTS Studio${this.currentFile ? ' — ' + U.baseName(this.currentFile) : ''}`; }

    inputSettings(inp, tab) { return BTS.InputSettings.open(inp, tab); }
    titleDesigner(inp) { return BTS.TitleDesigner.open(inp); }

    handleMenu(m) {
      const id = typeof m === 'string' ? m : m.id;
      switch (id) {
        case 'new': return this.newProject();
        case 'open': return this.openProject();
        case 'open-file': return this.openProject(m.file);
        case 'save': return this.saveProject();
        case 'save-as': return this.saveProject(null, true);
        case 'settings': return BTS.SettingsUI.open();
        case 'add-input': return BTS.AddInput.open(m.type);
        case 'stream-settings': return BTS.SettingsUI.open('stream');
        case 'record-settings': return BTS.SettingsUI.open('record');
        case 'toggle-stream': return this.studio.outputs.toggleStreaming();
        case 'toggle-record': return this.studio.outputs.toggleRecording();
        case 'external': return this.toggleExternal();
        case 'multiview-popout': return this.popoutMultiview();
        case 'title-designer': return BTS.TitleDesigner.open();
        case 'data-sources': return BTS.SettingsUI.dataSources();
        case 'telestrator': return BTS.TelestratorUI.open();
        case 'shortcuts': return BTS.SettingsUI.open('shortcuts');
        case 'stats': return BTS.SettingsUI.stats();
        case 'toggle-multiview': return this.toggleMultiview();
        case 'toggle-mixer': return this.toggleMixer();
        case 'about': return BTS.SettingsUI.about();
      }
    }
  }

  BTS.MainUI = MainUI;
})(window.BTS);
