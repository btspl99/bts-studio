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
    'lower-third-logo': () => ({
      name: 'Lower Third + Logo', width: 1920, height: 1080,
      animIn: { type: 'slide-left', duration: 550 }, animOut: { type: 'slide-left', duration: 400 },
      elements: [
        E({ type: 'rect', name: 'LogoBox', x: 110, y: 812, w: 146, h: 146, fill: '#ffffff', radius: 10 }),
        E({ type: 'image', name: 'Logo', x: 120, y: 822, w: 126, h: 126, src: '', fit: 'contain', delay: 60 }),
        E({ type: 'rect', name: 'NameBar', x: 256, y: 812, w: 760, h: 86, fill: '#0f2d52', fill2: '#173f70', delay: 80 }),
        E({ type: 'rect', name: 'TitleBar', x: 256, y: 898, w: 640, h: 60, fill: '#ffffff', delay: 140 }),
        E({ type: 'text', name: 'Name', x: 286, y: 812, w: 710, h: 86, text: 'Guest Name', size: 48, ...BASE_TEXT, delay: 110, typewriter: false }),
        E({ type: 'text', name: 'Title', x: 286, y: 898, w: 590, h: 60, text: 'Designation • Organisation', size: 30, ...BASE_TEXT, weight: 600, color: '#0f2d52', delay: 170 })
      ]
    }),
    'news-strap': () => ({
      name: 'News Strap (2 lines)', width: 1920, height: 1080,
      animIn: { type: 'wipe', duration: 500 }, animOut: { type: 'fade', duration: 300 },
      elements: [
        E({ type: 'rect', name: 'Tag', x: 80, y: 820, w: 230, h: 56, fill: '#d91e18' }),
        E({ type: 'text', name: 'TagText', x: 80, y: 820, w: 230, h: 56, text: 'LIVE', size: 34, ...BASE_TEXT, weight: 800, align: 'center' }),
        E({ type: 'rect', name: 'Strap', x: 80, y: 876, w: 1760, h: 92, fill: '#ffffff', delay: 60 }),
        E({ type: 'text', name: 'Headline', x: 110, y: 876, w: 1700, h: 92, text: 'Main headline of the story goes here', size: 50, ...BASE_TEXT, color: '#111', delay: 100, typewriter: true }),
        E({ type: 'rect', name: 'SubBar', x: 80, y: 968, w: 1760, h: 50, fill: '#13161c', delay: 120 }),
        E({ type: 'text', name: 'Sub', x: 110, y: 968, w: 1700, h: 50, text: 'Location • supporting detail', size: 28, ...BASE_TEXT, weight: 500, delay: 160 })
      ]
    }),
    'live-bug': () => ({
      name: 'LIVE Bug', width: 1920, height: 1080,
      animIn: { type: 'fade', duration: 300 }, animOut: { type: 'fade', duration: 300 },
      elements: [
        E({ type: 'rect', name: 'Live', x: 60, y: 50, w: 120, h: 50, fill: '#e2453c', radius: 6 }),
        E({ type: 'text', name: 'LiveText', x: 60, y: 50, w: 120, h: 50, text: '● LIVE', size: 26, ...BASE_TEXT, weight: 800, align: 'center' }),
        E({ type: 'rect', name: 'ClockBg', x: 186, y: 50, w: 150, h: 50, fill: '#101318', radius: 6, opacity: 0.85 }),
        E({ type: 'clock', name: 'Clock', x: 186, y: 50, w: 150, h: 50, format: 'HH:mm', size: 26, ...BASE_TEXT, align: 'center' })
      ]
    }),
    'quote': () => ({
      name: 'Quote', width: 1920, height: 1080,
      animIn: { type: 'fade', duration: 500 }, animOut: { type: 'fade', duration: 400 },
      elements: [
        E({ type: 'rect', name: 'Panel', x: 260, y: 300, w: 1400, h: 440, fill: '#0f1218', opacity: 0.92, radius: 16 }),
        E({ type: 'text', name: 'Mark', x: 300, y: 300, w: 120, h: 160, text: '“', size: 200, ...BASE_TEXT, color: '#f0a53a' }),
        E({ type: 'text', name: 'Quote', x: 380, y: 380, w: 1200, h: 200, text: 'An inspiring quote goes here.', size: 56, ...BASE_TEXT, weight: 500, italic: true, align: 'center', typewriter: true, delay: 150 }),
        E({ type: 'text', name: 'Author', x: 380, y: 620, w: 1200, h: 60, text: '— Author Name', size: 34, ...BASE_TEXT, weight: 600, color: '#f0a53a', align: 'center', delay: 400 })
      ]
    }),
    'leaderboard': () => {
      const els = [E({ type: 'rect', name: 'Panel', x: 560, y: 180, w: 800, h: 720, fill: '#0f1218', opacity: 0.95, radius: 14 }),
        E({ type: 'rect', name: 'Header', x: 560, y: 180, w: 800, h: 90, fill: '#f0a53a', radius: 14 }),
        E({ type: 'text', name: 'Heading', x: 600, y: 180, w: 720, h: 90, text: 'LEADERBOARD', size: 46, ...BASE_TEXT, weight: 800, color: '#1a1205', align: 'center' })];
      for (let i = 1; i <= 8; i++) {
        const y = 290 + (i - 1) * 74;
        els.push(E({ type: 'rect', name: 'Row' + i, x: 580, y, w: 760, h: 64, fill: i % 2 ? '#1b2030' : '#151925', radius: 6, delay: i * 50 }));
        els.push(E({ type: 'text', name: 'Pos' + i, x: 600, y, w: 60, h: 64, text: String(i), size: 30, ...BASE_TEXT, color: '#f0a53a', align: 'center', delay: i * 50 }));
        els.push(E({ type: 'text', name: 'Name' + i, x: 680, y, w: 480, h: 64, text: 'Name ' + i, size: 30, ...BASE_TEXT, weight: 600, delay: i * 50 }));
        els.push(E({ type: 'text', name: 'Score' + i, x: 1170, y, w: 150, h: 64, text: '0', size: 30, ...BASE_TEXT, align: 'right', delay: i * 50 }));
      }
      return { name: 'Leaderboard (8 rows)', width: 1920, height: 1080, animIn: { type: 'slide-up', duration: 500 }, animOut: { type: 'fade', duration: 300 }, elements: els };
    },
    'cricket-batting-card': () => {
      const els = [E({ type: 'rect', name: 'Panel', x: 360, y: 150, w: 1200, h: 780, fill: '#0e1a2b', opacity: 0.97, radius: 12 }),
        E({ type: 'rect', name: 'Header', x: 360, y: 150, w: 1200, h: 90, fill: '#f0a53a', radius: 12 }),
        E({ type: 'text', name: 'Team', x: 400, y: 150, w: 700, h: 90, text: 'INDIA — BATTING', size: 44, ...BASE_TEXT, weight: 800, color: '#1a1205' }),
        E({ type: 'text', name: 'Total', x: 1100, y: 150, w: 420, h: 90, text: '245/6 (40.0)', size: 44, ...BASE_TEXT, weight: 800, color: '#1a1205', align: 'right' }),
        E({ type: 'text', name: 'ColR', x: 1100, y: 250, w: 100, h: 40, text: 'R', size: 24, ...BASE_TEXT, color: '#9fb3cc', align: 'right' }),
        E({ type: 'text', name: 'ColB', x: 1210, y: 250, w: 100, h: 40, text: 'B', size: 24, ...BASE_TEXT, color: '#9fb3cc', align: 'right' }),
        E({ type: 'text', name: 'ColSR', x: 1330, y: 250, w: 190, h: 40, text: '4s / 6s', size: 24, ...BASE_TEXT, color: '#9fb3cc', align: 'right' })];
      for (let i = 1; i <= 8; i++) {
        const y = 290 + (i - 1) * 76;
        els.push(E({ type: 'rect', name: 'Row' + i, x: 380, y, w: 1160, h: 66, fill: i % 2 ? '#13253d' : '#102036', radius: 4, delay: i * 40 }));
        els.push(E({ type: 'text', name: 'Batter' + i, x: 400, y: y + 2, w: 420, h: 36, text: 'Batter ' + i, size: 28, ...BASE_TEXT, weight: 600, delay: i * 40 }));
        els.push(E({ type: 'text', name: 'Dismissal' + i, x: 400, y: y + 34, w: 680, h: 28, text: 'c Fielder b Bowler', size: 20, ...BASE_TEXT, weight: 400, color: '#9fb3cc', delay: i * 40 }));
        els.push(E({ type: 'text', name: 'R' + i, x: 1100, y, w: 100, h: 66, text: '0', size: 30, ...BASE_TEXT, align: 'right', delay: i * 40 }));
        els.push(E({ type: 'text', name: 'B' + i, x: 1210, y, w: 100, h: 66, text: '0', size: 26, ...BASE_TEXT, weight: 500, color: '#c2cfe0', align: 'right', delay: i * 40 }));
        els.push(E({ type: 'text', name: 'X' + i, x: 1330, y, w: 190, h: 66, text: '0 / 0', size: 26, ...BASE_TEXT, weight: 500, color: '#c2cfe0', align: 'right', delay: i * 40 }));
      }
      return { name: 'Cricket Batting Card', width: 1920, height: 1080, animIn: { type: 'fade', duration: 450 }, animOut: { type: 'fade', duration: 300 }, elements: els };
    },
    'match-intro': () => ({
      name: 'Match Intro (Team vs Team)', width: 1920, height: 1080,
      animIn: { type: 'zoom', duration: 600 }, animOut: { type: 'fade', duration: 400 },
      elements: [
        E({ type: 'rect', name: 'Bg', x: 0, y: 0, w: 1920, h: 1080, fill: '#0b1220', fill2: '#2a1606' }),
        E({ type: 'image', name: 'LogoA', x: 260, y: 300, w: 360, h: 360, src: '', delay: 100 }),
        E({ type: 'image', name: 'LogoB', x: 1300, y: 300, w: 360, h: 360, src: '', delay: 100 }),
        E({ type: 'text', name: 'TeamA', x: 160, y: 690, w: 560, h: 90, text: 'TEAM A', size: 64, ...BASE_TEXT, weight: 800, align: 'center', delay: 200 }),
        E({ type: 'text', name: 'TeamB', x: 1200, y: 690, w: 560, h: 90, text: 'TEAM B', size: 64, ...BASE_TEXT, weight: 800, align: 'center', delay: 200 }),
        E({ type: 'text', name: 'VS', x: 760, y: 420, w: 400, h: 160, text: 'VS', size: 140, ...BASE_TEXT, weight: 900, align: 'center', color: '#f0a53a', delay: 300 }),
        E({ type: 'text', name: 'Event', x: 160, y: 120, w: 1600, h: 90, text: 'TOURNAMENT NAME 2026', size: 56, ...BASE_TEXT, weight: 700, align: 'center', delay: 0 }),
        E({ type: 'text', name: 'Venue', x: 160, y: 860, w: 1600, h: 70, text: 'Venue • Date • Time', size: 36, ...BASE_TEXT, weight: 500, align: 'center', color: '#c9ccd4', delay: 350 })
      ]
    }),
    'end-credits': () => ({
      name: 'End Credits (roll)', width: 1920, height: 1080,
      animIn: { type: 'fade', duration: 500 }, animOut: { type: 'fade', duration: 500 },
      elements: [
        E({ type: 'rect', name: 'Bg', x: 0, y: 0, w: 1920, h: 1080, fill: '#000000' }),
        E({ type: 'crawl', name: 'Credits', x: 360, y: 60, w: 1200, h: 960, text: 'PRODUCED BY\nBhoomiputra Tech Solutions\n\nDIRECTOR\nName\n\nCAMERA\nName\nName\n\nGRAPHICS\nBTS Studio\n\nThank you for watching', size: 46, speed: 70, ...BASE_TEXT, weight: 500, align: 'center', loop: false })
      ]
    }),
    'ticker': () => ({
      name: 'Ticker (bottom)', width: 1920, height: 1080,
      animIn: { type: 'slide-up', duration: 400 }, animOut: { type: 'slide-up', duration: 300 },
      elements: [
        E({ type: 'rect', name: 'Bar', x: 0, y: 1010, w: 1920, h: 60, fill: '#101318', opacity: 0.95 }),
        E({ type: 'rect', name: 'Label', x: 0, y: 1010, w: 220, h: 60, fill: '#f0a53a' }),
        E({ type: 'text', name: 'LabelText', x: 0, y: 1010, w: 220, h: 60, text: 'UPDATES', size: 30, ...BASE_TEXT, weight: 800, color: '#1a1205', align: 'center' }),
        E({ type: 'ticker', name: 'Ticker', x: 230, y: 1010, w: 1690, h: 60, text: 'First headline • Second headline • Third headline', separator: '   ◆   ', speed: 150, size: 30, ...BASE_TEXT, weight: 500 })
      ]
    }),
    'blank': () => ({ name: 'Blank Title', width: 1920, height: 1080, animIn: { type: 'fade', duration: 300 }, animOut: { type: 'fade', duration: 300 }, elements: [] })
  };

  const TEMPLATE_LIST = [
    ['lower-third', 'Lower Third — Classic'], ['lower-third-modern', 'Lower Third — Modern'], ['breaking-news', 'Breaking News + Ticker'],
    ['cricket-scorebug', 'Cricket Score Bar'], ['sports-score', 'Sports Score (2 teams)'], ['clock', 'Clock'], ['countdown', 'Countdown'],
    ['lower-third-logo', 'Lower Third + Logo'], ['news-strap', 'News Strap (2 lines)'], ['ticker', 'Ticker (bottom)'], ['live-bug', 'LIVE Bug + Clock'],
    ['cricket-batting-card', 'Cricket Batting Card'], ['match-intro', 'Match Intro (Team vs Team)'], ['leaderboard', 'Leaderboard (8 rows)'], ['quote', 'Quote'], ['end-credits', 'End Credits (roll)'],
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
    get fields() { return this.t.elements.filter(e => ['text', 'image', 'countdown', 'ticker', 'crawl', 'rect'].includes(e.type)); }
    tickerCmd(name, cmd) { for (const e of this.t.elements.filter(x => x.type === 'ticker' && (!name || x.name.toLowerCase() === String(name).toLowerCase()))) { const st = this.tickers[e.id] || (this.tickers[e.id] = { t0: performance.now() }); if (cmd === 'pause' && !st.paused) { st.paused = true; st.pausedAt = performance.now() - st.t0; } else if (cmd === 'play') st.paused = false; else if (cmd === 'reset') { st.t0 = performance.now(); st.paused = false; } } }
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

    /* ---- animation model ----
     * Template default: t.animIn / t.animOut {type, duration} + per-element `delay` (legacy).
     * Per element (GT-style storyboard): e.animIn / e.animOut {type, duration, delay, ease} override the template.
     */
    _anim(e, dir) {
      const t = this.t, base = dir > 0 ? (t.animIn || { type: 'fade', duration: 500 }) : (t.animOut || { type: 'fade', duration: 400 });
      const own = dir > 0 ? e.animIn : e.animOut;
      return {
        type: (own && own.type) || base.type || 'fade',
        duration: own && own.duration != null ? own.duration : (base.duration ?? 500),
        delay: own && own.delay != null ? own.delay : (dir > 0 ? (e.delay || 0) : 0),
        ease: (own && own.ease) || base.ease || (dir > 0 ? 'out' : 'in')
      };
    }
    totalTime(dir) { return Math.max(0, ...this.t.elements.filter(e => !e.hidden).map(e => { const a = this._anim(e, dir); return a.type === 'none' ? 0 : a.delay + a.duration; })); }
    transitionIn() { if (!this.animate || !this.t.animIn || this.t.animIn.type === 'none' && !this.t.elements.some(e => e.animIn && e.animIn.type !== 'none')) { this.progress = 1; this.animDir = 0; return 0; } this.animDir = 1; this.animStart = performance.now(); this.progress = 0; return this.totalTime(1); }
    transitionOut() { if (!this.animate || !this.t.animOut || this.t.animOut.type === 'none' && !this.t.elements.some(e => e.animOut && e.animOut.type !== 'none')) { this.progress = 0; this.animDir = 0; return 0; } this.animDir = -1; this.animStart = performance.now(); return this.totalTime(-1); }
    show() { this.progress = 1; this.animDir = 0; }
    _maxDelay() { return Math.max(0, ...this.t.elements.map(e => e.delay || 0)); }
    /** Editor scrubbing: render the In (dir 1) or Out (dir -1) animation at time ms */
    renderAt(dir, ms) { const save = [this.animDir, this.animStart, this.progress]; this.animDir = dir; this.animStart = performance.now() - ms; this.progress = dir > 0 ? 0 : 1; this.render(performance.now(), false, true); [this.animDir, this.animStart, this.progress] = save; return this.canvas; }

    static ease(name, x) {
      switch (name) {
        case 'linear': return x;
        case 'in': return x * x * x;
        case 'inout': return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
        case 'back': { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
        case 'bounce': { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; }
        case 'elastic': return x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
        case 'out': default: return 1 - Math.pow(1 - x, 3);
      }
    }

    render(now = performance.now(), editing = false, scrub = false) {
      const { ctx, t } = this;
      const W = this.canvas.width, H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);
      const dir = this.animDir;
      const elapsed = now - this.animStart;
      if (dir !== 0 && !scrub && elapsed >= this.totalTime(dir)) { this.progress = dir > 0 ? 1 : 0; this.animDir = 0; }
      if (!editing && this.animDir === 0 && this.progress === 0) return this.canvas;
      for (const e of t.elements) {
        if (e.hidden) continue;
        let p = 1, a = null;
        if (!editing && this.animDir !== 0) {
          a = this._anim(e, this.animDir);
          if (a.type === 'none') p = this.animDir > 0 ? (elapsed >= a.delay ? 1 : 0) : (elapsed >= a.delay ? 0 : 1);
          else {
            const local = U.clamp((elapsed - a.delay) / Math.max(1, a.duration), 0, 1);
            p = this.animDir > 0 ? TitleRenderer.ease(a.ease, local) : 1 - TitleRenderer.ease(a.ease === 'out' ? 'in' : a.ease, local);
          }
        } else if (!editing) p = this.progress;
        if (p <= 0 && !(a && (a.type === 'pop' || a.type === 'back'))) continue;
        ctx.save();
        if (e.rotation) { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; ctx.translate(cx, cy); ctx.rotate(e.rotation * Math.PI / 180); ctx.translate(-cx, -cy); }
        const typing = a && a.type === 'typewriter';
        if (!typing && !(e.typewriter && this.animDir > 0)) this._applyAnim(ctx, e, a ? a.type : (t.animIn ? t.animIn.type : 'fade'), p, W, H);
        ctx.globalAlpha *= (e.opacity ?? 1);
        if (e.blend && e.blend !== 'normal') ctx.globalCompositeOperation = e.blend;
        this._typingNow = typing;
        this._drawEl(ctx, e, now, editing ? 1 : (typing || e.typewriter ? p : 1));
        this._typingNow = false;
        ctx.restore();
      }
      return this.canvas;
    }

    _applyAnim(ctx, e, type, p, W, H) {
      if (p >= 1 || type === 'none') return;
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      const q = Math.max(0, p);
      switch (type) {
        case 'slide-left': ctx.translate(-(1 - p) * (e.x + e.w + 40), 0); break;
        case 'slide-right': ctx.translate((1 - p) * (W - e.x + 40), 0); break;
        case 'slide-up': ctx.translate(0, (1 - p) * (H - e.y + 40)); break;
        case 'slide-down': ctx.translate(0, -(1 - p) * (e.y + e.h + 40)); break;
        case 'nudge-left': ctx.translate(-(1 - p) * 80, 0); ctx.globalAlpha *= q; break;
        case 'nudge-right': ctx.translate((1 - p) * 80, 0); ctx.globalAlpha *= q; break;
        case 'nudge-up': ctx.translate(0, (1 - p) * 60); ctx.globalAlpha *= q; break;
        case 'wipe': case 'wipe-right': ctx.beginPath(); ctx.rect(e.x - 4, e.y - 4, (e.w + 8) * q, e.h + 8); ctx.clip(); break;
        case 'wipe-left': ctx.beginPath(); ctx.rect(e.x - 4 + (e.w + 8) * (1 - q), e.y - 4, (e.w + 8) * q, e.h + 8); ctx.clip(); break;
        case 'wipe-down': ctx.beginPath(); ctx.rect(e.x - 4, e.y - 4, e.w + 8, (e.h + 8) * q); ctx.clip(); break;
        case 'wipe-up': ctx.beginPath(); ctx.rect(e.x - 4, e.y - 4 + (e.h + 8) * (1 - q), e.w + 8, (e.h + 8) * q); ctx.clip(); break;
        case 'reveal': ctx.beginPath(); ctx.rect(e.x - 4 + (e.w + 8) * (1 - q) / 2, e.y - 4, (e.w + 8) * q, e.h + 8); ctx.clip(); break;
        case 'zoom': ctx.translate(cx, cy); ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p); ctx.translate(-cx, -cy); ctx.globalAlpha *= q; break;
        case 'pop': { const s = Math.max(0.001, p); ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); break; }
        case 'stretch': ctx.translate(e.x, cy); ctx.scale(Math.max(0.001, q), 1); ctx.translate(-e.x, -cy); break;
        case 'flip': ctx.translate(cx, cy); ctx.scale(1, Math.max(0.001, Math.cos((1 - q) * Math.PI / 2))); ctx.translate(-cx, -cy); ctx.globalAlpha *= q; break;
        case 'spin': ctx.translate(cx, cy); ctx.rotate((1 - p) * -Math.PI); ctx.scale(Math.max(0.001, q), Math.max(0.001, q)); ctx.translate(-cx, -cy); break;
        case 'blur': ctx.filter = `blur(${Math.round((1 - q) * 24)}px)`; ctx.globalAlpha *= q; break;
        case 'drop': ctx.translate(0, -(1 - p) * (e.y + e.h + 40)); break;
        case 'fade': default: ctx.globalAlpha *= q;
      }
    }

    _fillStyle(ctx, e, a = 'fill', b = 'fill2') {
      const c1 = e[a], c2 = e[b];
      if (c2) {
        const ang = ((e.gradAngle ?? 135) - 90) * Math.PI / 180;
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2, r = Math.abs(e.w * Math.cos(ang)) / 2 + Math.abs(e.h * Math.sin(ang)) / 2;
        const g = e.gradType === 'radial' ? ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(e.w, e.h) / 2) : ctx.createLinearGradient(cx - Math.cos(ang) * r, cy - Math.sin(ang) * r, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
        g.addColorStop(0, c1 || '#000'); g.addColorStop(1, c2); return g;
      }
      return c1 || (a === 'fill' ? '#000' : '#fff');
    }
    _shadow(ctx, e, size) {
      if (e.shadowColor) { ctx.shadowColor = e.shadowColor; ctx.shadowBlur = e.shadowBlur ?? 10; ctx.shadowOffsetX = e.shadowX ?? 0; ctx.shadowOffsetY = e.shadowY ?? 4; }
      else if (e.shadow) { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = (size || 40) * 0.15; ctx.shadowOffsetY = (size || 40) * 0.05; }
    }
    _noShadow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }

    _lines(ctx, str, maxW) {
      const out = [];
      for (const para of String(str).split(/\r?\n/)) {
        const words = para.split(/(\s+)/); let line = '';
        for (const w of words) { const test = line + w; if (ctx.measureText(test).width > maxW && line.trim()) { out.push(line.trimEnd()); line = w.trimStart(); } else line = test; }
        out.push(line);
      }
      return out;
    }

    _text(ctx, e, str) {
      if (e.uppercase) str = str.toUpperCase();
      let size = e.size || 32;
      const font = (sz) => `${e.italic ? 'italic ' : ''}${e.weight || 600} ${sz}px "${e.font || 'Segoe UI'}", "Segoe UI", system-ui, sans-serif`;
      ctx.font = font(size);
      if ('letterSpacing' in ctx) ctx.letterSpacing = (e.letterSpacing || 0) + 'px';
      const pad = e.bg ? (e.pad ?? Math.round(size * 0.25)) : 0;
      const innerW = Math.max(10, e.w - pad * 2);
      const lh = (e.lineHeight || 1.2) * size;
      let lines = e.wrap || /\n/.test(str) ? this._lines(ctx, str, innerW) : [str];
      if (e.autoFit !== false) {
        const fits = () => (e.wrap ? lines.length * lh <= e.h - pad * 2 + 1 && lines.every(l => ctx.measureText(l).width <= innerW + 1) : lines.every(l => ctx.measureText(l).width <= innerW + 1));
        while (!fits() && size > 8) { size -= 1; ctx.font = font(size); lines = e.wrap || /\n/.test(str) ? this._lines(ctx, str, innerW) : [str]; }
      }
      const lineH = (e.lineHeight || 1.2) * size;
      const blockH = lines.length * lineH;
      const x = e.align === 'center' ? e.x + e.w / 2 : e.align === 'right' ? e.x + e.w - pad : e.x + pad;
      const top = e.valign === 'top' ? e.y + pad : e.valign === 'bottom' ? e.y + e.h - pad - blockH : e.y + (e.h - blockH) / 2;
      if (e.bg) {
        const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
        const bw = e.bgFull ? e.w : Math.min(e.w, widest + pad * 2), bx = e.align === 'center' ? e.x + (e.w - bw) / 2 : e.align === 'right' ? e.x + e.w - bw : e.x;
        ctx.save(); this._shadow(ctx, e, size); ctx.fillStyle = e.bg; ctx.beginPath(); ctx.roundRect(bx, top - pad, bw, blockH + pad * 2, e.bgRadius || 0); ctx.fill(); ctx.restore();
      }
      ctx.textAlign = e.align || 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = e.color2 ? this._fillStyle(ctx, e, 'color', 'color2') : (e.color || '#fff');
      if (!e.bg) this._shadow(ctx, e, size);
      lines.forEach((l, i) => {
        const y = top + lineH * i + lineH / 2 + size * 0.04;
        if (e.stroke && e.strokeWidth) { ctx.save(); ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = e.strokeWidth * 2; ctx.strokeStyle = e.stroke; ctx.strokeText(l, x, y); ctx.restore(); }
        ctx.fillText(l, x, y);
      });
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }

    _drawEl(ctx, e, now, p = 1) {
      switch (e.type) {
        case 'rect': case 'ellipse': {
          ctx.fillStyle = this._fillStyle(ctx, e);
          this._shadow(ctx, e, 40);
          ctx.beginPath();
          if (e.type === 'ellipse') ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, Math.abs(e.w / 2), Math.abs(e.h / 2), 0, 0, Math.PI * 2);
          else if (e.radius) ctx.roundRect(e.x, e.y, e.w, e.h, Math.min(e.radius, e.h / 2, e.w / 2)); else ctx.rect(e.x, e.y, e.w, e.h);
          if (e.noFill !== true) ctx.fill();
          this._noShadow(ctx);
          if (e.stroke && e.strokeWidth) { ctx.lineWidth = e.strokeWidth; ctx.strokeStyle = e.stroke; ctx.stroke(); }
          break;
        }
        case 'line': {
          ctx.lineWidth = e.strokeWidth || 4; ctx.strokeStyle = e.stroke || e.fill || '#fff'; ctx.lineCap = e.cap || 'round';
          this._shadow(ctx, e, 20);
          ctx.beginPath(); ctx.moveTo(e.x, e.y + (e.h < 0 ? -e.h : 0)); ctx.lineTo(e.x + e.w, e.y + Math.max(0, e.h)); ctx.stroke();
          break;
        }
        case 'text': { const t = String(e.text ?? ''); this._text(ctx, e, (e.typewriter || this._typingNow) && p < 1 ? t.slice(0, Math.max(0, Math.ceil(t.length * p))) : t); break; }
        case 'crawl': {
          ctx.beginPath(); ctx.rect(e.x, e.y, e.w, e.h); ctx.clip();
          const size = e.size || 40, lh = size * (e.lineHeight || 1.5);
          ctx.font = `${e.italic ? 'italic ' : ''}${e.weight || 500} ${size}px "${e.font || 'Segoe UI'}", "Segoe UI", sans-serif`;
          ctx.fillStyle = e.color || '#fff'; ctx.textAlign = e.align || 'center'; ctx.textBaseline = 'top';
          const lines = String(e.text || '').split(/\r?\n/);
          const total = lines.length * lh + e.h;
          const st = this.tickers[e.id] || (this.tickers[e.id] = { t0: now });
          let off = (now - st.t0) / 1000 * (e.speed || 60);
          if (e.loop !== false) off %= total; else off = Math.min(off, total);
          const x = e.align === 'left' ? e.x : e.align === 'right' ? e.x + e.w : e.x + e.w / 2;
          lines.forEach((l, i) => { const y = e.y + e.h - off + i * lh; if (y > e.y - lh && y < e.y + e.h) ctx.fillText(l, x, y); });
          break;
        }
        case 'clock': this._text(ctx, e, formatClock(e.format)); break;
        case 'countdown': this._text(ctx, e, formatTimer(this.timerValue(e))); break;
        case 'image': {
          const img = loadImage(e.src);
          if (img && img.complete && img.naturalWidth) {
            const r = U.fit(img.naturalWidth, img.naturalHeight, e.w, e.h, e.fit || 'contain');
            if (e.radius) { ctx.beginPath(); ctx.roundRect(e.x, e.y, e.w, e.h, e.radius); ctx.clip(); }
            this._shadow(ctx, e, 30);
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
          const sep = e.separator ?? '      •      ';
          const raw = Array.isArray(e.items) && e.items.length ? e.items.join(sep) : String(e.text);
          const txt = (e.uppercase ? raw.toUpperCase() : raw) + sep;
          const tw = Math.max(1, ctx.measureText(txt).width);
          const st = this.tickers[e.id] || (this.tickers[e.id] = { t0: now });
          if (st.paused) st.t0 = now - st.pausedAt;
          const off = ((now - st.t0) / 1000 * (e.speed || 120)) % tw;
          if (e.direction === 'ltr') { for (let x = e.x + off - tw; x < e.x + e.w; x += tw) ctx.fillText(txt, x, e.y + e.h / 2); }
          else for (let x = e.x - off; x < e.x + e.w; x += tw) ctx.fillText(txt, x, e.y + e.h / 2);
          break;
        }
      }
    }
  }

  const clearImageCache = () => imgCache.clear();
  BTS.Titles = { TEMPLATES, TEMPLATE_LIST, TitleRenderer, loadImage, clearImageCache, formatClock, newElement: E, BASE_TEXT };
})(window.BTS);
