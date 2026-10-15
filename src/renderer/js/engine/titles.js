'use strict';
/**
 * Title engine — vector titles (lower thirds, scoreboards, tickers, clocks, countdowns)
 * with named fields (SetText / SetImage), animate-in/out and data-source binding.
 */
(function (BTS) {
  const U = BTS.U;
  const imgCache = new Map();

  function loadImage(src) {
    if (!src) return null;
    if (imgCache.has(src)) return imgCache.get(src);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const url = /^(https?|data|file|blob):/i.test(src) ? src : 'file:///' + String(src).replace(/\\/g, '/').replace(/^\/+/, '');
    img.src = url;
    imgCache.set(src, img);
    return img;
  }

  let elId = 0;
  const E = (o) => ({ id: 'e' + (++elId) + Math.random().toString(36).slice(2, 5), opacity: 1, delay: 0, ...o });

  const BASE_TEXT = { font: 'Segoe UI', weight: 700, italic: false, color: '#ffffff', align: 'left', valign: 'middle', shadow: false, uppercase: false, autoFit: true };

  /* ---------------- built-in templates ---------------- */
  const TEMPLATES = {
    'lower-third': () => ({
      name: 'Lower Third', width: 1920, height: 1080,
      animIn: { type: 'slide-left', duration: 550 }, animOut: { type: 'slide-left', duration: 400 },
      elements: [
        E({ type: 'rect', name: 'Accent', x: 120, y: 820, w: 14, h: 130, fill: '#f0a53a', radius: 0 }),
        E({ type: 'rect', name: 'NameBar', x: 134, y: 820, w: 760, h: 78, fill: '#14161b', fill2: '#262a33', radius: 0, opacity: 0.95, delay: 60 }),
        E({ type: 'rect', name: 'TitleBar', x: 134, y: 898, w: 620, h: 52, fill: '#f0a53a', radius: 0, delay: 120 }),
        E({ type: 'text', name: 'Name', x: 164, y: 820, w: 710, h: 78, text: 'Speaker Name', size: 46, ...BASE_TEXT, delay: 90 }),
        E({ type: 'text', name: 'Title', x: 164, y: 898, w: 580, h: 52, text: 'Designation / Organisation', size: 28, ...BASE_TEXT, weight: 600, color: '#1a1205', delay: 150 })
      ]
    }),
    'lower-third-modern': () => ({
      name: 'Lower Third Modern', width: 1920, height: 1080,
      animIn: { type: 'wipe', duration: 600 }, animOut: { type: 'fade', duration: 350 },
      elements: [
        E({ type: 'rect', name: 'Panel', x: 100, y: 830, w: 820, h: 120, fill: '#ffffff', radius: 14, opacity: 0.96 }),
        E({ type: 'rect', name: 'Badge', x: 116, y: 846, w: 88, h: 88, fill: '#3d8bfd', fill2: '#6a5cff', radius: 44, delay: 80 }),
        E({ type: 'text', name: 'Initials', x: 116, y: 846, w: 88, h: 88, text: 'BT', size: 36, ...BASE_TEXT, align: 'center', delay: 120 }),
        E({ type: 'text', name: 'Name', x: 228, y: 846, w: 670, h: 52, text: 'Guest Name', size: 40, ...BASE_TEXT, color: '#12141a', delay: 100 }),
        E({ type: 'text', name: 'Title', x: 228, y: 896, w: 670, h: 38, text: 'Role • Company', size: 26, ...BASE_TEXT, weight: 500, color: '#5a6070', delay: 160 })
      ]
    }),
    'breaking-news': () => ({
      name: 'Breaking News', width: 1920, height: 1080,
      animIn: { type: 'slide-up', duration: 500 }, animOut: { type: 'slide-up', duration: 400 },
      elements: [
        E({ type: 'rect', name: 'Label', x: 0, y: 880, w: 380, h: 90, fill: '#d91e18', fill2: '#a3120e' }),
        E({ type: 'text', name: 'LabelText', x: 30, y: 880, w: 340, h: 90, text: 'BREAKING NEWS', size: 40, ...BASE_TEXT, weight: 800 }),
        E({ type: 'rect', name: 'HeadBar', x: 380, y: 880, w: 1540, h: 90, fill: '#ffffff' }),
        E({ type: 'text', name: 'Headline', x: 410, y: 880, w: 1480, h: 90, text: 'Headline text goes here', size: 44, ...BASE_TEXT, color: '#111' }),
        E({ type: 'rect', name: 'TickerBar', x: 0, y: 970, w: 1920, h: 56, fill: '#101318' }),
        E({ type: 'clock', name: 'Clock', x: 0, y: 970, w: 160, h: 56, format: 'HH:mm', size: 28, ...BASE_TEXT, align: 'center', color: '#f0a53a' }),
        E({ type: 'ticker', name: 'Ticker', x: 170, y: 970, w: 1750, h: 56, text: 'Scrolling ticker text • Add your updates here • BTS Studio', speed: 140, size: 28, ...BASE_TEXT, weight: 500 })
      ]
    }),
    'cricket-scorebug': () => ({
      name: 'Cricket Score Bar', width: 1920, height: 1080,
      animIn: { type: 'slide-up', duration: 500 }, animOut: { type: 'slide-up', duration: 400 },
      elements: [
        E({ type: 'rect', name: 'Bar', x: 60, y: 950, w: 1800, h: 80, fill: '#0e1a2b', fill2: '#13253d', radius: 6, opacity: 0.97 }),
        E({ type: 'rect', name: 'TeamBox', x: 60, y: 950, w: 240, h: 80, fill: '#f0a53a', radius: 6 }),
        E({ type: 'text', name: 'Team', x: 70, y: 950, w: 220, h: 80, text: 'IND', size: 44, ...BASE_TEXT, weight: 800, color: '#1a1205', align: 'center' }),
        E({ type: 'text', name: 'Score', x: 320, y: 950, w: 220, h: 80, text: '120/3', size: 50, ...BASE_TEXT, weight: 800 }),
        E({ type: 'text', name: 'Overs', x: 530, y: 950, w: 160, h: 80, text: '15.2 ov', size: 28, ...BASE_TEXT, weight: 500, color: '#9fb3cc' }),
        E({ type: 'rect', name: 'Sep1', x: 700, y: 965, w: 2, h: 50, fill: '#2d4566' }),
        E({ type: 'text', name: 'Batter1', x: 720, y: 952, w: 300, h: 40, text: 'Batter One*', size: 26, ...BASE_TEXT, weight: 600 }),
        E({ type: 'text', name: 'Batter1Runs', x: 1020, y: 952, w: 130, h: 40, text: '45 (30)', size: 26, ...BASE_TEXT, align: 'right' }),
        E({ type: 'text', name: 'Batter2', x: 720, y: 990, w: 300, h: 38, text: 'Batter Two', size: 24, ...BASE_TEXT, weight: 500, color: '#c2cfe0' }),
        E({ type: 'text', name: 'Batter2Runs', x: 1020, y: 990, w: 130, h: 38, text: '12 (10)', size: 24, ...BASE_TEXT, weight: 500, align: 'right', color: '#c2cfe0' }),
        E({ type: 'rect', name: 'Sep2', x: 1170, y: 965, w: 2, h: 50, fill: '#2d4566' }),
        E({ type: 'text', name: 'Bowler', x: 1190, y: 952, w: 280, h: 40, text: 'Bowler Name', size: 26, ...BASE_TEXT, weight: 600 }),
        E({ type: 'text', name: 'BowlerFigures', x: 1190, y: 990, w: 280, h: 38, text: '2-20 (3.2)', size: 24, ...BASE_TEXT, weight: 500, color: '#c2cfe0' }),
        E({ type: 'rect', name: 'InfoBox', x: 1490, y: 950, w: 370, h: 80, fill: '#1a3354', radius: 6 }),
        E({ type: 'text', name: 'Info', x: 1505, y: 952, w: 340, h: 40, text: 'CRR 7.83', size: 26, ...BASE_TEXT, align: 'center', color: '#f0a53a' }),
        E({ type: 'text', name: 'Info2', x: 1505, y: 990, w: 340, h: 38, text: 'Need 45 off 28', size: 22, ...BASE_TEXT, weight: 500, align: 'center' })
      ]
    }),
    'sports-score': () => ({
      name: 'Sports Score (2 teams)', width: 1920, height: 1080,
      animIn: { type: 'slide-down', duration: 450 }, animOut: { type: 'fade', duration: 300 },
      elements: [
        E({ type: 'rect', name: 'Bg', x: 60, y: 50, w: 560, h: 64, fill: '#101318', radius: 6, opacity: 0.95 }),
        E({ type: 'rect', name: 'HomeColor', x: 60, y: 50, w: 10, h: 64, fill: '#e2453c' }),
        E({ type: 'text', name: 'Home', x: 82, y: 50, w: 150, h: 64, text: 'HOME', size: 30, ...BASE_TEXT }),
        E({ type: 'rect', name: 'ScoreBox', x: 232, y: 50, w: 156, h: 64, fill: '#f0a53a' }),
        E({ type: 'text', name: 'HomeScore', x: 232, y: 50, w: 70, h: 64, text: '0', size: 38, ...BASE_TEXT, weight: 800, color: '#1a1205', align: 'center' }),
        E({ type: 'text', name: 'AwayScore', x: 318, y: 50, w: 70, h: 64, text: '0', size: 38, ...BASE_TEXT, weight: 800, color: '#1a1205', align: 'center' }),
        E({ type: 'text', name: 'Away', x: 398, y: 50, w: 150, h: 64, text: 'AWAY', size: 30, ...BASE_TEXT, align: 'right' }),
        E({ type: 'rect', name: 'AwayColor', x: 554, y: 50, w: 10, h: 64, fill: '#3d8bfd' }),
        E({ type: 'countdown', name: 'Timer', x: 570, y: 50, w: 50, h: 64, seconds: 0, countUp: true, size: 22, ...BASE_TEXT, weight: 600, align: 'center', color: '#c2cfe0' })
      ]
    }),
    'clock': () => ({
      name: 'Clock', width: 1920, height: 1080,
      animIn: { type: 'fade', duration: 300 }, animOut: { type: 'fade', duration: 300 },
      elements: [
        E({ type: 'rect', name: 'Bg', x: 1640, y: 50, w: 220, h: 64, fill: '#101318', radius: 32, opacity: 0.85 }),
        E({ type: 'clock', name: 'Clock', x: 1640, y: 50, w: 220, h: 64, format: 'HH:mm:ss', size: 32, ...BASE_TEXT, align: 'center' })
      ]
    }),
    'countdown': () => ({
      name: 'Countdown', width: 1920, height: 1080,
      animIn: { type: 'zoom', duration: 450 }, animOut: { type: 'fade', duration: 300 },
      elements: [
        E({ type: 'rect', name: 'Bg', x: 0, y: 0, w: 1920, h: 1080, fill: '#0b0d12', fill2: '#1a2233' }),
        E({ type: 'text', name: 'Heading', x: 0, y: 330, w: 1920, h: 90, text: 'WE WILL BE LIVE IN', size: 56, ...BASE_TEXT, align: 'center', color: '#f0a53a' }),
        E({ type: 'countdown', name: 'Countdown', x: 0, y: 430, w: 1920, h: 240, seconds: 300, size: 200, ...BASE_TEXT, align: 'center', weight: 800 }),
        E({ type: 'text', name: 'Sub', x: 0, y: 690, w: 1920, h: 70, text: 'Stay tuned', size: 38, ...BASE_TEXT, align: 'center', weight: 500, color: '#a9adb7' })
      ]
    }),
    'fullscreen-title': () => ({
      name: 'Full Screen Title', width: 1920, height: 1080,
      animIn: { type: 'fade', duration: 600 }, animOut: { type: 'fade', duration: 500 },
      elements: [
        E({ type: 'rect', name: 'Bg', x: 0, y: 0, w: 1920, h: 1080, fill: '#0e1117', fill2: '#24180a' }),
        E({ type: 'rect', name: 'Line', x: 760, y: 600, w: 400, h: 6, fill: '#f0a53a', delay: 200 }),
        E({ type: 'text', name: 'Title', x: 100, y: 420, w: 1720, h: 160, text: 'EVENT TITLE', size: 120, ...BASE_TEXT, align: 'center', weight: 800, delay: 100 }),
        E({ type: 'text', name: 'Subtitle', x: 100, y: 630, w: 1720, h: 80, text: 'Subtitle / Date / Venue', size: 44, ...BASE_TEXT, align: 'center', weight: 400, color: '#c9ccd4', delay: 300 })
      ]
    }),
    'social': () => ({
      name: 'Social Handle', width: 1920, height: 1080,
      animIn: { type: 'slide-left', duration: 500 }, animOut: { type: 'slide-left', duration: 400 },
      elements: [
        E({ type: 'rect', name: 'Bg', x: 1440, y: 960, w: 420, h: 60, fill: '#101318', radius: 30, opacity: 0.9 }),
        E({ type: 'rect', name: 'Dot', x: 1450, y: 970, w: 40, h: 40, fill: '#e2453c', fill2: '#f0a53a', radius: 20 }),
        E({ type: 'text', name: 'Handle', x: 1505, y: 960, w: 340, h: 60, text: '@btspl.tech', size: 30, ...BASE_TEXT, weight: 600 })
      ]
    }),
    'up-next': () => ({
      name: 'Up Next', width: 1920, height: 1080,
      animIn: { type: 'slide-right', duration: 500 }, animOut: { type: 'slide-right', duration: 400 },
      elements: [
        E({ type: 'rect', name: 'Label', x: 1420, y: 120, w: 440, h: 50, fill: '#f0a53a' }),
        E({ type: 'text', name: 'LabelText', x: 1440, y: 120, w: 400, h: 50, text: 'UP NEXT', size: 28, ...BASE_TEXT, weight: 800, color: '#1a1205' }),
        E({ type: 'rect', name: 'Panel', x: 1420, y: 170, w: 440, h: 120, fill: '#101318', opacity: 0.94, delay: 80 }),
        E({ type: 'text', name: 'Next', x: 1440, y: 175, w: 400, h: 70, text: 'Next Segment', size: 38, ...BASE_TEXT, delay: 120 }),
        E({ type: 'text', name: 'When', x: 1440, y: 240, w: 400, h: 40, text: 'in 5 minutes', size: 24, ...BASE_TEXT, weight: 500, color: '#a9adb7', delay: 160 })
      ]
    }),
    'blank': () => ({ name: 'Blank Title', width: 1920, height: 1080, animIn: { type: 'fade', duration: 300 }, animOut: { type: 'fade', duration: 300 }, elements: [] })
  };

  const TEMPLATE_LIST = [
    ['lower-third', 'Lower Third — Classic'], ['lower-third-modern', 'Lower Third — Modern'], ['breaking-news', 'Breaking News + Ticker'],
    ['cricket-scorebug', 'Cricket Score Bar'], ['sports-score', 'Sports Score (2 teams)'], ['clock', 'Clock'], ['countdown', 'Countdown'],
    ['fullscreen-title', 'Full Screen Title'], ['social', 'Social Handle'], ['up-next', 'Up Next'], ['blank', 'Blank (design your own)']
  ];

  function pad(n, l = 2) { return String(n).padStart(l, '0'); }
  function formatClock(fmt, d = new Date()) {
    const h12 = d.getHours() % 12 || 12;
    return (fmt || 'HH:mm:ss').replace(/HH/g, pad(d.getHours())).replace(/hh/g, pad(h12)).replace(/mm/g, pad(d.getMinutes())).replace(/ss/g, pad(d.getSeconds()))
      .replace(/A/g, d.getHours() < 12 ? 'AM' : 'PM').replace(/dd/g, pad(d.getDate())).replace(/MM/g, pad(d.getMonth() + 1)).replace(/yyyy/g, d.getFullYear());
  }
  function formatTimer(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  class TitleRenderer {
    constructor(template) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.timers = {}; // element id -> {running, base, startedAt}
      this.tickers = {};
      this.setTemplate(template);
      this.progress = 1;     // 0 hidden .. 1 shown
      this.animDir = 0;      // +1 in, -1 out
      this.animStart = 0;
      this.animate = true;
    }
    setTemplate(t) {
      this.t = t;
      this.canvas.width = t.width || 1920;
      this.canvas.height = t.height || 1080;
      for (const e of t.elements) if (e.type === 'countdown' && !this.timers[e.id]) this.timers[e.id] = { running: false, value: e.seconds || 0, startedAt: 0 };
    }
    get fields() { return this.t.elements.filter(e => ['text', 'image', 'countdown', 'ticker', 'rect'].includes(e.type)); }
    find(name) { const n = String(name).toLowerCase().replace(/\.(text|source|fill)$/, ''); return this.t.elements.find(e => e.name.toLowerCase() === n || e.id === name); }
    setText(name, value) { const e = this.find(name); if (!e) return false; if (e.type === 'countdown') { this.setTimer(e, value); return true; } e.text = String(value ?? ''); return true; }
    setImage(name, src) { const e = this.find(name); if (!e || e.type !== 'image') return false; e.src = src; return true; }
    setColor(name, color) { const e = this.find(name); if (!e) return false; if (e.type === 'rect') { e.fill = color; e.fill2 = null; } else e.color = color; return true; }
    setTimer(e, value) {
      let sec = Number(value);
      if (isNaN(sec) && typeof value === 'string') { const p = value.split(':').map(Number); sec = p.reduce((a, b) => a * 60 + b, 0); }
      this.timers[e.id] = { running: false, value: sec || 0, startedAt: 0 };
      e.seconds = sec || 0;
    }
    timerCmd(name, cmd) {
      const list = name ? [this.find(name)].filter(Boolean) : this.t.elements.filter(e => e.type === 'countdown');
      for (const e of list) {
        const tm = this.timers[e.id] || (this.timers[e.id] = { running: false, value: e.seconds || 0, startedAt: 0 });
        const cur = this.timerValue(e);
        if (cmd === 'start' && !tm.running) { tm.running = true; tm.value = cur; tm.startedAt = performance.now(); }
        if (cmd === 'stop' && tm.running) { tm.running = false; tm.value = cur; }
        if (cmd === 'toggle') this.timerCmd(e.name, tm.running ? 'stop' : 'start');
        if (cmd === 'reset') { tm.running = false; tm.value = e.seconds || 0; }
      }
    }
    timerValue(e) {
      const tm = this.timers[e.id];
      if (!tm) return e.seconds || 0;
      if (!tm.running) return tm.value;
      const el = (performance.now() - tm.startedAt) / 1000;
      return e.countUp ? tm.value + el : Math.max(0, tm.value - el);
    }

    transitionIn() { if (!this.animate || !this.t.animIn || this.t.animIn.type === 'none') { this.progress = 1; this.animDir = 0; return 0; } this.animDir = 1; this.animStart = performance.now(); this.progress = 0; return this.t.animIn.duration || 500; }
    transitionOut() { if (!this.animate || !this.t.animOut || this.t.animOut.type === 'none') { this.progress = 0; this.animDir = 0; return 0; } this.animDir = -1; this.animStart = performance.now(); return (this.t.animOut.duration || 400) + this._maxDelay(); }
    show() { this.progress = 1; this.animDir = 0; }
    _maxDelay() { return Math.max(0, ...this.t.elements.map(e => e.delay || 0)); }

    render(now = performance.now(), editing = false) {
      const { ctx, t } = this;
      const W = this.canvas.width, H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);
      const dir = this.animDir;
      const anim = dir > 0 ? t.animIn : t.animOut;
      const elapsed = now - this.animStart;
      if (dir !== 0) {
        const total = (anim.duration || 500) + this._maxDelay();
        if (elapsed >= total) { this.progress = dir > 0 ? 1 : 0; this.animDir = 0; }
      }
      if (!editing && this.animDir === 0 && this.progress === 0) return this.canvas;
      for (const e of t.elements) {
        if (e.hidden) continue;
        let p = 1;
        if (!editing && this.animDir !== 0) {
          const d = anim.duration || 500;
          const local = U.clamp((elapsed - (dir > 0 ? (e.delay || 0) : 0)) / d, 0, 1);
          p = dir > 0 ? U.ease.out(local) : 1 - U.ease.in(local);
        } else if (!editing) p = this.progress;
        if (p <= 0) continue;
        ctx.save();
        this._applyAnim(ctx, e, anim ? anim.type : 'fade', p, W, H);
        ctx.globalAlpha *= (e.opacity ?? 1);
        this._drawEl(ctx, e, now);
        ctx.restore();
      }
      return this.canvas;
    }

    _applyAnim(ctx, e, type, p, W, H) {
      if (p >= 1) return;
      switch (type) {
        case 'slide-left': ctx.translate(-(1 - p) * (e.x + e.w + 40), 0); break;
        case 'slide-right': ctx.translate((1 - p) * (W - e.x + 40), 0); break;
        case 'slide-up': ctx.translate(0, (1 - p) * (H - e.y + 40)); break;
        case 'slide-down': ctx.translate(0, -(1 - p) * (e.y + e.h + 40)); break;
        case 'wipe': ctx.beginPath(); ctx.rect(e.x, e.y - 2, e.w * p, e.h + 4); ctx.clip(); break;
        case 'zoom': { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; ctx.translate(cx, cy); ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p); ctx.translate(-cx, -cy); ctx.globalAlpha *= p; break; }
        case 'fade': default: ctx.globalAlpha *= p;
      }
    }

    _fillStyle(ctx, e) {
      if (e.fill2) { const g = ctx.createLinearGradient(e.x, e.y, e.x + e.w, e.y + e.h); g.addColorStop(0, e.fill); g.addColorStop(1, e.fill2); return g; }
      return e.fill || '#000';
    }

    _text(ctx, e, str) {
      if (e.uppercase) str = str.toUpperCase();
      let size = e.size || 32;
      const font = (s) => `${e.italic ? 'italic ' : ''}${e.weight || 600} ${s}px "${e.font || 'Segoe UI'}", "Segoe UI", system-ui, sans-serif`;
      ctx.font = font(size);
      if (e.autoFit !== false) { let w = ctx.measureText(str).width; while (w > e.w && size > 8) { size -= 1; ctx.font = font(size); w = ctx.measureText(str).width; } }
      ctx.fillStyle = e.color || '#fff';
      ctx.textAlign = e.align || 'left';
      ctx.textBaseline = 'middle';
      if (e.shadow) { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = size * 0.15; ctx.shadowOffsetY = size * 0.05; }
      const x = e.align === 'center' ? e.x + e.w / 2 : e.align === 'right' ? e.x + e.w : e.x;
      const y = e.valign === 'top' ? e.y + size * 0.6 : e.valign === 'bottom' ? e.y + e.h - size * 0.45 : e.y + e.h / 2 + size * 0.04;
      if (e.stroke && e.strokeWidth) { ctx.lineWidth = e.strokeWidth; ctx.strokeStyle = e.stroke; ctx.strokeText(str, x, y); }
      ctx.fillText(str, x, y);
    }

    _drawEl(ctx, e, now) {
      switch (e.type) {
        case 'rect': {
          ctx.fillStyle = this._fillStyle(ctx, e);
          ctx.beginPath();
          if (e.radius) ctx.roundRect(e.x, e.y, e.w, e.h, Math.min(e.radius, e.h / 2, e.w / 2)); else ctx.rect(e.x, e.y, e.w, e.h);
          ctx.fill();
          if (e.stroke && e.strokeWidth) { ctx.lineWidth = e.strokeWidth; ctx.strokeStyle = e.stroke; ctx.stroke(); }
          break;
        }
        case 'text': this._text(ctx, e, String(e.text ?? '')); break;
        case 'clock': this._text(ctx, e, formatClock(e.format)); break;
        case 'countdown': this._text(ctx, e, formatTimer(this.timerValue(e))); break;
        case 'image': {
          const img = loadImage(e.src);
          if (img && img.complete && img.naturalWidth) {
            const r = U.fit(img.naturalWidth, img.naturalHeight, e.w, e.h, e.fit || 'contain');
            if (e.radius) { ctx.beginPath(); ctx.roundRect(e.x, e.y, e.w, e.h, e.radius); ctx.clip(); }
            ctx.drawImage(img, e.x + r.x, e.y + r.y, r.w, r.h);
          } else if (!e.src) {
            ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.setLineDash([6, 6]); ctx.strokeRect(e.x, e.y, e.w, e.h);
          }
          break;
        }
        case 'ticker': {
          ctx.beginPath(); ctx.rect(e.x, e.y, e.w, e.h); ctx.clip();
          const size = e.size || 28;
          ctx.font = `${e.italic ? 'italic ' : ''}${e.weight || 500} ${size}px "${e.font || 'Segoe UI'}", "Segoe UI", sans-serif`;
          ctx.fillStyle = e.color || '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          const txt = (e.uppercase ? String(e.text).toUpperCase() : String(e.text)) + '      •      ';
          const tw = Math.max(1, ctx.measureText(txt).width);
          const st = this.tickers[e.id] || (this.tickers[e.id] = { t0: now });
          const off = ((now - st.t0) / 1000 * (e.speed || 120)) % tw;
          for (let x = e.x - off; x < e.x + e.w; x += tw) ctx.fillText(txt, x, e.y + e.h / 2);
          break;
        }
      }
    }
  }

  BTS.Titles = { TEMPLATES, TEMPLATE_LIST, TitleRenderer, loadImage, formatClock, newElement: E, BASE_TEXT };
})(window.BTS);
