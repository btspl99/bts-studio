'use strict';
/* global window, document */
window.BTS = window.BTS || {};
(function (BTS) {
  const U = {};

  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.uid = (p = 'i') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.ease = {
    linear: t => t,
    inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    out: t => 1 - Math.pow(1 - t, 3),
    in: t => t * t * t,
    back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  };
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.fmtTime = (sec) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec % 60);
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
  };
  U.fmtTimeMs = (sec) => U.fmtTime(sec) + '.' + String(Math.floor((sec % 1) * 10));
  U.db = (lin) => (lin <= 0.00001 ? -Infinity : 20 * Math.log10(lin));
  U.fromDb = (db) => Math.pow(10, db / 20);
  /** Fader position (0..1) <-> linear gain with broadcast-style taper (0 dB at 0.75, +10 dB max) */
  U.faderToGain = (p) => { if (p <= 0) return 0; const db = p >= 0.75 ? (p - 0.75) / 0.25 * 10 : -60 + (p / 0.75) * 60; return U.fromDb(p < 0.02 ? -96 : db); };
  U.gainToFader = (g) => { if (g <= 0) return 0; const db = U.db(g); if (db >= 0) return U.clamp(0.75 + db / 10 * 0.25, 0, 1); return U.clamp(((db + 60) / 60) * 0.75, 0, 0.75); };
  U.stamp = () => {
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}` };
  };
  U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.el = (tag, attrs = {}, children = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };
  U.fileExt = (p) => (String(p).split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  U.baseName = (p) => String(p).split(/[\\/]/).pop();
  U.VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'm2v', 'ts', 'mts', 'm2ts', 'wmv', 'asf', 'flv', 'f4v', 'ogv', '3gp', '3g2', 'mxf', 'vob', 'dv', 'divx', 'rm', 'rmvb', 'gxf', 'mod', 'tod', 'qt'];
  U.AUDIO_EXT = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus', 'wma', 'aif', 'aiff', 'ac3', 'mp2'];
  U.SLIDES_EXT = ['pdf', 'pptx', 'ppt', 'ppsx', 'pps', 'odp', 'key'];
  U.IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'avif', 'ico'];
  U.HTML_EXT = ['html', 'htm'];
  U.kindOfFile = (p) => {
    const e = U.fileExt(p);
    if (U.VIDEO_EXT.includes(e)) return 'video';
    if (U.AUDIO_EXT.includes(e)) return 'audio-file';
    if (U.IMAGE_EXT.includes(e)) return 'image';
    if (U.HTML_EXT.includes(e)) return 'browser';
    if (U.SLIDES_EXT.includes(e)) return 'slides';
    if (e === 'btsproj') return 'project';
    return null;
  };
  U.toast = (msg, type = 'info', ms = 4500) => {
    const t = U.el('div', { class: 'toast ' + type, text: msg });
    U.$('#toasts').append(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, ms);
  };
  /** Fit (contain) a w×h box into W×H */
  U.fit = (w, h, W, H, mode = 'contain') => {
    if (!w || !h) return { x: 0, y: 0, w: W, h: H };
    const s = mode === 'cover' ? Math.max(W / w, H / h) : mode === 'stretch' ? null : Math.min(W / w, H / h);
    if (s === null) return { x: 0, y: 0, w: W, h: H };
    const dw = w * s, dh = h * s;
    return { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
  };
  U.hexToRgb = (hex) => {
    const h = String(hex || '#000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  U.deepClone = (o) => JSON.parse(JSON.stringify(o));
  U.parseCSV = (text) => {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c !== ''));
  };
  U.getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? +k : k]), obj);

  BTS.U = U;
})(window.BTS);
