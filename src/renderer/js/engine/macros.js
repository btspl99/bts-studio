'use strict';
/**
 * Macros (scripts) and input triggers.
 * A macro is a list of steps {fn, params, delay} run in order — e.g. "Cut 2 → wait 2 s → Overlay 1 Lower Third".
 * A script can instead be JavaScript (kind: 'js') using the API object — see SCRIPT_HELP.
 * Triggers run a function or macro when an input goes live (TransitionIn), leaves (TransitionOut) or finishes (Completion).
 */
(function (BTS) {
  const U = BTS.U;

  const SCRIPT_HELP = `// JavaScript scripting — runs in a sandboxed worker. Everything is async: use await.
// await API.Cut({ Input: 2 })            any function from the Shortcuts list, with vMix-style parameters
// await API.Function('Fade', { Input: 'Camera 1', Duration: 1000 })
// await API.state()                      { inputs, active, preview, overlays, streaming, recording, ... }
// await API.input('Lower Third')         { number, title, type, live, preview, fields, position, duration }
// await API.setText('Lower Third', 'Name', 'Priya')     update a title field
// await API.data('Players')              { rows, columns, row } of a data source
// await sleep(1000)                      wait
// log('message')                         shows a notification and writes to the log
// running()                              false once Stop is pressed — use in loops
//
// Example: rotate cameras 1-3 every 5 s until stopped
// while (running()) {
//   for (const n of [1, 2, 3]) { await API.Fade({ Input: n, Duration: 800 }); await sleep(5000); }
// }
`;

  // Worker prelude: API calls are forwarded to the studio over postMessage (no DOM / Node access inside scripts).
  const PRELUDE = `'use strict';
let __id = 0, __alive = true; const __wait = new Map();
self.onmessage = (e) => { const m = e.data; if (m.t === 'stop') { __alive = false; for (const [, w] of __wait) w.reject({ __cancel: true }); __wait.clear(); return; } const w = __wait.get(m.id); if (!w) return; __wait.delete(m.id); m.ok ? w.resolve(m.data) : w.reject(new Error(m.error)); };
const __rpc = (op, ...args) => new Promise((resolve, reject) => { if (!__alive) return reject({ __cancel: true }); const id = ++__id; __wait.set(id, { resolve, reject }); postMessage({ t: 'rpc', id, op, args }); });
const running = () => __alive;
const sleep = (ms) => new Promise((resolve, reject) => { if (!__alive) return reject({ __cancel: true }); const id = 's' + (++__id); const t = setTimeout(() => { __wait.delete(id); resolve(); }, Math.max(0, +ms || 0)); __wait.set(id, { resolve, reject: (x) => { clearTimeout(t); reject(x); } }); });
const log = (...a) => postMessage({ t: 'log', msg: a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ') });
const API = new Proxy({ Function: (fn, p) => __rpc('call', fn, p || {}), state: () => __rpc('state'), input: (r) => __rpc('input', r), setText: (i, f, v) => __rpc('setText', i, f, v), setImage: (i, f, v) => __rpc('setImage', i, f, v), data: (r) => __rpc('data', r) },
  { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^[A-Z]/.test(k) ? (p) => __rpc('call', k, p || {}) : undefined) });
`;

  class Macros extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.list = [];      // [{id, name, steps:[{fn, params, delay}], loop:false}]
      this.running = new Map(); // id -> {cancel}
      this._watch();
    }
    /** event sources for input triggers beyond in / out / completion */
    _watch() {
      const st = this.studio;
      let pvw = st.previewId, ovl = new Map();
      st.on('bus', () => {
        if (st.previewId !== pvw) { const a = st.byId(pvw), b = st.byId(st.previewId); pvw = st.previewId; if (a) this.fire(a, 'PreviewOut'); if (b) this.fire(b, 'PreviewIn'); }
      });
      st.on('overlays', () => {
        const now = new Map(st.overlays.map((o, i) => [i, o.inputId && (o.state === 'in' || o.state === 'on') ? o.inputId : null]));
        for (const [i, id] of now) { const was = ovl.get(i) || null; if (id === was) continue; if (was && st.byId(was)) this.fire(st.byId(was), 'OverlayOut'); if (id && st.byId(id)) this.fire(st.byId(id), 'OverlayIn'); }
        ovl = now;
      });
      // timers reaching zero and media about to end (checked twice a second)
      setInterval(() => {
        for (const i of st.inputs) {
          if (!i.props.triggers || !i.props.triggers.length) continue;
          if (i.type === 'title' && i.renderer) {
            for (const e of i.renderer.t.elements) {
              if (e.type !== 'countdown' || e.countUp) continue;
              const tm = i.renderer.timers[e.id]; if (!tm || !tm.running) { if (tm) tm._fired = false; continue; }
              if (i.renderer.timerValue(e) <= 0 && !tm._fired) { tm._fired = true; this.fire(i, 'TimerEnd'); }
            }
          }
          if (i.isMedia && i.playing && i.duration > 0) {
            const left = i.duration - i.currentTime, near = left <= (i.props.nearEndSec || 10);
            if (near && !i._nearFired) { i._nearFired = true; this.fire(i, 'NearEnd'); } else if (!near) i._nearFired = false;
          }
        }
      }, 500);
    }
    get(ref) { const r = String(ref).toLowerCase(); return this.list.find(m => m.id === ref || m.name.toLowerCase() === r) || null; }
    add(name = 'New Macro', kind = 'steps') { const m = { id: U.uid('mc'), name, kind, steps: [], loop: false, code: kind === 'js' ? SCRIPT_HELP : '' }; this.list.push(m); this.emit('change'); return m; }
    remove(id) { this.stop(id); this.list = this.list.filter(m => m.id !== id); this.emit('change'); }

    async run(ref) {
      const m = this.get(ref);
      if (!m) return { ok: false, error: 'Macro not found: ' + ref };
      if (this.running.has(m.id)) return { ok: true }; // already running
      let cancelled = false;
      const waits = new Set();
      this.running.set(m.id, { cancel: () => { cancelled = true; for (const w of waits) w(); } });
      this.emit('change');
      if (m.kind === 'js') {
        try { await this._runJs(m, () => !cancelled, waits); return { ok: true }; }
        catch (e) { if (e && e.__cancel) return { ok: true }; U.toast(`Script "${m.name}": ${e.message || e}`, 'error', 6000); window.bts.log('warn', `Script ${m.name}: ${e.stack || e}`); return { ok: false, error: String(e.message || e) }; }
        finally { this.running.delete(m.id); this.emit('change'); }
      }
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
    _runJs(m, alive, waits) {
      const st = this.studio;
      return new Promise((resolve, reject) => {
        const src = PRELUDE + `\n(async () => {\n${m.code || ''}\n})().then(() => postMessage({ t: 'done' }), (e) => postMessage(e && e.__cancel ? { t: 'done' } : { t: 'error', error: String(e && e.message || e), stack: String(e && e.stack || '') }));\n`;
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const wk = new Worker(url, { name: 'BTS script: ' + m.name });
        let finished = false;
        const finish = (err) => { if (finished) return; finished = true; waits.delete(stopper); clearInterval(poll); setTimeout(() => wk.terminate(), 50); URL.revokeObjectURL(url); err ? reject(err) : resolve(); };
        const stopper = () => { try { wk.postMessage({ t: 'stop' }); } catch { /* noop */ } setTimeout(() => finish({ __cancel: true }), 300); };
        waits.add(stopper);
        const poll = setInterval(() => { if (!alive()) stopper(); }, 200);
        const reply = (id, ok, data, error) => { try { wk.postMessage({ id, ok, data, error }); } catch { /* noop */ } };
        const inputInfo = (ref) => { const i = st.resolve(ref); if (!i) return null; return { id: i.id, number: i.number, title: i.title, type: i.type, live: !!i.live, preview: st.previewId === i.id, position: i.currentTime, duration: i.duration, playing: i.playing,
          fields: i.renderer ? Object.fromEntries(i.renderer.fields.filter(e => e.type !== 'rect').map(e => [e.name, e.type === 'image' ? e.src : e.text])) : {} }; };
        wk.onmessage = async (e) => {
          const d = e.data;
          if (d.t === 'done') return finish();
          if (d.t === 'error') { const err = new Error(d.error); err.stack = d.stack; return finish(err); }
          if (d.t === 'log') { U.toast(`📜 ${m.name}: ${d.msg.slice(0, 160)}`); window.bts.log('info', `Script ${m.name}: ${d.msg}`); return; }
          if (d.t !== 'rpc') return;
          try {
            const [a0, a1, a2] = d.args;
            if (d.op === 'call') {
              const params = Object.fromEntries(Object.entries(a1 || {}).map(([k, v]) => [k, v == null ? v : String(v)]));
              const r = await BTS.Functions.call(String(a0), params);
              if (!r.ok) return reply(d.id, false, null, `${a0}: ${r.error}`);
              return reply(d.id, true, r.data === undefined || typeof r.data === 'object' && r.data && r.data.nodeType ? true : r.data);
            }
            if (d.op === 'state') return reply(d.id, true, st.apiState());
            if (d.op === 'input') return reply(d.id, true, inputInfo(a0));
            if (d.op === 'setText' || d.op === 'setImage') { const i = st.resolve(a0); if (!i || !i[d.op]) return reply(d.id, false, null, 'Not a title input: ' + a0); return reply(d.id, true, !!i[d.op](a1, String(a2))); }
            if (d.op === 'data') { const ds = st.data.get(a0); return reply(d.id, true, ds ? { rows: ds.rows, columns: ds.columns, row: ds.row } : null); }
            reply(d.id, false, null, 'Unknown operation');
          } catch (err) { reply(d.id, false, null, String(err.message || err)); }
        };
        wk.onerror = (e) => { e.preventDefault(); finish(new Error(`${e.message}${e.lineno ? ` (line ${Math.max(1, e.lineno - PRELUDE.split('\n').length - 1)})` : ''}`)); };
      }).then(async () => { if (m.loop && alive()) { await new Promise(r => setTimeout(r, 20)); if (alive()) return this._runJs(m, alive, waits); } });
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

  Macros.SCRIPT_HELP = SCRIPT_HELP;
  BTS.Macros = Macros;
})(window.BTS);
