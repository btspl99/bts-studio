'use strict';
/**
 * Pro audio UI + output engine: "Audio Device (Pro)" inputs (ASIO / WASAPI exclusive / WDM-KS / MME through
 * the native bts-audio helper, with a VST3 effect chain) and pro audio outputs (Master or a bus to an ASIO /
 * WASAPI device).
 */
(function (BTS) {
  const U = BTS.U;
  const SLOTS = 4;

  const label = (d) => `${d.name}  —  ${d.hostApi}`;
  const order = (h) => (/ASIO/i.test(h) ? 0 : /WASAPI/i.test(h) ? 1 : /WDM/i.test(h) ? 2 : 3);
  const sortDevs = (list) => list.slice().sort((a, b) => order(a.hostApi) - order(b.hostApi) || a.name.localeCompare(b.name));
  const sel = (opts, val, on, style) => { const e = U.el('select', { style: style || { width: '100%' } }); for (const [v, l] of opts) e.append(U.el('option', { value: v, text: l, selected: String(v) === String(val) })); e.onchange = () => on(e.value); return e; };
  const helperMissing = () => U.el('div', { class: 'ext-warn', html: 'The pro audio helper (<b>bts-audio</b>) is not part of this copy of BTS Studio. ASIO, WASAPI exclusive and VST3 come with the <b>Windows installer</b> from studio.btspl.tech (not the Microsoft Store version).' });

  /** channel choices for a device with n inputs: stereo pairs and single channels (mono) */
  function channelOpts(n) {
    const out = [];
    for (let i = 0; i + 1 < Math.max(2, n); i += 2) out.push([`p${i / 2}`, `Stereo ${i + 1} + ${i + 2}`]);
    for (let i = 0; i < Math.max(1, n); i++) out.push([`m${i}`, `Mono ${i + 1}`]);
    return out.slice(0, 96);
  }

  /** VST3 chain editor. list: [{path, name, bypass, state}], onChange(kind) — kind 'chain' needs a restart */
  function vstChain(list, { onChange, inp } = {}) {
    const box = U.el('div');
    const draw = () => {
      box.innerHTML = '';
      const tbl = U.el('div', { class: 'list', style: { minHeight: '40px' } });
      list.forEach((v, i) => {
        tbl.append(U.el('div', { class: 'li' }, [
          U.el('b', { text: `${i + 1}`, style: { minWidth: '18px' } }),
          U.el('span', { class: 'grow', text: v.name || U.baseName(v.path).replace(/\.vst3$/i, ''), title: v.path }),
          inp ? U.el('button', { class: 'btn small', text: 'Edit', title: 'Open the plug-in window', onclick: () => inp.vstEditor(i) }) : null,
          U.el('button', { class: 'btn small' + (v.bypass ? ' danger' : ''), text: v.bypass ? 'Bypassed' : 'Bypass', onclick: () => { if (inp) inp.vstBypass(i); else v.bypass = !v.bypass; draw(); } }),
          U.el('button', { class: 'btn small', text: '▲', disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); onChange && onChange('chain'); } }),
          U.el('button', { class: 'btn small', text: '✕', onclick: () => { list.splice(i, 1); draw(); onChange && onChange('chain'); } })
        ]));
      });
      if (!list.length) tbl.append(U.el('div', { class: 'li hint', text: 'No VST3 effects. Add EQ, compressor, de-esser, noise reduction or reverb plug-ins (applied in order).' }));
      const add = (p) => { if (!p || list.length >= 8) return; list.push({ path: p, name: U.baseName(p).replace(/\.vst3$/i, ''), bypass: false }); draw(); onChange && onChange('chain'); };
      const installed = U.el('select', { style: { minWidth: '220px' } });
      installed.append(U.el('option', { value: '', text: 'Installed VST3 plug-ins…' }));
      window.bts.proAudio.scan().then(l => { for (const p of l) installed.append(U.el('option', { value: p.path, text: p.name })); if (!l.length) installed.append(U.el('option', { value: '', text: '(none found in the VST3 folder)', disabled: true })); });
      installed.onchange = () => { add(installed.value); installed.value = ''; };
      box.append(tbl, U.el('div', { class: 'inline', style: { marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
        installed,
        U.el('button', { class: 'btn', text: 'Add plug-in file…', onclick: async () => { const f = await window.bts.dialog.open({ filters: [{ name: 'VST3 plug-in', extensions: ['vst3'] }] }); if (f) add(f[0]); } }),
        U.el('button', { class: 'btn', text: 'Add plug-in folder…', title: 'For .vst3 bundles (folders)', onclick: async () => { const f = await window.bts.dialog.folder(); if (f) add(f); } })
      ]));
    };
    draw();
    return box;
  }

  /** Add Input pane */
  async function addPane(el) {
    el.innerHTML = '<div class="hint">Looking for audio devices…</div>';
    const st = await window.bts.proAudio.status();
    const info = st.available ? await window.bts.proAudio.list(true) : { devices: [] };
    const devs = sortDevs((info.devices || []).filter(d => d.maxIn > 0));
    const o = { device: devs[0] ? devs[0].id : 'test', chan: 'p0', exclusive: false, title: '', vst: [] };
    const draw = () => {
      el.innerHTML = '';
      if (!st.available) el.append(helperMissing());
      const d = devs.find(x => String(x.id) === String(o.device));
      const opts = [...devs.map(x => [x.id, label(x)]), ['test', 'Test tone (no hardware)']];
      el.append(BTS.Dialog.form([
        { label: 'Device', custom: sel(opts, o.device, (v) => { o.device = v; o.chan = 'p0'; draw(); }) },
        { label: 'Channels', custom: sel(channelOpts(d ? d.maxIn : 2), o.chan, (v) => { o.chan = v; }) },
        d && /WASAPI/i.test(d.hostApi) ? { label: 'Exclusive mode', key: 'exclusive', type: 'checkbox', hint: 'Lowest latency; the device is reserved for BTS Studio.' } : null,
        { custom: U.el('div', { class: 'hint', html: d ? `${d.maxIn} inputs · ${d.defaultRate} Hz · about ${d.lowLatencyMs} ms${/ASIO/i.test(d.hostApi) ? ' · ASIO: set the buffer size in the driver’s control panel and run the interface at <b>48 kHz</b>' : ''}` : '' }) },
        { section: 'VST3 effects' },
        { custom: vstChain(o.vst) },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ].filter(Boolean), o));
    };
    draw();
    return () => {
      if (!st.available && o.device !== 'test') { U.toast('Pro audio is not available in this copy of BTS Studio', 'error'); return null; }
      const d = devs.find(x => String(x.id) === String(o.device));
      const cfg = { device: o.device, deviceName: d ? d.name : 'Test tone', hostApi: d ? d.hostApi : '', exclusive: !!o.exclusive, vst: o.vst, pair: 0, mono: -1 };
      if (o.chan[0] === 'p') cfg.pair = +o.chan.slice(1); else cfg.mono = +o.chan.slice(1);
      return [{ type: 'proaudio', title: o.title || (d ? d.name.replace(/\s*\(.*\)$/, '') : 'Test tone'), cfg }];
    };
  }

  /** Input settings tab */
  function inputTab(inp) {
    const c = inp.cfg, box = U.el('div');
    const restart = U.debounce(() => inp.init(), 400);
    const draw = async () => {
      const info = await window.bts.proAudio.list();
      const devs = sortDevs((info.devices || []).filter(d => d.maxIn > 0));
      const d = devs.find(x => String(x.id) === String(c.device)) || devs.find(x => x.name === c.deviceName && x.hostApi === c.hostApi);
      if (d && String(d.id) !== String(c.device)) c.device = d.id; // device numbers can change when hardware is added
      box.innerHTML = '';
      if (!info.available) box.append(helperMissing());
      const chan = c.mono >= 0 ? `m${c.mono}` : `p${c.pair || 0}`;
      box.append(BTS.Dialog.form([
        { custom: U.el('div', { class: 'hint', text: `${inp.deviceInfo || inp.statusMsg || ''}` }) },
        { label: 'Device', custom: sel([...devs.map(x => [x.id, label(x)]), ['test', 'Test tone']], c.device, (v) => { const n = devs.find(x => String(x.id) === v); c.device = v; c.deviceName = n ? n.name : 'Test tone'; c.hostApi = n ? n.hostApi : ''; restart(); draw(); }) },
        { label: 'Channels', custom: sel(channelOpts(d ? d.maxIn : 2), chan, (v) => { if (v[0] === 'p') { c.pair = +v.slice(1); c.mono = -1; } else { c.mono = +v.slice(1); c.pair = 0; } restart(); }) },
        d && /WASAPI/i.test(d.hostApi) ? { label: 'Exclusive mode', key: 'exclusive', type: 'checkbox', onChange: () => restart() } : null,
        { section: 'VST3 effects' },
        { custom: vstChain(c.vst, { inp, onChange: () => restart() }) },
        { custom: U.el('p', { class: 'hint', text: 'Edit opens the plug-in’s own window. Settings are saved with the preset. Adding, removing or reordering plug-ins restarts the device for a moment.' }) }
      ].filter(Boolean), c));
    };
    draw();
    return box;
  }

  /* ---------------- pro audio outputs (Master / bus → ASIO / WASAPI device) ---------------- */
  class ProAudioOut {
    constructor(studio) { this.studio = studio; this.live = new Map(); window.bts.proAudio.onEvent((ev) => { if (ev.out && ev.event === 'stopped' && this.live.has(+ev.out.slice(4))) { this.stop(+ev.out.slice(4)); if (ev.message) U.toast('Pro audio output: ' + ev.message, 'error', 8000); } }); }
    cfg() { const s = BTS.settings; s.proAudio = s.proAudio || {}; const a = s.proAudio; a.outputs = a.outputs || []; for (let i = 0; i < SLOTS; i++) a.outputs[i] = { enabled: false, device: '', deviceName: '', bus: 'M', pair: 0, exclusive: false, ...(a.outputs[i] || {}) }; return a; }
    isLive(i) { return this.live.has(i); }
    async start(i) {
      this.stop(i);
      const c = this.cfg().outputs[i];
      if (c.device === '' || c.device == null) { U.toast(`Pro audio output ${i + 1}: choose a device`, 'error'); return false; }
      const key = 'out-' + i;
      const r = await window.bts.proAudio.startOut(key, { device: c.device, pair: c.pair || 0, exclusive: !!c.exclusive });
      if (!r.ok) { U.toast(`Pro audio output ${i + 1}: ${r.error}`, 'error', 8000); return false; }
      const enc = this.studio.outputs && this.studio.outputs.encoder;
      if (!enc || !(await enc.tapReady)) return false;
      const a = this.studio.audio, b = a.buses[c.bus] || a.buses.M;
      const src = c.bus === 'M' || !a.buses[c.bus] ? a.limiter : b.post;
      const node = new AudioWorkletNode(a.ctx, 'bts-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      const mute = a.ctx.createGain(); mute.gain.value = 0;
      src.connect(node); node.connect(mute); mute.connect(a.ctx.destination);
      node.port.onmessage = (e) => window.bts.proAudio.pcm(key, e.data.data);
      this.live.set(i, { key, node, src });
      return true;
    }
    stop(i) {
      const r = this.live.get(i); if (!r) return;
      this.live.delete(i);
      try { r.src.disconnect(r.node); r.node.disconnect(); } catch { /* noop */ }
      window.bts.proAudio.stopOut(r.key);
    }
    async startAll() { const c = this.cfg(); for (let i = 0; i < SLOTS; i++) if (c.outputs[i].enabled) await this.start(i); }
    stopAll() { for (const i of [...this.live.keys()]) this.stop(i); }
  }

  function outputsSection() {
    const box = U.el('div', { style: { marginTop: '16px' } });
    const O = BTS.proAudioOut;
    const draw = async () => {
      const st = await window.bts.proAudio.status();
      const info = st.available ? await window.bts.proAudio.list() : { devices: [] };
      const devs = sortDevs((info.devices || []).filter(d => d.maxOut > 0));
      const cfg = O.cfg();
      box.innerHTML = '';
      box.append(U.el('h4', { text: 'Pro audio outputs — ASIO / WASAPI (Master or a bus to an audio interface, PA or recorder)' }));
      if (!st.available) { box.append(helperMissing()); return; }
      const tbl = U.el('table', { class: 'tbl' });
      tbl.append(U.el('tr', {}, ['On', '#', 'Device', 'Audio', 'Channels', 'Exclusive', ''].map(h => U.el('th', { text: h }))));
      for (let i = 0; i < SLOTS; i++) {
        const c = cfg.outputs[i], live = O.isLive(i);
        const d = devs.find(x => String(x.id) === String(c.device)) || devs.find(x => x.name === c.deviceName);
        if (d) c.device = d.id;
        const save = () => BTS.SettingsUI.save();
        const en = U.el('input', { type: 'checkbox' }); en.checked = !!c.enabled; en.onchange = () => { c.enabled = en.checked; save(); };
        const pairs = []; for (let k = 0; k * 2 + 1 < Math.max(2, d ? d.maxOut : 2); k++) pairs.push([k, `${k * 2 + 1} + ${k * 2 + 2}`]);
        const ex = U.el('input', { type: 'checkbox', disabled: !(d && /WASAPI/i.test(d.hostApi)) }); ex.checked = !!c.exclusive; ex.onchange = () => { c.exclusive = ex.checked; save(); };
        tbl.append(U.el('tr', { class: live ? 'live' : '' }, [
          U.el('td', {}, [en]), U.el('td', { text: String(i + 1) }),
          U.el('td', {}, [sel([['', '— choose —'], ...devs.map(x => [x.id, label(x)])], c.device, (v) => { const n = devs.find(x => String(x.id) === v); c.device = v; c.deviceName = n ? n.name : ''; save(); draw(); }, { width: '320px' })]),
          U.el('td', {}, [sel([['M', 'Master'], ...'ABCDEFG'.split('').map(b => [b, 'Bus ' + b])], c.bus, (v) => { c.bus = v; save(); })]),
          U.el('td', {}, [sel(pairs, c.pair || 0, (v) => { c.pair = +v; save(); })]),
          U.el('td', {}, [ex]),
          U.el('td', {}, [live ? U.el('button', { class: 'btn danger', text: 'Stop', onclick: () => { O.stop(i); draw(); } }) : U.el('button', { class: 'btn primary', text: 'Start', onclick: async () => { await O.start(i); draw(); } })])
        ]));
      }
      box.append(tbl, BTS.Dialog.form([{ label: 'Start with BTS Studio', key: 'autoStart', type: 'checkbox', onChange: () => BTS.SettingsUI.save() }], cfg, () => {}),
        U.el('p', { class: 'hint', text: 'For a virtual microphone in Zoom / Teams, send a bus to a virtual audio cable here or in the mixer. ASIO interfaces must run at 48 kHz; latency is set in the driver’s own control panel.' }));
    };
    draw();
    return box;
  }

  BTS.ProAudioOut = ProAudioOut;
  BTS.ProAudioUI = { addPane, inputTab, vstChain, outputsSection };
})(window.BTS);
