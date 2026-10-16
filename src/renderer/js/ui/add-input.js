'use strict';
/** Add Input dialog */
(function (BTS) {
  const U = BTS.U;

  const TYPES = [
    ['camera', '🎥', 'Camera / Capture', 'Webcam, Blackmagic, AVerMedia, Elgato…'],
    ['stream', '📡', 'Stream / IP Cam', 'RTSP, SRT, RTMP, HLS, UDP'],
    ['screen', '🖥️', 'Desktop Capture', 'Screen or application window'],
    ['guest', '📞', 'Remote Guest', 'Callers join from a browser link'],
    ['video', '🎞️', 'Video', 'MP4, MOV, AVI, WMV, MXF, MPEG-2…'],
    ['slides', '📑', 'Slides / PowerPoint', 'PDF, PPTX, Keynote or image folder'],
    ['image', '🖼️', 'Image', 'PNG, JPG, GIF, SVG, WebP'],
    ['playlist', '📃', 'List', 'Playlist of videos & images'],
    ['browser', '🌐', 'Web Browser', 'URL or local HTML overlay'],
    ['title', '🅃', 'Title', 'Lower thirds, scores, clocks'],
    ['color', '🎨', 'Colour', 'Solid, gradient, bars'],
    ['scene', '🧩', 'Scene', 'PiP, side-by-side, layers'],
    ['mix', '🔀', 'Mix', 'A second, independent switcher'],
    ['delay', '⏱️', 'Video Delay', 'Delay any input by up to 10 s'],
    ['audio', '🎙️', 'Audio Input', 'Microphone / line-in'],
    ['audio-file', '🎵', 'Audio File', 'MP3, WAV, AAC, FLAC']
  ];

  async function devices(kind) {
    let list = await navigator.mediaDevices.enumerateDevices();
    if (list.some(d => d.kind === kind && !d.label)) {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: kind === 'audioinput', video: kind === 'videoinput' }); s.getTracks().forEach(t => t.stop()); } catch { /* denied */ }
      list = await navigator.mediaDevices.enumerateDevices();
    }
    return list.filter(d => d.kind === kind);
  }

  function open(type) {
    const st = BTS.studio;
    let current = type || 'camera';
    let build = null; // returns array of input data or null
    const left = U.el('div', { class: 'grid-cards', style: { gridTemplateColumns: '1fr', width: '210px', alignContent: 'start' } });
    const right = U.el('div', { style: { flex: 1, minWidth: '560px', minHeight: '400px' } });
    const body = U.el('div', { style: { display: 'flex', gap: '14px' } }, [left, right]);
    for (const [id, ico, lbl, desc] of TYPES) {
      const c = U.el('div', { class: 'type-card', 'data-t': id, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', textAlign: 'left' } }, [
        U.el('span', { class: 'ico', text: ico, style: { fontSize: '20px', margin: 0 } }),
        U.el('div', {}, [U.el('div', { class: 'lbl', text: lbl }), U.el('div', { class: 'desc', text: desc })])
      ]);
      c.onclick = () => select(id);
      left.append(c);
    }

    async function select(id) {
      if (right._cleanup) { right._cleanup(); right._cleanup = null; }
      current = id;
      U.$$('.type-card', left).forEach(c => c.classList.toggle('on', c.dataset.t === id));
      right.innerHTML = '<div class="hint">Loading…</div>';
      build = await PANES[id](right, st);
    }

    const dlg = BTS.Dialog.open({
      title: 'Add Input', body, width: 960, onClose: () => { if (right._cleanup) right._cleanup(); },
      buttons: [
        { label: 'Cancel' },
        {
          label: 'OK', primary: true, onClick: async () => {
            const list = build ? await build() : null;
            if (!list || !list.length) return false;
            for (const d of list) await st.addInput(d, { select: true });
            const last = st.inputs.at(-1); if (last && !last.noPreview) st.setPreview(last.id);
            return true;
          }
        }
      ]
    });
    select(current);
    return dlg;
  }

  const PANES = {
    async camera(el) {
      const vids = await devices('videoinput');
      const auds = await devices('audioinput');
      const o = { deviceId: vids[0]?.deviceId || '', mode: 'auto', audioDeviceId: 'auto', deinterlace: false, keepLastFrame: true, autoReconnect: true, flipH: false, title: '' };
      el.innerHTML = '';
      if (!vids.length) {
        el.append(U.el('div', { class: 'hint', style: { lineHeight: '1.7' }, html: '<b>No cameras or capture cards found.</b><br>• Connect the device and install its driver (Blackmagic Desktop Video, AVerMedia driver, etc.).<br>• Blackmagic DeckLink / UltraStudio: enable <b>Settings → Devices → Capture backend: DirectShow</b> and restart.<br>• For IP cameras, SRT or RTMP feeds use <b>Stream / IP Cam</b>.' }),
          U.el('button', { class: 'btn', text: 'Refresh devices', onclick: () => PANES.camera(el) }));
        return () => null;
      }
      const video = U.el('video', { muted: true, autoplay: true, playsinline: true, style: { width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '4px', display: 'block' } });
      const info = U.el('div', { class: 'hint', style: { margin: '6px 0' } });
      const hint = U.el('div', { class: 'hint', style: { color: 'var(--accent2)', lineHeight: '1.5' } });
      const modeSel = U.el('select', { style: { width: '100%' } });
      let probe = null;
      const MODES = [['3840x2160@60', '2160p60 (4K)'], ['3840x2160@30', '2160p30 (4K)'], ['3840x2160@25', '2160p25 (4K)'], ['2560x1440@60', '1440p60'], ['2560x1440@30', '1440p30'], ['1920x1080@60', '1080p60'], ['1920x1080@59.94', '1080p59.94'], ['1920x1080@50', '1080p50'], ['1920x1080@30', '1080p30'], ['1920x1080@29.97', '1080p29.97'], ['1920x1080@25', '1080p25'], ['1920x1080@24', '1080p24'], ['1280x720@60', '720p60'], ['1280x720@50', '720p50'], ['1280x720@30', '720p30'], ['1280x720@25', '720p25'], ['720x576@25', '576p25 (PAL SD)'], ['720x480@29.97', '480p29.97 (NTSC SD)'], ['640x480@30', '480p30 (VGA)']];
      const fillModes = (caps) => {
        modeSel.innerHTML = '';
        modeSel.append(U.el('option', { value: 'auto', text: 'Auto — device / signal default' }));
        for (const [v, l] of MODES) {
          const [wh, f] = v.split('@'); const [w, h] = wh.split('x').map(Number);
          if (caps && caps.width && (w > caps.width.max || h > caps.height.max || +f > (caps.frameRate?.max || 60) + 0.5)) continue;
          modeSel.append(U.el('option', { value: v, text: l }));
        }
        modeSel.value = o.mode;
        if (modeSel.value !== o.mode) { modeSel.value = 'auto'; o.mode = 'auto'; }
      };
      modeSel.onchange = () => { o.mode = modeSel.value; };
      const preview = async () => {
        if (probe) probe.getTracks().forEach(t => t.stop());
        video.srcObject = null; info.textContent = 'Opening device…';
        const d = vids.find(v => v.deviceId === o.deviceId);
        hint.textContent = BTS.Inputs.cardHint(d && d.label);
        try {
          probe = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: o.deviceId } } });
          video.srcObject = probe;
          const t = probe.getVideoTracks()[0]; const caps = t.getCapabilities ? t.getCapabilities() : null; const st = t.getSettings();
          info.textContent = `Signal: ${st.width}×${st.height} @ ${Math.round(st.frameRate || 0)} fps` + (caps && caps.width ? ` • Max ${caps.width.max}×${caps.height.max} @ ${Math.round(caps.frameRate?.max || 0)}` : '');
          fillModes(caps);
        } catch (e) { info.textContent = 'Cannot open device: ' + (e.name === 'NotReadableError' ? 'it is busy (close other apps) or has no signal' : e.message || e.name); fillModes(null); }
        const pa = await BTS.Inputs.findPairedAudio(d);
        autoOpt.textContent = 'Auto — ' + (pa ? `paired: ${pa.label}` : 'no matching audio device');
      };
      const devSel = U.el('select', { style: { width: '100%' } });
      for (const d of vids) devSel.append(U.el('option', { value: d.deviceId, text: d.label || 'Camera' }));
      devSel.onchange = () => { o.deviceId = devSel.value; preview(); };
      const audSel = U.el('select', { style: { width: '100%' } });
      const autoOpt = U.el('option', { value: 'auto', text: 'Auto — match capture card audio' });
      audSel.append(autoOpt, U.el('option', { value: 'none', text: 'None (video only)' }), ...auds.map(d => U.el('option', { value: d.deviceId, text: d.label || 'Microphone' })));
      audSel.onchange = () => { o.audioDeviceId = audSel.value; };
      const left = U.el('div', { style: { flex: 1 } }, [video, info, hint]);
      const form = BTS.Dialog.form([
        { label: 'Device', custom: devSel },
        { label: 'Format', custom: modeSel },
        { label: 'Audio', custom: audSel },
        { label: 'Deinterlace', key: 'deinterlace', type: 'checkbox', hint: 'For interlaced sources (1080i50 / 1080i59.94) from broadcast cameras.' },
        { label: 'Hold last frame on signal loss', key: 'keepLastFrame', type: 'checkbox' },
        { label: 'Auto reconnect', key: 'autoReconnect', type: 'checkbox' },
        { label: 'Mirror', key: 'flipH', type: 'checkbox' },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o);
      el.append(U.el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '14px' } }, [left, form]),
        U.el('div', { style: { marginTop: '8px' } }, [U.el('button', { class: 'btn', text: '↻ Refresh devices', onclick: () => { if (probe) probe.getTracks().forEach(t => t.stop()); PANES.camera(el); } })]));
      el._cleanup = () => { if (probe) probe.getTracks().forEach(t => t.stop()); };
      preview();
      return () => {
        if (probe) probe.getTracks().forEach(t => t.stop());
        if (!o.deviceId) { U.toast('No camera selected', 'error'); return null; }
        let w = 0, h = 0, fps = 0;
        if (o.mode !== 'auto') { const [wh, f] = o.mode.split('@'); [w, h] = wh.split('x').map(Number); fps = +f; }
        const label = vids.find(v => v.deviceId === o.deviceId)?.label || 'Camera';
        return [{ type: 'camera', title: o.title || label.replace(/\s*\(.*\)$/, ''), props: { position: { flipH: o.flipH }, effects: { deinterlace: o.deinterlace } },
          cfg: { deviceId: o.deviceId, label, width: w, height: h, fps, audioDeviceId: o.audioDeviceId, keepLastFrame: o.keepLastFrame, autoReconnect: o.autoReconnect } }];
      };
    },

    async stream(el) {
      const o = { url: '', transport: 'tcp', width: 1920, fps: 30, quality: 4, audio: true, lowLatency: true, listen: false, title: '' };
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'Stream URL', key: 'url', placeholder: 'rtsp://user:pass@192.168.1.64:554/Streaming/Channels/101' },
        { custom: U.el('div', { class: 'hint', style: { lineHeight: '1.7' }, html: 'Examples:<br>• IP camera / CCTV: <span class="kbd">rtsp://192.168.1.64:554/stream1</span><br>• SRT (receive from encoder/phone): <span class="kbd">srt://0.0.0.0:9000?mode=listener&amp;latency=200000</span><br>• RTMP pull: <span class="kbd">rtmp://server/live/key</span> • HLS: <span class="kbd">https://…/index.m3u8</span><br>• UDP / MPEG-TS: <span class="kbd">udp://0.0.0.0:1234</span> • NDI: use an NDI → RTSP/SRT bridge' }) },
        { label: 'RTSP transport', key: 'transport', type: 'select', options: [['tcp', 'TCP (reliable, recommended)'], ['udp', 'UDP (lowest latency)']] },
        { label: 'RTMP: listen for incoming', key: 'listen', type: 'checkbox', hint: 'Lets an encoder push to rtmp://THIS-PC:1935/live/key' },
        { label: 'Max width', key: 'width', type: 'select', number: true, options: [[1280, '1280 (720p)'], [1920, '1920 (1080p)'], [3840, '3840 (4K)']] },
        { label: 'Frame rate', key: 'fps', type: 'select', number: true, options: [[25, '25'], [30, '30'], [50, '50'], [60, '60']] },
        { label: 'Quality', key: 'quality', type: 'select', number: true, options: [[2, 'Highest'], [4, 'High'], [7, 'Medium (lower CPU)']] },
        { label: 'Include audio', key: 'audio', type: 'checkbox' },
        { label: 'Low latency', key: 'lowLatency', type: 'checkbox' },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o));
      return () => {
        if (!o.url) { U.toast('Enter a stream URL', 'error'); return null; }
        let host = ''; try { host = new URL(o.url).hostname; } catch { /* noop */ }
        return [{ type: 'stream', title: o.title || ('Stream ' + (host || '')).trim(), cfg: { url: o.url, transport: o.transport, width: o.width, fps: o.fps, quality: o.quality, audio: o.audio, lowLatency: o.lowLatency, listen: o.listen } }];
      };
    },

    async screen(el) {
      const sources = await window.bts.captureSources();
      const o = { sel: sources[0]?.id, cursor: true, audio: false, fps: 30 };
      el.innerHTML = '';
      const grid = U.el('div', { class: 'src-grid' });
      for (const s of sources) {
        const it = U.el('div', { class: 'src-item' + (s.id === o.sel ? ' on' : ''), title: s.name }, [U.el('img', { src: s.thumb }), U.el('div', { text: (s.id.startsWith('screen') ? '🖥 ' : '🗔 ') + s.name })]);
        it.onclick = () => { o.sel = s.id; U.$$('.src-item', grid).forEach(x => x.classList.remove('on')); it.classList.add('on'); };
        grid.append(it);
      }
      el.append(grid, U.el('div', { style: { height: '10px' } }), BTS.Dialog.form([
        { label: 'Show cursor', key: 'cursor', type: 'checkbox' },
        { label: 'Capture system audio', key: 'audio', type: 'checkbox', hint: 'Windows only — captures desktop sound (loopback).' },
        { label: 'Frame rate', key: 'fps', type: 'select', number: true, options: [[15, '15'], [30, '30'], [60, '60']] }
      ], o));
      return () => {
        const s = sources.find(x => x.id === o.sel); if (!s) return null;
        return [{ type: 'screen', title: s.name.slice(0, 40), cfg: { sourceId: s.id, name: s.name, cursor: o.cursor, audio: o.audio, fps: o.fps } }];
      };
    },

    async video(el) { return fileType(el, 'video', 'Video files', U.VIDEO_EXT, true); },
    async 'audio-file'(el) { return fileType(el, 'audio-file', 'Audio files', U.AUDIO_EXT, false); },
    async image(el) { return fileType(el, 'image', 'Images', U.IMAGE_EXT, false); },

    async slides(el) {
      const o = { path: '', folder: '', transition: 'fade', transitionMs: 300, autoAdvance: false, slideSeconds: 8, loop: false, title: '' };
      el.innerHTML = '';
      const lbl = U.el('div', { class: 'li hint', text: 'Nothing selected' });
      const show = () => { lbl.textContent = o.folder ? '📁 ' + o.folder : o.path || 'Nothing selected'; lbl.classList.toggle('hint', !(o.folder || o.path)); };
      const pickFile = async () => { const f = await window.bts.dialog.open({ properties: ['openFile'], filters: [{ name: 'Presentations', extensions: U.SLIDES_EXT }, { name: 'All files', extensions: ['*'] }] }); if (f) { o.path = f[0]; o.folder = ''; show(); } };
      const pickFolder = async () => { const f = await window.bts.dialog.folder(); if (f) { o.folder = f; o.path = ''; show(); } };
      el.append(U.el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } }, [
        U.el('button', { class: 'btn primary', text: 'Presentation / PDF…', onclick: pickFile }),
        U.el('button', { class: 'btn', text: 'Folder of slide images…', onclick: pickFolder })
      ]), U.el('div', { class: 'list' }, [lbl]), U.el('div', { style: { height: '10px' } }));
      el.append(BTS.Dialog.form([
        { label: 'Transition', key: 'transition', type: 'select', options: [['cut', 'Cut'], ['fade', 'Fade'], ['slide', 'Slide (push)']] },
        { label: 'Transition (ms)', key: 'transitionMs', type: 'number', min: 0, max: 3000, step: 50 },
        { label: 'Auto-advance when live', key: 'autoAdvance', type: 'checkbox' },
        { label: 'Seconds per slide', key: 'slideSeconds', type: 'number', min: 1, max: 600 },
        { label: 'Loop', key: 'loop', type: 'checkbox' },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o));
      el.append(U.el('p', { class: 'hint', style: { lineHeight: '1.6' }, html: 'PDF opens directly. <b>PowerPoint</b> (.pptx / .ppt) is converted with Microsoft PowerPoint if installed, otherwise LibreOffice. You can also export the deck as PNG/JPEG (File → Export) and pick that folder. Use <b>Next / Previous</b> on the input, the shortcuts NextItem / PreviousItem, a clicker mapped to them, or the web controller to change slides.' }));
      setTimeout(pickFile, 50);
      return () => {
        if (!o.path && !o.folder) { U.toast('Choose a presentation or a folder', 'error'); return null; }
        const name = o.title || U.baseName(o.path || o.folder).replace(/\.[^.]+$/, '');
        const { title, ...cfg } = o;
        return [{ type: 'slides', title: name, cfg }];
      };
    },

    async guest(el, st) {
      const o = { title: '', password: '', returnSource: 'program', returnKbps: 1500 };
      const n = st.inputs.filter(i => i.type === 'guest').length + 1;
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'Title', key: 'title', placeholder: `Guest ${n}` },
        { label: 'Password (optional)', key: 'password', placeholder: 'Leave empty for none' },
        { label: 'Return feed', key: 'returnSource', type: 'select', options: [['program', 'Program output'], ['preview', 'Preview'], ['multiview', 'Multiview']] },
        { label: 'Return bitrate (kbps)', key: 'returnKbps', type: 'number', min: 300, max: 6000, step: 100 }
      ], o));
      el.append(U.el('div', { class: 'hint', style: { lineHeight: '1.7', marginTop: '10px' }, html:
        'Each Remote Guest input has its own private link. Send it to your guest — they open it in Chrome, Edge, Safari or Firefox, allow camera and microphone, and press <b>Join</b>. No install needed.<br>' +
        '• Guests hear the show without their own voice (<b>mix-minus</b>) and see the return feed you choose.<br>' +
        '• On your network it works straight away. The page uses a self-signed certificate, so the guest taps <i>Advanced → Continue</i> once.<br>' +
        '• For guests outside your network, forward the guest port (Settings → Remote Guests, default 8089) on your router or use a VPN/tunnel, and add a TURN server if a guest cannot connect.' }));
      return () => [{ type: 'guest', title: o.title || `Guest ${n}`, cfg: { password: o.password, returnSource: o.returnSource, returnKbps: o.returnKbps, autoTitle: !o.title } }];
    },

    async playlist(el) {
      const o = { title: 'List', loop: true, shuffle: false, imgDur: 5, items: [] };
      el.innerHTML = '';
      const list = U.el('div', { class: 'list', style: { minHeight: '200px' } });
      const redraw = () => {
        list.innerHTML = '';
        o.items.forEach((it, i) => list.append(U.el('div', { class: 'li' }, [
          U.el('span', { text: `${i + 1}.` }), U.el('span', { class: 'grow', text: U.baseName(it.path), title: it.path }),
          U.el('button', { class: 'tbtn small', text: '▲', onclick: () => { if (i) { [o.items[i - 1], o.items[i]] = [o.items[i], o.items[i - 1]]; redraw(); } } }),
          U.el('button', { class: 'tbtn small', text: '▼', onclick: () => { if (i < o.items.length - 1) { [o.items[i + 1], o.items[i]] = [o.items[i], o.items[i + 1]]; redraw(); } } }),
          U.el('button', { class: 'tbtn small', text: '✕', onclick: () => { o.items.splice(i, 1); redraw(); } })
        ])));
        if (!o.items.length) list.append(U.el('div', { class: 'li hint', text: 'No items — click Add Files' }));
      };
      redraw();
      const add = U.el('button', { class: 'btn', text: '＋ Add Files…', onclick: async () => {
        const f = await window.bts.dialog.open({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: [...U.VIDEO_EXT, ...U.IMAGE_EXT, ...U.AUDIO_EXT] }] });
        if (f) { o.items.push(...f.map(p => ({ path: p, duration: o.imgDur }))); redraw(); }
      } });
      el.append(BTS.Dialog.form([{ label: 'Title', key: 'title' }, { label: 'Loop list', key: 'loop', type: 'checkbox' }, { label: 'Shuffle', key: 'shuffle', type: 'checkbox' }, { label: 'Image duration (s)', key: 'imgDur', type: 'number', min: 1 }], o), U.el('div', { style: { margin: '10px 0 6px' } }, [add]), list);
      return () => {
        if (!o.items.length) { U.toast('Add at least one file', 'error'); return null; }
        o.items.forEach(it => { if (U.kindOfFile(it.path) === 'image') it.duration = o.imgDur; });
        return [{ type: 'playlist', title: o.title, props: { loop: o.loop }, cfg: { items: o.items, shuffle: o.shuffle } }];
      };
    },

    async browser(el, st) {
      const o = { url: 'https://', width: st.W, height: st.H, fps: 30, css: 'body { background-color: rgba(0,0,0,0) !important; margin: 0 auto; overflow: hidden; }', audio: false, title: '' };
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'URL / HTML file', key: 'url', type: 'file', filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] },
        { label: 'Width', key: 'width', type: 'number', min: 64, max: 3840 },
        { label: 'Height', key: 'height', type: 'number', min: 64, max: 2160 },
        { label: 'Frame rate', key: 'fps', type: 'select', number: true, options: [[15, '15'], [25, '25'], [30, '30'], [60, '60']] },
        { label: 'Custom CSS', key: 'css', type: 'textarea', rows: 3, mono: true },
        { label: 'Play page audio', key: 'audio', type: 'checkbox', hint: 'Page audio plays on the system output (not mixed into the stream).' },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o));
      el.append(U.el('p', { class: 'hint', text: 'Transparent backgrounds are preserved — ideal for HTML scoreboards and overlays (e.g. your cricket overlay). Control the page with the BrowserExecute API function.' }));
      return () => {
        if (!o.url || o.url === 'https://') { U.toast('Enter a URL', 'error'); return null; }
        let title = o.title; try { title = title || new URL(/^[a-z]+:/i.test(o.url) ? o.url : 'https://' + o.url).hostname || U.baseName(o.url); } catch { title = U.baseName(o.url); }
        return [{ type: 'browser', title, cfg: { url: o.url, width: o.width, height: o.height, fps: o.fps, css: o.css, audio: o.audio } }];
      };
    },

    async title(el) {
      let sel = 'lower-third';
      el.innerHTML = '';
      const grid = U.el('div', { class: 'grid-cards' });
      for (const [id, name] of BTS.Titles.TEMPLATE_LIST) {
        const t = BTS.Titles.TEMPLATES[id]();
        const r = new BTS.Titles.TitleRenderer(t);
        const c = r.render(performance.now(), true);
        const cv = U.el('canvas', { width: 240, height: 135, style: { width: '100%', background: 'repeating-conic-gradient(#2a2b30 0 25%, #222327 0 50%) 0 0 / 14px 14px', borderRadius: '3px' } });
        cv.getContext('2d').drawImage(c, 0, 0, 240, 135);
        const card = U.el('div', { class: 'type-card' + (id === sel ? ' on' : ''), style: { padding: '6px' } }, [cv, U.el('div', { class: 'lbl', text: name, style: { marginTop: '4px', fontSize: '11px' } })]);
        card.onclick = () => { sel = id; U.$$('.type-card', grid).forEach(x => x.classList.remove('on')); card.classList.add('on'); };
        card.ondblclick = () => { sel = id; BTS.Dialog.top && U.$('.modal-foot .btn.primary', BTS.Dialog.top.el).click(); };
        grid.append(card);
      }
      el.append(grid, U.el('p', { class: 'hint', text: 'After adding, edit text in Input Settings or design your own layout in the Title Designer. Bind fields to CSV/JSON/Google Sheets via Tools → Data Sources.' }));
      return () => [{ type: 'title', title: BTS.Titles.TEMPLATE_LIST.find(x => x[0] === sel)[1].split(' —')[0], cfg: { templateId: sel } }];
    },

    async color(el) {
      const o = { mode: 'solid', color: '#000000', color2: '#3a2a12', title: '' };
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'Type', key: 'mode', type: 'select', options: [['solid', 'Solid colour'], ['gradient', 'Gradient'], ['bars', 'Colour bars (SMPTE)'], ['checker', 'Checkerboard'], ['transparent', 'Transparent (blank)']] },
        { label: 'Colour', key: 'color', type: 'color' },
        { label: 'Colour 2', key: 'color2', type: 'color' },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o));
      return () => [{ type: 'color', title: o.title || ({ solid: 'Colour', gradient: 'Gradient', bars: 'Bars', checker: 'Checker', transparent: 'Blank' }[o.mode]), cfg: { mode: o.mode, color: o.color, color2: o.color2 } }];
    },

    async scene(el, st) {
      const vids = st.inputs.filter(i => i.type !== 'scene' && i.hasVideo);
      const opts = [['', '— none —'], ...vids.map(i => [i.id, `${i.number}. ${i.title}`])];
      const o = { layout: 'pip', a: vids[0]?.id || '', b: vids[1]?.id || '', c: vids[2]?.id || '', d: vids[3]?.id || '', background: '#000000', title: '' };
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'Layout', key: 'layout', type: 'select', options: [['pip', 'Picture-in-Picture (bottom right)'], ['pip-left', 'Picture-in-Picture (top left)'], ['side', 'Side by side'], ['quad', '2×2 grid'], ['three', '1 large + 2 small'], ['blank', 'Blank (add layers later)']] },
        { label: 'Input 1 (main)', key: 'a', type: 'select', options: opts },
        { label: 'Input 2', key: 'b', type: 'select', options: opts },
        { label: 'Input 3', key: 'c', type: 'select', options: opts },
        { label: 'Input 4', key: 'd', type: 'select', options: opts },
        { label: 'Background', key: 'background', type: 'color' },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o));
      el.append(U.el('p', { class: 'hint', text: 'A Scene combines up to 10 layers of other inputs. Fine-tune positions in Input Settings → Layers.' }));
      return () => {
        const L = (id, x, y, w, h) => (id ? { inputId: id, x, y, w, h, visible: true } : null);
        const m = 0.02;
        const lay = {
          pip: [L(o.a, 0, 0, 1, 1), L(o.b, 1 - 0.3 - m, 1 - 0.3 - m * 1.6, 0.3, 0.3)],
          'pip-left': [L(o.a, 0, 0, 1, 1), L(o.b, m, m * 1.6, 0.3, 0.3)],
          side: [L(o.a, 0, 0.25, 0.5, 0.5), L(o.b, 0.5, 0.25, 0.5, 0.5)],
          quad: [L(o.a, 0, 0, 0.5, 0.5), L(o.b, 0.5, 0, 0.5, 0.5), L(o.c, 0, 0.5, 0.5, 0.5), L(o.d, 0.5, 0.5, 0.5, 0.5)],
          three: [L(o.a, 0.02, 0.17, 0.64, 0.64), L(o.b, 0.68, 0.17, 0.3, 0.3), L(o.c, 0.68, 0.51, 0.3, 0.3)],
          blank: []
        }[o.layout].filter(Boolean);
        return [{ type: 'scene', title: o.title || 'Scene', cfg: { layers: lay, background: o.background } }];
      };
    },

    async mix(el, st) {
      const o = { title: 'Mix ' + (st.inputs.filter(i => i.type === 'mix').length + 1), transition: 'Fade', duration: 500 };
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'Title', key: 'title' },
        { label: 'Default transition', key: 'transition', type: 'select', options: BTS.Transitions.list.filter(t => !t.id.startsWith('Stinger')).map(t => [t.id, t.name]) },
        { label: 'Duration (ms)', key: 'duration', type: 'number', min: 0 }
      ], o));
      el.append(U.el('p', { class: 'hint', style: { lineHeight: '1.6' }, text: 'A Mix input is a complete second switcher with its own Preview and Output. Use it as a source anywhere — in a Scene layer, an overlay, or on an External output (for example a separate feed for a stage screen or an ISO record). Switch it from Input Settings → Mix, or with the MixCut / MixFade / MixPreviewInput API functions.' }));
      return () => [{ type: 'mix', title: o.title, cfg: { transition: o.transition, duration: o.duration } }];
    },

    async delay(el, st) {
      const srcs = st.inputs.filter(i => i.hasVideo && !['delay', 'mix'].includes(i.type));
      const o = { sourceId: srcs[0]?.id || '', delayMs: 2000, height: 540, title: '' };
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'Source', key: 'sourceId', type: 'select', options: srcs.length ? srcs.map(i => [i.id, `${i.number}. ${i.title}`]) : [['', 'Add a camera or video first']] },
        { label: 'Delay (ms)', key: 'delayMs', type: 'number', min: 40, max: 10000, step: 40 },
        { label: 'Quality', key: 'height', type: 'select', number: true, options: [[360, '360p (low memory)'], [540, '540p (balanced)'], [720, '720p'], [1080, '1080p (uses a lot of memory)']] },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o));
      el.append(U.el('p', { class: 'hint', style: { lineHeight: '1.6' }, text: 'Delays the picture (and the source\'s sound, if it has any) — for broadcast safety delays, lip-sync fixes, or showing a coach a few seconds behind live. Memory use grows with delay × quality.' }));
      return () => {
        if (!o.sourceId) { U.toast('Choose a source', 'error'); return null; }
        const src = st.byId(o.sourceId);
        return [{ type: 'delay', title: o.title || `${src.title} (+${(o.delayMs / 1000).toFixed(1)}s)`, cfg: { sourceId: o.sourceId, delayMs: o.delayMs, height: o.height } }];
      };
    },

    async audio(el) {
      const auds = await devices('audioinput');
      const o = { deviceId: auds[0]?.deviceId || '', noise: false, echo: false, title: '' };
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'Device', key: 'deviceId', type: 'select', options: auds.length ? auds.map(d => [d.deviceId, d.label || 'Microphone']) : [['', 'No audio inputs found']] },
        { label: 'Noise suppression', key: 'noise', type: 'checkbox' },
        { label: 'Echo cancellation', key: 'echo', type: 'checkbox' },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o));
      return () => {
        if (!o.deviceId) return null;
        const label = auds.find(a => a.deviceId === o.deviceId)?.label || 'Audio';
        return [{ type: 'audio', title: o.title || label.replace(/\s*\(.*\)$/, ''), cfg: { deviceId: o.deviceId, label, noise: o.noise, echo: o.echo } }];
      };
    }
  };

  async function fileType(el, type, name, exts, allowUrl) {
    const o = { files: [], url: '', loop: false };
    el.innerHTML = '';
    const list = U.el('div', { class: 'list', style: { minHeight: '120px' } });
    const redraw = () => { list.innerHTML = ''; for (const f of o.files) list.append(U.el('div', { class: 'li' }, [U.el('span', { class: 'grow', text: f })])); if (!o.files.length) list.append(U.el('div', { class: 'li hint', text: 'No files selected' })); };
    redraw();
    const pick = async () => { const f = await window.bts.dialog.open({ properties: ['openFile', 'multiSelections'], filters: [{ name, extensions: exts }, { name: 'All files', extensions: ['*'] }] }); if (f) { o.files = f; redraw(); } };
    el.append(U.el('div', { style: { marginBottom: '8px' } }, [U.el('button', { class: 'btn primary', text: 'Browse…', onclick: pick })]), list, U.el('div', { style: { height: '10px' } }));
    const rows = [];
    if (type !== 'image') rows.push({ label: 'Loop', key: 'loop', type: 'checkbox' });
    if (allowUrl) rows.push({ label: 'or URL', key: 'url', placeholder: 'https://example.com/video.mp4' });
    el.append(BTS.Dialog.form(rows, o));
    el.append(U.el('p', { class: 'hint', text: 'Tip: you can also drag & drop files onto the inputs area. Selecting several files adds one input per file.' + (type === 'image' ? '' : ' Formats the player cannot decode directly (AVI, WMV, MXF, MPEG-2, VOB, FLV, ProRes…) are converted automatically the first time — progress shows on the input.') }));
    setTimeout(pick, 50);
    return () => {
      const items = [...o.files];
      if (o.url) items.push(o.url);
      if (!items.length) { U.toast('Choose a file', 'error'); return null; }
      return items.map(p => ({ type, title: U.baseName(p).replace(/\.[^.]+$/, ''), props: { loop: o.loop }, cfg: { path: p } }));
    };
  }

  BTS.AddInput = { open, devices };
})(window.BTS);
