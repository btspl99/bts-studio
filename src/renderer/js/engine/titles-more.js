'use strict';
/** Additional built-in title templates (sports, news, events, social, church, education) + template categories. */
(function (BTS) {
  const { TEMPLATES, TEMPLATE_LIST, newElement: E, BASE_TEXT: T } = BTS.Titles;
  const W = 1920, H = 1080;
  const tpl = (name, animIn, animOut, elements) => ({ name, width: W, height: H, animIn, animOut, elements });
  const A = (type, duration) => ({ type, duration });

  const MORE = {
    'lower-third-minimal': () => tpl('Lower Third — Minimal', A('fade', 400), A('fade', 300), [
      E({ type: 'rect', name: 'Line', x: 120, y: 905, w: 420, h: 4, fill: '#ffffff', delay: 100 }),
      E({ type: 'text', name: 'Name', x: 120, y: 835, w: 900, h: 70, text: 'Speaker Name', size: 52, ...T, shadow: true }),
      E({ type: 'text', name: 'Title', x: 120, y: 915, w: 900, h: 48, text: 'Designation', size: 30, ...T, weight: 400, shadow: true, delay: 150 })
    ]),
    'lower-third-pill': () => tpl('Lower Third — Gradient Pill', A('slide-left', 550), A('slide-left', 400), [
      E({ type: 'rect', name: 'Pill', x: 100, y: 850, w: 860, h: 110, fill: '#7b2ff7', fill2: '#f107a3', radius: 55 }),
      E({ type: 'text', name: 'Name', x: 160, y: 856, w: 760, h: 58, text: 'Guest Name', size: 44, ...T, delay: 80 }),
      E({ type: 'text', name: 'Title', x: 160, y: 908, w: 760, h: 42, text: 'Creator • Speaker', size: 26, ...T, weight: 500, color: '#ffe3f6', delay: 140 })
    ]),
    'dual-lower-third': () => tpl('Interview — Two Names', A('slide-up', 500), A('fade', 300), [
      E({ type: 'rect', name: 'LeftBar', x: 80, y: 880, w: 720, h: 100, fill: '#111622', opacity: 0.94, radius: 8 }),
      E({ type: 'rect', name: 'LeftAccent', x: 80, y: 880, w: 10, h: 100, fill: '#f0a53a' }),
      E({ type: 'text', name: 'Name1', x: 110, y: 884, w: 670, h: 54, text: 'Host Name', size: 40, ...T }),
      E({ type: 'text', name: 'Title1', x: 110, y: 934, w: 670, h: 40, text: 'Host', size: 26, ...T, weight: 500, color: '#f0a53a' }),
      E({ type: 'rect', name: 'RightBar', x: 1120, y: 880, w: 720, h: 100, fill: '#111622', opacity: 0.94, radius: 8, delay: 120 }),
      E({ type: 'rect', name: 'RightAccent', x: 1830, y: 880, w: 10, h: 100, fill: '#3d8bfd', delay: 120 }),
      E({ type: 'text', name: 'Name2', x: 1140, y: 884, w: 670, h: 54, text: 'Guest Name', size: 40, ...T, align: 'right', delay: 120 }),
      E({ type: 'text', name: 'Title2', x: 1140, y: 934, w: 670, h: 40, text: 'Guest', size: 26, ...T, weight: 500, color: '#7fb2ff', align: 'right', delay: 120 })
    ]),
    'location-tag': () => tpl('Location Tag', A('wipe', 500), A('fade', 300), [
      E({ type: 'rect', name: 'Bg', x: 80, y: 70, w: 560, h: 76, fill: '#0f1218', opacity: 0.88, radius: 38 }),
      E({ type: 'text', name: 'Pin', x: 96, y: 70, w: 60, h: 76, text: '📍', size: 36, ...T, align: 'center' }),
      E({ type: 'text', name: 'Location', x: 160, y: 72, w: 460, h: 44, text: 'Mumbai, India', size: 32, ...T }),
      E({ type: 'clock', name: 'Date', x: 160, y: 110, w: 460, h: 30, format: 'dd/MM/yyyy', size: 20, ...T, weight: 500, color: '#a9adb7' })
    ]),
    'subscribe-cta': () => tpl('Subscribe / Call to Action', A('zoom', 500), A('fade', 300), [
      E({ type: 'rect', name: 'Card', x: 1360, y: 820, w: 480, h: 150, fill: '#ffffff', radius: 18 }),
      E({ type: 'rect', name: 'Button', x: 1390, y: 890, w: 230, h: 58, fill: '#e62117', radius: 10, delay: 120 }),
      E({ type: 'text', name: 'ButtonText', x: 1390, y: 890, w: 230, h: 58, text: 'SUBSCRIBE', size: 26, ...T, weight: 800, align: 'center', delay: 120 }),
      E({ type: 'text', name: 'Channel', x: 1390, y: 832, w: 420, h: 50, text: '@YourChannel', size: 34, ...T, color: '#111' }),
      E({ type: 'text', name: 'Bell', x: 1640, y: 890, w: 180, h: 58, text: '🔔 Bell on', size: 24, ...T, weight: 600, color: '#555', delay: 180 })
    ]),
    'sponsor-bug': () => tpl('Sponsor Bug', A('fade', 500), A('fade', 400), [
      E({ type: 'rect', name: 'Bg', x: 1560, y: 40, w: 320, h: 150, fill: '#ffffff', opacity: 0.92, radius: 12 }),
      E({ type: 'text', name: 'Label', x: 1560, y: 46, w: 320, h: 30, text: 'PRESENTED BY', size: 18, ...T, weight: 700, color: '#666', align: 'center' }),
      E({ type: 'image', name: 'Logo', x: 1590, y: 78, w: 260, h: 100, src: '', fit: 'contain' })
    ]),
    'football-scorebug': () => tpl('Football Score Bug', A('slide-down', 450), A('fade', 300), [
      E({ type: 'rect', name: 'Bg', x: 60, y: 50, w: 640, h: 60, fill: '#0b1020', radius: 6, opacity: 0.96 }),
      E({ type: 'rect', name: 'HomeColor', x: 60, y: 50, w: 8, h: 60, fill: '#d7263d' }),
      E({ type: 'text', name: 'Home', x: 78, y: 50, w: 130, h: 60, text: 'HOM', size: 30, ...T, weight: 800, uppercase: true }),
      E({ type: 'rect', name: 'ScoreBg', x: 210, y: 56, w: 140, h: 48, fill: '#ffffff', radius: 4 }),
      E({ type: 'text', name: 'HomeScore', x: 210, y: 56, w: 60, h: 48, text: '0', size: 34, ...T, weight: 800, color: '#0b1020', align: 'center' }),
      E({ type: 'text', name: 'Dash', x: 265, y: 56, w: 30, h: 48, text: '-', size: 30, ...T, color: '#0b1020', align: 'center' }),
      E({ type: 'text', name: 'AwayScore', x: 290, y: 56, w: 60, h: 48, text: '0', size: 34, ...T, weight: 800, color: '#0b1020', align: 'center' }),
      E({ type: 'text', name: 'Away', x: 360, y: 50, w: 130, h: 60, text: 'AWY', size: 30, ...T, weight: 800, uppercase: true }),
      E({ type: 'rect', name: 'AwayColor', x: 490, y: 50, w: 8, h: 60, fill: '#1b98e0' }),
      E({ type: 'countdown', name: 'MatchClock', x: 506, y: 50, w: 120, h: 60, seconds: 0, countUp: true, size: 30, ...T, weight: 700, align: 'center', color: '#f0a53a' }),
      E({ type: 'text', name: 'Period', x: 626, y: 50, w: 70, h: 60, text: '1H', size: 24, ...T, weight: 700, align: 'center', color: '#a9b4c8' })
    ]),
    'basketball-score': () => tpl('Basketball Score Bug', A('slide-up', 450), A('fade', 300), [
      E({ type: 'rect', name: 'Bg', x: 560, y: 960, w: 800, h: 74, fill: '#121212', radius: 8, opacity: 0.96 }),
      E({ type: 'rect', name: 'HomeBox', x: 560, y: 960, w: 250, h: 74, fill: '#552583', radius: 8 }),
      E({ type: 'text', name: 'Home', x: 574, y: 960, w: 130, h: 74, text: 'HOME', size: 30, ...T, weight: 800 }),
      E({ type: 'text', name: 'HomeScore', x: 700, y: 960, w: 100, h: 74, text: '0', size: 44, ...T, weight: 800, align: 'right' }),
      E({ type: 'rect', name: 'AwayBox', x: 1110, y: 960, w: 250, h: 74, fill: '#007a33', radius: 8 }),
      E({ type: 'text', name: 'AwayScore', x: 1120, y: 960, w: 100, h: 74, text: '0', size: 44, ...T, weight: 800 }),
      E({ type: 'text', name: 'Away', x: 1216, y: 960, w: 130, h: 74, text: 'AWAY', size: 30, ...T, weight: 800, align: 'right' }),
      E({ type: 'text', name: 'Quarter', x: 820, y: 962, w: 90, h: 70, text: 'Q1', size: 30, ...T, align: 'center', color: '#f0a53a' }),
      E({ type: 'countdown', name: 'GameClock', x: 900, y: 962, w: 130, h: 70, seconds: 720, size: 34, ...T, align: 'center' }),
      E({ type: 'countdown', name: 'ShotClock', x: 1030, y: 962, w: 70, h: 70, seconds: 24, size: 30, ...T, align: 'center', color: '#ff5a4f' })
    ]),
    'election-results': () => {
      const els = [E({ type: 'rect', name: 'Panel', x: 160, y: 160, w: 1600, h: 760, fill: '#0c1424', opacity: 0.96, radius: 14 }),
        E({ type: 'text', name: 'Heading', x: 220, y: 180, w: 1200, h: 90, text: 'RESULTS — LIVE COUNT', size: 52, ...T, weight: 800 }),
        E({ type: 'clock', name: 'Updated', x: 1340, y: 190, w: 380, h: 70, format: 'HH:mm', size: 30, ...T, weight: 500, align: 'right', color: '#9fb3cc' })];
      const cols = ['#ff9933', '#138808', '#1e90ff', '#d7263d', '#8e44ad'];
      for (let i = 1; i <= 5; i++) {
        const y = 300 + (i - 1) * 120;
        els.push(E({ type: 'text', name: 'Party' + i, x: 220, y, w: 380, h: 90, text: 'Party ' + i, size: 36, ...T, delay: i * 60 }));
        els.push(E({ type: 'rect', name: 'BarBg' + i, x: 620, y: y + 20, w: 900, h: 50, fill: '#1c2740', radius: 6, delay: i * 60 }));
        els.push(E({ type: 'rect', name: 'Bar' + i, x: 620, y: y + 20, w: 900 - i * 140, h: 50, fill: cols[i - 1], radius: 6, delay: i * 60 + 80 }));
        els.push(E({ type: 'text', name: 'Seats' + i, x: 1540, y, w: 180, h: 90, text: String(100 - i * 15), size: 44, ...T, weight: 800, align: 'right', delay: i * 60 }));
      }
      return tpl('Election / Results Bars', A('fade', 500), A('fade', 300), els);
    },
    'quiz-question': () => {
      const els = [E({ type: 'rect', name: 'QBox', x: 160, y: 520, w: 1600, h: 140, fill: '#1a1446', fill2: '#2d1f7a', radius: 70 }),
        E({ type: 'text', name: 'Question', x: 220, y: 520, w: 1480, h: 140, text: 'Which planet is known as the Red Planet?', size: 48, ...T, align: 'center' })];
      const L = ['A', 'B', 'C', 'D'];
      L.forEach((l, i) => {
        const x = i % 2 ? 980 : 160, y = 700 + Math.floor(i / 2) * 120;
        els.push(E({ type: 'rect', name: 'Opt' + l + 'Box', x, y, w: 780, h: 96, fill: '#0f1030', stroke: '#6c5ce7', strokeWidth: 3, radius: 48, delay: 150 + i * 80 }));
        els.push(E({ type: 'text', name: 'Opt' + l + 'Letter', x: x + 30, y, w: 60, h: 96, text: l + ':', size: 38, ...T, color: '#f0a53a', delay: 150 + i * 80 }));
        els.push(E({ type: 'text', name: 'Opt' + l, x: x + 100, y, w: 640, h: 96, text: ['Venus', 'Mars', 'Jupiter', 'Saturn'][i], size: 36, ...T, weight: 600, delay: 150 + i * 80 }));
      });
      return tpl('Quiz Question (A–D)', A('slide-up', 500), A('fade', 300), els);
    },
    'poll-results': () => {
      const els = [E({ type: 'rect', name: 'Panel', x: 1180, y: 300, w: 680, h: 480, fill: '#0f1218', opacity: 0.94, radius: 16 }),
        E({ type: 'text', name: 'Question', x: 1220, y: 320, w: 600, h: 80, text: 'Who will win today?', size: 38, ...T })];
      for (let i = 1; i <= 3; i++) {
        const y = 420 + (i - 1) * 115;
        els.push(E({ type: 'text', name: 'Option' + i, x: 1220, y, w: 420, h: 44, text: 'Option ' + i, size: 28, ...T, weight: 600, delay: i * 80 }));
        els.push(E({ type: 'text', name: 'Pct' + i, x: 1640, y, w: 180, h: 44, text: [52, 31, 17][i - 1] + '%', size: 28, ...T, align: 'right', color: '#f0a53a', delay: i * 80 }));
        els.push(E({ type: 'rect', name: 'BarBg' + i, x: 1220, y: y + 50, w: 600, h: 22, fill: '#232836', radius: 11, delay: i * 80 }));
        els.push(E({ type: 'rect', name: 'Bar' + i, x: 1220, y: y + 50, w: 600 * [0.52, 0.31, 0.17][i - 1], h: 22, fill: '#f0a53a', fill2: '#ffcf7a', radius: 11, delay: i * 80 + 100 }));
      }
      return tpl('Poll Results (3 options)', A('slide-left', 500), A('fade', 300), els);
    },
    'starting-soon': () => tpl('Starting Soon (countdown)', A('fade', 600), A('fade', 500), [
      E({ type: 'rect', name: 'Bg', x: 0, y: 0, w: W, h: H, fill: '#0d1b2a', fill2: '#3a0ca3' }),
      E({ type: 'text', name: 'Show', x: 0, y: 300, w: W, h: 100, text: 'SHOW NAME', size: 72, ...T, weight: 800, align: 'center' }),
      E({ type: 'text', name: 'Heading', x: 0, y: 410, w: W, h: 80, text: 'STARTING SOON', size: 48, ...T, weight: 600, align: 'center', color: '#ffd166' }),
      E({ type: 'countdown', name: 'Countdown', x: 0, y: 500, w: W, h: 200, seconds: 600, size: 170, ...T, weight: 800, align: 'center' }),
      E({ type: 'ticker', name: 'Ticker', x: 0, y: 1000, w: W, h: 60, text: 'Grab a chai ☕ • Drop a hello in the chat • Share the stream with your friends', size: 28, ...T, weight: 500, color: '#cdd3ff' })
    ]),
    'be-right-back': () => tpl('Be Right Back', A('fade', 500), A('fade', 500), [
      E({ type: 'rect', name: 'Bg', x: 0, y: 0, w: W, h: H, fill: '#141e30', fill2: '#243b55' }),
      E({ type: 'text', name: 'Title', x: 0, y: 420, w: W, h: 140, text: 'BE RIGHT BACK', size: 120, ...T, weight: 800, align: 'center' }),
      E({ type: 'text', name: 'Sub', x: 0, y: 580, w: W, h: 70, text: 'Stay tuned — we will continue shortly', size: 40, ...T, weight: 400, align: 'center', color: '#c9d6ea' })
    ]),
    'thank-you': () => tpl('Thank You / End Screen', A('fade', 600), A('fade', 500), [
      E({ type: 'rect', name: 'Bg', x: 0, y: 0, w: W, h: H, fill: '#0f0c29', fill2: '#302b63' }),
      E({ type: 'text', name: 'Title', x: 0, y: 300, w: W, h: 140, text: 'THANK YOU FOR WATCHING', size: 96, ...T, weight: 800, align: 'center' }),
      E({ type: 'image', name: 'Logo', x: 810, y: 470, w: 300, h: 160, src: '' }),
      E({ type: 'text', name: 'Website', x: 0, y: 660, w: W, h: 60, text: 'www.yourwebsite.com', size: 38, ...T, weight: 500, align: 'center', color: '#f0a53a' }),
      E({ type: 'text', name: 'Social', x: 0, y: 730, w: W, h: 60, text: 'YouTube • Instagram • Facebook  @yourhandle', size: 32, ...T, weight: 400, align: 'center', color: '#c9ccd4' })
    ]),
    'agenda': () => {
      const els = [E({ type: 'rect', name: 'Panel', x: 260, y: 140, w: 1400, h: 800, fill: '#0e1117', opacity: 0.95, radius: 16 }),
        E({ type: 'text', name: 'Heading', x: 320, y: 170, w: 1280, h: 100, text: "TODAY'S AGENDA", size: 60, ...T, weight: 800 }),
        E({ type: 'rect', name: 'Line', x: 320, y: 270, w: 200, h: 6, fill: '#f0a53a' })];
      for (let i = 1; i <= 6; i++) {
        const y = 300 + (i - 1) * 104;
        els.push(E({ type: 'text', name: 'Time' + i, x: 320, y, w: 220, h: 90, text: `${9 + i}:00`, size: 38, ...T, color: '#f0a53a', delay: i * 60 }));
        els.push(E({ type: 'text', name: 'Item' + i, x: 560, y, w: 1040, h: 90, text: 'Session ' + i, size: 38, ...T, weight: 500, delay: i * 60 }));
      }
      return tpl('Agenda / Schedule (6 rows)', A('fade', 500), A('fade', 300), els);
    },
    'weather': () => tpl('Weather Card', A('slide-right', 500), A('fade', 300), [
      E({ type: 'rect', name: 'Card', x: 1420, y: 640, w: 440, h: 300, fill: '#1e3c72', fill2: '#2a5298', radius: 18 }),
      E({ type: 'text', name: 'City', x: 1450, y: 655, w: 380, h: 60, text: 'MUMBAI', size: 36, ...T, weight: 800 }),
      E({ type: 'text', name: 'Icon', x: 1450, y: 720, w: 140, h: 140, text: '⛅', size: 100, ...T, align: 'center' }),
      E({ type: 'text', name: 'Temp', x: 1600, y: 720, w: 240, h: 140, text: '31°', size: 110, ...T, weight: 800, align: 'right' }),
      E({ type: 'text', name: 'Condition', x: 1450, y: 870, w: 380, h: 50, text: 'Partly cloudy • H 33° L 26°', size: 26, ...T, weight: 500, color: '#dbe7ff' })
    ]),
    'rss-ticker': () => tpl('News Ticker (RSS-ready)', A('slide-up', 400), A('slide-up', 300), [
      E({ type: 'rect', name: 'Bar', x: 0, y: 1000, w: W, h: 70, fill: '#ffffff' }),
      E({ type: 'rect', name: 'Label', x: 0, y: 1000, w: 230, h: 70, fill: '#c0392b' }),
      E({ type: 'text', name: 'LabelText', x: 0, y: 1000, w: 230, h: 70, text: 'NEWS', size: 36, ...T, weight: 900, align: 'center' }),
      E({ type: 'clock', name: 'Clock', x: 1760, y: 1000, w: 160, h: 70, format: 'HH:mm', size: 30, ...T, align: 'center', color: '#c0392b' }),
      E({ type: 'ticker', name: 'Headlines', x: 250, y: 1000, w: 1500, h: 70, text: 'Bind this ticker to an RSS feed in Data Sources (mode: all rows)', separator: '   ■   ', speed: 140, size: 32, ...T, weight: 600, color: '#111' })
    ]),
    'chapter-title': () => tpl('Chapter / Section Title', A('slide-left', 550), A('slide-left', 400), [
      E({ type: 'rect', name: 'Block', x: 0, y: 380, w: 900, h: 320, fill: '#f0a53a' }),
      E({ type: 'text', name: 'Number', x: 80, y: 400, w: 300, h: 120, text: '01', size: 110, ...T, weight: 900, color: '#1a1205', delay: 100 }),
      E({ type: 'text', name: 'Chapter', x: 80, y: 530, w: 780, h: 90, text: 'Chapter Title', size: 64, ...T, weight: 800, color: '#1a1205', delay: 160 }),
      E({ type: 'text', name: 'Sub', x: 80, y: 615, w: 780, h: 60, text: 'Short description', size: 32, ...T, weight: 500, color: '#3d2a08', delay: 220 })
    ]),
    'comment-card': () => tpl('Viewer Comment Card', A('slide-left', 450), A('fade', 300), [
      E({ type: 'rect', name: 'Card', x: 90, y: 760, w: 900, h: 190, fill: '#ffffff', radius: 16 }),
      E({ type: 'image', name: 'Avatar', x: 115, y: 785, w: 80, h: 80, src: '', radius: 40, fit: 'cover' }),
      E({ type: 'text', name: 'Name', x: 215, y: 782, w: 600, h: 44, text: 'Viewer Name', size: 30, ...T, color: '#111' }),
      E({ type: 'text', name: 'Platform', x: 760, y: 782, w: 200, h: 44, text: 'YouTube', size: 22, ...T, weight: 600, color: '#e62117', align: 'right' }),
      E({ type: 'text', name: 'Comment', x: 215, y: 828, w: 740, h: 100, text: 'Great show! Greetings from Pune 👋', size: 30, ...T, weight: 400, color: '#333', valign: 'top' })
    ]),
    'caption-centre': () => tpl('Caption Box (lyrics / scripture)', A('fade', 400), A('fade', 400), [
      E({ type: 'rect', name: 'Box', x: 160, y: 820, w: 1600, h: 200, fill: '#000000', opacity: 0.7, radius: 10 }),
      E({ type: 'text', name: 'Line1', x: 200, y: 835, w: 1520, h: 80, text: 'First line of text', size: 50, ...T, weight: 600, align: 'center' }),
      E({ type: 'text', name: 'Line2', x: 200, y: 915, w: 1520, h: 80, text: 'Second line of text', size: 50, ...T, weight: 600, align: 'center' }),
      E({ type: 'text', name: 'Reference', x: 200, y: 990, w: 1520, h: 30, text: '', size: 22, ...T, weight: 400, align: 'center', color: '#ccc' })
    ])
  };
  Object.assign(TEMPLATES, MORE);

  const ADD = [
    ['lower-third-minimal', 'Lower Third — Minimal'], ['lower-third-pill', 'Lower Third — Gradient Pill'], ['dual-lower-third', 'Interview — Two Names'],
    ['location-tag', 'Location Tag'], ['subscribe-cta', 'Subscribe / Call to Action'], ['sponsor-bug', 'Sponsor Bug'], ['comment-card', 'Viewer Comment Card'],
    ['football-scorebug', 'Football Score Bug'], ['basketball-score', 'Basketball Score Bug'], ['election-results', 'Election / Results Bars'],
    ['quiz-question', 'Quiz Question (A–D)'], ['poll-results', 'Poll Results'], ['starting-soon', 'Starting Soon (countdown)'], ['be-right-back', 'Be Right Back'],
    ['thank-you', 'Thank You / End Screen'], ['agenda', 'Agenda / Schedule'], ['weather', 'Weather Card'], ['rss-ticker', 'News Ticker (RSS-ready)'],
    ['chapter-title', 'Chapter / Section Title'], ['caption-centre', 'Caption Box (lyrics / scripture)']
  ];
  const blank = TEMPLATE_LIST.findIndex(x => x[0] === 'blank');
  TEMPLATE_LIST.splice(blank < 0 ? TEMPLATE_LIST.length : blank, 0, ...ADD);

  const CATEGORIES = {
    'Lower thirds': ['lower-third', 'lower-third-modern', 'lower-third-minimal', 'lower-third-pill', 'lower-third-logo', 'dual-lower-third', 'location-tag', 'social', 'comment-card'],
    'News': ['breaking-news', 'news-strap', 'ticker', 'rss-ticker', 'live-bug', 'weather', 'election-results', 'clock'],
    'Sports': ['cricket-scorebug', 'cricket-batting-card', 'sports-score', 'football-scorebug', 'basketball-score', 'match-intro', 'leaderboard'],
    'Full screen': ['fullscreen-title', 'starting-soon', 'countdown', 'be-right-back', 'thank-you', 'end-credits', 'chapter-title', 'agenda', 'up-next'],
    'Engagement': ['subscribe-cta', 'sponsor-bug', 'quiz-question', 'poll-results', 'quote', 'caption-centre']
  };
  BTS.Titles.CATEGORIES = CATEGORIES;
})(window.BTS);
