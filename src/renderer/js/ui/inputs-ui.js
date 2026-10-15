'use strict';
/** Input strip — cards with thumbnails, tally, quick buttons, drag-reorder and context menus. */
(function (BTS) {
  const U = BTS.U;

  class InputsUI {
    constructor(studio) {
      this.studio = studio;
      this.root = U.$('#inputs');
      this.cards = new Map();
      studio.on('inputs', () => this.render());
      studio.on('bus', () => this.tally());
      studio.on('overlays', () => this.tally());
      studio.on('input-status', (i) => this.updateStatus(i));
      studio.on('mixer-values', () => this.tally());
      let tick = 0;
      studio.on('frame', () => {
        tick++;
        const every = Math.max(1, Math.round(studio.fps / 10));
        if (tick % every) return;
        for (const [id, c] of this.cards) this.drawThumb(id, c);
      });
      setInterval(() => this.updateTimes(), 250);
      this._setupDnD();
    }

    render() {
      const st = this.studio;
      const keep = new Set(st.inputs.map(i => i.id));
      for (const [id, c] of this.cards) if (!keep.has(id)) { c.el.remove(); this.cards.delete(id); }
      st.inputs.forEach((inp, idx) => {
        let c = this.cards.get(inp.id);
        if (!c) c = this.create(inp);
        c.el.querySelector('.ic-num').textContent = idx + 1;
        c.el.querySelector('.ic-title').textContent = inp.title;
        c.el.querySelector('.ic-title').title = inp.title;
        c.el.querySelector('.ic-iso').classList.toggle('on', !!inp.iso);
        if (this.root.children[idx] !== c.el) this.root.insertBefore(c.el, this.root.children[idx] || null);
      });
      this.tally();
    }

    create(inp) {
      const st = this.studio;
      const canvas = U.el('canvas', { width: 320, height: 180 });
      const el = U.el('div', { class: 'input-card', draggable: 'true', 'data-id': inp.id }, [
        U.el('div', { class: 'ic-head' }, [
          U.el('span', { class: 'ic-num' }),
          U.el('span', { class: 'ic-title' }),
          U.el('span', { class: 'ic-type', text: inp.info.label }),
          U.el('button', { class: 'ic-close', title: 'Settings', text: '⚙', onclick: () => BTS.ui.inputSettings(inp) }),
          U.el('button', { class: 'ic-close', title: 'Remove input', text: '✕', onclick: async () => { if (inp.id === st.programId || st.liveSet.has(inp)) { if (!(await BTS.Dialog.confirm(`"${inp.title}" is LIVE. Remove it anyway?`, { danger: true, ok: 'Remove' }))) return; } st.removeInput(inp.id); } })
        ]),
        U.el('div', { class: 'ic-thumb', title: 'Click: Preview  •  Double-click: Settings  •  Right-click: menu' }, [
          canvas,
          U.el('span', { class: 'ic-badge' }),
          U.el('span', { class: 'ic-status' }),
          U.el('span', { class: 'ic-iso', text: 'ISO REC' }),
          U.el('div', { class: 'ic-meter' }, [U.el('i')])
        ]),
        U.el('div', { class: 'ic-btns' }, [
          U.el('button', { class: 'wide3', text: 'Quick Play', title: 'Transition to Output with the Quick Play effect', onclick: () => st.quickPlay(inp.id) }),
          U.el('button', { class: 'wide2', text: 'Cut', title: 'Cut to Output', onclick: () => st.cut(inp.id) }),
          U.el('button', { 'data-b': 'loop', text: '⟳', title: 'Loop', onclick: () => { BTS.Functions.call('Loop', { Input: inp.id }); this.tally(); } }),
          ...[1, 2, 3, 4].map(n => U.el('button', { 'data-ovl': n, text: String(n), title: `Overlay ${n}`, onclick: () => st.overlay(n, inp.id, 'toggle') })),
          U.el('button', { 'data-b': 'audio', text: '🔊', title: 'Audio on/off', onclick: () => { if (inp.channel) { inp.channel.set({ muted: !inp.channel.s.muted }); st.emit('mixer-values'); } } })
        ])
      ]);
      const thumb = el.querySelector('.ic-thumb');
      thumb.addEventListener('click', () => st.setPreview(inp.id));
      thumb.addEventListener('dblclick', () => BTS.ui.inputSettings(inp));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(inp, e.clientX, e.clientY); });
      inp.on('state', () => this.tally());
      inp.on('live', () => this.tally());
      const tctx = canvas.getContext('2d', { alpha: false }); tctx.imageSmoothingQuality = 'low';
      const c = { el, canvas, ctx: tctx, meter: el.querySelector('.ic-meter i'), badge: el.querySelector('.ic-badge'), status: el.querySelector('.ic-status') };
      this.cards.set(inp.id, c);
      this.updateStatus(inp);
      return c;
    }

    menu(inp, x, y) {
      const st = this.studio;
      const items = [
        { label: 'Preview', onClick: () => st.setPreview(inp.id) },
        { label: 'Cut to Output', onClick: () => st.cut(inp.id) },
        { label: 'Quick Play', onClick: () => st.quickPlay(inp.id) },
        '-',
        { label: 'Input Settings…', onClick: () => BTS.ui.inputSettings(inp) },
        { label: 'Position / Crop…', onClick: () => BTS.ui.inputSettings(inp, 'position') },
        { label: 'Colour Correction…', onClick: () => BTS.ui.inputSettings(inp, 'color') },
        { label: 'Chroma / Luma Key…', onClick: () => BTS.ui.inputSettings(inp, 'key') },
        inp.channel ? { label: 'Audio Settings…', onClick: () => BTS.ui.inputSettings(inp, 'audio') } : null,
        inp.type === 'title' ? { label: 'Edit Title Text…', onClick: () => BTS.ui.inputSettings(inp, 'general') } : null,
        inp.type === 'title' ? { label: 'Title Designer…', onClick: () => BTS.ui.titleDesigner(inp) } : null,
        inp.type === 'browser' ? { label: 'Reload Page', onClick: () => inp.reload() } : null,
        inp.type === 'browser' ? { label: 'Page Developer Tools', onClick: () => window.bts.browser.devtools(inp.id) } : null,
        ['camera', 'screen'].includes(inp.type) ? { label: 'Restart Device', onClick: () => inp.init() } : null,
        '-',
        { label: 'Rename…', onClick: async () => { const n = await BTS.Dialog.prompt('Rename input', inp.title); if (n) st.renameInput(inp.id, n); } },
        { label: 'Duplicate', onClick: () => st.duplicateInput(inp.id) },
        inp.getMediaStream() ? { label: inp.iso ? 'Stop ISO Recording' : 'Start ISO Recording', onClick: () => (inp.iso ? st.outputs.stopIso(inp.id) : st.outputs.startIso(inp.id)) } : null,
        { label: 'Snapshot Input', onClick: () => BTS.Functions.call('SnapshotInput', { Input: inp.id }).then(r => r.ok && U.toast('Saved ' + r.data, 'ok')) },
        '-',
        { label: 'Remove', onClick: () => st.removeInput(inp.id) }
      ];
      BTS.Dialog.ctxMenu(x, y, items);
    }

    drawThumb(id, c) {
      const inp = this.studio.byId(id); if (!inp) return;
      const ctx = c.ctx, W = c.canvas.width, H = c.canvas.height;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      try {
        if (inp.type === 'title' && !inp.live) inp.drawStatic(ctx, 0, 0, W, H);
        else inp.draw(ctx, 0, 0, W, H);
      } catch { /* ignore */ }
      if (inp.status === 'loading') { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#aaa'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Loading…', W / 2, H / 2); }
      if (inp.channel) {
        const pk = Math.max(...inp.channel.peak);
        c.meter.style.height = (U.clamp((U.db(pk) + 60) / 60, 0, 1) * 100) + '%';
      }
    }

    updateStatus(inp) {
      const c = this.cards.get(inp.id); if (!c) return;
      if (inp.status === 'error') { c.status.textContent = '⚠ ' + (inp.statusMsg || 'Error'); c.status.className = 'ic-status err'; c.status.title = inp.statusMsg; }
      else if (inp.trackInfo) { c.status.textContent = inp.trackInfo; c.status.className = 'ic-status'; }
      else { c.status.textContent = ''; c.status.className = 'ic-status hidden'; }
    }

    updateTimes() {
      for (const [id, c] of this.cards) {
        const inp = this.studio.byId(id); if (!inp) continue;
        if (inp.isMedia && inp.duration) {
          const rem = inp.duration - inp.currentTime;
          c.badge.textContent = (inp.playing ? '▶ ' : '❚❚ ') + U.fmtTime(rem) + (inp.type === 'playlist' ? `  [${inp.index + 1}/${inp.cfg.items.length}]` : '');
          c.badge.style.color = inp.playing && rem < 10 ? '#ff6b61' : '';
        } else c.badge.textContent = '';
      }
    }

    tally() {
      const st = this.studio;
      for (const [id, c] of this.cards) {
        const inp = st.byId(id); if (!inp) continue;
        const pgm = id === st.programId || (st.active && st.active.to === id);
        const ovl = st.overlays.some(o => o.inputId === id && o.state !== 'off');
        const live = st.liveSet.has(inp);
        c.el.classList.toggle('pgm', pgm || (live && !ovl));
        c.el.classList.toggle('ovl', ovl && !pgm);
        c.el.classList.toggle('pvw', id === st.previewId && !pgm && !ovl);
        c.el.querySelectorAll('[data-ovl]').forEach(b => { const o = st.overlays[+b.dataset.ovl - 1]; b.classList.toggle('ovl-on', o.inputId === id && o.state !== 'off'); });
        const lb = c.el.querySelector('[data-b=loop]'); lb.classList.toggle('on', !!inp.props.loop); lb.disabled = !inp.isMedia;
        const ab = c.el.querySelector('[data-b=audio]');
        ab.disabled = !inp.channel; ab.style.opacity = inp.channel ? 1 : 0.35;
        ab.classList.toggle('muted', !!(inp.channel && inp.channel.s.muted));
        ab.textContent = inp.channel && inp.channel.s.muted ? '🔇' : '🔊';
      }
    }

    _setupDnD() {
      let dragId = null;
      this.root.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.input-card'); if (!card) return;
        dragId = card.dataset.id; card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/bts-input', dragId);
      });
      this.root.addEventListener('dragend', (e) => { const card = e.target.closest('.input-card'); if (card) card.classList.remove('dragging'); U.$$('.drop-before').forEach(x => x.classList.remove('drop-before')); dragId = null; });
      this.root.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        U.$$('.drop-before').forEach(x => x.classList.remove('drop-before'));
        const card = e.target.closest('.input-card'); if (card && card.dataset.id !== dragId) card.classList.add('drop-before');
      });
      this.root.addEventListener('drop', (e) => {
        if (!dragId) return;
        e.preventDefault(); e.stopPropagation();
        const card = e.target.closest('.input-card');
        const st = this.studio;
        const to = card ? st.inputs.indexOf(st.byId(card.dataset.id)) : st.inputs.length;
        const from = st.inputs.indexOf(st.byId(dragId));
        st.moveInput(dragId, from < to ? to - 1 : to);
      });
    }
  }

  BTS.InputsUI = InputsUI;
})(window.BTS);
