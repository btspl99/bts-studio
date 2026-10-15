'use strict';
/** Input Settings — General, Position/Crop, Colour, Keying, Audio, Layers (scene). Changes apply live. */
(function (BTS) {
  const U = BTS.U;
  const F = (...a) => BTS.Dialog.form(...a);

  function open(inp, tab = 'general') {
    const st = BTS.studio;
    const tabs = [{ id: 'general', label: 'General', el: general(inp, st) }];
    if (inp.type === 'scene') tabs.push({ id: 'layers', label: 'Layers', el: layers(inp, st) });
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

  function colour(inp) {
    const c = inp.props.effects.color;
    return U.el('div', {}, [F([
      { label: 'Enable', key: 'enabled', type: 'checkbox' },
      { label: 'Brightness', key: 'brightness', type: 'range', min: -0.5, max: 0.5, step: 0.005, default: 0 },
      { label: 'Contrast', key: 'contrast', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
      { label: 'Saturation', key: 'saturation', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
      { label: 'Hue', key: 'hue', type: 'range', min: -180, max: 180, step: 1, default: 0, unit: '°' },
      { label: 'Gamma', key: 'gamma', type: 'range', min: 0.3, max: 2.5, step: 0.01, default: 1 },
      { label: 'Temperature', key: 'temperature', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
      { label: 'Tint', key: 'tint', type: 'range', min: -1, max: 1, step: 0.01, default: 0 }
    ], c), U.el('p', { class: 'hint', text: 'GPU-accelerated. Double-click a slider to reset.' })]);
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
      { label: 'Bus A', key: 'buses.A', type: 'checkbox', onChange: apply },
      { label: 'Bus B', key: 'buses.B', type: 'checkbox', onChange: apply },
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

  function layers(inp, st) {
    const box = U.el('div');
    const draw = () => {
      box.innerHTML = '';
      const opts = st.inputs.filter(i => i !== inp && !(i.type === 'scene' && i.containsInput(inp.id)));
      const tbl = U.el('table', { class: 'tbl' });
      tbl.append(U.el('tr', {}, ['#', 'Input', 'X', 'Y', 'W', 'H', 'Opacity', 'On', ''].map(h => U.el('th', { text: h }))));
      inp.cfg.layers.forEach((l, i) => {
        const sel = U.el('select'); for (const o of opts) { const op = U.el('option', { value: o.id, text: `${o.number}. ${o.title}` }); if (o.id === l.inputId) op.selected = true; sel.append(op); }
        sel.onchange = () => { l.inputId = sel.value; st._updateLive(); };
        const n = (k, def) => { const e = U.el('input', { type: 'number', step: 0.01, min: -1, max: 2, value: l[k] ?? def, style: { width: '64px' } }); e.oninput = () => { l[k] = +e.value; }; return e; };
        const on = U.el('input', { type: 'checkbox' }); on.checked = l.visible !== false; on.onchange = () => { l.visible = on.checked; st._updateLive(); };
        tbl.append(U.el('tr', {}, [U.el('td', { text: String(i + 1) }), U.el('td', {}, [sel]), U.el('td', {}, [n('x', 0)]), U.el('td', {}, [n('y', 0)]), U.el('td', {}, [n('w', 1)]), U.el('td', {}, [n('h', 1)]), U.el('td', {}, [n('opacity', 1)]), U.el('td', {}, [on]),
          U.el('td', {}, [U.el('button', { class: 'tbtn small', text: '▲', onclick: () => { if (i) { [inp.cfg.layers[i - 1], inp.cfg.layers[i]] = [inp.cfg.layers[i], inp.cfg.layers[i - 1]]; draw(); } } }), U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { inp.cfg.layers.splice(i, 1); st._updateLive(); draw(); } })])]));
      });
      box.append(tbl, U.el('div', { style: { marginTop: '8px' } }, [U.el('button', { class: 'btn', text: '＋ Add layer', onclick: () => { if (inp.cfg.layers.length >= 10) return U.toast('Maximum 10 layers', 'error'); if (!opts[0]) return U.toast('Add other inputs first', 'error'); inp.cfg.layers.push({ inputId: opts[0].id, x: 0.6, y: 0.6, w: 0.35, h: 0.35, visible: true }); st._updateLive(); draw(); } })]),
        U.el('p', { class: 'hint', text: 'X/Y/W/H are fractions of the frame (0–1). Layers draw top-to-bottom: the last row is on top. Each layer also uses its input\'s own crop, zoom & effects.' }));
    };
    draw();
    return box;
  }

  BTS.InputSettings = { open };
})(window.BTS);
