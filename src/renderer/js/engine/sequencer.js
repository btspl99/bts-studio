'use strict';
/**
 * Playlist sequencer — plays a list of inputs to Output one after another (adverts, highlights, slides, loops).
 * Each entry: { inputId, duration } — duration in seconds; 0 = until the media ends (videos / lists) or 10 s for stills.
 */
(function (BTS) {
  const U = BTS.U;

  class Sequencer extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.cfg = { items: [], loop: true, transition: 'Fade', duration: 600 };
      this.index = -1;
      this.running = false;
      this._timer = null;
      studio.on('input-ended', (inp) => {
        const it = this.current;
        if (this.running && it && it.inputId === inp.id && !it.duration) this.next();
      });
    }
    get current() { return this.cfg.items[this.index] || null; }

    start(from = 0) {
      const items = this.cfg.items.filter(i => this.studio.byId(i.inputId));
      if (!items.length) { U.toast('Playlist is empty — add inputs in the Playlist window', 'error'); return false; }
      this.running = true;
      this._play(U.clamp(from, 0, this.cfg.items.length - 1));
      return true;
    }
    stop() { this.running = false; clearTimeout(this._timer); this.emit('change'); return true; }
    next() { if (!this.running) return this.start(0); return this._play(this.index + 1); }
    prev() { if (!this.running) return this.start(0); return this._play(this.index - 1); }

    _play(i) {
      clearTimeout(this._timer);
      const n = this.cfg.items.length;
      if (!n) return this.stop();
      if (i >= n) { if (!this.cfg.loop) return this.stop(); i = 0; }
      if (i < 0) i = n - 1;
      let guard = 0;
      while (!this.studio.byId(this.cfg.items[i]?.inputId) && guard++ < n) i = (i + 1) % n;
      const it = this.cfg.items[i];
      const inp = this.studio.byId(it?.inputId);
      if (!inp) return this.stop();
      this.index = i;
      if (inp.isMedia) inp.restart();
      this.studio.transition(this.cfg.transition, this.cfg.duration, inp.id);
      if (inp.isMedia) inp.play();
      const secs = it.duration > 0 ? it.duration : (inp.isMedia ? 0 : 10);
      if (secs > 0) this._timer = setTimeout(() => { if (this.running) this.next(); }, secs * 1000 + this.cfg.duration);
      this.emit('change');
      return true;
    }

    serialize() { return U.deepClone(this.cfg); }
    load(c) { this.stop(); if (c) this.cfg = Object.assign({ items: [], loop: true, transition: 'Fade', duration: 600 }, U.deepClone(c)); this.emit('change'); }
  }

  BTS.Sequencer = Sequencer;
})(window.BTS);
