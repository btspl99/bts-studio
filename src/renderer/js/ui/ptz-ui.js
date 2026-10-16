'use strict';
/**
 * PTZ Control module (dockable) + PTZ virtual inputs.
 * Assign an IP (VISCA over IP) to any camera input, then drive it with the joystick, zoom rocker and presets.
 * "Make input" turns a preset into a virtual input: selecting it into Preview moves the camera there (vMix-style).
 */
(function (BTS) {
  const U = BTS.U;
  const { Input, register } = BTS.Inputs;

  /* ---------- virtual input: a camera at a PTZ position ---------- */
  class VirtualInput extends Input {
    async init() {
      this.setStatus(this.source ? 'ok' : 'error', this.source ? '' : 'Source camera missing');
      if (!this._off) this._off = this.app.on('bus', () => { if (this.app.previewId === this.id && this._lastPv !== this.id) this.recall(); this._lastPv = this.app.previewId; });
    }
    get source() { return this.app.byId(this.cfg.sourceId); }
    get ptz() { const s = this.source; return s && s.cfg.ptz && s.cfg.ptz.host ? s.cfg.ptz : null; }
    recall() { const p = this.ptz; if (p && this.cfg.preset != null) return window.bts.ptz.recall(p, this.cfg.preset); }
    onLive(on) { if (on && this.app.previewId !== this.id && this._recalledFor !== this.app.programId) { this._recalledFor = this.app.programId; this.recall(); } }
    getFrame() { const s = this.source; if (!s) return null; const f = s.getFrame(); return f; }
    children() { const s = this.source; return s ? [s] : []; }
    get channel() { return null; } set channel(v) { /* virtual inputs have no own audio */ }
    destroy() { if (this._off) this._off(); super.destroy(); }
  }
  register('virtual', VirtualInput, { label: 'PTZ / Virtual', icon: '🎯' });

  const PROTOS = [['visca-udp', 'VISCA over IP (Sony, BirdDog, Lumens…) UDP 52381'], ['visca-tcp', 'VISCA TCP (PTZOptics 5678)'], ['visca-udp-raw', 'VISCA UDP raw (PTZOptics 1259)']];

  class PtzUI {
    constructor(studio, root) {
      this.studio = studio; this.root = root;
      this.camId = null; this.speed = 0.6;
      this.build();
      studio.on('inputs', () => this.refreshCams());
    }
    get cams() { return this.studio.inputs.filter(i => i.type === 'camera' || i.type === 'stream'); }
    get cam() { return this.studio.byId(this.camId) || this.cams.find(c => c.cfg.ptz && c.cfg.ptz.host) || this.cams[0] || null; }
    get conf() { const c = this.cam; return c && c.cfg.ptz && c.cfg.ptz.host ? c.cfg.ptz : null; }

    build() {
      this.root.innerHTML = '';
      this.camSel = U.el('select', { onchange: () => { this.camId = this.camSel.value; this.refresh(); } });
      this.status = U.el('span', { class: 'hint' });
      const pad = this.pad = U.el('div', { class: 'ptz-pad', title: 'Drag to pan/tilt — further from centre = faster. Arrow keys work when focused.', tabindex: 0 }, [U.el('div', { class: 'ptz-knob' })]);
      const zoom = this.zoomEl = U.el('input', { type: 'range', min: -1, max: 1, step: 0.01, value: 0, class: 'ptz-zoom', title: 'Zoom: up = tele, down = wide (springs back)' });
      const speed = U.el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: this.speed, title: 'Max speed', oninput: () => { this.speed = +speed.value; } });
      this.presets = U.el('div', { class: 'ptz-presets' });
      const btn = (t, title, fn) => U.el('button', { class: 'tbtn small', text: t, title, onclick: fn });
      this.root.append(
        U.el('div', { class: 'mod-toolbar' }, [U.el('span', { class: 'hint', text: 'Camera' }), this.camSel, btn('⚙ Setup', 'IP address and protocol for this camera', () => this.setup()), U.el('div', { class: 'spacer' }), this.status]),
        U.el('div', { class: 'ptz-body' }, [
          U.el('div', { class: 'ptz-left' }, [
            pad,
            U.el('div', { class: 'ptz-row' }, [btn('⌂', 'Home', () => this.call('home')), btn('AF', 'Auto focus', () => this.call('focus', 'auto')), btn('1-push', 'One-push focus', () => this.call('focus', 'onepush')), btn('F−', 'Focus near (hold)', null), btn('F+', 'Focus far (hold)', null)]),
            U.el('div', { class: 'ptz-row' }, [U.el('span', { class: 'hint', text: 'Speed' }), speed])
          ]),
          U.el('div', { class: 'ptz-zoomcol' }, [U.el('span', { class: 'hint', text: 'T' }), zoom, U.el('span', { class: 'hint', text: 'W' })]),
          U.el('div', { class: 'ptz-right' }, [U.el('div', { class: 'hint', text: 'PRESETS — click to recall · Shift+click or right-click to store' }), this.presets])
        ])
      );
      // focus hold buttons
      const [fn, ff] = [...this.root.querySelectorAll('.ptz-row .tbtn')].filter(b => /^F[−+]$/.test(b.textContent));
      for (const [b, m] of [[fn, 'near'], [ff, 'far']]) { b.onpointerdown = () => this.call('focus', 'manual').then(() => this.call('focus', m)); b.onpointerup = b.onpointerleave = () => this.call('focus', 'stop'); }
      // joystick
      let dragging = false, lastSend = 0, last = [0, 0];
      const knob = pad.firstChild;
      const apply = (x, y, force) => {
        knob.style.transform = `translate(${x * 42}px, ${y * 42}px)`;
        const now = performance.now();
        if (!force && now - lastSend < 80 && Math.hypot(x - last[0], y - last[1]) < 0.15) return;
        lastSend = now; last = [x, y];
        if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) this.call('stop'); else this.call('move', x * this.speed, y * this.speed);
      };
      const pos = (e) => { const r = pad.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } return [x, y]; };
      pad.addEventListener('pointerdown', (e) => { dragging = true; try { pad.setPointerCapture(e.pointerId); } catch { /* synthetic */ } apply(...pos(e), true); });
      pad.addEventListener('pointermove', (e) => { if (dragging) apply(...pos(e)); });
      const end = () => { if (!dragging) return; dragging = false; apply(0, 0, true); };
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
      const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      pad.addEventListener('keydown', (e) => { const k = keys[e.key]; if (k) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) apply(k[0] * 0.6, k[1] * 0.6, true); } });
      pad.addEventListener('keyup', (e) => { if (keys[e.key]) { e.stopPropagation(); apply(0, 0, true); } });
      // zoom rocker springs back to 0
      let zt = 0;
      zoom.oninput = () => { const v = +zoom.value; if (performance.now() - zt > 80 || Math.abs(v) < 0.05) { zt = performance.now(); this.call('zoom', v * this.speed); } };
      const zEnd = () => { zoom.value = 0; this.call('zoom', 0); };
      zoom.onpointerup = zEnd; zoom.onchange = zEnd;
      this.refreshCams();
    }

    refreshCams() {
      const cams = this.cams;
      this.camSel.innerHTML = '';
      for (const c of cams) this.camSel.append(U.el('option', { value: c.id, text: `${c.number}. ${c.title}${c.cfg.ptz && c.cfg.ptz.host ? '' : ' (no PTZ)'}`, selected: this.cam && c.id === this.cam.id }));
      if (!cams.length) this.camSel.append(U.el('option', { text: 'Add a camera input first' }));
      this.refresh();
    }

    refresh() {
      const c = this.cam, p = this.conf;
      this.status.textContent = p ? `${p.host}:${p.port || ''} ${p.protocol}` : (c ? 'Not configured — click Setup' : '');
      this.root.classList.toggle('ptz-off', !p);
      this.presets.innerHTML = '';
      if (!c) return;
      const list = (c.cfg.ptzPresets = c.cfg.ptzPresets || []);
      for (let n = 0; n < 16; n++) {
        const pr = list[n];
        const b = U.el('button', { class: 'ptz-pre' + (pr ? ' set' : ''), title: pr ? `Recall ${pr.name || 'preset ' + (n + 1)} · Shift+click to overwrite` : 'Shift+click or right-click to store the current position here' }, [
          pr && pr.thumb ? U.el('img', { src: pr.thumb, alt: '' }) : U.el('div', { class: 'ptz-pre-empty', text: String(n + 1) }),
          U.el('span', { text: pr ? (pr.name || String(n + 1)) : '' })
        ]);
        b.onclick = (e) => { if (e.shiftKey || !pr) this.storePreset(n); else this.call('recall', n); };
        b.oncontextmenu = (e) => {
          e.preventDefault();
          BTS.Dialog.ctxMenu(e.clientX, e.clientY, [
            { label: 'Store current position', onClick: () => this.storePreset(n) },
            pr && { label: 'Rename…', onClick: async () => { const v = await BTS.Dialog.prompt('Preset name', pr.name || ''); if (v != null) { pr.name = v; this.refresh(); } } },
            pr && { label: 'Make input (select it to move the camera)', onClick: () => this.makeInput(n) },
            pr && { label: 'Clear', onClick: () => { list[n] = null; this.refresh(); } }
          ]);
        };
        this.presets.append(b);
      }
    }

    async call(cmd, ...a) {
      const p = this.conf;
      if (!p) { this.status.textContent = 'Not configured — click Setup'; return { ok: false }; }
      const r = await window.bts.ptz[cmd](p, ...a);
      if (r && !r.ok) this.status.textContent = '⚠ ' + r.error; else if (cmd !== 'move' && cmd !== 'zoom') this.status.textContent = `${p.host} · ${cmd}${a.length ? ' ' + a[0] : ''}`;
      return r;
    }

    async storePreset(n) {
      const c = this.cam; if (!c) return;
      const r = await this.call('store', n);
      if (r && r.ok === false) return;
      const list = c.cfg.ptzPresets = c.cfg.ptzPresets || [];
      list[n] = { ...(list[n] || {}), n, name: (list[n] && list[n].name) || `Pos ${n + 1}`, thumb: this.studio.thumbOf(c.id, 160, 0.6) };
      this.refresh();
      U.toast(`Stored preset ${n + 1} on ${c.title}`);
    }

    async makeInput(n) {
      const c = this.cam; const pr = c && c.cfg.ptzPresets[n]; if (!pr) return;
      const inp = await this.studio.addInput({ type: 'virtual', title: `${c.title} · ${pr.name || 'Pos ' + (n + 1)}`, cfg: { sourceId: c.id, preset: n }, noAutoProgram: true }, { select: false });
      U.toast(`Added ${inp.title} — select it into Preview to move the camera`);
    }

    setup() {
      const c = this.cam; if (!c) return U.toast('Add a camera input first', 'error');
      const p = c.cfg.ptz = c.cfg.ptz || { protocol: 'visca-udp', host: '', port: 52381, address: 1 };
      BTS.Dialog.open({
        title: `PTZ — ${c.title}`, width: 520,
        body: U.el('div', {}, [BTS.Dialog.form([
          { label: 'Protocol', key: 'protocol', type: 'select', options: PROTOS, onChange: (v) => { p.port = v === 'visca-tcp' ? 5678 : v === 'visca-udp-raw' ? 1259 : 52381; } },
          { label: 'IP address', key: 'host', placeholder: '192.168.1.100' },
          { label: 'Port', key: 'port', type: 'number', min: 1, max: 65535 },
          { label: 'VISCA address', key: 'address', type: 'number', min: 1, max: 7, hint: 'Usually 1 for IP cameras.' },
          { label: 'Preset recall speed', key: 'recallSpeed', type: 'number', min: 1, max: 24, hint: 'Optional (Sony / PTZOptics). Leave empty for the camera default.' }
        ], p), U.el('p', { class: 'hint', text: 'Enable VISCA over IP in the camera\'s web page. Video still comes in through the camera input (NDI is not supported yet — use SRT/RTSP via a Stream input, HDMI/SDI capture or USB).' })]),
        buttons: [{ label: 'Test (home)', onClick: () => { this.refresh(); this.call('home'); return false; } }, { label: 'Done', primary: true, onClick: () => { if (p.recallSpeed) this.call('presetSpeed', p.recallSpeed); this.refreshCams(); return true; } }]
      });
    }
  }

  BTS.PtzUI = PtzUI;
})(window.BTS);
