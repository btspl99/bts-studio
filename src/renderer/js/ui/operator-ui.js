'use strict';
/**
 * Operator panels: Instant Replay, Playlist, Scripts (macros), input Triggers, MIDI mapping,
 * Devices & Performance settings. Replay / Playlist / Scripts are floating, non-blocking panels
 * so the switcher stays usable while they are open.
 */
(function (BTS) {
  const U = BTS.U;
  const FNS = () => BTS.Functions.all();

  /* ---------------- floating panel ---------------- */
  const panels = new Map();
  const HOSTS = { playlist: '#playlistModule', scripts: '#scriptsModule' };
  function floatPanel(id, title, build, { width = 420, mountOnly = false } = {}) {
    const hostSel = HOSTS[id];
    if (hostSel && U.$(hostSel)) {
      // docked module: build once into its workspace container, then just bring it to front
      if (!panels.has(id)) {
        const host = U.$(hostSel);
        const body = U.el('div', { class: 'module-body' });
        host.innerHTML = ''; host.append(body);
        const api = { el: host, body, close: () => BTS.layout && BTS.layout.hide(id), refresh: null };
        panels.set(id, api);
        build(api);
      }
      if (!mountOnly && BTS.layout) BTS.layout.activate(id);
      return panels.get(id);
    }
    if (panels.has(id)) { const p = panels.get(id); p.el.style.zIndex = ++floatPanel.z; return p; }
    const saved = (() => { try { return JSON.parse(localStorage.getItem('bts.panel.' + id) || 'null'); } catch { return null; } })();
    const el = U.el('div', { class: 'float-panel', style: { width: width + 'px', left: (saved?.x ?? 120 + panels.size * 40) + 'px', top: (saved?.y ?? 80 + panels.size * 30) + 'px', zIndex: ++floatPanel.z } });
    const head = U.el('div', { class: 'fp-head' }, [U.el('span', { text: title }), U.el('button', { class: 'x', html: '×', title: 'Close' })]);
    const body = U.el('div', { class: 'fp-body' });
    el.append(head, body);
    document.body.append(el);
    const api = { el, body, close: () => { el.remove(); panels.delete(id); if (api.onClose) api.onClose(); }, refresh: null };
    head.querySelector('.x').onclick = api.close;
    el.addEventListener('mousedown', () => { el.style.zIndex = ++floatPanel.z; });
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      head.setPointerCapture(e.pointerId);
      const ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop;
      const move = (ev) => { el.style.left = U.clamp(ev.clientX - ox, 0, innerWidth - 80) + 'px'; el.style.top = U.clamp(ev.clientY - oy, 0, innerHeight - 40) + 'px'; };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); try { localStorage.setItem('bts.panel.' + id, JSON.stringify({ x: el.offsetLeft, y: el.offsetTop })); } catch { /* noop */ } };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    panels.set(id, api);
    build(api);
    return api;
  }
  floatPanel.z = 150;

  function fnSelect(value, onChange) {
    const sel = U.el('select');
    let grp = null, og;
    for (const f of FNS()) { if (f.group !== grp) { grp = f.group; og = U.el('optgroup', { label: grp }); sel.append(og); } const o = U.el('option', { value: f.name, text: f.name }); if (f.name === value) o.selected = true; og.append(o); }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }
  function txt(value, placeholder, onChange, width) { const e = U.el('input', { type: 'text', value: value ?? '', placeholder, style: { width: width || '100%' } }); e.onchange = () => onChange(e.value); e.onkeydown = (ev) => ev.stopPropagation(); return e; }
  function numIn(value, onChange, width = '70px', step = 100) { const e = U.el('input', { type: 'number', value: value ?? 0, min: 0, step, style: { width } }); e.onchange = () => onChange(+e.value || 0); e.onkeydown = (ev) => ev.stopPropagation(); return e; }

  class OperatorUI {
    constructor(studio) {
      this.studio = studio;
      U.$('#btnReplay').onclick = () => this.replayPanel();
      U.$('#btnPlaylist').onclick = () => this.playlistPanel();
      U.$('#btnScripts').onclick = () => this.scriptsPanel();
      studio.sequencer.on('change', () => U.$('#btnPlaylist').classList.toggle('on', studio.sequencer.running));
    }

    /* ================= Instant Replay ================= */
    mountModules() { this.playlistPanel({ mountOnly: true }); this.scriptsPanel({ mountOnly: true }); }

    replayPanel() { if (BTS.layout) { BTS.layout.activate('replay'); return; } return this._legacyReplayPanel(); }

    _legacyReplayPanel() {
      const st = this.studio, R = st.replay;
      return floatPanel('replay', '⏪ Instant Replay', (p) => {
        const draw = () => {
          p.body.innerHTML = '';
          const srcBox = U.el('div', { class: 'chips' });
          const options = [['program', 'Program (Output)'], ...st.inputs.filter(i => i.getMediaStream() && i.hasVideo && i.type !== 'replay').map(i => [i.id, `${i.number}. ${i.title}`])];
          for (const [k, l] of options) {
            const cb = U.el('input', { type: 'checkbox' }); cb.checked = R.cfg.sources.includes(k); cb.disabled = R.running;
            cb.onchange = () => { R.cfg.sources = cb.checked ? [...new Set([...R.cfg.sources, k])] : R.cfg.sources.filter(x => x !== k); };
            srcBox.append(U.el('label', { class: 'chip' }, [cb, ' ' + l]));
          }
          const secs = numIn(R.cfg.seconds, (v) => { R.cfg.seconds = U.clamp(v, 20, 600); }, '70px', 10); secs.disabled = R.running;
          const startBtn = U.el('button', { class: 'btn ' + (R.running ? 'danger' : 'primary'), text: R.running ? '■ Stop buffer' : '● Start buffer', onclick: async () => { startBtn.disabled = true; if (R.running) await R.stop(); else await R.start(); draw(); } });
          const status = U.el('div', { class: 'hint', text: R.running ? 'Buffering…' : 'Buffer stopped' });
          const camSel = U.el('select', { onchange: (e) => { R.cfg.current = e.target.value; } });
          for (const k of R.active.keys()) camSel.append(U.el('option', { value: k, text: R.sourceLabel(k), selected: k === R.cfg.current }));
          const big = (label, cls, fn) => U.el('button', { class: 'rp-btn ' + (cls || ''), text: label, onclick: fn, disabled: !R.running });
          const marks = U.el('div', { class: 'hint', text: R.markInWall ? `Mark In ${new Date(R.markInWall).toLocaleTimeString()}${R.markOutWall ? ' → Out ' + new Date(R.markOutWall).toLocaleTimeString() : ''}` : 'No marks' });
          const speedRow = U.el('div', { class: 'rp-row' }, [U.el('span', { class: 'hint', text: 'Speed' }), ...[0.25, 0.5, 0.75, 1].map(v => U.el('button', { class: 'tbtn' + (Math.abs(R.cfg.speed - v) < 0.01 ? ' on' : ''), text: Math.round(v * 100) + '%', onclick: () => { R.setSpeed(v); draw(); } }))]);
          const auto = U.el('input', { type: 'checkbox' }); auto.checked = R.cfg.autoPlay; auto.onchange = () => { R.cfg.autoPlay = auto.checked; };
          const events = U.el('div', { class: 'list', style: { maxHeight: '190px' } });
          R.events.forEach((ev, i) => events.append(U.el('div', { class: 'li' }, [
            U.el('span', { text: `${i + 1}.` }), U.el('span', { class: 'grow', text: `${ev.label} • ${ev.duration.toFixed(1)}s • ${ev.time}`, title: ev.file }),
            U.el('button', { class: 'tbtn small', text: 'PVW', title: 'Load to Preview', onclick: () => R.load(ev) }),
            U.el('button', { class: 'tbtn small', text: '▶ OUT', title: 'Play to Output', onclick: () => R.load(ev, { toOutput: true }) }),
            U.el('button', { class: 'tbtn small', text: '✕', title: 'Delete clip', onclick: () => { window.bts.replay.deleteClip(ev.file); R.events.splice(i, 1); draw(); } })
          ])));
          if (!R.events.length) events.append(U.el('div', { class: 'li hint', text: 'Saved replays appear here' }));
          p.body.append(
            U.el('div', { class: 'hint', text: 'SOURCES', style: { marginBottom: '4px' } }), srcBox,
            U.el('div', { class: 'rp-row' }, [U.el('span', { class: 'hint', text: 'Buffer (s)' }), secs, startBtn]), status,
            U.el('div', { class: 'rp-row' }, [U.el('span', { class: 'hint', text: 'Camera' }), camSel]),
            U.el('div', { class: 'rp-grid' }, [
              big('MARK IN', '', () => { R.markIn(); draw(); }), big('MARK OUT', '', () => { R.markOut(); draw(); }), big('SAVE MARKS', '', async () => { await R.clip({ marks: true }); draw(); }),
              big('LAST 5s', '', async () => { await R.clip({ last: 5 }); draw(); }), big('LAST 10s', '', async () => { await R.clip({ last: 10 }); draw(); }), big('LAST 20s', '', async () => { await R.clip({ last: 20 }); draw(); })
            ]),
            marks,
            big('⏪ INSTANT REPLAY', 'hot', async () => { await R.instant(); draw(); }),
            speedRow,
            U.el('label', { class: 'rp-row' }, [auto, ' Instant replay goes straight to Output']),
            U.el('div', { class: 'hint', text: 'EVENTS', style: { margin: '8px 0 4px' } }), events,
            U.el('div', { class: 'hint', style: { marginTop: '6px' }, text: 'Shortcuts: add ReplayInstant / ReplayMarkIn / ReplayMarkOut / ReplaySaveMarks / ReplaySetSpeed in Settings → Shortcuts or map them to MIDI.' })
          );
          if (R.running) R.status().then(s => { const k = R.cfg.current; const x = s[k]; if (x) status.textContent = x.active ? `Buffered ${x.buffered.toFixed(0)} s of ${R.cfg.seconds} s` : 'Encoder stopped: ' + x.error; });
        };
        draw();
        const off = R.on('change', draw);
        const iv = setInterval(() => { if (R.running) draw(); }, 3000);
        p.onClose = () => { off(); clearInterval(iv); };
      }, { width: 460 });
    }

    /* ================= Playlist ================= */
    playlistPanel(opts = {}) {
      const st = this.studio, Q = st.sequencer;
      return floatPanel('playlist', '📃 Playlist', (p) => {
        const draw = () => {
          p.body.innerHTML = '';
          const c = Q.cfg;
          const list = U.el('div', { class: 'list', style: { maxHeight: '260px' } });
          c.items.forEach((it, i) => {
            const sel = U.el('select', { style: { flex: 1, minWidth: 0 } });
            for (const inp of st.inputs) sel.append(U.el('option', { value: inp.id, text: `${inp.number}. ${inp.title}`, selected: inp.id === it.inputId }));
            sel.onchange = () => { it.inputId = sel.value; };
            list.append(U.el('div', { class: 'li' + (Q.running && i === Q.index ? ' on' : '') }, [
              U.el('span', { text: `${i + 1}.` }), sel, numIn(it.duration, (v) => { it.duration = v; }, '60px', 1), U.el('span', { class: 'hint', text: 's' }),
              U.el('button', { class: 'tbtn small', text: '▶', title: 'Play from here', onclick: () => Q.start(i) }),
              U.el('button', { class: 'tbtn small', text: '▲', onclick: () => { if (i) { [c.items[i - 1], c.items[i]] = [c.items[i], c.items[i - 1]]; draw(); } } }),
              U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { c.items.splice(i, 1); draw(); } })
            ]));
          });
          if (!c.items.length) list.append(U.el('div', { class: 'li hint', text: 'Add inputs to play them in sequence' }));
          const tr = U.el('select'); for (const t of BTS.Transitions.list.filter(t => !t.id.startsWith('Stinger'))) tr.append(U.el('option', { value: t.id, text: t.name, selected: t.id === c.transition }));
          tr.onchange = () => { c.transition = tr.value; };
          const loop = U.el('input', { type: 'checkbox' }); loop.checked = c.loop; loop.onchange = () => { c.loop = loop.checked; };
          p.body.append(list,
            U.el('div', { class: 'rp-row' }, [U.el('button', { class: 'btn', text: '＋ Add input', onclick: () => { const i = st.preview || st.inputs[0]; if (!i) return U.toast('Add inputs first', 'error'); c.items.push({ inputId: i.id, duration: i.isMedia ? 0 : 10 }); draw(); } }),
              U.el('button', { class: 'btn', text: '＋ Add all', onclick: () => { for (const i of st.inputs) if (i.hasVideo) c.items.push({ inputId: i.id, duration: i.isMedia ? 0 : 10 }); draw(); } })]),
            U.el('div', { class: 'rp-row' }, [U.el('span', { class: 'hint', text: 'Transition' }), tr, numIn(c.duration, (v) => { c.duration = v; }, '70px'), U.el('span', { class: 'hint', text: 'ms' })]),
            U.el('label', { class: 'rp-row' }, [loop, ' Loop playlist']),
            U.el('div', { class: 'rp-row' }, [
              U.el('button', { class: 'btn ' + (Q.running ? 'danger' : 'primary'), text: Q.running ? '■ Stop' : '▶ Start', onclick: () => { Q.running ? Q.stop() : Q.start(0); draw(); } }),
              U.el('button', { class: 'btn', text: '⏮ Previous', onclick: () => Q.prev() }), U.el('button', { class: 'btn', text: 'Next ⏭', onclick: () => Q.next() })
            ]),
            U.el('div', { class: 'hint', text: 'Duration 0 = play videos/lists to the end (stills: 10 s).' }));
        };
        draw();
        const off = Q.on('change', draw);
        p.onClose = off;
      }, { width: 480, ...opts });
    }

    /* ================= Scripts (macros) ================= */
    scriptsPanel(opts = {}) {
      const st = this.studio, M = st.macros;
      let cur = M.list[0]?.id;
      return floatPanel('scripts', '⚡ Scripts', (p) => {
        const draw = () => {
          p.body.innerHTML = '';
          const left = U.el('div', { class: 'list', style: { maxHeight: '320px' } });
          for (const m of M.list) {
            const li = U.el('div', { class: 'li' + (m.id === cur ? ' on' : ''), style: { cursor: 'pointer' } }, [U.el('span', { class: 'grow', text: (M.running.has(m.id) ? '● ' : '') + m.name }),
              U.el('button', { class: 'tbtn small', text: M.running.has(m.id) ? '■' : '▶', onclick: (e) => { e.stopPropagation(); M.running.has(m.id) ? M.stop(m.id) : M.run(m.id); } })]);
            li.onclick = () => { cur = m.id; draw(); };
            left.append(li);
          }
          if (!M.list.length) left.append(U.el('div', { class: 'li hint', text: 'No scripts yet' }));
          const m = M.get(cur);
          const right = U.el('div');
          if (m) {
            const loop = U.el('input', { type: 'checkbox' }); loop.checked = m.loop; loop.onchange = () => { m.loop = loop.checked; };
            right.append(U.el('div', { class: 'rp-row' }, [txt(m.name, 'Name', (v) => { m.name = v || m.name; M.emit('change'); })]), U.el('label', { class: 'rp-row' }, [loop, ' Loop until stopped']));
            const tbl = U.el('table', { class: 'tbl' });
            tbl.append(U.el('tr', {}, ['Wait ms', 'Function', 'Input', 'Value', ''].map(h => U.el('th', { text: h }))));
            m.steps.forEach((s, i) => tbl.append(U.el('tr', {}, [
              U.el('td', {}, [numIn(s.delay, (v) => { s.delay = v; }, '64px')]),
              U.el('td', {}, [fnSelect(s.fn, (v) => { s.fn = v; })]),
              U.el('td', {}, [txt(s.params?.Input, '#/name', (v) => { s.params = { ...(s.params || {}), Input: v || undefined }; }, '80px')]),
              U.el('td', {}, [txt(s.params?.Value, '', (v) => { s.params = { ...(s.params || {}), Value: v || undefined }; }, '80px')]),
              U.el('td', {}, [U.el('button', { class: 'tbtn small', text: '▲', onclick: () => { if (i) { [m.steps[i - 1], m.steps[i]] = [m.steps[i], m.steps[i - 1]]; draw(); } } }), U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { m.steps.splice(i, 1); draw(); } })])
            ])));
            right.append(tbl, U.el('div', { class: 'rp-row' }, [
              U.el('button', { class: 'btn', text: '＋ Step', onclick: () => { m.steps.push({ fn: 'Cut', params: {}, delay: 0 }); draw(); } }),
              U.el('button', { class: 'btn primary', text: '▶ Run', onclick: () => M.run(m.id) }), U.el('button', { class: 'btn', text: '■ Stop', onclick: () => M.stop(m.id) }),
              U.el('button', { class: 'btn danger', text: 'Delete', onclick: () => { M.remove(m.id); cur = M.list[0]?.id; draw(); } })
            ]), U.el('div', { class: 'hint', text: `Run from a shortcut, MIDI, a trigger or the API: ScriptStart Value=${m.name}` }));
          }
          p.body.append(U.el('div', { style: { display: 'grid', gridTemplateColumns: '170px 1fr', gap: '10px' } }, [
            U.el('div', {}, [left, U.el('button', { class: 'btn', style: { marginTop: '6px', width: '100%' }, text: '＋ New script', onclick: () => { cur = M.add('Script ' + (M.list.length + 1)).id; draw(); } })]), right]));
        };
        draw();
        const off = M.on('change', draw);
        p.onClose = off;
      }, { width: 760, ...opts });
    }

    /* ================= Input triggers (tab in Input Settings) ================= */
    triggersTab(inp) {
      const box = U.el('div');
      inp.props.triggers = inp.props.triggers || [];
      const draw = () => {
        box.innerHTML = '';
        const tbl = U.el('table', { class: 'tbl' });
        tbl.append(U.el('tr', {}, ['When', 'Function', 'Input', 'Value', 'Delay ms', ''].map(h => U.el('th', { text: h }))));
        inp.props.triggers.forEach((t, i) => {
          const ev = U.el('select'); for (const [v, l] of [['TransitionIn', 'Goes live (in)'], ['TransitionOut', 'Leaves output (out)'], ['Completion', 'Video/list finishes']]) ev.append(U.el('option', { value: v, text: l, selected: v === t.event }));
          ev.onchange = () => { t.event = ev.value; };
          tbl.append(U.el('tr', {}, [U.el('td', {}, [ev]), U.el('td', {}, [fnSelect(t.fn, (v) => { t.fn = v; })]),
            U.el('td', {}, [txt(t.params?.Input, '{self} / #', (v) => { t.params = { ...(t.params || {}), Input: v || undefined }; }, '80px')]),
            U.el('td', {}, [txt(t.params?.Value, '', (v) => { t.params = { ...(t.params || {}), Value: v || undefined }; }, '80px')]),
            U.el('td', {}, [numIn(t.delay, (v) => { t.delay = v; }, '64px')]),
            U.el('td', {}, [U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { inp.props.triggers.splice(i, 1); draw(); } })])]));
        });
        box.append(tbl, U.el('div', { class: 'rp-row' }, [U.el('button', { class: 'btn', text: '＋ Add trigger', onclick: () => { inp.props.triggers.push({ event: 'TransitionIn', fn: 'OverlayInput1In', params: {}, delay: 0 }); draw(); } })]),
          U.el('p', { class: 'hint', text: 'Examples: when the camera goes live, bring the Lower Third in on Overlay 1 after 2000 ms • when an advert finishes, QuickPlay the next input • when a title leaves, StopCountdown. Use {self} as Input to mean this input.' }));
      };
      draw();
      return box;
    }

    /* ================= MIDI (tab in Settings) ================= */
    midiTab() {
      const st = this.studio, midi = st.midi;
      BTS.settings.midi = BTS.settings.midi || { enabled: true, mappings: [] };
      const cfg = BTS.settings.midi;
      const box = U.el('div');
      const lastEl = U.el('span', { class: 'kbd', text: '—' });
      const offMsg = midi.on('message', (ev) => { lastEl.textContent = `${ev.device}: ${ev.kind} ch${ev.ch} #${ev.num} = ${Math.round(ev.value)}`; });
      const draw = () => {
        box.innerHTML = '';
        const en = U.el('input', { type: 'checkbox' }); en.checked = cfg.enabled !== false; en.onchange = () => { cfg.enabled = en.checked; };
        box.append(U.el('div', { class: 'rp-row' }, [U.el('label', {}, [en, ' Enable MIDI control']), U.el('span', { class: 'hint', text: 'Devices: ' + (midi.devices.length ? midi.devices.join(', ') : 'none detected (plug in and reopen Settings)') })]),
          U.el('div', { class: 'rp-row' }, [U.el('span', { class: 'hint', text: 'Last message:' }), lastEl]));
        const tbl = U.el('table', { class: 'tbl' });
        tbl.append(U.el('tr', {}, ['Control', 'Action', 'Function / Input', 'Value', ''].map(h => U.el('th', { text: h }))));
        cfg.mappings.forEach((m, i) => {
          const act = U.el('select'); for (const [v, l] of [['fn', 'Run function'], ['tbar', 'T-Bar (fader)'], ['master', 'Master volume (fader)'], ['volume', 'Input volume (fader)']]) act.append(U.el('option', { value: v, text: l, selected: (m.action || 'fn') === v }));
          act.onchange = () => { m.action = act.value === 'fn' ? undefined : act.value; draw(); };
          const fnCell = !m.action ? fnSelect(m.fn || 'Cut', (v) => { m.fn = v; }) : m.action === 'volume' ? txt(m.params?.Input, 'Input #/name', (v) => { m.params = { Input: v }; }, '120px') : U.el('span', { class: 'hint', text: '—' });
          tbl.append(U.el('tr', {}, [U.el('td', { text: `${m.kind} ch${m.ch} #${m.num}` }), U.el('td', {}, [act]), U.el('td', {}, [fnCell]),
            U.el('td', {}, [!m.action ? txt(m.params?.Input || m.params?.Value, 'Input', (v) => { m.params = { ...(m.params || {}), Input: v || undefined }; }, '80px') : '']),
            U.el('td', {}, [U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { cfg.mappings.splice(i, 1); draw(); } })])]));
        });
        const learn = U.el('button', { class: 'btn primary', text: '🎹 Learn: press a button or move a fader…', onclick: () => {
          learn.textContent = 'Waiting for MIDI…'; learn.disabled = true;
          midi.learn((ev) => { cfg.mappings.push({ kind: ev.kind, ch: ev.ch, num: ev.num, fn: ev.kind === 'note' ? 'Cut' : undefined, action: ev.kind === 'cc' || ev.kind === 'pitch' ? 'tbar' : undefined, params: {} }); draw(); });
        } });
        box.append(tbl, U.el('div', { class: 'rp-row' }, [learn]), U.el('p', { class: 'hint', text: 'Works with any class-compliant MIDI controller (Behringer X-Touch, Akai APC/MIDImix, Korg nanoKONTROL, Novation Launch Control…). Saved with Settings.' }));
      };
      draw();
      box._cleanup = offMsg;
      return box;
    }

    /* ================= Devices & Performance (tab in Settings) ================= */
    devicesTab() {
      const s = BTS.settings;
      s.capture = s.capture || { backend: 'mediafoundation' };
      s.performance = s.performance || { governor: true, thumbnailFps: 10, disableGpu: false };
      const box = U.el('div');
      const list = U.el('div', { class: 'list', style: { maxHeight: '200px' } });
      navigator.mediaDevices.enumerateDevices().then(devs => {
        for (const d of devs.filter(x => x.kind !== 'audiooutput')) {
          const hint = d.kind === 'videoinput' ? BTS.Inputs.cardHint(d.label) : '';
          list.append(U.el('div', { class: 'li' }, [U.el('span', { text: d.kind === 'videoinput' ? '🎥' : '🎙' }), U.el('span', { class: 'grow', text: d.label || '(permission needed — add a camera input once)', title: hint })]));
        }
      });
      box.append(BTS.Dialog.form([
        { section: 'Capture devices' },
        { label: 'Capture backend', key: 'capture.backend', type: 'select', options: [['mediafoundation', 'Media Foundation (default, best for USB/UVC)'], ['directshow', 'DirectShow (Blackmagic DeckLink, older PCIe cards)']], hint: 'Restart BTS Studio after changing.' },
        { custom: list },
        { section: 'Performance' },
        { label: 'Adaptive load governor', key: 'performance.governor', type: 'checkbox', hint: 'Under heavy load, previews/thumbnails/multiview slow down first so Output stays smooth.' },
        { label: 'Thumbnail rate (fps)', key: 'performance.thumbnailFps', type: 'select', number: true, options: [[2, '2'], [5, '5'], [10, '10'], [15, '15'], [30, '30']] },
        { label: 'Software rendering (no GPU)', key: 'performance.disableGpu', type: 'checkbox', hint: 'Only for broken graphics drivers — much slower. Restart required.' }
      ], s));
      return box;
    }
  }

  OperatorUI.floatPanel = floatPanel;
  BTS.OperatorUI = OperatorUI;
})(window.BTS);
