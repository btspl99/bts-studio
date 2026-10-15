'use strict';
/**
 * Macros (scripts) and input triggers.
 * A macro is a list of steps {fn, params, delay} run in order — e.g. "Cut 2 → wait 2 s → Overlay 1 Lower Third".
 * Triggers run a function or macro when an input goes live (TransitionIn), leaves (TransitionOut) or finishes (Completion).
 */
(function (BTS) {
  const U = BTS.U;

  class Macros extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.list = [];      // [{id, name, steps:[{fn, params, delay}], loop:false}]
      this.running = new Map(); // id -> {cancel}
    }
    get(ref) { const r = String(ref).toLowerCase(); return this.list.find(m => m.id === ref || m.name.toLowerCase() === r) || null; }
    add(name = 'New Macro') { const m = { id: U.uid('mc'), name, steps: [], loop: false }; this.list.push(m); this.emit('change'); return m; }
    remove(id) { this.stop(id); this.list = this.list.filter(m => m.id !== id); this.emit('change'); }

    async run(ref) {
      const m = this.get(ref);
      if (!m) return { ok: false, error: 'Macro not found: ' + ref };
      if (this.running.has(m.id)) return { ok: true }; // already running
      let cancelled = false;
      this.running.set(m.id, { cancel: () => { cancelled = true; } });
      this.emit('change');
      try {
        do {
          for (const step of m.steps) {
            if (cancelled) break;
            if (step.delay) await new Promise(r => setTimeout(r, step.delay));
            if (cancelled) break;
            if (step.fn === 'Wait') continue;
            const r = step.fn === 'ScriptStart' && this.get(step.params?.Value)?.id === m.id ? { ok: false, error: 'Macro cannot start itself' } : await BTS.Functions.call(step.fn, step.params || {});
            if (!r.ok) U.toast(`Macro "${m.name}": ${step.fn} — ${r.error}`, 'error', 4000);
          }
          if (m.loop && !cancelled) await new Promise(r => setTimeout(r, 50));
        } while (m.loop && !cancelled);
      } finally {
        this.running.delete(m.id);
        this.emit('change');
      }
      return { ok: true };
    }
    stop(ref) { const m = this.get(ref); if (m && this.running.has(m.id)) this.running.get(m.id).cancel(); return true; }
    stopAll() { for (const r of this.running.values()) r.cancel(); }

    /** Fire an input's triggers for an event */
    fire(input, event) {
      const trig = input.props.triggers || [];
      for (const t of trig) {
        if (t.event !== event || !t.fn) continue;
        const params = { ...(t.params || {}) };
        if (params.Input === '{self}') params.Input = input.id;
        setTimeout(() => BTS.Functions.call(t.fn, params).then(r => { if (!r.ok) U.toast(`Trigger on ${input.title}: ${t.fn} — ${r.error}`, 'error', 4000); }), t.delay || 0);
      }
    }

    serialize() { return U.deepClone(this.list); }
    load(list) { this.stopAll(); this.list = U.deepClone(list || []); this.emit('change'); }
  }

  BTS.Macros = Macros;
})(window.BTS);
