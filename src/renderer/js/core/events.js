'use strict';
(function (BTS) {
  /** Tiny event bus */
  class Emitter {
    constructor() { this._h = new Map(); }
    on(ev, fn) { if (!this._h.has(ev)) this._h.set(ev, new Set()); this._h.get(ev).add(fn); return () => this.off(ev, fn); }
    off(ev, fn) { const s = this._h.get(ev); if (s) s.delete(fn); }
    once(ev, fn) { const off = this.on(ev, (...a) => { off(); fn(...a); }); return off; }
    emit(ev, ...args) { const s = this._h.get(ev); if (s) for (const fn of [...s]) { try { fn(...args); } catch (e) { console.error(`[event ${ev}]`, e); } } }
  }
  BTS.Emitter = Emitter;
  BTS.bus = new Emitter();
})(window.BTS);
