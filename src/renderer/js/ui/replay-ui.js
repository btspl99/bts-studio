'use strict';
/**
 * Instant Replay module (dockable). Operator layout:
 *   [Recorder bar: REC, cameras, buffer]
 *   [Replay monitor + transport + speed lever] [Camera angles + big action buttons] [Event list]
 */
(function (BTS) {
  const U = BTS.U;

  class ReplayUI {
    constructor(studio, root) {
      this.studio = studio;
      this.R = studio.replay;
      this.root = root;
      this.selected = null;
      this.visible = false;
      this.build();
      this.R.on('change', () => this.refresh());
      this.R.on('speed', () => this.syncSpeed());
      studio.on('inputs', () => this.refreshSources());
      let n = 0;
      studio.on('frame', () => { if (this.visible && (++n % 2 === 0)) this.drawMonitor(); });
      setInterval(() => this.tickStatus(), 1000);
    }

    build() {
      const R = this.R;
      this.root.innerHTML = `
        <div class="rp-bar">
          <button class="rp-rec" id="rpRec"><i></i><span>REC OFF</span></button>
          <div class="rp-src" id="rpSources" title="Replay cameras (buffered continuously)"></div>
          <div class="spacer"></div>
          <span class="hint" id="rpBuf">Buffer stopped</span>
          <label class="hint">Buffer <select id="rpSecs"><option>30</option><option>60</option><option>120</option><option>300</option><option>600</option></select> s</label>
          <button class="tbtn" id="rpCfg" title="Replay settings">⚙</button>
        </div>
        <div class="rp-main">
          <section class="rp-mon">
            <div class="rp-screen"><canvas id="rpCanvas" width="640" height="360"></canvas><div class="rp-osd"><span id="rpOsdCam">—</span><span id="rpOsdSpeed">50%</span></div></div>
            <div class="rp-time"><span id="rpTc">00:00.0</span><input type="range" id="rpSeek" min="0" max="1000" value="0"><span id="rpDur">00:00.0</span></div>
            <div class="rp-transport">
              <button class="tbtn" data-t="start" title="To start">⏮</button>
              <button class="tbtn" data-t="back" title="Back 1 s">⏪</button>
              <button class="tbtn" data-t="frameback" title="Back 1 frame">◀︎|</button>
              <button class="tbtn big" data-t="play" id="rpPlay" title="Play / pause">▶</button>
              <button class="tbtn" data-t="framefwd" title="Forward 1 frame">|▶︎</button>
              <button class="tbtn" data-t="fwd" title="Forward 1 s">⏩</button>
              <button class="tbtn" data-t="end" title="To end">⏭</button>
            </div>
            <div class="rp-speed">
              <span class="hint">SPEED</span>
              <input type="range" id="rpSpeed" min="5" max="200" step="1" value="50">
              <b id="rpSpeedVal">50%</b>
              <div class="rp-speed-presets">${[25, 33, 50, 75, 100].map(v => `<button class="tbtn small" data-sp="${v}">${v}</button>`).join('')}</div>
            </div>
          </section>
          <section class="rp-ctl">
            <div class="hint">CAMERA ANGLE</div>
            <div class="rp-cams" id="rpCams"></div>
            <div class="rp-actions">
              <button class="rp-btn" data-a="in">MARK IN<small>[</small></button>
              <button class="rp-btn" data-a="out">MARK OUT<small>]</small></button>
              <button class="rp-btn" data-a="save">SAVE EVENT<small>Shift+S</small></button>
              <button class="rp-btn" data-a="l5">LAST 5s</button>
              <button class="rp-btn" data-a="l10">LAST 10s</button>
              <button class="rp-btn" data-a="l20">LAST 20s</button>
            </div>
            <div class="rp-marks" id="rpMarks">No marks</div>
            <button class="rp-btn hot" data-a="instant">⏪ INSTANT REPLAY <small>Shift+R</small></button>
            <div class="rp-actions two">
              <button class="rp-btn live" data-a="out-play">▶ PLAY TO OUTPUT</button>
              <button class="rp-btn back" data-a="return">⟲ RETURN TO LIVE</button>
            </div>
            <button class="rp-btn" data-a="highlights">★ PLAY HIGHLIGHTS</button>
          </section>
          <section class="rp-events">
            <div class="rp-ev-head"><span class="hint">EVENTS</span><div class="spacer"></div><input type="search" id="rpFilter" placeholder="Filter…"><label class="hint"><input type="checkbox" id="rpStarOnly"> ★ only</label></div>
            <div class="rp-ev-list" id="rpEvents"></div>
          </section>
        </div>`;
      const $ = (s) => this.root.querySelector(s);
      this.el = { rec: $('#rpRec'), src: $('#rpSources'), buf: $('#rpBuf'), secs: $('#rpSecs'), canvas: $('#rpCanvas'), tc: $('#rpTc'), dur: $('#rpDur'), seek: $('#rpSeek'), play: $('#rpPlay'), speed: $('#rpSpeed'), speedVal: $('#rpSpeedVal'), cams: $('#rpCams'), marks: $('#rpMarks'), events: $('#rpEvents'), filter: $('#rpFilter'), starOnly: $('#rpStarOnly'), osdCam: $('#rpOsdCam'), osdSpeed: $('#rpOsdSpeed') };
      this.ctx = this.el.canvas.getContext('2d');
      this.el.secs.value = String(R.cfg.seconds);
      this.el.secs.onchange = () => { R.cfg.seconds = +this.el.secs.value; if (R.running) U.toast('New buffer length applies when the recorder restarts'); };
      this.el.rec.onclick = async () => { this.el.rec.disabled = true; if (R.running) await R.stop(); else await R.start(); this.el.rec.disabled = false; };
      $('#rpCfg').onclick = () => this.settings();
      this.el.speed.oninput = () => R.setSpeed(+this.el.speed.value / 100);
      this.root.querySelectorAll('[data-sp]').forEach(b => { b.onclick = () => R.setSpeed(+b.dataset.sp / 100); });
      this.el.seek.oninput = () => { const i = R.replayInput(); if (i && i.duration) i.seek(+this.el.seek.value / 1000 * i.duration); };
      this.root.querySelector('.rp-transport').addEventListener('click', (e) => {
        const t = e.target.closest('[data-t]')?.dataset.t; const i = R.replayInput(); if (!t || !i) return;
        const f = 1 / (this.studio.fps || 30);
        if (t === 'play') i.togglePlay(); if (t === 'start') i.seek(0); if (t === 'end') i.seek(i.duration - 0.05);
        if (t === 'back') i.seek(i.currentTime - 1); if (t === 'fwd') i.seek(i.currentTime + 1);
        if (t === 'frameback') { i.pause(); i.seek(i.currentTime - f); } if (t === 'framefwd') { i.pause(); i.seek(i.currentTime + f); }
      });
      this.root.querySelector('.rp-ctl').addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        if (a === 'in') R.markIn(); if (a === 'out') R.markOut();
        if (a === 'save') { const ev = await R.clip({ marks: !!R.markInWall }); if (ev) this.select(ev); }
        if (a === 'l5' || a === 'l10' || a === 'l20') { const ev = await R.clip({ last: +a.slice(1) }); if (ev) this.select(ev); }
        if (a === 'instant') await R.instant();
        if (a === 'out-play') { if (this.selected) await R.load(this.selected, { toOutput: true }); else if (R.loaded) await R.goLive(); else await R.playLast(); }
        if (a === 'return') R.returnToLive();
        if (a === 'highlights') await R.playHighlights();
      });
      this.el.filter.oninput = () => this.renderEvents();
      this.el.starOnly.onchange = () => this.renderEvents();
      // wheel on monitor = jog
      this.el.canvas.addEventListener('wheel', (e) => { e.preventDefault(); const i = R.replayInput(); if (i) { i.pause(); i.seek(i.currentTime + Math.sign(e.deltaY) * (e.shiftKey ? 1 : 1 / (this.studio.fps || 30))); } }, { passive: false });
      this.refresh();
    }

    setVisible(v) { this.visible = v; if (v) this.refresh(); }

    refreshSources() {
      const R = this.R, box = this.el.src;
      box.innerHTML = '';
      for (const [k, l] of R.candidates()) {
        const on = R.cfg.sources.includes(k), live = R.active.has(k);
        const chip = U.el('label', { class: 'chip-src' + (on ? ' on' : '') + (live ? ' live' : ''), title: live ? 'Buffering' : (R.running ? 'Restart the recorder to add' : 'Include in replay') }, [
          U.el('input', { type: 'checkbox', checked: on, disabled: R.running, onchange: (e) => { R.cfg.sources = e.target.checked ? [...new Set([...R.cfg.sources, k])] : R.cfg.sources.filter(x => x !== k); this.refreshSources(); } }), l
        ]);
        box.append(chip);
      }
    }

    refresh() {
      const R = this.R;
      this.el.rec.classList.toggle('on', R.running);
      this.el.rec.querySelector('span').textContent = R.running ? `REC ● ${R.cameras.length} CAM` : 'REC OFF';
      this.el.secs.disabled = R.running;
      this.refreshSources();
      // camera angle buttons
      const cams = R.running ? R.cameras : (R.loaded ? Object.keys(R.loaded.event.files) : R.cfg.sources);
      this.el.cams.innerHTML = '';
      cams.forEach((k, n) => {
        const has = !R.loaded || R.loaded.event.files[k];
        this.el.cams.append(U.el('button', { class: 'rp-cam' + (k === (R.loaded ? R.loaded.key : R.cfg.current) ? ' on' : ''), disabled: !has, title: `Angle ${n + 1}: ${R.sourceLabel(k)}`, onclick: () => R.angle(k) }, [U.el('b', { text: String(n + 1) }), U.el('span', { text: R.sourceLabel(k) })]));
      });
      if (!cams.length) this.el.cams.append(U.el('div', { class: 'hint', text: 'Choose cameras above and press REC' }));
      this.el.marks.textContent = R.markInWall ? `IN ${new Date(R.markInWall).toLocaleTimeString()}${R.markOutWall ? '  →  OUT ' + new Date(R.markOutWall).toLocaleTimeString() + `  (${((R.markOutWall - R.markInWall) / 1000).toFixed(1)} s)` : '  →  …'}` : 'No marks — Mark In, then Mark Out (or Save Event)';
      this.el.marks.classList.toggle('on', !!R.markInWall);
      this.root.querySelectorAll('.rp-btn, .rp-cam').forEach(b => { if (!['highlights', 'return'].includes(b.dataset.a) && b.classList.contains('rp-btn')) b.disabled = !R.running && !['out-play'].includes(b.dataset.a); });
      this.syncSpeed();
      this.renderEvents();
      U.$('#chipReplay')?.classList.toggle('on', R.running);
      U.$('#btnReplay')?.classList.toggle('on', R.running);
    }

    syncSpeed() {
      const v = Math.round(this.R.cfg.speed * 100);
      if (document.activeElement !== this.el.speed) this.el.speed.value = v;
      this.el.speedVal.textContent = v + '%';
      this.el.osdSpeed.textContent = v + '%';
      this.root.querySelectorAll('[data-sp]').forEach(b => b.classList.toggle('on', +b.dataset.sp === v));
    }

    select(ev) { this.selected = ev; this.R.load(ev); this.renderEvents(); }

    renderEvents() {
      const R = this.R, q = this.el.filter.value.toLowerCase(), starOnly = this.el.starOnly.checked;
      const list = this.el.events;
      list.innerHTML = '';
      const evs = R.events.filter(e => (!starOnly || e.star) && (!q || (e.label || '').toLowerCase().includes(q) || e.time.includes(q)));
      if (!evs.length) { list.append(U.el('div', { class: 'mod-empty', text: R.events.length ? 'No matching events' : 'Saved replays appear here. Use LAST 5s/10s, Mark In/Out or Instant Replay.' })); return; }
      evs.forEach((ev) => {
        const n = R.events.indexOf(ev) + 1;
        const label = U.el('input', { class: 'rp-ev-label', value: ev.label || '', placeholder: 'Add label (e.g. Goal, Wicket)…', onchange: (e) => { ev.label = e.target.value; }, onkeydown: (e) => e.stopPropagation(), onclick: (e) => e.stopPropagation() });
        const row = U.el('div', { class: 'rp-ev' + (this.selected === ev ? ' sel' : '') + (R.loaded && R.loaded.event === ev ? ' loaded' : '') }, [
          U.el('button', { class: 'rp-star' + (ev.star ? ' on' : ''), text: ev.star ? '★' : '☆', title: 'Highlight', onclick: (e) => { e.stopPropagation(); R.toggleStar(ev); } }),
          U.el('span', { class: 'rp-ev-n', text: String(n) }),
          U.el('div', { class: 'rp-ev-info' }, [label, U.el('div', { class: 'hint', text: `${ev.time} · ${ev.duration.toFixed(1)} s · ${Object.keys(ev.files).length} angle${Object.keys(ev.files).length > 1 ? 's' : ''}` })]),
          U.el('button', { class: 'tbtn small', text: 'PVW', title: 'Load to replay monitor / Preview', onclick: (e) => { e.stopPropagation(); this.select(ev); } }),
          U.el('button', { class: 'tbtn small hot', text: '▶ OUT', title: 'Play to Output', onclick: (e) => { e.stopPropagation(); this.selected = ev; R.load(ev, { toOutput: true }); } }),
          U.el('button', { class: 'tbtn small', text: '✕', title: 'Delete event', onclick: (e) => { e.stopPropagation(); R.removeEvent(ev); } })
        ]);
        row.onclick = () => this.select(ev);
        row.ondblclick = () => { this.selected = ev; R.load(ev, { toOutput: true }); };
        list.append(row);
      });
    }

    drawMonitor() {
      const R = this.R, ctx = this.ctx, W = 640, H = 360;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const i = R.replayInput();
      if (i) {
        i.draw(ctx, 0, 0, W, H);
        const d = i.duration || 0;
        this.el.tc.textContent = U.fmtTimeMs(i.currentTime).slice(3);
        this.el.dur.textContent = U.fmtTimeMs(d).slice(3);
        if (document.activeElement !== this.el.seek && d) this.el.seek.value = Math.round(i.currentTime / d * 1000);
        this.el.play.textContent = i.playing ? '❚❚' : '▶';
        this.el.osdCam.textContent = R.loaded ? R.sourceLabel(R.loaded.key) : '—';
        const onAir = this.studio.programId === i.id;
        this.el.canvas.parentElement.classList.toggle('onair', onAir);
      } else {
        ctx.fillStyle = '#6f7685'; ctx.font = '600 18px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText(R.running ? 'Save an event to load it here' : 'Replay recorder is off', W / 2, H / 2);
      }
    }

    async tickStatus() {
      if (!this.R.running) { this.el.buf.textContent = 'Buffer stopped'; return; }
      const s = await this.R.status();
      const vals = Object.values(s);
      const buf = vals.length ? Math.min(...vals.map(x => x.buffered || 0)) : 0;
      const bad = vals.find(x => !x.active);
      this.el.buf.textContent = bad ? 'Encoder stopped: ' + (bad.error || '').slice(0, 60) : `Buffered ${buf.toFixed(0)} / ${this.R.cfg.seconds} s`;
      this.el.buf.style.color = bad ? 'var(--pgm)' : '';
    }

    settings() {
      const R = this.R;
      const trans = [['quick', 'Quick Play transition'], ['cut', 'Cut'], ...Array.from({ length: 8 }, (_, i) => [`Stinger${i + 1}`, `Stinger ${i + 1}`])];
      BTS.Dialog.open({
        title: 'Replay settings', width: 520,
        body: BTS.Dialog.form([
          { label: 'Instant replay length (s)', key: 'lastSeconds', type: 'number', min: 2, max: 60 },
          { label: 'Instant replay goes to Output', key: 'autoPlay', type: 'checkbox' },
          { label: 'Default speed (%)', key: 'speedPct', type: 'number', min: 5, max: 200 },
          { label: 'Transition into replay', key: 'transIn', type: 'select', options: trans, hint: 'A stinger (e.g. a logo wipe) is the classic replay transition — set it in Settings → Transitions.' },
          { label: 'Transition back to live', key: 'transOut', type: 'select', options: trans },
          { label: 'Return to live automatically when a replay ends', key: 'autoReturn', type: 'checkbox' },
          { label: 'Pre-roll (s)', key: 'preroll', type: 'number', min: 0, max: 5, step: 0.5, hint: 'Start playback this far into the event.' }
        ], Object.assign(R.cfg, { speedPct: Math.round(R.cfg.speed * 100) }), (k, v) => { if (k === 'speedPct') R.setSpeed(v / 100); }),
        buttons: [{ label: 'Close', primary: true }]
      });
    }
  }

  BTS.ReplayUI = ReplayUI;
})(window.BTS);
