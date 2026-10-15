'use strict';
/**
 * Instant Replay engine (renderer side). Buffers selected cameras (or the programme) continuously,
 * cuts clips (last N seconds or Mark In → Mark Out) and plays them in a "Replay" input at 100/75/50/25 %.
 */
(function (BTS) {
  const U = BTS.U;

  class Replay extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.cfg = { sources: ['program'], seconds: 120, current: 'program', speed: 0.5, autoPlay: true, lastSeconds: 8 };
      this.active = new Map(); // key -> {recorder, id}
      this.events = [];        // [{file, duration, label, time}]
      this.markInWall = 0; this.markOutWall = 0;
    }
    get running() { return this.active.size > 0; }
    sourceStream(key) {
      if (key === 'program') return this.studio.outputs.programStream();
      const i = this.studio.byId(key); return i ? i.getMediaStream() : null;
    }
    sourceLabel(key) { return key === 'program' ? 'Program' : (this.studio.byId(key)?.title || 'Input'); }

    async start() {
      await this.stop();
      const enc = await window.bts.output.encoders();
      const hw = (enc.list || []).find(e => /nvenc|qsv|amf/.test(e) && e.startsWith('h264'));
      for (const key of this.cfg.sources) {
        const ms = this.sourceStream(key);
        if (!ms || !ms.getVideoTracks().length) { U.toast(`Replay: ${this.sourceLabel(key)} has no video`, 'error'); continue; }
        const id = 'rp-' + key;
        const r = await window.bts.replay.start(id, { seconds: this.cfg.seconds, fps: Math.round(this.studio.fps), encoder: hw || 'libx264', height: Math.min(1080, this.studio.H) });
        if (!r.ok) continue;
        const mime = this.studio.outputs.mime.mime;
        const rec = new MediaRecorder(ms, { mimeType: mime || undefined, videoBitsPerSecond: 16e6, audioBitsPerSecond: 192000 });
        let q = Promise.resolve();
        rec.ondataavailable = (e) => { if (e.data.size) q = q.then(() => e.data.arrayBuffer()).then(b => window.bts.replay.chunk(id, b)).catch(() => {}); };
        rec.start(500);
        this.active.set(key, { rec, id });
      }
      if (!this.active.has(this.cfg.current)) this.cfg.current = [...this.active.keys()][0] || 'program';
      this.emit('change');
      return this.running;
    }
    async stop() {
      for (const [key, a] of this.active) { try { a.rec.stop(); } catch { /* noop */ } await window.bts.replay.stop(a.id); }
      this.active.clear();
      this.emit('change');
    }
    async status() {
      const out = {};
      for (const [key, a] of this.active) out[key] = await window.bts.replay.status(a.id);
      return out;
    }
    markIn() { this.markInWall = Date.now(); this.markOutWall = 0; this.emit('change'); return true; }
    markOut() { this.markOutWall = Date.now(); this.emit('change'); return true; }

    async clip({ last, marks, source } = {}) {
      const key = source || this.cfg.current;
      const a = this.active.get(key);
      if (!a) { U.toast('Start the replay buffer first (Replay panel)', 'error'); return null; }
      const opts = marks && this.markInWall ? { inWall: this.markInWall, outWall: this.markOutWall || Date.now(), label: this.sourceLabel(key) } : { last: last || this.cfg.lastSeconds, label: this.sourceLabel(key) };
      const r = await window.bts.replay.clip(a.id, opts);
      if (!r.ok) { U.toast('Replay: ' + r.error, 'error'); return null; }
      const ev = { file: r.file, duration: r.duration, label: this.sourceLabel(key), time: new Date().toLocaleTimeString() };
      this.events.unshift(ev);
      if (this.events.length > 50) this.events.pop();
      if (marks) { this.markInWall = 0; this.markOutWall = 0; }
      this.emit('change');
      return ev;
    }

    replayInput() { return this.studio.inputs.find(i => i.type === 'replay'); }
    async load(ev, { speed, toOutput } = {}) {
      if (!ev) return false;
      let inp = this.replayInput();
      if (!inp) inp = await this.studio.addInput({ type: 'replay', title: 'Replay', cfg: { path: ev.file }, props: { autoPlay: true, autoRestart: true, autoPause: true, onEnd: '' }, noAutoProgram: true }, { select: false });
      else { inp.cfg.path = ev.file; await inp.init(); }
      inp.setSpeed(speed || this.cfg.speed);
      inp.restart();
      if (toOutput) { this.studio.quickPlay(inp.id); inp.play(); }
      else this.studio.setPreview(inp.id);
      return true;
    }
    async instant(last) {
      const ev = await this.clip({ last });
      if (ev) await this.load(ev, { toOutput: this.cfg.autoPlay });
      return !!ev;
    }
    setSpeed(v) { this.cfg.speed = v; const i = this.replayInput(); if (i) i.setSpeed(v); this.emit('change'); return true; }

    serialize() { return { ...U.deepClone(this.cfg), events: this.events.slice(0, 20) }; }
    loadCfg(c) { if (!c) return; const { events, ...rest } = c; Object.assign(this.cfg, rest); this.events = events || []; this.emit('change'); }
  }

  BTS.Replay = Replay;
})(window.BTS);
