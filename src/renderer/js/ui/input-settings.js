'use strict';
/** Input Settings — General, Position/Crop, Colour, Keying, Audio, Layers (scene). Changes apply live. */
(function (BTS) {
  const U = BTS.U;
  const F = (...a) => BTS.Dialog.form(...a);

  function open(inp, tab = 'general') {
    const st = BTS.studio;
    const tabs = [{ id: 'general', label: 'General', el: general(inp, st) }];
    if (inp.type === 'scene') tabs.push({ id: 'layers', label: 'Layers', el: layers(inp, st) });
    if (inp.type === 'mix') tabs.push({ id: 'mix', label: 'Mix Switcher', el: mixTab(inp, st) });
    if (inp.type === 'delay') tabs.push({ id: 'delay', label: 'Delay', el: delayTab(inp, st) });
    if (inp.type === 'slides') tabs.push({ id: 'slides', label: 'Slides', el: slidesTab(inp) });
    if (inp.type === 'guest') tabs.push({ id: 'guest', label: 'Remote Guest', el: guestTab(inp) });
    if (inp.type === 'browser') tabs.push({ id: 'interact', label: 'Interact', el: browserTab(inp) });
    if (inp.hasVideo) {
      tabs.push({ id: 'position', label: 'Position / Crop', el: position(inp) });
      tabs.push({ id: 'color', label: 'Colour Correction', el: colour(inp) });
      tabs.push({ id: 'key', label: 'Keying', el: keying(inp) });
    }
    if (inp.channel) tabs.push({ id: 'audio', label: 'Audio', el: audio(inp, st) });
    tabs.push({ id: 'triggers', label: 'Triggers', el: BTS.operatorUI.triggersTab(inp) });
    const t = BTS.Dialog.tabs(tabs);
    const dlg = BTS.Dialog.open({ title: `${inp.number}. ${inp.title} — ${inp.info.label}`, body: t.el, width: 720, buttons: [{ label: 'Close', primary: true }] });
    t.show(tabs.find(x => x.id === tab) ? tab : 'general');
    return dlg;
  }

  function general(inp, st) {
    const box = U.el('div');
    const o = { title: inp.title };
    box.append(F([{ label: 'Name', key: 'title', onChange: (v) => st.renameInput(inp.id, v) }], o));
    const c = inp.cfg, p = inp.props;
    const reinit = U.debounce(() => inp.init(), 400);
    const rows = [];
    switch (inp.type) {
      case 'video': case 'audio-file':
        rows.push({ label: 'File / URL', key: 'path', type: 'file', onChange: () => inp.init() });
        break;
      case 'image':
        rows.push({ label: 'File', key: 'path', type: 'file', filters: [{ name: 'Images', extensions: U.IMAGE_EXT }], onChange: () => inp.init() });
        break;
      case 'color':
        rows.push({ label: 'Type', key: 'mode', type: 'select', options: [['solid', 'Solid'], ['gradient', 'Gradient'], ['bars', 'Bars'], ['checker', 'Checker'], ['transparent', 'Transparent']], onChange: reinit },
          { label: 'Colour', key: 'color', type: 'color', onChange: reinit }, { label: 'Colour 2', key: 'color2', type: 'color', onChange: reinit });
        break;
      case 'browser':
        rows.push({ label: 'URL / File', key: 'url', type: 'file', onChange: () => inp.update({}) },
          { label: 'Width', key: 'width', type: 'number', onChange: () => inp.update({}) }, { label: 'Height', key: 'height', type: 'number', onChange: () => inp.update({}) },
          { label: 'Frame rate', key: 'fps', type: 'number', min: 1, max: 60, onChange: () => inp.update({}) },
          { label: 'Custom CSS', key: 'css', type: 'textarea', rows: 3, mono: true, onChange: () => inp.update({}) },
          { label: 'Page audio', key: 'audio', type: 'checkbox', onChange: () => inp.update({}) });
        break;
      case 'camera': {
        const devSel = U.el('select', { style: { width: '100%' } });
        BTS.AddInput.devices('videoinput').then(list => { for (const d of list) { const op = U.el('option', { value: d.deviceId, text: d.label || 'Camera' }); if (d.deviceId === c.deviceId) op.selected = true; devSel.append(op); } });
        devSel.onchange = () => { c.deviceId = devSel.value; c.label = devSel.selectedOptions[0].text; inp.init(); };
        const fmt = U.el('select', { style: { width: '100%' } });
        const MODES = ['auto', '3840x2160@30', '3840x2160@25', '2560x1440@30', '1920x1080@60', '1920x1080@59.94', '1920x1080@50', '1920x1080@30', '1920x1080@29.97', '1920x1080@25', '1280x720@60', '1280x720@50', '1280x720@30', '1280x720@25', '720x576@25', '720x480@29.97'];
        const cur = c.width ? `${c.width}x${c.height}@${c.fps}` : 'auto';
        for (const m of MODES) { const op = U.el('option', { value: m, text: m === 'auto' ? 'Auto — device / signal default' : m.replace('@', ' @ ') }); if (m === cur) op.selected = true; fmt.append(op); }
        fmt.onchange = () => { if (fmt.value === 'auto') { c.width = c.height = c.fps = 0; } else { const [wh, f] = fmt.value.split('@'); [c.width, c.height] = wh.split('x').map(Number); c.fps = +f; } inp.init(); };
        rows.push({ label: 'Device', custom: devSel }, { label: 'Format', custom: fmt },
          { custom: U.el('div', { class: 'hint', text: `Current: ${inp.trackInfo || '—'}${inp.pairedAudio ? ' • Audio: ' + inp.pairedAudio : ''}` }) },
          inp.hint ? { custom: U.el('div', { class: 'hint', style: { color: 'var(--accent2)' }, text: inp.hint }) } : null,
          { label: 'Hold last frame on signal loss', key: 'keepLastFrame', type: 'checkbox' },
          { label: 'Auto reconnect', key: 'autoReconnect', type: 'checkbox' },
          { label: 'Include in MultiCorder', key: 'isoEnabled', type: 'checkbox' },
          { custom: U.el('button', { class: 'btn', text: 'Restart device', onclick: () => inp.init() }) });
        break;
      }
      case 'screen':
        rows.push({ custom: U.el('button', { class: 'btn', text: 'Restart capture', onclick: () => inp.init() }) }, { label: 'Include in MultiCorder', key: 'isoEnabled', type: 'checkbox' });
        break;
      case 'stream':
        rows.push({ label: 'Stream URL', key: 'url', onChange: () => inp.init() },
          { label: 'RTSP transport', key: 'transport', type: 'select', options: [['tcp', 'TCP'], ['udp', 'UDP']], onChange: () => inp.init() },
          { label: 'Max width', key: 'width', type: 'select', number: true, options: [[1280, '1280'], [1920, '1920'], [3840, '3840']], onChange: () => inp.init() },
          { label: 'Frame rate', key: 'fps', type: 'select', number: true, options: [[25, '25'], [30, '30'], [50, '50'], [60, '60']], onChange: () => inp.init() },
          { label: 'Include audio', key: 'audio', type: 'checkbox', onChange: () => inp.init() },
          { custom: U.el('button', { class: 'btn', text: 'Reconnect now', onclick: () => inp.init() }) });
        break;
      case 'audio':
        rows.push({ label: 'Noise suppression', key: 'noise', type: 'checkbox', onChange: () => inp.init() }, { label: 'Echo cancellation', key: 'echo', type: 'checkbox', onChange: () => inp.init() });
        break;
      case 'playlist':
        rows.push({ label: 'Shuffle', key: 'shuffle', type: 'checkbox' });
        rows.push({ custom: playlistEditor(inp) });
        break;
      case 'scene':
        rows.push({ label: 'Background', key: 'background', type: 'color' });
        break;
    }
    if (rows.length) box.append(U.el('div', { style: { height: '10px' } }), F(rows.filter(Boolean), c));
    if (inp.isMedia) {
      box.append(U.el('div', { style: { height: '10px' } }), F([
        { section: 'Playback' },
        { label: 'Loop', key: 'loop', type: 'checkbox', onChange: (v) => inp.setLoop && inp.setLoop(v) },
        { label: 'Auto Play (on transition in)', key: 'autoPlay', type: 'checkbox' },
        { label: 'Auto Pause (on transition out)', key: 'autoPause', type: 'checkbox' },
        { label: 'Auto Restart', key: 'autoRestart', type: 'checkbox' },
        { label: 'Mark In (s)', key: 'markIn', type: 'number', step: 0.1 },
        { label: 'Mark Out (s)', key: 'markOut', type: 'number', step: 0.1 },
        { label: 'On completion', key: 'onEnd', type: 'select', options: [['', 'Do nothing'], ['next', 'Quick Play the Preview input'], ['next-input', 'Quick Play the next input']] }
      ], p));
    }
    if (inp.type === 'title') box.append(U.el('div', { style: { height: '10px' } }), titleFields(inp, st));
    return box;
  }

  function titleFields(inp) {
    const wrap = U.el('div');
    const r = inp.renderer;
    const rows = [{ section: 'Title Fields (changes go live immediately)' }];
    const obj = {};
    for (const e of r.t.elements) {
      if (e.type === 'text' || e.type === 'ticker') { obj[e.id] = e.text; rows.push({ label: e.name, key: e.id, type: e.type === 'ticker' ? 'textarea' : 'text', rows: 2, onChange: (v) => inp.setText(e.id, v) }); }
      if (e.type === 'image') { obj[e.id] = e.src || ''; rows.push({ label: e.name + ' (image)', key: e.id, type: 'file', filters: [{ name: 'Images', extensions: U.IMAGE_EXT }], onChange: (v) => inp.setImage(e.id, v) }); }
      if (e.type === 'countdown') {
        obj[e.id] = e.seconds; rows.push({ label: e.name + ' (seconds)', key: e.id, type: 'number', onChange: (v) => r.setTimer(e, v) });
        rows.push({ custom: U.el('div', { class: 'inline' }, [
          U.el('button', { class: 'btn', text: '▶ Start', onclick: () => r.timerCmd(e.id, 'start') }),
          U.el('button', { class: 'btn', text: '❚❚ Stop', onclick: () => r.timerCmd(e.id, 'stop') }),
          U.el('button', { class: 'btn', text: '↺ Reset', onclick: () => r.timerCmd(e.id, 'reset') }),
          U.el('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [(() => { const cb = U.el('input', { type: 'checkbox' }); cb.checked = !!e.countUp; cb.onchange = () => { e.countUp = cb.checked; }; return cb; })(), 'Count up'])
        ]) });
      }
      if (e.type === 'rect' && /color|bg|box|bar/i.test(e.name)) { obj[e.id + '_c'] = e.fill; rows.push({ label: e.name + ' colour', key: e.id + '_c', type: 'color', onChange: (v) => { e.fill = v; e.fill2 = null; } }); }
    }
    const anim = { inType: r.t.animIn?.type || 'none', inDur: r.t.animIn?.duration || 500, outType: r.t.animOut?.type || 'none', outDur: r.t.animOut?.duration || 400, animate: inp.cfg.animate !== false };
    const types = [['none', 'None'], ['fade', 'Fade'], ['slide-left', 'Slide from left'], ['slide-right', 'Slide from right'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['wipe', 'Wipe'], ['zoom', 'Zoom']];
    const apply = () => { r.t.animIn = { type: anim.inType, duration: anim.inDur }; r.t.animOut = { type: anim.outType, duration: anim.outDur }; inp.cfg.animate = anim.animate; r.animate = anim.animate; };
    wrap.append(F(rows, obj), U.el('div', { style: { height: '10px' } }), F([
      { section: 'Animation' },
      { label: 'Animate in/out', key: 'animate', type: 'checkbox', onChange: apply },
      { label: 'Transition In', key: 'inType', type: 'select', options: types, onChange: apply },
      { label: 'In duration (ms)', key: 'inDur', type: 'number', onChange: apply },
      { label: 'Transition Out', key: 'outType', type: 'select', options: types, onChange: apply },
      { label: 'Out duration (ms)', key: 'outDur', type: 'number', onChange: apply },
      { custom: U.el('div', { class: 'inline' }, [U.el('button', { class: 'btn primary', text: 'Open Title Designer…', onclick: () => BTS.ui.titleDesigner(inp) }), U.el('button', { class: 'btn', text: '▶ Play animation', onclick: () => r.transitionIn() })]) }
    ], anim));
    return wrap;
  }

  function playlistEditor(inp) {
    const list = U.el('div', { class: 'list', style: { minHeight: '140px' } });
    const redraw = () => {
      list.innerHTML = '';
      inp.cfg.items.forEach((it, i) => list.append(U.el('div', { class: 'li' + (i === inp.index ? ' on' : '') }, [
        U.el('span', { text: `${i + 1}.` }), U.el('span', { class: 'grow', text: U.baseName(it.path), title: it.path, ondblclick: () => inp.load(i, inp.playing || inp.live) }),
        U.kindOfFile(it.path) === 'image' ? (() => { const n = U.el('input', { type: 'number', value: it.duration || 5, min: 1, style: { width: '56px' }, title: 'Seconds' }); n.onchange = () => { it.duration = +n.value; }; return n; })() : null,
        U.el('button', { class: 'tbtn small', text: '▶', title: 'Play this item', onclick: () => { inp.load(i, true); redraw(); } }),
        U.el('button', { class: 'tbtn small', text: '▲', onclick: () => { if (i) { [inp.cfg.items[i - 1], inp.cfg.items[i]] = [inp.cfg.items[i], inp.cfg.items[i - 1]]; redraw(); } } }),
        U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { inp.cfg.items.splice(i, 1); redraw(); } })
      ])));
    };
    redraw();
    inp.on('item', redraw);
    const add = U.el('button', { class: 'btn', text: '＋ Add Files…', onclick: async () => {
      const f = await window.bts.dialog.open({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: [...U.VIDEO_EXT, ...U.IMAGE_EXT, ...U.AUDIO_EXT] }] });
      if (f) { inp.cfg.items.push(...f.map(p => ({ path: p, duration: 5 }))); redraw(); if (inp.status === 'error') inp.load(0, false); }
    } });
    return U.el('div', {}, [U.el('div', { style: { marginBottom: '6px' } }, [add]), list]);
  }

  function position(inp) {
    const p = inp.props;
    const presets = U.el('div', { class: 'inline', style: { flexWrap: 'wrap', marginBottom: '10px' } });
    const set = (pos, crop) => { Object.assign(p.position, pos); if (crop) Object.assign(p.crop, crop); refresh(); };
    const P = [
      ['Full', { zoom: 1, panX: 0, panY: 0, rotate: 0 }], ['PiP ↘', { zoom: 0.3, panX: 0.33, panY: 0.32 }], ['PiP ↙', { zoom: 0.3, panX: -0.33, panY: 0.32 }],
      ['PiP ↗', { zoom: 0.3, panX: 0.33, panY: -0.32 }], ['PiP ↖', { zoom: 0.3, panX: -0.33, panY: -0.32 }], ['Left ½', { zoom: 0.5, panX: -0.25, panY: 0 }], ['Right ½', { zoom: 0.5, panX: 0.25, panY: 0 }]
    ];
    for (const [l, v] of P) presets.append(U.el('button', { class: 'btn', text: l, onclick: () => set(v) }));
    presets.append(U.el('button', { class: 'btn', text: 'Reset crop', onclick: () => set({}, { l: 0, r: 0, t: 0, b: 0 }) }));
    const box = U.el('div', {}, [presets]);
    let formEl;
    const refresh = () => { if (formEl) formEl.remove(); formEl = build(); box.append(formEl); };
    const build = () => F([
      { section: 'Position' },
      { label: 'Zoom', key: 'position.zoom', type: 'range', min: 0.05, max: 4, step: 0.01, default: 1 },
      { label: 'Pan X', key: 'position.panX', type: 'range', min: -1, max: 1, step: 0.005, default: 0 },
      { label: 'Pan Y', key: 'position.panY', type: 'range', min: -1, max: 1, step: 0.005, default: 0 },
      { label: 'Rotation', key: 'position.rotate', type: 'range', min: -180, max: 180, step: 0.5, default: 0, unit: '°' },
      { label: 'Fit', key: 'position.fit', type: 'select', options: [['contain', 'Fit (letterbox)'], ['cover', 'Fill (crop)'], ['stretch', 'Stretch']] },
      { label: 'Opacity', key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 1 },
      { section: 'Crop' },
      { label: 'Left', key: 'crop.l', type: 'range', min: 0, max: 0.9, step: 0.001, default: 0 },
      { label: 'Right', key: 'crop.r', type: 'range', min: 0, max: 0.9, step: 0.001, default: 0 },
      { label: 'Top', key: 'crop.t', type: 'range', min: 0, max: 0.9, step: 0.001, default: 0 },
      { label: 'Bottom', key: 'crop.b', type: 'range', min: 0, max: 0.9, step: 0.001, default: 0 },
      { section: 'Border & Shadow (PiP)' },
      { label: 'Border width', key: 'position.borderWidth', type: 'range', min: 0, max: 30, step: 1, default: 0, unit: 'px' },
      { label: 'Border colour', key: 'position.borderColor', type: 'color' },
      { label: 'Corner radius', key: 'position.radius', type: 'range', min: 0, max: 120, step: 1, default: 0, unit: 'px' },
      { label: 'Drop shadow', key: 'position.shadow', type: 'checkbox' },
      { section: 'Orientation' },
      { label: 'Mirror horizontally', key: 'position.flipH', type: 'checkbox' },
      { label: 'Flip vertically', key: 'position.flipV', type: 'checkbox' },
      { label: 'Deinterlace (blend)', key: 'effects.deinterlace', type: 'checkbox' }
    ], p);
    refresh();
    box.append(U.el('p', { class: 'hint', text: 'Double-click a slider to reset it. Use the PiP presets with Overlay channels for picture-in-picture.' }));
    return box;
  }

  const LOOKS = {
    Neutral: {},
    Warm: { temperature: 0.35, saturation: 1.08, gain: { x: 0.12, y: 0.03, m: 0 } },
    Cool: { temperature: -0.35, gain: { x: -0.1, y: -0.08, m: 0 } },
    Cinematic: { contrast: 1.12, saturation: 0.9, lift: { x: -0.25, y: -0.35, m: 0.01 }, gain: { x: 0.18, y: 0.1, m: 0.02 } },
    Vivid: { contrast: 1.08, saturation: 1.35 },
    'Black & White': { saturation: 0, contrast: 1.1 },
    Faded: { contrast: 0.85, lift: { x: 0, y: 0, m: 0.06 }, saturation: 0.8 },
    'Stage lights fix': { temperature: -0.2, gain: { x: -0.05, y: 0, m: -0.08 }, gammaW: { x: 0, y: 0, m: -0.05 } }
  };
  const CC_KEYS = ['brightness', 'contrast', 'saturation', 'hue', 'gamma', 'temperature', 'tint', 'lift', 'gammaW', 'gain'];
  const CC_DEF = { brightness: 0, contrast: 1, saturation: 1, hue: 0, gamma: 1, temperature: 0, tint: 0, lift: { x: 0, y: 0, m: 0 }, gammaW: { x: 0, y: 0, m: 0 }, gain: { x: 0, y: 0, m: 0 } };

  /** A colour wheel control: drag the puck to tint, slider underneath for the master (luma) level. */
  function wheel(label, obj, key, range) {
    obj[key] = obj[key] || { x: 0, y: 0, m: 0 };
    const S = 120, R = 54;
    const c = U.el('canvas', { width: S, height: S, class: 'cw-canvas', title: 'Drag to tint · double-click to reset' });
    const ctx = c.getContext('2d');
    const draw = () => {
      ctx.clearRect(0, 0, S, S);
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = (x - S / 2) / R, dy = (S / 2 - y) / R, r = Math.hypot(dx, dy);
        if (r > 1) continue;
        const rgb = BTS.GLProcessor.wheelRGB({ x: dx, y: dy }).map(v => Math.round((0.45 + v * 0.45) * 255));
        const i = (y * S + x) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S / 2 - 6, S / 2); ctx.lineTo(S / 2 + 6, S / 2); ctx.moveTo(S / 2, S / 2 - 6); ctx.lineTo(S / 2, S / 2 + 6); ctx.stroke();
      const v = obj[key]; const px = S / 2 + v.x * R, py = S / 2 - v.y * R;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.lineWidth = 1;
    };
    const set = (e) => { const r = c.getBoundingClientRect(); let x = ((e.clientX - r.left) * S / r.width - S / 2) / R, y = (S / 2 - (e.clientY - r.top) * S / r.height) / R; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } obj[key].x = +x.toFixed(3); obj[key].y = +y.toFixed(3); draw(); };
    c.addEventListener('pointerdown', (e) => { try { c.setPointerCapture(e.pointerId); } catch { /* noop */ } set(e); const mv = (ev) => set(ev); const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); }; c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up); });
    c.addEventListener('dblclick', () => { obj[key] = { x: 0, y: 0, m: 0 }; m.value = 0; draw(); });
    const m = U.el('input', { type: 'range', min: -range, max: range, step: range / 100, value: obj[key].m, title: 'Master level (double-click resets)' });
    m.oninput = () => { obj[key].m = +m.value; };
    m.ondblclick = () => { m.value = 0; obj[key].m = 0; };
    draw();
    const el = U.el('div', { class: 'cw' }, [U.el('div', { class: 'cw-label', text: label }), c, m]);
    el._redraw = () => { m.value = obj[key].m || 0; draw(); };
    return el;
  }

  function colour(inp) {
    const fx = inp.props.effects;
    const c = fx.color;
    for (const k of ['lift', 'gammaW', 'gain']) c[k] = c[k] || { x: 0, y: 0, m: 0 };
    const box = U.el('div');
    let wheels = [], formEl;
    const rebuild = () => {
      box.innerHTML = '';
      const en = U.el('label', { class: 'rp-row' }, [(() => { const cb = U.el('input', { type: 'checkbox' }); cb.checked = !!c.enabled; cb.onchange = () => { c.enabled = cb.checked; }; return cb; })(), ' Enable colour correction']);
      const looks = U.el('select'); looks.append(U.el('option', { value: '', text: 'Apply a look…' }));
      for (const k of Object.keys(LOOKS)) looks.append(U.el('option', { value: k, text: k }));
      looks.onchange = () => { if (!looks.value) return; Object.assign(c, U.deepClone(CC_DEF), U.deepClone(LOOKS[looks.value]), { enabled: true }); rebuild(); };
      const bar = U.el('div', { class: 'rp-row' }, [en, U.el('span', { class: 'spacer' }), looks,
        U.el('button', { class: 'btn', text: 'Save preset…', onclick: async () => { const f = await window.bts.dialog.save({ defaultPath: inp.title + '.btscolor', filters: [{ name: 'BTS colour preset', extensions: ['btscolor'] }] }); if (!f) return; const data = { app: 'BTS Studio colour', color: Object.fromEntries(CC_KEYS.map(k => [k, c[k]])), sharpen: fx.sharpen || 0 }; await window.bts.project.write(f, data); U.toast('Colour preset saved', 'ok'); } }),
        U.el('button', { class: 'btn', text: 'Load preset…', onclick: async () => { const f = await window.bts.dialog.open({ filters: [{ name: 'BTS colour preset', extensions: ['btscolor', 'json'] }] }); if (!f) return; try { const d = JSON.parse(await window.bts.file.readText(f[0])); Object.assign(c, U.deepClone(CC_DEF), d.color || {}, { enabled: true }); fx.sharpen = d.sharpen || 0; rebuild(); U.toast('Colour preset loaded', 'ok'); } catch (e) { U.toast('Not a colour preset: ' + e.message, 'error'); } } }),
        U.el('button', { class: 'btn', text: 'Copy to all cameras', title: 'Apply this grade to every camera / capture input (matching)', onclick: () => { let n = 0; for (const i of BTS.studio.inputs) if (i !== inp && ['camera', 'stream'].includes(i.type)) { i.props.effects.color = U.deepClone(c); i.props.effects.sharpen = fx.sharpen; n++; } U.toast(`Copied to ${n} camera input(s)`, 'ok'); } }),
        U.el('button', { class: 'btn', text: 'Reset', onclick: () => { Object.assign(c, U.deepClone(CC_DEF)); fx.sharpen = 0; rebuild(); } })
      ]);
      wheels = [wheel('LIFT (shadows)', c, 'lift', 0.25), wheel('GAMMA (mid-tones)', c, 'gammaW', 0.5), wheel('GAIN (highlights)', c, 'gain', 0.5)];
      formEl = F([
        { section: 'Basic' },
        { label: 'Brightness', key: 'brightness', type: 'range', min: -0.5, max: 0.5, step: 0.005, default: 0 },
        { label: 'Contrast', key: 'contrast', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
        { label: 'Saturation', key: 'saturation', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
        { label: 'Hue', key: 'hue', type: 'range', min: -180, max: 180, step: 1, default: 0, unit: '°' },
        { label: 'Gamma', key: 'gamma', type: 'range', min: 0.3, max: 2.5, step: 0.01, default: 1 },
        { label: 'Temperature', key: 'temperature', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
        { label: 'Tint', key: 'tint', type: 'range', min: -1, max: 1, step: 0.01, default: 0 }
      ], c);
      const sh = F([{ section: 'Detail' }, { label: 'Sharpen', key: 'sharpen', type: 'range', min: 0, max: 2, step: 0.05, default: 0 }], fx);
      box.append(bar, U.el('div', { class: 'cw-row' }, wheels), formEl, sh,
        U.el('p', { class: 'hint', text: 'GPU-accelerated, applied live. Open the Scopes module (Modules → Scopes) to grade by numbers. Presets save as .btscolor files you can share between computers.' }));
    };
    rebuild();
    return box;
  }

  function keying(inp) {
    const ck = inp.props.effects.chroma, lk = inp.props.effects.luma;
    const pickBtn = U.el('button', { class: 'btn', text: 'Pick colour from input', onclick: () => {
      const f = inp.getFrame(); if (!f) return;
      const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const ctx = c.getContext('2d'); ctx.drawImage(f.src, 0, 0, 64, 36);
      const d = ctx.getImageData(2, 2, 6, 6).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4; ck.color = '#' + [r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('');
      ck.enabled = true; U.toast('Key colour sampled from top-left corner: ' + ck.color, 'ok');
    } });
    return U.el('div', {}, [F([
      { section: 'Chroma Key' },
      { label: 'Enable', key: 'enabled', type: 'checkbox' },
      { label: 'Key colour', key: 'color', type: 'color' },
      { custom: U.el('div', { class: 'inline' }, [
        U.el('button', { class: 'btn', text: 'Green', onclick: () => { ck.color = '#00ff00'; ck.enabled = true; } }),
        U.el('button', { class: 'btn', text: 'Blue', onclick: () => { ck.color = '#0000ff'; ck.enabled = true; } }), pickBtn]) },
      { label: 'Similarity', key: 'similarity', type: 'range', min: 1, max: 1000, step: 1, default: 400 },
      { label: 'Smoothness', key: 'smoothness', type: 'range', min: 1, max: 1000, step: 1, default: 80 },
      { label: 'Spill reduction', key: 'spill', type: 'range', min: 1, max: 1000, step: 1, default: 100 }
    ], ck), U.el('div', { style: { height: '12px' } }), F([
      { section: 'Luma Key' },
      { label: 'Enable', key: 'enabled', type: 'checkbox' },
      { label: 'Low', key: 'low', type: 'range', min: 0, max: 1, step: 0.005, default: 0 },
      { label: 'High', key: 'high', type: 'range', min: 0, max: 1, step: 0.005, default: 0.15 },
      { label: 'Softness', key: 'smooth', type: 'range', min: 0, max: 0.3, step: 0.005, default: 0.03 },
      { label: 'Key out range (invert)', key: 'invert', type: 'checkbox', hint: 'Checked: pixels between Low–High become transparent (e.g. remove black).' }
    ], lk)]);
  }

  function audio(inp, st) {
    const ch = inp.channel, s = ch.s;
    const apply = () => { ch.apply(); st.emit('mixer-values'); };
    return U.el('div', {}, [F([
      { section: 'Level' },
      { label: 'Volume', key: 'volume', type: 'range', min: 0, max: 3.16, step: 0.01, default: 1, format: v => { const d = U.db(v); return d === -Infinity ? '-∞ dB' : d.toFixed(1) + ' dB'; }, onChange: apply },
      { label: 'Gain (trim)', key: 'trimDb', type: 'range', min: -20, max: 24, step: 0.5, default: 0, unit: ' dB', onChange: apply },
      { label: 'Balance', key: 'balance', type: 'range', min: -1, max: 1, step: 0.01, default: 0, onChange: apply },
      { label: 'Delay (lip-sync)', key: 'delayMs', type: 'range', min: 0, max: 2000, step: 10, default: 0, unit: ' ms', onChange: apply },
      { label: 'Muted', key: 'muted', type: 'checkbox', onChange: apply },
      { label: 'Audio follows video', key: 'followVideo', type: 'checkbox', onChange: apply },
      { section: 'Routing' },
      { label: 'Master', key: 'buses.M', type: 'checkbox', onChange: apply },
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(b => ({ label: 'Bus ' + b, key: 'buses.' + b, type: 'checkbox', onChange: () => { apply(); BTS.studio.emit('mixer'); } })),
      { section: 'Equaliser (3-band)' },
      { label: 'Enable EQ', key: 'eq.enabled', type: 'checkbox', onChange: apply },
      { label: 'Low (120 Hz)', key: 'eq.low', type: 'range', min: -15, max: 15, step: 0.5, default: 0, unit: ' dB', onChange: apply },
      { label: 'Mid (1.2 kHz)', key: 'eq.mid', type: 'range', min: -15, max: 15, step: 0.5, default: 0, unit: ' dB', onChange: apply },
      { label: 'High (8 kHz)', key: 'eq.high', type: 'range', min: -15, max: 15, step: 0.5, default: 0, unit: ' dB', onChange: apply },
      { section: 'Dynamics' },
      { label: 'Compressor', key: 'comp.enabled', type: 'checkbox', onChange: apply },
      { label: 'Threshold', key: 'comp.threshold', type: 'range', min: -60, max: 0, step: 1, default: -18, unit: ' dB', onChange: apply },
      { label: 'Ratio', key: 'comp.ratio', type: 'range', min: 1, max: 20, step: 0.5, default: 3, unit: ':1', onChange: apply },
      { label: 'Noise gate', key: 'gate.enabled', type: 'checkbox', onChange: apply },
      { label: 'Gate threshold', key: 'gate.threshold', type: 'range', min: -90, max: -10, step: 1, default: -50, unit: ' dB', onChange: apply }
    ], s)]);
  }

  /** Scene Layers: drag-on-screen Layer Designer + numeric table + layout presets */
  function layers(inp, st) {
    const box = U.el('div');
    let sel = 0;
    const SW = 640, SH = Math.round(640 * st.H / st.W);
    const stage = U.el('canvas', { width: SW, height: SH, class: 'ld-stage', title: 'Drag a layer to move · drag a corner to resize (Shift keeps proportions) · arrow keys nudge · Alt+drag snaps off' });
    const sctx = stage.getContext('2d');
    const tableBox = U.el('div');
    const snap = (v) => (dragSnap ? Math.round(v * 40) / 40 : v);
    let drag = null, dragSnap = true;
    const L = () => inp.cfg.layers;
    const hit = (x, y) => { for (let i = L().length - 1; i >= 0; i--) { const l = L()[i]; if (l.visible === false) continue; if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return i; } return -1; };
    const corner = (x, y) => { const l = L()[sel]; if (!l) return null; const tol = 10 / SW; for (const [cx, cy, k] of [[l.x, l.y, 'tl'], [l.x + l.w, l.y, 'tr'], [l.x, l.y + l.h, 'bl'], [l.x + l.w, l.y + l.h, 'br']]) if (Math.abs(x - cx) < tol && Math.abs(y - cy) < tol * SW / SH) return k; return null; };
    const pos = (e) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    stage.addEventListener('pointerdown', (e) => {
      try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } stage.focus();
      const [x, y] = pos(e); dragSnap = !e.altKey;
      const c = corner(x, y);
      if (c) drag = { mode: c, x, y, l0: { ...L()[sel] } };
      else { const i = hit(x, y); if (i >= 0) { sel = i; drag = { mode: 'move', x, y, l0: { ...L()[i] } }; drawTable(); } }
    });
    stage.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      stage.style.cursor = corner(x, y) ? 'nwse-resize' : hit(x, y) >= 0 ? 'move' : 'default';
      if (!drag) return;
      const l = L()[sel], o = drag.l0, dx = x - drag.x, dy = y - drag.y;
      if (drag.mode === 'move') { l.x = snap(o.x + dx); l.y = snap(o.y + dy); }
      else {
        let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
        if (drag.mode.includes('l')) x1 = snap(o.x + dx); else x2 = snap(x2 + dx);
        if (drag.mode.includes('t')) y1 = snap(o.y + dy); else y2 = snap(y2 + dy);
        let w = Math.max(0.02, x2 - x1), h = Math.max(0.02, y2 - y1);
        if (e.shiftKey) { h = w * (o.h / o.w); if (drag.mode.includes('t')) y1 = y2 - h; }
        l.x = x1; l.y = y1; l.w = w; l.h = h;
      }
    });
    stage.addEventListener('pointerup', () => { if (drag) { drag = null; drawTable(); } });
    stage.tabIndex = 0;
    stage.addEventListener('keydown', (e) => {
      const l = L()[sel]; if (!l) return;
      const d = e.shiftKey ? 0.05 : 0.005;
      if (e.key === 'ArrowLeft') l.x -= d; else if (e.key === 'ArrowRight') l.x += d; else if (e.key === 'ArrowUp') l.y -= d; else if (e.key === 'ArrowDown') l.y += d;
      else if (e.key === 'Delete') { L().splice(sel, 1); sel = 0; st._updateLive(); drawTable(); } else return;
      e.preventDefault(); e.stopPropagation(); drawTable();
    });
    let raf;
    const paint = () => {
      if (!box.isConnected && box._mounted) return;
      if (box.isConnected) box._mounted = true;
      sctx.fillStyle = '#000'; sctx.fillRect(0, 0, SW, SH);
      const f = inp.getFrame(); if (f) sctx.drawImage(f.src, 0, 0, SW, SH);
      // title-safe guides
      sctx.strokeStyle = 'rgba(255,255,255,.15)'; sctx.setLineDash([4, 4]); sctx.strokeRect(SW * 0.05, SH * 0.05, SW * 0.9, SH * 0.9); sctx.setLineDash([]);
      L().forEach((l, i) => {
        const x = l.x * SW, y = l.y * SH, w = l.w * SW, h = l.h * SH, on = i === sel;
        sctx.strokeStyle = on ? '#f5a524' : 'rgba(255,255,255,.5)'; sctx.lineWidth = on ? 2 : 1; sctx.strokeRect(x, y, w, h);
        sctx.fillStyle = on ? '#f5a524' : 'rgba(0,0,0,.6)'; sctx.font = '700 11px Segoe UI'; const t = `${i + 1} ${st.byId(l.inputId)?.title || '?'}`;
        sctx.fillRect(x, y, sctx.measureText(t).width + 8, 16); sctx.fillStyle = on ? '#1a1203' : '#fff'; sctx.fillText(t, x + 4, y + 12);
        if (on) for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { sctx.fillStyle = '#f5a524'; sctx.fillRect(cx - 4, cy - 4, 8, 8); }
      });
      raf = requestAnimationFrame(paint);
    };
    const PRESETS = {
      'PiP ↘': [[0, 0, 1, 1], [0.66, 0.62, 0.3, 0.3]], 'PiP ↖': [[0, 0, 1, 1], [0.04, 0.06, 0.3, 0.3]],
      'Side by side': [[0, 0.25, 0.5, 0.5], [0.5, 0.25, 0.5, 0.5]], 'Over-the-shoulder': [[0, 0, 1, 1], [0.06, 0.12, 0.42, 0.42]],
      '2×2 grid': [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
      '1 + 2': [[0.02, 0.17, 0.64, 0.64], [0.68, 0.17, 0.3, 0.3], [0.68, 0.51, 0.3, 0.3]],
      '3 across': [[0, 0.33, 0.333, 0.333], [0.333, 0.33, 0.334, 0.333], [0.667, 0.33, 0.333, 0.333]],
      'Interview (2 boxes)': [[0.04, 0.2, 0.44, 0.6], [0.52, 0.2, 0.44, 0.6]]
    };
    const presetSel = U.el('select'); presetSel.append(U.el('option', { value: '', text: 'Arrange layers as…' }));
    for (const k of Object.keys(PRESETS)) presetSel.append(U.el('option', { value: k, text: k }));
    presetSel.onchange = () => { const p = PRESETS[presetSel.value]; if (!p) return; p.forEach((r, i) => { if (L()[i]) Object.assign(L()[i], { x: r[0], y: r[1], w: r[2], h: r[3] }); }); presetSel.value = ''; drawTable(); };
    const drawTable = () => {
      tableBox.innerHTML = '';
      const opts = st.inputs.filter(i => i !== inp && !(i.containsInput && i.containsInput(inp.id)));
      const tbl = U.el('table', { class: 'tbl' });
      tbl.append(U.el('tr', {}, ['#', 'Input', 'X', 'Y', 'W', 'H', 'Opacity', 'On', ''].map(h => U.el('th', { text: h }))));
      L().forEach((l, i) => {
        const s2 = U.el('select'); for (const o of opts) s2.append(U.el('option', { value: o.id, text: `${o.number}. ${o.title}`, selected: o.id === l.inputId }));
        s2.onchange = () => { l.inputId = s2.value; st._updateLive(); };
        const n = (k, def) => { const e = U.el('input', { type: 'number', step: 0.01, min: -1, max: 2, value: (+(l[k] ?? def)).toFixed(3), style: { width: '64px' } }); e.oninput = () => { l[k] = +e.value; }; e.onkeydown = (ev) => ev.stopPropagation(); return e; };
        const on = U.el('input', { type: 'checkbox' }); on.checked = l.visible !== false; on.onchange = () => { l.visible = on.checked; st._updateLive(); };
        const row = U.el('tr', { class: i === sel ? 'sel' : '', onclick: () => { sel = i; drawTable(); } }, [U.el('td', { text: String(i + 1) }), U.el('td', {}, [s2]), U.el('td', {}, [n('x', 0)]), U.el('td', {}, [n('y', 0)]), U.el('td', {}, [n('w', 1)]), U.el('td', {}, [n('h', 1)]), U.el('td', {}, [n('opacity', 1)]), U.el('td', {}, [on]),
          U.el('td', {}, [U.el('button', { class: 'tbtn small', text: '▲', title: 'Move down (behind)', onclick: (e) => { e.stopPropagation(); if (i) { [L()[i - 1], L()[i]] = [L()[i], L()[i - 1]]; sel = i - 1; drawTable(); } } }), U.el('button', { class: 'tbtn small', text: '✕', onclick: (e) => { e.stopPropagation(); L().splice(i, 1); sel = Math.max(0, sel - 1); st._updateLive(); drawTable(); } })])]);
        tbl.append(row);
      });
      tableBox.append(tbl);
    };
    box.append(stage, U.el('div', { class: 'rp-row' }, [
      U.el('button', { class: 'btn', text: '＋ Add layer', onclick: () => { const opts = st.inputs.filter(i => i !== inp && !(i.containsInput && i.containsInput(inp.id))); if (L().length >= 10) return U.toast('Maximum 10 layers', 'error'); if (!opts[0]) return U.toast('Add other inputs first', 'error'); L().push({ inputId: (st.preview && st.preview !== inp ? st.preview.id : opts[0].id), x: 0.6, y: 0.6, w: 0.35, h: 0.35, visible: true }); sel = L().length - 1; st._updateLive(); drawTable(); } }),
      presetSel,
      U.el('span', { class: 'hint', text: 'Drag on the picture to move / resize. Shift = keep proportions, Alt = no snapping, arrows = nudge.' })
    ]), tableBox);
    drawTable();
    paint();
    return box;
  }

  function mixTab(inp, st) {
    const box = U.el('div');
    const mons = U.el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' } });
    const pv = U.el('canvas', { width: 480, height: 270, style: { width: '100%', background: '#000', borderRadius: '4px', outline: '2px solid var(--pvw)' } });
    const pg = U.el('canvas', { width: 480, height: 270, style: { width: '100%', background: '#000', borderRadius: '4px', outline: '2px solid var(--pgm)' } });
    mons.append(U.el('div', {}, [U.el('div', { class: 'hint', text: 'MIX PREVIEW' }), pv]), U.el('div', {}, [U.el('div', { class: 'hint', text: 'MIX OUTPUT' }), pg]));
    const tr = U.el('select'); for (const t of BTS.Transitions.list.filter(t => !t.id.startsWith('Stinger'))) tr.append(U.el('option', { value: t.id, text: t.name, selected: t.id === inp.cfg.transition }));
    tr.onchange = () => { inp.cfg.transition = tr.value; };
    const dur = U.el('input', { type: 'number', value: inp.cfg.duration, min: 0, step: 100, style: { width: '80px' } }); dur.onchange = () => { inp.cfg.duration = +dur.value || 0; };
    const ctl = U.el('div', { class: 'rp-row' }, [
      U.el('button', { class: 'btn primary', text: 'Transition ▶', onclick: () => inp.transition() }),
      U.el('button', { class: 'btn', text: 'Cut', onclick: () => inp.cut() }), tr, dur, U.el('span', { class: 'hint', text: 'ms' })
    ]);
    const grid = U.el('div', { class: 'grid-cards', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } });
    const drawGrid = () => {
      grid.innerHTML = '';
      for (const i of st.inputs.filter(x => inp._ok(x))) {
        const on = i.id === inp.cfg.programId, pvw = i.id === inp.cfg.previewId;
        grid.append(U.el('div', { class: 'type-card' + (on ? ' on' : ''), style: { padding: '6px', borderColor: on ? 'var(--pgm)' : pvw ? 'var(--pvw)' : '' } }, [
          U.el('div', { class: 'lbl', text: `${i.number}. ${i.title}`, style: { fontSize: '11px', marginBottom: '4px' } }),
          U.el('div', { class: 'rp-row', style: { justifyContent: 'center', margin: 0 } }, [
            U.el('button', { class: 'tbtn small', text: 'PVW', onclick: () => inp.setPreview(i.id) }),
            U.el('button', { class: 'tbtn small', text: 'Cut', onclick: () => inp.cut(i.id) }),
            U.el('button', { class: 'tbtn small', text: 'Fade', onclick: () => inp.transition(inp.cfg.transition, inp.cfg.duration, i.id) })
          ])
        ]));
      }
    };
    drawGrid();
    inp.on('mix', drawGrid);
    let raf;
    const loop = () => {
      if (!box.isConnected) { raf = requestAnimationFrame(loop); if (!document.body.contains(box) && box._started) return cancelAnimationFrame(raf); return; }
      box._started = true;
      pv.getContext('2d').drawImage(inp.drawPreview(), 0, 0, 480, 270);
      const f = inp.getFrame(); const g = pg.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 480, 270); if (f) g.drawImage(f.src, 0, 0, 480, 270);
      raf = requestAnimationFrame(loop);
    };
    loop();
    box.append(mons, ctl, U.el('div', { class: 'hint', text: 'SOURCES', style: { margin: '10px 0 4px' } }), grid,
      U.el('p', { class: 'hint', text: 'API: MixPreviewInput / MixCut / MixFade with Input = this Mix and Value = source input.' }));
    return box;
  }

  function delayTab(inp) {
    const o = { delayMs: inp.cfg.delayMs, height: inp.cfg.height };
    const info = U.el('div', { class: 'hint' });
    const iv = setInterval(() => { if (!info.isConnected) return; info.textContent = `Buffered ${inp.buffered.toFixed(1)} s · ${inp.ring.length} frames`; }, 500);
    setTimeout(() => { if (!info.isConnected) clearInterval(iv); }, 600000);
    return U.el('div', {}, [BTS.Dialog.form([
      { label: 'Delay (ms)', key: 'delayMs', type: 'number', min: 40, max: 10000, step: 40, onChange: (v) => { inp.cfg.delayMs = U.clamp(v, 40, 10000); if (inp.channel) inp.channel.set({ delayMs: inp.cfg.delayMs }); } },
      { label: 'Quality', key: 'height', type: 'select', number: true, options: [[360, '360p'], [540, '540p'], [720, '720p'], [1080, '1080p']], onChange: (v) => { inp.cfg.height = v; } }
    ], o), info]);
  }

  /* ---------- Slides ---------- */
  function slidesTab(inp) {
    const box = U.el('div');
    const grid = U.el('div', { class: 'slide-grid' });
    const info = U.el('span', { class: 'hint' });
    const o = inp.cfg;
    const reinit = () => { inp.init().then(draw); };
    const nav = U.el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '0 0 8px' } }, [
      U.el('button', { class: 'btn', text: '⏮ First', onclick: () => inp.load(0) }),
      U.el('button', { class: 'btn', text: '◀ Previous', onclick: () => inp.prev() }),
      U.el('button', { class: 'btn primary', text: 'Next ▶', onclick: () => inp.next() }),
      U.el('button', { class: 'btn', text: '⟳ Reload', title: 'Re-open the file (after editing the deck)', onclick: reinit }),
      U.el('span', { style: { flex: 1 } }), info
    ]);
    const mark = () => { info.textContent = inp.count ? `Slide ${inp.index + 1} / ${inp.count}` : (inp.statusMsg || ''); U.$$('.slide-th', grid).forEach((t, i) => t.classList.toggle('on', i === inp.index)); const cur = grid.children[inp.index]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' }); };
    function draw() {
      grid.innerHTML = '';
      for (let i = 0; i < inp.count; i++) {
        const img = U.el('img', { alt: '' });
        const t = U.el('div', { class: 'slide-th', onclick: () => inp.load(i) }, [img, U.el('span', { text: String(i + 1) })]);
        grid.append(t);
      }
      // thumbnails rendered progressively so huge decks stay responsive
      let i = 0;
      const step = () => { if (!grid.isConnected && i > 0) return; if (i >= inp.count) return; const k = i++; inp.thumbnail(k).then(u => { const im = grid.children[k]?.querySelector('img'); if (im) im.src = u; }).catch(() => {}).finally(() => setTimeout(step, 0)); };
      step();
      mark();
    }
    const offItem = inp.on('item', mark);
    const offSt = inp.on('status', () => { if (inp.status === 'ok') draw(); else mark(); });
    const iv = setInterval(() => { if (!box.isConnected && box._shown) { offItem(); offSt(); clearInterval(iv); } if (box.isConnected) box._shown = true; }, 1000);
    box.append(BTS.Dialog.form([
      { label: 'File', key: 'path', type: 'file', filters: [{ name: 'Presentations', extensions: U.SLIDES_EXT }], onChange: () => { o.folder = ''; inp.index = 0; reinit(); } },
      { label: 'or image folder', key: 'folder', type: 'file', folder: true, onChange: () => { o.path = ''; inp.index = 0; reinit(); } },
      { label: 'Transition', key: 'transition', type: 'select', options: [['cut', 'Cut'], ['fade', 'Fade'], ['slide', 'Slide (push)']] },
      { label: 'Transition (ms)', key: 'transitionMs', type: 'number', min: 0, max: 3000, step: 50 },
      { label: 'Auto-advance when live', key: 'autoAdvance', type: 'checkbox' },
      { label: 'Seconds per slide', key: 'slideSeconds', type: 'number', min: 1, max: 600 },
      { label: 'Loop', key: 'loop', type: 'checkbox' },
      { label: 'Transparent PDF background', key: 'transparent', type: 'checkbox', onChange: reinit }
    ], o), nav, grid);
    if (inp.status === 'ok') setTimeout(draw, 0); else mark();
    return box;
  }

  /* ---------- Remote Guest ---------- */
  function guestTab(inp) {
    const box = U.el('div');
    const links = U.el('div', { class: 'list' });
    const status = U.el('div', { class: 'guest-status' });
    const chat = U.el('div', { class: 'guest-chat' });
    const msg = U.el('input', { type: 'text', placeholder: 'Message to guest…', maxlength: 300, style: { flex: 1 } });
    const send = () => { const t = msg.value.trim(); if (!t) return; if (!inp.sendChat(t)) U.toast('No guest connected', 'error'); msg.value = ''; };
    msg.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    const drawLinks = async () => {
      links.innerHTML = '<div class="li hint">Starting guest server…</div>';
      try {
        const urls = await inp.links();
        links.innerHTML = '';
        for (const u of urls) {
          const local = /localhost/.test(u);
          links.append(U.el('div', { class: 'li' }, [
            U.el('span', { class: 'grow mono', text: u, title: local ? 'This computer only — for testing' : 'Send this link to the guest' }),
            local ? U.el('span', { class: 'hint', text: 'this PC' }) : null,
            U.el('button', { class: 'tbtn small', text: 'Copy', onclick: () => { navigator.clipboard.writeText(u); U.toast('Link copied'); } }),
            U.el('button', { class: 'tbtn small', text: 'Open', onclick: () => window.bts.shell.open(u) })
          ]));
        }
      } catch (e) { links.innerHTML = ''; links.append(U.el('div', { class: 'li', style: { color: 'var(--danger, #e2453c)' }, text: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })); }
    };
    const drawStatus = () => {
      const g = inp.guest;
      status.innerHTML = '';
      status.append(g
        ? U.el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
          U.el('span', { class: 'dot ' + (inp.pc && inp.pc.connectionState === 'connected' ? 'ok' : 'wait') }),
          U.el('b', { text: g.name }), U.el('span', { class: 'hint', text: `${g.ip || ''} · ${inp.pc ? inp.pc.connectionState : ''}${g.mic === false ? ' · mic muted' : ''}` }),
          U.el('span', { style: { flex: 1 } }),
          U.el('button', { class: 'btn danger', text: 'Hang up', onclick: () => inp.hangup(true) })
        ])
        : U.el('div', { class: 'hint', text: 'No guest connected — send one of the links below.' }));
    };
    const drawChat = () => { chat.innerHTML = ''; for (const m of inp.chat.slice(-50)) chat.append(U.el('div', {}, [U.el('b', { text: m.from + ': ' }), m.text])); chat.scrollTop = 1e9; };
    const offs = [inp.on('state', drawStatus), inp.on('status', drawStatus), inp.on('chat', drawChat)];
    const iv = setInterval(() => { if (box._shown && !box.isConnected) { offs.forEach(f => f()); clearInterval(iv); } if (box.isConnected) box._shown = true; }, 1000);
    const o = inp.cfg;
    box.append(status, U.el('h4', { text: 'Guest links' }), links,
      U.el('p', { class: 'hint', text: 'Use the address on the same network as the guest. The page uses a self-signed certificate — the guest taps Advanced → Continue once.' }),
      BTS.Dialog.form([
        { label: 'Password', key: 'password', placeholder: 'None', onChange: () => BTS.Guests.add(inp) },
        { label: 'Return feed', key: 'returnSource', type: 'select', options: [['program', 'Program output'], ['preview', 'Preview'], ['multiview', 'Multiview']] },
        { label: 'Return bitrate (kbps)', key: 'returnKbps', type: 'number', min: 300, max: 6000, step: 100 },
        { label: 'Use guest name as title', key: 'autoTitle', type: 'checkbox' }
      ], o),
      U.el('div', { style: { display: 'flex', gap: '8px', margin: '8px 0' } }, [
        U.el('button', { class: 'btn', text: '🔑 New link', title: 'Invalidate the old link and make a new one', onclick: () => { BTS.Guests.remove(inp); inp.hangup(true); inp.cfg.key = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); BTS.Guests.add(inp).then(drawLinks); } })
      ]),
      U.el('h4', { text: 'Chat' }), chat, U.el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } }, [msg, U.el('button', { class: 'btn', text: 'Send', onclick: send })]));
    drawStatus(); drawChat(); drawLinks();
    return box;
  }

  /* ---------- Web browser: interactive ---------- */
  const KEYMAP = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Escape: 'Escape', Enter: 'Return' };
  function browserTab(inp) {
    const box = U.el('div');
    const url = U.el('input', { type: 'text', value: inp.cfg.url || '', style: { flex: 1 }, spellcheck: false });
    const go = () => { let u = url.value.trim(); if (!u) return; inp.update({ url: u }); };
    url.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    const nav = (a) => window.bts.browser.nav(inp.id, a).then(r => { if (r) url.value = r.url; });
    const cv = U.el('canvas', { class: 'browser-live', tabindex: 0 });
    const g = cv.getContext('2d');
    const W = () => inp.cfg.width || inp.app.W, H = () => inp.cfg.height || inp.app.H;
    let raf = 0;
    const loop = () => {
      if (!box.isConnected && box._shown) return;
      if (box.isConnected) box._shown = true;
      if (cv.width !== W()) { cv.width = W(); cv.height = H(); }
      if (inp.last) { g.clearRect(0, 0, cv.width, cv.height); g.drawImage(inp.canvas, 0, 0, cv.width, cv.height); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) / r.width * W()), y: Math.round((e.clientY - r.top) / r.height * H()) }; };
    const mods = (e) => [e.shiftKey && 'shift', e.ctrlKey && 'control', e.altKey && 'alt', e.metaKey && 'meta'].filter(Boolean);
    const btn = (e) => ['left', 'middle', 'right'][e.button] || 'left';
    const send = (ev) => window.bts.browser.input(inp.id, ev);
    cv.addEventListener('mousedown', (e) => { cv.focus(); e.preventDefault(); send({ type: 'mouseDown', ...pt(e), button: btn(e), clickCount: e.detail || 1, modifiers: mods(e) }); });
    cv.addEventListener('mouseup', (e) => send({ type: 'mouseUp', ...pt(e), button: btn(e), clickCount: e.detail || 1, modifiers: mods(e) }));
    cv.addEventListener('mousemove', (e) => send({ type: 'mouseMove', ...pt(e), modifiers: mods(e) }));
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => { e.preventDefault(); send({ type: 'mouseWheel', ...pt(e), deltaX: -e.deltaX, deltaY: -e.deltaY, canScroll: true, modifiers: mods(e) }); }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const kc = KEYMAP[e.key] || e.key;
      send({ type: 'keyDown', keyCode: kc, modifiers: mods(e) });
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) send({ type: 'char', keyCode: e.key, modifiers: mods(e) });
    });
    cv.addEventListener('keyup', (e) => { e.preventDefault(); e.stopPropagation(); send({ type: 'keyUp', keyCode: KEYMAP[e.key] || e.key, modifiers: mods(e) }); });
    box.append(
      U.el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
        U.el('button', { class: 'tbtn', text: '◀', title: 'Back', onclick: () => nav('back') }),
        U.el('button', { class: 'tbtn', text: '▶', title: 'Forward', onclick: () => nav('forward') }),
        U.el('button', { class: 'tbtn', text: '⟳', title: 'Reload', onclick: () => inp.reload() }),
        url, U.el('button', { class: 'btn primary', text: 'Go', onclick: go }),
        U.el('button', { class: 'tbtn', text: 'DevTools', onclick: () => window.bts.browser.devtools(inp.id) })
      ]),
      cv,
      U.el('p', { class: 'hint', text: 'Click, scroll and type directly on the page above — e.g. log in to a social-media comments dashboard, start a web scoreboard, or click through a web presentation. What you see here is what goes to air.' })
    );
    return box;
  }

  BTS.InputSettings = { open };
})(window.BTS);
