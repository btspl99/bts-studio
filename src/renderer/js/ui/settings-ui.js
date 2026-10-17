'use strict';
/** Settings, stream/record config, transitions, shortcuts, web controller, updates, data sources, external output, about. */
(function (BTS) {
  const U = BTS.U;
  const F = (...a) => BTS.Dialog.form(...a);

  const SERVICES = {
    youtube: { name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2' },
    'youtube-backup': { name: 'YouTube (backup)', url: 'rtmp://b.rtmp.youtube.com/live2?backup=1' },
    facebook: { name: 'Facebook Live', url: 'rtmps://live-api-s.facebook.com:443/rtmp/' },
    twitch: { name: 'Twitch', url: 'rtmp://live.twitch.tv/app' },
    custom: { name: 'Custom RTMP / RTMPS', url: '' },
    srt: { name: 'SRT', url: 'srt://host:port?mode=caller&latency=200000' },
    udp: { name: 'UDP / MPEG-TS', url: 'udp://239.0.0.1:1234?pkt_size=1316' }
  };

  const DEFAULT_SHORTCUTS = [
    { key: 'Space', fn: 'QuickPlay' }, { key: 'Enter', fn: 'Cut' }, { key: 'B', fn: 'FadeToBlack' },
    { key: 'Shift+1', fn: 'OverlayInput1' }, { key: 'Shift+2', fn: 'OverlayInput2' }, { key: 'Shift+3', fn: 'OverlayInput3' }, { key: 'Shift+4', fn: 'OverlayInput4' },
    { key: 'Shift+0', fn: 'OverlayInputAllOff' }, { key: 'T', fn: 'Transition1' }, { key: 'Y', fn: 'Transition2' }, { key: 'U', fn: 'Transition3' }, { key: 'I', fn: 'Transition4' },
    { key: 'P', fn: 'PlayPause' }, { key: 'R', fn: 'Restart' }, { key: 'N', fn: 'NextItem' }, { key: 'Ctrl+P', fn: 'Snapshot' },
    { key: 'ArrowRight', fn: 'PreviewInputNext' }, { key: 'ArrowLeft', fn: 'PreviewInputPrevious' },
    { key: 'Shift+R', fn: 'ReplayInstant' }, { key: '[', fn: 'ReplayMarkIn' }, { key: ']', fn: 'ReplayMarkOut' }, { key: 'Shift+S', fn: 'ReplaySaveMarks' },
    { key: 'Shift+P', fn: 'StartPlayList' }, { key: 'Escape', fn: 'ScriptStopAll' }
  ];
  for (let i = 1; i <= 9; i++) { DEFAULT_SHORTCUTS.push({ key: String(i), fn: 'PreviewInput', params: { Input: String(i) } }); DEFAULT_SHORTCUTS.push({ key: 'Ctrl+' + i, fn: 'Cut', params: { Input: String(i) } }); }

  async function save() { BTS.settings = await window.bts.settings.set(BTS.settings); return BTS.settings; }

  /* ---------------- main settings ---------------- */
  async function open(tab = 'general') {
    const s = BTS.settings, st = BTS.studio;
    const enc = await window.bts.output.encoders();
    const encLabels = { gpu: 'GPU — shared hardware H.264 (recommended)', libx264: 'x264 (CPU)', libx265: 'x265 HEVC (CPU)', h264_nvenc: 'NVIDIA NVENC H.264', hevc_nvenc: 'NVIDIA NVENC HEVC', av1_nvenc: 'NVIDIA NVENC AV1', h264_qsv: 'Intel Quick Sync H.264', hevc_qsv: 'Intel Quick Sync HEVC', h264_amf: 'AMD AMF H.264', hevc_amf: 'AMD AMF HEVC', h264_videotoolbox: 'Apple VideoToolbox H.264', hevc_videotoolbox: 'Apple VideoToolbox HEVC', prores_ks: 'Apple ProRes 422 HQ (editing)', dnxhd: 'Avid DNxHR HQ (editing)' };
    const v2 = st.outputs.v2;
    const ff = (enc.list && enc.list.length ? enc.list : ['libx264']);
    const streamEncOpts = [...(v2 ? ['gpu'] : []), ...ff.filter(e => !['prores_ks', 'dnxhd'].includes(e))].map(e => [e, encLabels[e] || e]);
    const encOpts = [...(v2 ? ['gpu'] : []), ...ff].map(e => [e, encLabels[e] || e]);
    const resOpts = [['program', 'Same as output'], ['3840x2160', '2160p (4K)'], ['2560x1440', '1440p'], ['1920x1080', '1080p'], ['1280x720', '720p'], ['854x480', '480p'], ['1080x1920', '1080×1920 vertical']];

    const gen = { res: `${s.video.width}x${s.video.height}`, fps: s.video.fps, previewOverlays: st.previewOverlays, tbarReverse: !!s.ui.tbarReverse };
    const general = U.el('div', {}, [F([
      { section: 'Video format' },
      { label: 'Resolution', key: 'res', type: 'select', options: [['1280x720', '1280×720 (720p)'], ['1920x1080', '1920×1080 (1080p)'], ['2560x1440', '2560×1440'], ['3840x2160', '3840×2160 (4K UHD)'], ['1080x1920', '1080×1920 (vertical)'], ['1080x1080', '1080×1080 (square)']] },
      { label: 'Frame rate', key: 'fps', type: 'select', number: true, options: [[24, '24'], [25, '25 (PAL)'], [29.97, '29.97'], [30, '30'], [50, '50'], [59.94, '59.94'], [60, '60']] },
      { custom: U.el('div', { class: 'hint', text: 'Changing format applies immediately; stop outputs first.' }) },
      { section: 'Monitors' },
      { label: 'Show overlays on Preview', key: 'previewOverlays', type: 'checkbox' },
      { label: 'T-Bar starts at top', key: 'tbarReverse', type: 'checkbox' }
    ], gen)]);

    const destBox = U.el('div');
    s.stream.destinations.forEach((d, i) => {
      destBox.append(F([
        { section: `Destination ${i + 1}` },
        { label: 'Enabled', key: 'enabled', type: 'checkbox' },
        { label: 'Name', key: 'name' },
        { label: 'Service', key: 'service', type: 'select', options: Object.entries(SERVICES).map(([k, v]) => [k, v.name]), onChange: (v) => { d.url = SERVICES[v].url; urlInput.value = d.url; } },
        { label: 'Server URL', key: 'url' },
        { label: 'Stream key', key: 'key', type: 'password', placeholder: 'Paste your stream key' },
        { label: 'Encoder override', key: 'encoder', type: 'select', options: [['', 'Same as below'], ...streamEncOpts] },
        { label: 'Resolution override', key: 'resolution', type: 'select', options: [['', 'Same as below'], ...resOpts] },
        { label: 'Bitrate override (kbps)', key: 'videoBitrate', type: 'number', hint: 'Leave blank to use the global bitrate below. Destinations with the same encoder, resolution and bitrate share one encode.' },
        { label: 'Audio', key: 'audioBus', type: 'select', options: [['M', 'Master'], ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(b => [b, 'Bus ' + b])], hint: 'e.g. a second destination with a different-language commentary on Bus B.' }
      ], d));
      const urlInput = destBox.querySelectorAll('.form')[i].querySelectorAll('input[type=text]')[1];
    });
    const stream = U.el('div', {}, [destBox, F([
      { section: 'Encoding (applies to all destinations)' },
      { label: 'Encoder', key: 'encoder', type: 'select', options: streamEncOpts, hint: enc.ffmpeg ? 'GPU: encoded once on the graphics card and sent as-is — lowest CPU, no second compression. Other encoders re-encode a near-lossless copy.' : 'FFmpeg not found!' },
      { label: 'Resolution', key: 'resolution', type: 'select', options: resOpts, hint: 'Stream at a lower resolution than you produce (e.g. produce 4K, stream 1080p).' },
      { label: 'x264 preset', key: 'preset', type: 'select', options: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'] },
      { label: 'Video bitrate (kbps)', key: 'videoBitrate', type: 'number', min: 300, max: 80000, hint: '720p30: 3000 • 1080p30: 6000 • 1080p60: 9000 • 1440p60: 16000 • 4K30: 20000 • 4K60: 35000 (YouTube)' },
      { label: 'Audio bitrate (kbps)', key: 'audioBitrate', type: 'select', number: true, options: [[96, '96'], [128, '128'], [160, '160'], [192, '192'], [256, '256'], [320, '320']] },
      { label: 'Keyframe interval (s)', key: 'keyint', type: 'select', number: true, options: [[1, '1'], [2, '2 (recommended)'], [4, '4']] },
      { label: 'Auto reconnect', key: 'autoReconnect', type: 'checkbox' }
    ], s.stream)]);

    const record = U.el('div', {}, [F([
      { label: 'Folder', key: 'folder', type: 'file', folder: true },
      { label: 'Format', key: 'format', type: 'select', options: [['mp4', 'MP4 (crash-safe fragmented)'], ['mkv', 'MKV (crash-safe)'], ['mov', 'MOV'], ['webm', 'WebM']] },
      { label: 'Encoder', key: 'encoder', type: 'select', options: encOpts, hint: 'GPU writes the encoded picture directly (no second compression). ProRes / DNxHR create large editing files (use MOV or MKV).' },
      { label: 'Rate control', key: 'rateControl', type: 'select', options: [['quality', 'Constant quality (recommended)'], ['bitrate', 'Fixed bitrate']] },
      { label: 'Quality', key: 'quality', type: 'select', options: [['lossless', 'Visually lossless (very large)'], ['lossless-ish', 'Near lossless'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low (small files)']] },
      { label: 'Bitrate (kbps)', key: 'videoBitrate', type: 'number', min: 1000, max: 400000, hint: 'Used with Fixed bitrate. 1080p: 20000–40000 • 4K: 60000–120000.' },
      { label: 'Audio', key: 'audioCodec', type: 'select', options: [['aac', 'AAC 320 kbps'], ['pcm', 'PCM 24-bit lossless (MOV / MKV)']] },
      { label: 'File name', key: 'filenamePattern', hint: '{date} {time} placeholders' }
    ], s.record), U.el('div', { style: { height: '10px' } }), F([
      { section: 'Recorder 2 (second recording of the same output)' },
      { label: 'Enable Recorder 2', key: 'enabled', type: 'checkbox', hint: 'Starts and stops with Record. Example: MP4 for editing plus an MKV safety copy.' },
      { label: 'Format', key: 'format', type: 'select', options: [['mkv', 'MKV (crash-safe)'], ['mp4', 'MP4'], ['mov', 'MOV'], ['webm', 'WebM']] },
      { label: 'Encoder', key: 'encoder', type: 'select', options: encOpts },
      { label: 'Quality', key: 'quality', type: 'select', options: [['lossless-ish', 'Near lossless'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low (proxy)']] },
      { label: 'File name suffix', key: 'suffix' },
      { label: 'Audio', key: 'audioBus', type: 'select', options: [['M', 'Master'], ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(b => [b, 'Bus ' + b])] }
    ], s.record2 || (s.record2 = { enabled: false, format: 'mkv', mode: 'encode', encoder: 'libx264', quality: 'medium', suffix: '-2' }))]);

    // encoders tab
    s.encoding = s.encoding || { engine: 'v2', hardware: 'auto' };
    const capBox = U.el('div', { class: 'hint', text: 'Checking this PC…' });
    const encTab = U.el('div', {}, [F([
      { section: 'Output engine' },
      { label: 'Engine', key: 'engine', type: 'select', options: [['v2', 'Shared GPU encode (recommended)'], ['classic', 'Classic (one capture per output)']], hint: 'The shared engine encodes the programme once and feeds every stream and recording — far lower load and no double compression.' },
      { label: 'Video encoder hardware', key: 'hardware', type: 'select', options: [['auto', 'Automatic — GPU when available'], ['hardware', 'GPU only'], ['software', 'CPU only']] },
      { label: 'Audio offset (ms)', key: 'audioOffsetMs', type: 'number', min: -500, max: 500, step: 5, hint: 'Fine-tune lip-sync of streams and recordings. Positive delays the sound.' }
    ], s.encoding), U.el('h4', { text: 'This PC', style: { margin: '14px 0 6px' } }), capBox]);
    if (st.outputs.encoder) st.outputs.encoder.capabilities().then((c) => {
      capBox.innerHTML = '';
      if (!c.webcodecs) { capBox.textContent = 'WebCodecs is not available — the classic engine will be used.'; return; }
      const t = U.el('table', { class: 'tbl' });
      t.append(U.el('tr', {}, ['Format', 'GPU H.264', 'CPU H.264'].map(h => U.el('th', { text: h }))));
      for (const r of c.rows) t.append(U.el('tr', {}, [U.el('td', { text: r.label }), U.el('td', { text: r.gpu ? '✔ yes' : '—', class: r.gpu ? 'good' : '' }), U.el('td', { text: r.cpu ? '✔ yes' : '—' })]));
      capBox.append(t, U.el('p', { class: 'hint', text: `Constant-quality recording: ${c.quantizer ? 'supported' : 'not supported by this encoder (variable bitrate is used instead)'}. FFmpeg encoders found: ${ff.map(e => encLabels[e] || e).join(', ')}.` }));
    });

    // transitions
    const tr = st.transitions;
    const tOpts = BTS.Transitions.list.map(t => [t.id, t.name]);
    const ovlOpts = [['Fade', 'Fade'], ['Cut', 'Cut'], ['Zoom', 'Zoom'], ['Slide', 'Slide from left'], ['SlideRight', 'Slide from right'], ['SlideUp', 'Slide up'], ['Wipe', 'Wipe']];
    const trans = U.el('div', {}, [
      F([{ section: 'Quick Play' }, { label: 'Effect', key: 'type', type: 'select', options: tOpts }, { label: 'Duration (ms)', key: 'duration', type: 'number', min: 0 }], tr.quickPlay),
      ...tr.buttons.map((b, i) => F([{ section: `Transition ${i + 1}` }, { label: 'Effect', key: 'type', type: 'select', options: tOpts }, { label: 'Duration (ms)', key: 'duration', type: 'number', min: 0 }], b)),
      ...Object.entries(tr.stingers).map(([k, v]) => F([{ section: k + ' (video with alpha: WebM VP9 or MOV ProRes4444 → convert to WebM)' }, { label: 'Video', key: 'path', type: 'file', filters: [{ name: 'Video', extensions: U.VIDEO_EXT }] }, { label: 'Cut point (ms)', key: 'cutPoint', type: 'number', hint: 'When the switch happens behind the stinger.' }], v)),
      ...st.overlays.map((o, i) => F([{ section: `Overlay channel ${i + 1}` }, { label: 'Transition', key: 'type', type: 'select', options: ovlOpts }, { label: 'Duration (ms)', key: 'duration', type: 'number', min: 0 }], o))
    ]);

    const api = U.el('div');
    const addrs = await window.bts.api.addresses();
    api.append(F([
      { label: 'Enable Web Controller & API', key: 'enabled', type: 'checkbox' },
      { label: 'Port', key: 'port', type: 'number', min: 1024, max: 65535 },
      { label: 'Allow other devices (LAN)', key: 'allowRemote', type: 'checkbox' },
      { label: 'TCP API (vMix-compatible)', key: 'tcpEnabled', type: 'checkbox' },
      { label: 'TCP port', key: 'tcpPort', type: 'number', min: 1024, max: 65535 }
    ], s.api), U.el('div', { style: { marginTop: '12px', lineHeight: '1.8' } }, [
      U.el('div', { html: `<b>Web Controller</b> (phone/tablet): ${['127.0.0.1', ...addrs].map(a => `<span class="kbd">http://${a}:${s.api.port}/</span>`).join(' ')}` }),
      U.el('div', { html: `<b>Tally</b>: <span class="kbd">http://IP:${s.api.port}/tally/?input=1</span>` }),
      U.el('div', { html: `<b>API</b>: <span class="kbd">http://127.0.0.1:${s.api.port}/api/?Function=Cut&amp;Input=2</span> • state: <span class="kbd">/api</span> (JSON) or <span class="kbd">/api?format=xml</span> • list: <span class="kbd">/api/functions</span>` }),
      U.el('div', { html: `<b>Live preview</b> (MJPEG): <span class="kbd">http://IP:${s.api.port}/api/mjpeg?Input=program&amp;fps=10&amp;width=640</span>` }),
      U.el('div', { html: `<b>TCP API</b>: port <span class="kbd">${s.api.tcpPort || 8099}</span> — <span class="kbd">FUNCTION Cut Input=2</span> · <span class="kbd">TALLY</span> · <span class="kbd">SUBSCRIBE TALLY</span> · <span class="kbd">XML</span> (Companion / Stream Deck / tally boxes)` })
    ]));

    s.guests = s.guests || {}; s.media = s.media || {};
    const guestsEl = U.el('div', {}, [
      F([{ section: 'Media files' },
        { label: 'Auto-convert unsupported formats', key: 'autoConvert', type: 'checkbox', hint: 'AVI, WMV, MXF, MPEG-2, VOB, FLV, ProRes/DNxHD MOV… are converted once to an H.264 proxy with FFmpeg and cached.' },
        { label: 'Conversion quality', key: 'convertQuality', type: 'select', options: [['fast', 'Fast (good quality, quick)'], ['high', 'High (slower, near-original)']] }
      ], s.media),
      U.el('div', { style: { margin: '6px 0 14px' } }, [U.el('button', { class: 'btn', text: 'Clear converted-file cache', onclick: async () => { await window.bts.media.clearCache(); U.toast('Cache cleared'); } })]),
      F([{ section: 'Remote Guests (browser call-in)' },
        { label: 'Guest page port (HTTPS)', key: 'port', type: 'number', min: 1024, max: 65535, hint: 'Forward this TCP port on your router to allow guests from outside your network.' },
        { label: 'STUN server(s)', key: 'stun', placeholder: 'stun:stun.l.google.com:19302', hint: 'Helps guests behind home routers find a direct path. Separate several with commas.' },
        { label: 'TURN server', key: 'turn', placeholder: 'turn:turn.example.com:3478', hint: 'Optional relay for guests on strict corporate / mobile networks.' },
        { label: 'TURN user name', key: 'turnUser' },
        { label: 'TURN password', key: 'turnPass', type: 'password' }
      ], s.guests),
      U.el('p', { class: 'hint', text: 'Port changes apply the next time BTS Studio starts.' })
    ]);

    const sc = shortcutsEditor();

    const info = await window.bts.info();
    const ffv = await window.bts.output.ffmpegVersion();
    const upd = U.el('div', {}, [F([
      { label: 'Check automatically', key: 'autoCheck', type: 'checkbox' },
      { label: 'Update server', key: 'url', placeholder: 'https://studio.btspl.tech/updates/ (default)' }
    ], s.updates), U.el('div', { style: { marginTop: '12px', lineHeight: '1.8' } }, [
      U.el('div', { html: `Installed version: <b>${info.version}</b> • Electron ${info.electron} • Chromium ${info.chrome}` }),
      U.el('div', { text: `FFmpeg: ${ffv || 'not found'}` }),
      U.el('button', { class: 'btn primary', text: 'Check for updates now', onclick: () => window.bts.update.check() })
    ])]);

    const midiEl = BTS.operatorUI.midiTab();
    const capBefore = JSON.stringify(s.capture || {}) + JSON.stringify((s.performance || {}).disableGpu);
    const devEl = BTS.operatorUI.devicesTab();
    const t = BTS.Dialog.tabs([
      { id: 'general', label: 'General', el: general }, { id: 'stream', label: 'Streaming', el: stream }, { id: 'record', label: 'Recording', el: record },
      { id: 'transitions', label: 'Transitions', el: trans }, { id: 'shortcuts', label: 'Shortcuts', el: sc.el }, { id: 'midi', label: 'MIDI', el: midiEl },
      { id: 'devices', label: 'Devices & Performance', el: devEl }, { id: 'api', label: 'Web Controller / API', el: api }, { id: 'guests', label: 'Media & Guests', el: guestsEl }, { id: 'encoders', label: 'Encoders', el: encTab }, { id: 'updates', label: 'Updates', el: upd }
    ]);
    BTS.Dialog.open({
      title: 'Settings', body: t.el, width: 820, onClose: () => { if (midiEl._cleanup) midiEl._cleanup(); },
      buttons: [{ label: 'Cancel' }, {
        label: 'Save', primary: true, onClick: async () => {
          const g = gen;
          const [w, h] = g.res.split('x').map(Number);
          s.shortcuts = sc.value();
          s.ui.tbarReverse = g.tbarReverse;
          st.previewOverlays = g.previewOverlays;
          const fmtChanged = w !== s.video.width || h !== s.video.height || g.fps !== s.video.fps;
          s.video = { width: w, height: h, fps: g.fps };
          await save();
          if (fmtChanged) { if (st.outputs.isStreaming() || st.outputs.isRecording()) U.toast('Format changes apply after outputs are stopped', 'error'); else st.setVideoFormat(w, h, g.fps); BTS.ui.updateFormatInfo(); }
          st.preloadStingers();
          st.emit('transitions-config');
          BTS.ui.loadShortcuts();
          if (JSON.stringify(s.capture || {}) + JSON.stringify((s.performance || {}).disableGpu) !== capBefore) U.toast('Capture backend / rendering change applies after restarting BTS Studio', 'info', 8000);
          U.toast('Settings saved', 'ok');
        }
      }]
    });
    t.show(tab);
  }

  function shortcutsEditor() {
    const list = U.deepClone(BTS.settings.shortcuts || DEFAULT_SHORTCUTS);
    const el = U.el('div');
    const fns = BTS.Functions.all();
    const draw = () => {
      el.innerHTML = '';
      const tbl = U.el('table', { class: 'tbl' });
      tbl.append(U.el('tr', {}, ['Key', 'Function', 'Input', 'Value', ''].map(h => U.el('th', { text: h }))));
      list.forEach((r, i) => {
        const key = U.el('input', { type: 'text', value: r.key, readonly: true, placeholder: 'Press keys…', style: { cursor: 'pointer' } });
        key.onkeydown = (e) => { e.preventDefault(); e.stopPropagation(); const k = keyName(e); if (k) { r.key = k; key.value = k; } };
        const fn = U.el('select');
        let grp = null, og;
        for (const f of fns) { if (f.group !== grp) { grp = f.group; og = U.el('optgroup', { label: grp }); fn.append(og); } const o = U.el('option', { value: f.name, text: f.name }); if (f.name === r.fn) o.selected = true; og.append(o); }
        fn.onchange = () => { r.fn = fn.value; };
        const inp = U.el('input', { type: 'text', value: r.params?.Input || '', placeholder: 'number / name', style: { width: '110px' } });
        inp.onchange = () => { r.params = { ...(r.params || {}), Input: inp.value || undefined }; };
        const val = U.el('input', { type: 'text', value: r.params?.Value || '', style: { width: '90px' } });
        val.onchange = () => { r.params = { ...(r.params || {}), Value: val.value || undefined }; };
        tbl.append(U.el('tr', {}, [U.el('td', {}, [key]), U.el('td', {}, [fn]), U.el('td', {}, [inp]), U.el('td', {}, [val]), U.el('td', {}, [U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { list.splice(i, 1); draw(); } })])]));
      });
      el.append(tbl, U.el('div', { class: 'inline', style: { marginTop: '8px', gap: '6px', display: 'flex' } }, [
        U.el('button', { class: 'btn', text: '＋ Add shortcut', onclick: () => { list.push({ key: '', fn: 'Cut' }); draw(); } }),
        U.el('button', { class: 'btn', text: 'Restore defaults', onclick: () => { list.splice(0, list.length, ...U.deepClone(DEFAULT_SHORTCUTS)); draw(); } })
      ]), U.el('p', { class: 'hint', text: 'Click the Key box and press the key combination. Shortcuts are ignored while typing in text fields.' }));
    };
    draw();
    return { el, value: () => list.filter(r => r.key && r.fn) };
  }

  function keyName(e) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
    let k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code.startsWith('Numpad') ? 'Num' + e.code.slice(6) : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (e.shiftKey) k = 'Shift+' + k;
    if (e.altKey) k = 'Alt+' + k;
    if (e.ctrlKey || e.metaKey) k = 'Ctrl+' + k;
    return k;
  }

  /* ---------------- data sources ---------------- */
  function dataSources() {
    const st = BTS.studio, ds = st.data;
    const box = U.el('div', { style: { display: 'grid', gridTemplateColumns: '220px 1fr', gap: '12px', minHeight: '440px' } });
    const left = U.el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const right = U.el('div', { style: { overflow: 'auto' } });
    box.append(left, right);
    let cur = ds.sources[0]?.id;
    const drawLeft = () => {
      left.innerHTML = '';
      const l = U.el('div', { class: 'list', style: { flex: 1 } });
      for (const s of ds.sources) { const li = U.el('div', { class: 'li' + (s.id === cur ? ' on' : ''), style: { cursor: 'pointer' } }, [U.el('span', { class: 'grow', text: s.name }), U.el('span', { class: 'hint', text: s.error ? '⚠' : `${s.rows.length} rows` })]); li.onclick = () => { cur = s.id; drawLeft(); drawRight(); }; l.append(li); }
      if (!ds.sources.length) l.append(U.el('div', { class: 'li hint', text: 'No data sources yet' }));
      left.append(l, U.el('button', { class: 'btn primary', text: '＋ New data source', onclick: () => { const s = ds.add({ name: 'Data ' + (ds.sources.length + 1) }); cur = s.id; drawLeft(); drawRight(); } }));
    };
    const drawRight = () => {
      right.innerHTML = '';
      const s = ds.get(cur); if (!s) { right.append(U.el('p', { class: 'hint', text: 'Data sources drive titles from Excel workbooks, CSV, Google Sheets, JSON APIs, XML files or RSS news feeds — updating live as the data changes. Create one on the left.' })); return; }
      const o = { name: s.name, type: s.type, url: s.url, interval: s.interval, jsonPath: s.jsonPath, sheet: s.sheet || '', headerRow: s.headerRow || 1, itemPath: s.itemPath || '', maxRows: s.maxRows || 0 };
      const typeRows = {
        json: [{ label: 'JSON path', key: 'jsonPath', placeholder: 'e.g. data.players', hint: 'Optional: path to the array inside the JSON.' }],
        excel: [{ label: 'Sheet', key: 'sheet', type: 'select', options: [['', 'First sheet'], ...(s.sheets || []).map(n => [n, n])] }, { label: 'Header row', key: 'headerRow', type: 'number', min: 1, hint: 'Row that holds the column names. The file is re-read whenever it is saved.' }],
        xml: [{ label: 'Item element', key: 'itemPath', placeholder: 'auto, or e.g. player  or  /root/players/player', hint: 'The repeating element that becomes one row. Attributes appear as @name.' }],
        rss: [{ label: 'Max items', key: 'maxRows', type: 'number', min: 0, hint: 'Columns: title, description, link, time, image… Bind "title" to a ticker with "All rows" for a headline ticker.' }]
      };
      right.append(F([
        { label: 'Name', key: 'name' },
        { label: 'Type', key: 'type', type: 'select', options: [['csv', 'CSV (file / URL / Google Sheet)'], ['excel', 'Excel (.xlsx) / OpenDocument (.ods)'], ['json', 'JSON (file / API)'], ['xml', 'XML (file / URL)'], ['rss', 'RSS / Atom news feed'], ['text', 'Text lines']], onChange: () => { Object.assign(s, { type: o.type, url: o.url, name: o.name }); drawRight(); } },
        { label: 'File or URL', key: 'url', type: 'file', filters: [{ name: 'Data', extensions: ['csv', 'xlsx', 'xlsm', 'ods', 'json', 'xml', 'rss', 'txt'] }], hint: 'Google Sheets: paste the share link (sheet must be viewable by link).' },
        ...(typeRows[o.type] || []),
        { label: 'Refresh every (s)', key: 'interval', type: 'number', min: 0 }
      ], o), U.el('div', { class: 'inline', style: { margin: '8px 0', display: 'flex', gap: '6px' } }, [
        U.el('button', { class: 'btn primary', text: 'Apply & refresh', onclick: () => { ds.update(s.id, o); setTimeout(drawRight, 800); drawLeft(); } }),
        U.el('button', { class: 'btn danger', text: 'Delete', onclick: () => { ds.remove(s.id); cur = ds.sources[0]?.id; drawLeft(); drawRight(); } })
      ]));
      if (s.error) right.append(U.el('div', { class: 'toast error', text: s.error, style: { animation: 'none', margin: '6px 0' } }));
      // rows
      if (s.rows.length) {
        const tbl = U.el('table', { class: 'tbl' });
        tbl.append(U.el('tr', {}, [U.el('th', { text: '#' }), ...s.columns.slice(0, 8).map(c => U.el('th', { text: c }))]));
        s.rows.slice(0, 200).forEach((r, i) => { const tr = U.el('tr', { style: { cursor: 'pointer', background: i === s.row ? '#3a3426' : '' } }, [U.el('td', { text: String(i + 1) }), ...s.columns.slice(0, 8).map(c => U.el('td', { text: String(r[c] ?? '') }))]); tr.onclick = () => { ds.selectRow(s.id, i); drawRight(); }; tbl.append(tr); });
        right.append(U.el('div', { class: 'hint', text: 'Click a row to send it to the bound titles.', style: { margin: '10px 0 4px' } }), U.el('div', { class: 'list', style: { maxHeight: '180px' } }, [tbl]));
      }
      // bindings
      const titles = st.inputs.filter(i => i.type === 'title');
      const bt = U.el('table', { class: 'tbl', style: { marginTop: '10px' } });
      bt.append(U.el('tr', {}, ['Title input', 'Field', 'Column', 'Rows', ''].map(h => U.el('th', { text: h }))));
      s.bindings.forEach((b, i) => {
        const ti = U.el('select'); for (const t of titles) { const op = U.el('option', { value: t.id, text: t.title }); if (t.id === b.inputId) op.selected = true; ti.append(op); }
        const fi = U.el('select');
        const fillFields = () => { fi.innerHTML = ''; const t = st.byId(ti.value); if (t) for (const e of t.renderer.fields) { const op = U.el('option', { value: e.name, text: e.name }); if (e.name === b.field) op.selected = true; fi.append(op); } b.inputId = ti.value; b.field = fi.value; };
        ti.onchange = fillFields; fillFields(); fi.onchange = () => { b.field = fi.value; };
        const co = U.el('select'); for (const c of s.columns) { const op = U.el('option', { value: c, text: c }); if (c === b.column) op.selected = true; co.append(op); } b.column = b.column || co.value; co.onchange = () => { b.column = co.value; ds.apply(s); };
        const mo = U.el('select', { title: 'Selected row, a row relative to it (e.g. +1 for a second lower third or leaderboard row 2), or all rows joined (tickers, lists)' });
        for (const [v, l] of [['', 'Selected'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ['+' + n, 'Selected +' + n]), ['all', 'All rows']]) mo.append(U.el('option', { value: v, text: l, selected: (b.mode === 'all' ? 'all' : b.rowOffset ? '+' + b.rowOffset : '') === v }));
        mo.onchange = () => { if (mo.value === 'all') { b.mode = 'all'; b.rowOffset = 0; } else { b.mode = ''; b.rowOffset = +mo.value.slice(1) || 0; } ds.apply(s); };
        bt.append(U.el('tr', {}, [U.el('td', {}, [ti]), U.el('td', {}, [fi]), U.el('td', {}, [co]), U.el('td', {}, [mo]), U.el('td', {}, [U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { s.bindings.splice(i, 1); drawRight(); } })])]));
      });
      right.append(U.el('h4', { text: 'BINDINGS', style: { margin: '14px 0 4px', color: 'var(--accent2)', fontSize: '11px', letterSpacing: '.08em' } }), bt,
        U.el('div', { class: 'inline', style: { marginTop: '6px', display: 'flex', gap: '6px' } }, [
          U.el('button', { class: 'btn', text: '＋ Add binding', onclick: () => { if (!titles.length) return U.toast('Add a Title input first', 'error'); s.bindings.push({ inputId: titles[0].id, field: '', column: s.columns[0] || '' }); drawRight(); } }),
          U.el('button', { class: 'btn', text: 'Apply now', onclick: () => ds.apply(s) })
        ]),
        U.el('p', { class: 'hint', text: `API: DataSourceNextRow / DataSourcePreviousRow / DataSourceSelectRow with Value=${s.name}` }));
    };
    drawLeft(); drawRight();
    BTS.Dialog.open({ title: 'Data Sources', body: box, width: 900, buttons: [{ label: 'Close', primary: true }] });
  }

  /* ---------------- external output ---------------- */
  /* ---------------- external / fullscreen outputs (up to 6) ---------------- */
  let extDlg = null, extRefresh = null;
  async function external() {
    const ui = BTS.ui, st = BTS.studio;
    const displays = await window.bts.displays();
    const box = U.el('div');
    const srcOpts = () => [['program', 'Output (program)'], ['preview', 'Preview'], ['multiview', 'Multiview'], ...st.inputs.map(i => ['input:' + i.id, `Input ${i.number}: ${i.title}`])];
    const draw = () => {
      box.innerHTML = '';
      const tbl = U.el('table', { class: 'tbl' });
      tbl.append(U.el('tr', {}, ['#', 'Screen', 'Source', 'Status', ''].map(h => U.el('th', { text: h }))));
      for (let slot = 0; slot < 6; slot++) {
        const x = ui.externals[slot];
        const live = x && x.win && !x.win.closed;
        const disp = U.el('select'); for (const [v, l] of [...displays.map(d => [String(d.id), d.label]), ['', 'Window (resizable)']]) disp.append(U.el('option', { value: v, text: l, selected: live ? String(x.display || '') === v : v === String(displays.find(d => !/primary/.test(d.label))?.id ?? '') }));
        const src = U.el('select'); for (const [v, l] of srcOpts()) src.append(U.el('option', { value: v, text: l, selected: live ? x.source === v : v === 'program' }));
        const btn = live ? U.el('button', { class: 'btn danger', text: 'Stop', onclick: () => { ui.closeExternal(slot); draw(); } })
          : U.el('button', { class: 'btn primary', text: 'Start', onclick: () => { ui.openExternal(disp.value || null, src.value, slot); setTimeout(draw, 400); } });
        tbl.append(U.el('tr', {}, [U.el('td', { text: String(slot + 1) }), U.el('td', {}, [disp]), U.el('td', {}, [src]),
          U.el('td', { html: live ? '<b style="color:var(--pvw)">● Live</b>' : '<span class="hint">Off</span>' }), U.el('td', {}, [btn])]));
      }
      box.append(tbl, U.el('p', { class: 'hint', style: { lineHeight: '1.6' }, text: 'Each output is a clean feed for a projector, LED wall, confidence monitor or a capture device — choose a full screen or a resizable window. Source can be Output, Preview, Multiview or any single input (e.g. a Mix input as a stage feed). Press Esc in an output window to close it.' }));
    };
    draw();
    if (extDlg) extDlg.close();
    extRefresh = draw;
    extDlg = BTS.Dialog.open({ title: 'External Outputs', body: box, width: 760, onClose: () => { extDlg = null; extRefresh = null; } });
  }
  function refreshExternals() { if (extRefresh) extRefresh(); }

  function about() {
    window.bts.info().then(info => {
      BTS.Dialog.open({
        title: 'About BTS Studio', width: 520, body: `
          <div style="text-align:center;padding:10px 0 4px">
            <div style="font-size:30px;font-weight:800;letter-spacing:.02em"><span style="color:var(--accent)">BTS</span> Studio</div>
            <div class="hint" style="margin:4px 0 14px">Live production • switching • streaming • recording</div>
            <div>Version <b>${info.version}</b> (${info.platform}-${info.arch})</div>
            <div class="hint">Electron ${info.electron} • Chromium ${info.chrome}</div>
            <p style="line-height:1.6;margin-top:14px">Free and open-source software for students and creators.<br>© 2026 Bhoomiputra Tech Solutions Pvt Ltd</p>
            <p><a href="#" id="abSite">studio.btspl.tech</a></p>
            <p class="hint" style="line-height:1.5">Uses FFmpeg (LGPL/GPL) for encoding and streaming. See THIRD_PARTY_NOTICES.md for licences.</p>
          </div>`
      });
      setTimeout(() => { const a = U.$('#abSite'); if (a) a.onclick = (e) => { e.preventDefault(); window.bts.shell.open('https://studio.btspl.tech'); }; }, 50);
    });
  }

  function stats() {
    const st = BTS.studio;
    const body = U.el('div', { style: { fontFamily: 'Consolas, monospace', lineHeight: '1.7', minWidth: '520px' } });
    const draw = () => {
      const s = st.stats;
      const outs = st.outputs.summary();
      body.innerHTML = `
        <div>Format: ${st.W}×${st.H} @ ${st.fps} fps</div>
        <div>Render FPS: ${s.fps.toFixed(1)} • Render time: ${s.renderMs.toFixed(2)} ms • Dropped frames: ${s.dropped}</div>
        <div>Inputs: ${st.inputs.length} • Live: ${st.liveSet.size} • GL effects: ${st.gl.ok ? 'GPU' : 'unavailable'}</div>
        <div>Capture codec: ${st.outputs.mime.mime || 'n/a'}</div>
        <div>Audio: ${st.audio.ctx.sampleRate} Hz • state ${st.audio.ctx.state} • base latency ${(st.audio.ctx.baseLatency * 1000).toFixed(1)} ms</div>
        <hr style="border-color:var(--line)">
        ${outs.length ? outs.map(o => `<div>${o.id}: <b>${o.state}</b> ${o.kbps ? o.kbps.toFixed(0) + ' kbps' : ''} ${o.fps ? o.fps.toFixed(0) + ' fps' : ''} ${o.time || ''}</div>`).join('') : '<div class="hint">No active outputs</div>'}`;
    };
    draw();
    const t = setInterval(draw, 1000);
    BTS.Dialog.open({ title: 'Statistics', body, onClose: () => clearInterval(t) });
  }

  /* ---------------- updates ---------------- */
  let updDlg = null;
  function onUpdateStatus(s) {
    if (s.status === 'available') {
      if (updDlg) updDlg.close();
      updDlg = BTS.Dialog.open({
        title: 'Update available', width: 480,
        body: `<p>BTS Studio <b>${U.esc(s.version)}</b> is available.</p>${s.releaseNotes ? `<div class="hint" style="max-height:200px;overflow:auto">${s.releaseNotes}</div>` : ''}<div class="progress" style="margin-top:10px"><i id="updProg"></i></div><div class="hint" id="updTxt" style="margin-top:6px"></div>`,
        onClose: () => { updDlg = null; },
        buttons: [{ label: 'Later' }, { label: 'Download', primary: true, close: false, onClick: () => { window.bts.update.download(); U.$('#updTxt').textContent = 'Starting download…'; return false; } }]
      });
    } else if (s.status === 'downloading') {
      const p = U.$('#updProg'), t = U.$('#updTxt');
      if (p) p.style.width = (s.percent || 0).toFixed(1) + '%';
      if (t) t.textContent = `${(s.percent || 0).toFixed(1)}% • ${((s.bytesPerSecond || 0) / 1048576).toFixed(1)} MB/s`;
    } else if (s.status === 'downloaded') {
      if (updDlg) updDlg.close();
      const live = BTS.studio.outputs.isStreaming() || BTS.studio.outputs.isRecording();
      BTS.Dialog.open({
        title: 'Update ready', width: 460,
        body: `<p>Version <b>${U.esc(s.version)}</b> has been downloaded.</p><p class="hint">${live ? 'You are live — the update will install automatically when you close BTS Studio.' : 'Restart now to install, or it will install when you close the app.'}</p>`,
        buttons: [{ label: 'Later' }, { label: 'Restart & Install', primary: true, onClick: async () => { if (live && !(await BTS.Dialog.confirm('Outputs are active. Restart anyway?', { danger: true }))) return false; await BTS.ui.saveAutosave(); window.bts.update.install(); } }]
      });
    } else if (s.manual) {
      if (s.status === 'none') U.toast(`You have the latest version (${s.version || ''}).`, 'ok');
      else if (s.status === 'error') U.toast('Update check failed: ' + s.message, 'error', 8000);
      else if (s.status === 'dev') U.toast(s.message);
      else if (s.status === 'checking') U.toast('Checking for updates…');
    }
  }

  BTS.SettingsUI = { open, dataSources, external, refreshExternals, about, stats, onUpdateStatus, DEFAULT_SHORTCUTS, keyName, save };
})(window.BTS);
