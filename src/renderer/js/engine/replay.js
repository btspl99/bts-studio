'use strict';
/**
 * Instant Replay engine (renderer side).
 * - Continuously buffers up to 8 replay cameras (any camera / capture / stream input, or Program).
 * - An EVENT is the same moment cut from every buffered camera (multi-angle), by Mark In/Out or "last N s".
 * - Events play in the Replay input at any speed; the angle can be switched while playing (time-aligned).
 * - Return to Live goes back to the input that was on Output before the replay.
 * - Highlights: play starred events (or a whole list) back-to-back.
 */
(function (BTS) {
  const U = BTS.U;

  class Replay extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.cfg = { sources: ['program'], seconds: 120, current: 'program', speed: 0.5, autoPlay: true, lastSeconds: 8, transIn: 'quick', transOut: 'quick', preroll: 0, autoReturn: false };
      this.active = new Map(); // key -> {rec, id, startedAt}
      this.events = [];        // [{id, files:{key:file}, duration, label, time, star, inWall}]
      this.markInWall = 0; this.markOutWall = 0;
      this.loaded = null;      // {event, key}
      this.queue = [];
      this.returnTo = null;
      studio.on('input-ended', (inp) => { if (inp === this.replayInput()) this._onEnded(); });
    }
    get running() { return this.active.size > 0; }
    get cameras() { return [...this.active.keys()]; }
    sourceStream(key) {
      if (key === 'program') return this.studio.outputs.programStream();
      const i = this.studio.byId(key); return i ? i.getMediaStream() : null;
    }
    sourceLabel(key) { return key === 'program' ? 'Program' : (this.studio.byId(key)?.title || 'Camera'); }
    candidates() { return [['program', 'Program (Output)'], ...this.studio.inputs.filter(i => i.getMediaStream && i.getMediaStream() && i.hasVideo && i.type !== 'replay').map(i => [i.id, `${i.number}. ${i.title}`])]; }

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

    replayInput() { return this.studio.inputs.find(i => i.type === 'replay'); }
    async _ensureInput(path) {
      let inp = this.replayInput();
      if (!inp) inp = await this.studio.addInput({ type: 'replay', title: 'Replay', cfg: { path }, props: { autoPlay: true, autoRestart: false, autoPause: true, onEnd: '' }, noAutoProgram: true }, { select: false });
      return inp;
    }

    /** Load an event (optionally a given angle) into the Replay input */
    async load(ev, { key, speed, toOutput, keepTime } = {}) {
      if (!ev) return false;
      const k = key && ev.files[key] ? key : ev.files[this.cfg.current] ? this.cfg.current : Object.keys(ev.files)[0];
      const path = ev.files[k] || ev.file;
      const inp = await this._ensureInput(path);
      const t = keepTime ? inp.currentTime : this.cfg.preroll || 0;
      const wasPlaying = inp.playing;
      if (inp.cfg.path !== path || !inp.el || !inp.el.src) {
        inp.cfg.path = path;
        inp._createEl();
        const ready = new Promise(res => { inp.el.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 2500); });
        await inp.init();
        await ready;
      }
      inp.title = 'Replay — ' + this.sourceLabel(k);
      inp.setSpeed(speed || this.cfg.speed);
      inp.seek(t);
      this.loaded = { event: ev, key: k };
      if (toOutput) await this.goLive();
      else if (keepTime && wasPlaying) inp.play();
      else this.studio.setPreview(inp.id);
      this.studio.emit('inputs');
      this.emit('change');
      return true;
    }
    /** Switch camera angle of the loaded event, keeping the playhead */
    async angle(key) {
      this.cfg.current = key;
      if (this.loaded && this.loaded.event.files[key]) return this.load(this.loaded.event, { key, keepTime: true, speed: this.cfg.speed });
      this.emit('change');
      return true;
    }
    async goLive() {
      const inp = this.replayInput(); if (!inp) return false;
      if (this.studio.programId !== inp.id) this.returnTo = this.studio.programId;
      inp.play();
      this._transition(this.cfg.transIn, inp.id);
      return true;
    }
    returnToLive() {
      const inp = this.replayInput();
      this.queue = [];
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
    setSpeed(v) { this.cfg.speed = U.clamp(v, 0.05, 2); const i = this.replayInput(); if (i) i.setSpeed(this.cfg.speed); this.emit('speed'); return true; }
    toggleStar(ev) { ev.star = !ev.star; this.emit('change'); }
    removeEvent(ev) { for (const f of Object.values(ev.files)) window.bts.replay.deleteClip(f); this.events = this.events.filter(e => e !== ev); if (this.loaded && this.loaded.event === ev) this.loaded = null; this.emit('change'); }

    /** Highlights: play a list of events back-to-back on Output */
    async playHighlights(list) {
      const evs = (list || this.events.filter(e => e.star)).slice().reverse();
      if (!evs.length) { U.toast('Star some events first (☆)', 'error'); return false; }
      this.queue = evs.slice(1);
      await this.load(evs[0], { toOutput: true });
      return true;
    }
    async _onEnded() {
      if (this.queue.length) { const next = this.queue.shift(); await this.load(next, { keepTime: false }); const i = this.replayInput(); if (i) i.play(); return; }
      if (this.cfg.autoReturn && this.studio.programId === this.replayInput()?.id) this.returnToLive();
    }

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
