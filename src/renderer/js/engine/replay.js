'use strict';
/**
 * Instant Replay engine (renderer side).
 * - Continuously buffers up to 8 replay cameras (any camera / capture / stream input, or Program).
 * - An EVENT is the same moment cut from every buffered camera (multi-angle), by Mark In/Out or "last N s".
 * - Events play in the Replay input at any speed; the angle can be switched while playing (time-aligned).
 * - Return to Live goes back to the input that was on Output before the replay.
 * - Highlights: play starred events (or a whole list) back-to-back, optionally over a music bed.
 * - Two replay channels (A and B): B can follow A in sync with a different angle (e.g. A to Output, B to a big screen),
 *   or be driven independently.
 */
(function (BTS) {
  const U = BTS.U;

  class Replay extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.cfg = { sources: ['program'], seconds: 120, current: 'program', speed: 0.5, autoPlay: true, lastSeconds: 8, transIn: 'quick', transOut: 'quick', preroll: 0, autoReturn: false,
        bFollow: false, bAngle: 2, music: '', musicVolume: 0.8, replayAudio: 0.25, musicFadeMs: 1500 };
      this.sel = 'A';           // channel the operator controls
      this.chan = { A: { loaded: null, queue: [], returnTo: null }, B: { loaded: null, queue: [], returnTo: null } };
      this.active = new Map(); // key -> {rec, id, startedAt}
      this.events = [];        // [{id, files:{key:file}, duration, label, time, star, inWall}]
      this.markInWall = 0; this.markOutWall = 0;
      studio.on('input-ended', (inp) => { for (const c of ['A', 'B']) if (inp === this.replayInput(c)) this._onEnded(c); });
      this._sync = setInterval(() => this._syncB(), 500);
    }
    // per-channel state; `loaded`/`queue`/`returnTo` refer to the selected channel
    get loaded() { return this.chan[this.sel].loaded; } set loaded(v) { this.chan[this.sel].loaded = v; }
    get queue() { return this.chan[this.sel].queue; } set queue(v) { this.chan[this.sel].queue = v; }
    get returnTo() { return this.chan[this.sel].returnTo; } set returnTo(v) { this.chan[this.sel].returnTo = v; }
    select(c) { this.sel = c === 'B' ? 'B' : 'A'; this.emit('change'); return true; }
    get following() { return this.cfg.bFollow && this.sel === 'A'; }
    get running() { return this.active.size > 0; }
    get cameras() { return [...this.active.keys()]; }
    sourceStream(key) {
      if (key === 'program') return this.studio.outputs.programStream();
      const i = this.studio.byId(key); return i ? i.getMediaStream() : null;
    }
    sourceLabel(key) { return key === 'program' ? 'Program' : (this.studio.byId(key)?.title || 'Camera'); }
    candidates() { return [['program', 'Program (Output)'], ...this.studio.inputs.filter(i => i.getMediaStream && i.getMediaStream() && i.hasVideo && !['replay', 'audio-file', 'audio', 'telestrator', 'title', 'color'].includes(i.type)).map(i => [i.id, `${i.number}. ${i.title}`])]; }

    async start() {
      await this.stop();
      const enc = await window.bts.output.encoders();
      const hw = (enc.list || []).find(e => /nvenc|qsv|amf/.test(e) && e.startsWith('h264'));
      for (const key of this.cfg.sources.slice(0, 8)) {
        const ms = this.sourceStream(key);
        // media-element streams publish their tracks asynchronously
        if (ms && !ms.getVideoTracks().length) await new Promise(r => { ms.addEventListener('addtrack', r, { once: true }); setTimeout(r, 1500); });
        if (!ms || !ms.getVideoTracks().length) { U.toast(`Replay: ${this.sourceLabel(key)} has no video`, 'error'); continue; }
        const id = 'rp-' + key;
        const r = await window.bts.replay.start(id, { seconds: this.cfg.seconds, fps: Math.round(this.studio.fps), encoder: hw || 'libx264', height: Math.min(1080, this.studio.H) });
        if (!r.ok) continue;
        const mime = this.studio.outputs.mime.mime;
        const rec = new MediaRecorder(ms, { mimeType: mime || undefined, videoBitsPerSecond: 16e6, audioBitsPerSecond: 192000 });
        let q = Promise.resolve();
        rec.ondataavailable = (e) => { if (e.data.size) q = q.then(() => e.data.arrayBuffer()).then(b => window.bts.replay.chunk(id, b)).catch(() => {}); };
        rec.start(500);
        this.active.set(key, { rec, id, startedAt: Date.now() });
      }
      if (!this.active.has(this.cfg.current)) this.cfg.current = this.cameras[0] || 'program';
      this.emit('change');
      return this.running;
    }
    async stop() {
      for (const [, a] of this.active) { try { a.rec.stop(); } catch { /* noop */ } await window.bts.replay.stop(a.id); }
      this.active.clear();
      this.emit('change');
    }
    async status() {
      const out = {};
      for (const [key, a] of this.active) out[key] = await window.bts.replay.status(a.id);
      return out;
    }
    markIn() { this.markInWall = Date.now(); this.markOutWall = 0; this.emit('change'); return true; }
    markOut() { if (!this.markInWall) this.markInWall = Date.now() - this.cfg.lastSeconds * 1000; this.markOutWall = Date.now(); this.emit('change'); return true; }
    clearMarks() { this.markInWall = 0; this.markOutWall = 0; this.emit('change'); }

    /** Create a multi-angle event. opts: {last} seconds, or {marks:true} */
    async clip({ last, marks, label } = {}) {
      if (!this.running) { U.toast('Start the replay recorder first', 'error'); return null; }
      const now = Date.now();
      const inWall = marks && this.markInWall ? this.markInWall : now - (last || this.cfg.lastSeconds) * 1000;
      const outWall = marks && this.markOutWall ? this.markOutWall : now;
      const results = await Promise.all(this.cameras.map(async (key) => {
        const a = this.active.get(key);
        const r = await window.bts.replay.clip(a.id, { inWall, outWall, label: this.sourceLabel(key) });
        return [key, r];
      }));
      const files = {}; let duration = 0; let err = '';
      for (const [key, r] of results) { if (r.ok) { files[key] = r.file; duration = Math.max(duration, r.duration); } else err = r.error; }
      if (!Object.keys(files).length) { U.toast('Replay: ' + (err || 'clip failed'), 'error'); return null; }
      const ev = { id: U.uid('ev'), files, duration, label: label || '', time: new Date(inWall).toLocaleTimeString(), star: false, inWall };
      this.events.unshift(ev);
      if (this.events.length > 200) this.events.pop();
      if (marks) this.clearMarks();
      this.emit('change');
      return ev;
    }

    replayInput(c = this.sel) { return this.studio.inputs.find(i => i.type === 'replay' && (i.cfg.channel || 'A') === c); }
    async _ensureInput(path, c = this.sel) {
      let inp = this.replayInput(c);
      if (!inp) inp = await this.studio.addInput({ type: 'replay', title: 'Replay ' + c, cfg: { path, channel: c }, props: { autoPlay: true, autoRestart: false, autoPause: c === 'A', onEnd: '' }, noAutoProgram: true }, { select: false });
      return inp;
    }
    /** angle for B when following A: the configured angle number, or the next angle that A is not using */
    _bKey(ev, aKey) {
      const keys = Object.keys(ev.files);
      const want = keys[(this.cfg.bAngle || 2) - 1];
      if (want && want !== aKey) return want;
      return keys.find(k => k !== aKey) || aKey;
    }
    _syncB() {
      if (!this.cfg.bFollow) return;
      const a = this.replayInput('A'), b = this.replayInput('B');
      if (!a || !b || !this.chan.A.loaded || !this.chan.B.loaded || this.chan.A.loaded.event !== this.chan.B.loaded.event) return;
      if (a.playing !== b.playing) { if (a.playing) b.play(); else b.pause(); }
      if ((b.el && b.el.playbackRate) !== (a.el && a.el.playbackRate) && a.el) b.setSpeed(a.el.playbackRate);
      if (Math.abs(a.currentTime - b.currentTime) > 0.12) b.seek(a.currentTime);
    }

    /** Load an event (optionally a given angle) into the Replay input */
    async load(ev, { key, speed, toOutput, keepTime, channel, _follow, _angleOnly } = {}) {
      if (!ev) return false;
      const c = channel || this.sel;
      const ch = this.chan[c];
      const k = key && ev.files[key] ? key : ev.files[this.cfg.current] ? this.cfg.current : Object.keys(ev.files)[0];
      const path = ev.files[k] || ev.file;
      const inp = await this._ensureInput(path, c);
      const t = keepTime ? inp.currentTime : this.cfg.preroll || 0;
      const wasPlaying = inp.playing;
      if (inp.cfg.path !== path || !inp.el || !inp.el.src) {
        inp.cfg.path = path;
        inp._createEl();
        const ready = new Promise(res => { inp.el.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 2500); });
        await inp.init();
        await ready;
      }
      inp.title = `Replay ${c} — ` + this.sourceLabel(k);
      inp.setSpeed(speed || this.cfg.speed);
      inp.seek(t);
      ch.loaded = { event: ev, key: k };
      if (c === 'A' && this.cfg.bFollow) {
        // B shows the same moment from another angle, kept in sync
        const bk = this._bKey(ev, k);
        if (!_angleOnly) await this.load(ev, { key: bk, speed: speed || this.cfg.speed, channel: 'B', keepTime: false, _follow: true });
      }
      if (toOutput) await this.goLive(c);
      else if (keepTime && wasPlaying) inp.play();
      else if (c === this.sel && !_follow) this.studio.setPreview(inp.id);
      this.studio.emit('inputs');
      this.emit('change');
      return true;
    }
    /** Switch camera angle of the loaded event, keeping the playhead */
    async angle(key) {
      this.cfg.current = key;
      if (this.loaded && this.loaded.event.files[key]) {
        const ev = this.loaded.event, c = this.sel;
        const inp = this.replayInput(c), t = inp ? inp.currentTime : 0, playing = inp && inp.playing;
        // switch only this channel's angle; B keeps following time but not the angle
        const ok = await this.load(ev, { key, keepTime: true, speed: this.cfg.speed, channel: c, _angleOnly: true });
        if (c === 'A' && this.cfg.bFollow) { const b = this.replayInput('B'); if (b) { b.seek(t); if (playing) b.play(); } }
        return ok;
      }
      this.emit('change');
      return true;
    }
    async goLive(c = this.sel) {
      const inp = this.replayInput(c); if (!inp) return false;
      if (this.studio.programId !== inp.id) this.chan[c].returnTo = this.studio.programId;
      inp.play();
      if (c === 'A' && this.cfg.bFollow) { const b = this.replayInput('B'); if (b && this.chan.B.loaded) { b.seek(inp.currentTime); b.play(); } }
      this._transition(this.cfg.transIn, inp.id);
      return true;
    }
    returnToLive() {
      const inp = this.replayInput();
      this.queue = [];
      this._musicOut();
      const back = this.returnTo && this.studio.byId(this.returnTo) ? this.returnTo : this.studio.inputs.find(i => i !== inp && i.hasVideo)?.id;
      if (!back) return false;
      this._transition(this.cfg.transOut, back);
      return true;
    }
    _transition(kind, id) {
      if (kind === 'cut') this.studio.cut(id);
      else if (BTS.Transitions.isStinger(kind)) this.studio.transition(kind, 0, id);
      else this.studio.quickPlay(id);
    }
    async instant(last) {
      const ev = await this.clip({ last });
      if (ev) await this.load(ev, { toOutput: this.cfg.autoPlay });
      return !!ev;
    }
    async playLast() { return this.load(this.events[0], { toOutput: true }); }
    setSpeed(v) { this.cfg.speed = U.clamp(v, 0.05, 2); const i = this.replayInput(); if (i) i.setSpeed(this.cfg.speed); if (this.following) { const b = this.replayInput('B'); if (b) b.setSpeed(this.cfg.speed); } this.emit('speed'); return true; }
    toggleStar(ev) { ev.star = !ev.star; this.emit('change'); }
    /** tags (event lists): Goal, Wicket, Save… — an event can carry several */
    get tagList() { return this.cfg.tags && this.cfg.tags.length ? this.cfg.tags : ['Goal', 'Save', 'Foul', 'Wicket', 'Six', 'Four', 'Best']; }
    toggleTag(ev, tag) { ev.tags = ev.tags || []; ev.tags = ev.tags.includes(tag) ? ev.tags.filter(t => t !== tag) : [...ev.tags, tag]; this.emit('change'); return true; }
    tagLast(tag) { const ev = this.events[0]; if (!ev) return false; ev.tags = [...new Set([...(ev.tags || []), tag])]; this.emit('change'); return true; }
    byTag(tag) { return this.events.filter(e => (e.tags || []).includes(tag)); }
    playTag(tag) { const l = this.byTag(tag); if (!l.length) { U.toast(`No events tagged “${tag}”`, 'error'); return false; } return this.playHighlights(l); }
    removeEvent(ev) { for (const f of Object.values(ev.files)) window.bts.replay.deleteClip(f); this.events = this.events.filter(e => e !== ev); if (this.loaded && this.loaded.event === ev) this.loaded = null; this.emit('change'); }

    /** Highlights: play a list of events back-to-back on Output */
    async playHighlights(list) {
      const evs = (list || this.events.filter(e => e.star)).slice().reverse();
      if (!evs.length) { U.toast('Star some events first (☆)', 'error'); return false; }
      this.queue = evs.slice(1);
      this.chan[this.sel].highlights = true;
      await this._musicIn();
      await this.load(evs[0], { toOutput: true });
      return true;
    }
    async _onEnded(c = 'A') {
      const ch = this.chan[c];
      if (c === 'B' && this.cfg.bFollow) return; // B follows A
      if (ch.queue.length) { const next = ch.queue.shift(); await this.load(next, { keepTime: false, channel: c }); const i = this.replayInput(c); if (i) i.play(); if (c === 'A' && this.cfg.bFollow) { const b = this.replayInput('B'); if (b) b.play(); } return; }
      if (ch.highlights) { ch.highlights = false; this._musicOut(); }
      const prev = this.sel; this.sel = c;
      if (this.cfg.autoReturn && this.studio.programId === this.replayInput(c)?.id) this.returnToLive();
      this.sel = prev;
    }

    /* ---------- highlight music bed ---------- */
    musicInput() { return this.studio.inputs.find(i => i.type === 'audio-file' && i.cfg.replayMusic); }
    async _musicIn() {
      if (!this.cfg.music) return;
      let m = this.musicInput();
      if (!m) m = await this.studio.addInput({ type: 'audio-file', title: 'Highlight Music', cfg: { path: this.cfg.music, replayMusic: true }, props: { loop: true, autoPlay: false, autoPause: false }, noAutoProgram: true }, { select: false });
      else if (m.cfg.path !== this.cfg.music) { m.cfg.path = this.cfg.music; await m.init(); }
      m.setLoop(true);
      m.channel.set({ followVideo: false, muted: false });
      m.channel.fadeTo(0, 1);
      m.restart(); m.play();
      m.channel.fadeTo(this.cfg.musicVolume ?? 0.8, this.cfg.musicFadeMs || 1500);
      // duck the replay clip's own sound under the music
      for (const c of ['A', 'B']) { const r = this.replayInput(c); if (r && r.channel) { r._preMusicVol = r._preMusicVol ?? r.channel.s.volume; r.channel.fadeTo(this.cfg.replayAudio ?? 0.25, 400); } }
      this.emit('music', true);
    }
    _musicOut() {
      const m = this.musicInput();
      if (m && m.playing) {
        const ms = this.cfg.musicFadeMs || 1500;
        m.channel.fadeTo(0, ms);
        clearTimeout(this._musicT); this._musicT = setTimeout(() => m.pause(), ms + 100);
      }
      for (const c of ['A', 'B']) { const r = this.replayInput(c); if (r && r.channel && r._preMusicVol != null) { r.channel.fadeTo(r._preMusicVol, 400); r._preMusicVol = null; } }
      this.emit('music', false);
    }
    get musicPlaying() { const m = this.musicInput(); return !!(m && m.playing); }

    serialize() { return { ...U.deepClone(this.cfg), events: this.events.slice(0, 50) }; }
    loadCfg(c) {
      if (!c) return;
      const { events, ...rest } = c;
      Object.assign(this.cfg, rest);
      this.events = (events || []).map(e => (e.files ? e : { id: U.uid('ev'), files: { program: e.file }, duration: e.duration, label: e.label || '', time: e.time, star: false }));
      this.emit('change');
    }
  }

  BTS.Replay = Replay;
})(window.BTS);
