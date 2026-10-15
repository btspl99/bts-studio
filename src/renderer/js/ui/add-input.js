'use strict';
/** Add Input dialog */
(function (BTS) {
  const U = BTS.U;

  const TYPES = [
    ['camera', '🎥', 'Camera', 'Webcam, capture card, NDI virtual cam'],
    ['screen', '🖥️', 'Desktop Capture', 'Screen or application window'],
    ['video', '🎞️', 'Video', 'MP4, MOV, MKV, WebM… or URL'],
    ['image', '🖼️', 'Image', 'PNG, JPG, GIF, SVG, WebP'],
    ['playlist', '📃', 'List', 'Playlist of videos & images'],
    ['browser', '🌐', 'Web Browser', 'URL or local HTML overlay'],
    ['title', '🅃', 'Title / XAML-free', 'Lower thirds, scores, clocks'],
    ['color', '🎨', 'Colour', 'Solid, gradient, bars'],
    ['scene', '🧩', 'Scene', 'PiP, side-by-side, layers'],
    ['audio', '🎙️', 'Audio Input', 'Microphone / line-in'],
    ['audio-file', '🎵', 'Audio File', 'MP3, WAV, AAC, FLAC']
  ];
  TYPES[6][2] = 'Title';

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
      current = id;
      U.$$('.type-card', left).forEach(c => c.classList.toggle('on', c.dataset.t === id));
      right.innerHTML = '<div class="hint">Loading…</div>';
      build = await PANES[id](right, st);
    }

    const dlg = BTS.Dialog.open({
      title: 'Add Input', body, width: 860,
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
      const o = { deviceId: vids[0]?.deviceId || '', res: '1920x1080', fps: 30, audioDeviceId: 'none', title: '' };
      el.innerHTML = '';
      el.append(BTS.Dialog.form([
        { label: 'Device', key: 'deviceId', type: 'select', options: vids.length ? vids.map(d => [d.deviceId, d.label || 'Camera']) : [['', 'No cameras found']] },
        { label: 'Resolution', key: 'res', type: 'select', options: [['640x360', '360p'], ['1280x720', '720p HD'], ['1920x1080', '1080p Full HD'], ['2560x1440', '1440p'], ['3840x2160', '2160p 4K']] },
        { label: 'Frame rate', key: 'fps', type: 'select', number: true, options: [[25, '25'], [30, '30'], [50, '50'], [60, '60']] },
        { label: 'Audio', key: 'audioDeviceId', type: 'select', options: [['none', 'None (video only)'], ...auds.map(d => [d.deviceId, d.label || 'Microphone'])] },
        { label: 'Title', key: 'title', placeholder: 'Optional' }
      ], o));
      el.append(U.el('p', { class: 'hint', text: 'Capture cards (e.g. HDMI-USB) appear as cameras. NDI sources can be used through NDI Webcam Input / NDI Virtual Input.' }));
      return () => {
        if (!o.deviceId) { U.toast('No camera selected', 'error'); return null; }
        const [w, h] = o.res.split('x').map(Number);
        const label = vids.find(v => v.deviceId === o.deviceId)?.label || 'Camera';
        return [{ type: 'camera', title: o.title || label.replace(/\s*\(.*\)$/, ''), cfg: { deviceId: o.deviceId, label, width: w, height: h, fps: o.fps, audioDeviceId: o.audioDeviceId } }];
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
    el.append(U.el('p', { class: 'hint', text: 'Tip: you can also drag & drop files onto the inputs area. Selecting several files adds one input per file.' }));
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
