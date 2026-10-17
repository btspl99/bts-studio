'use strict';
/**
 * MIDI controllers (Behringer X-Touch, Akai APC/MIDImix, Korg nanoKONTROL, Novation, X-keys MIDI mode…).
 * Map a note / CC to any function, or a fader/knob CC to the T-Bar, master volume or an input's volume.
 * "Learn" assigns the next control you touch.
 */
(function (BTS) {
  const U = BTS.U;

  class Midi extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.access = null;
      this.learnCb = null;
      this.devices = [];
      this.last = null;
    }
    get mappings() { return (BTS.settings.midi && BTS.settings.midi.mappings) || []; }

    async init() {
      if (!navigator.requestMIDIAccess) return false;
      try { this.access = await navigator.requestMIDIAccess({ sysex: false }); }
      catch (e) { console.warn('MIDI unavailable', e); return false; }
      const bind = () => {
        this.devices = [];
        for (const inp of this.access.inputs.values()) { inp.onmidimessage = (m) => this._msg(inp, m); this.devices.push(inp.name); }
        this.emit('devices', this.devices);
      };
      this.access.onstatechange = () => { bind(); this.feedback(true); };
      bind();
      // activators: light controller buttons for tally, overlays, recording and streaming
      const st = this.studio, kick = () => this.feedback();
      st.on('bus', kick); st.on('overlays', kick); st.on('transition', kick);
      if (st.outputs) st.outputs.on('change', kick);
      setInterval(kick, 1000);
      this.feedback(true);
      return true;
    }

    /** current state of a mapping's light: 'on' (red / program), 'pvw' (green / preview) or 'off' */
    _state(m) {
      const st = this.studio, fb = m.feedback;
      const inp = m.params && m.params.Input ? st.resolve(m.params.Input) : null;
      switch (fb) {
        case 'tally': return inp ? (inp.live ? 'on' : st.previewId === inp.id ? 'pvw' : 'off') : 'off';
        case 'overlay': { const n = +(m.params && m.params.Value) || +(String(m.fn || '').match(/Overlay\D*(\d)/) || [])[1] || 1; const o = st.overlays[n - 1]; return o && o.inputId && o.state !== 'off' && o.state !== 'out' ? 'on' : 'off'; }
        case 'recording': return st.outputs && st.outputs.isRecording() ? 'on' : 'off';
        case 'streaming': return st.outputs && st.outputs.isStreaming() ? 'on' : 'off';
        case 'ftb': return st.ftb && st.ftb.on ? 'on' : 'off';
        default: return null;
      }
    }
    feedback(force) {
      if (!this.access || !this.access.outputs.size) return;
      this._sent = this._sent || new Map();
      for (const m of this.mappings) {
        if (!m.feedback || m.feedback === 'none' || m.kind === 'pitch') continue;
        const s = this._state(m); if (s == null) continue;
        const key = `${m.kind}|${m.ch}|${m.num}`;
        const vel = s === 'on' ? (m.onVel ?? 127) : s === 'pvw' ? (m.pvwVel ?? 1) : (m.offVel ?? 0);
        if (!force && this._sent.get(key) === vel) continue;
        this._sent.set(key, vel);
        const msg = m.kind === 'cc' ? [0xb0 | (m.ch - 1), m.num, vel] : [0x90 | (m.ch - 1), m.num, vel];
        for (const out of this.access.outputs.values()) { if (m.device && out.name !== m.device && !String(out.name).startsWith(String(m.device).slice(0, 12))) continue; try { out.send(msg); } catch { /* unplugged */ } }
      }
    }

    learn(cb) { this.learnCb = cb; }

    _msg(port, m) {
      const [st, d1, d2] = m.data;
      const type = st & 0xf0, ch = (st & 0x0f) + 1;
      let ev = null;
      if (type === 0x90 && d2 > 0) ev = { kind: 'note', ch, num: d1, value: d2 };
      else if (type === 0x80 || (type === 0x90 && d2 === 0)) ev = { kind: 'noteoff', ch, num: d1, value: 0 };
      else if (type === 0xb0) ev = { kind: 'cc', ch, num: d1, value: d2 };
      else if (type === 0xe0) ev = { kind: 'pitch', ch, num: 0, value: ((d2 << 7) | d1) / 16383 * 127 };
      if (!ev) return;
      ev.device = port.name;
      this.last = ev;
      this.emit('message', ev);
      if (this.learnCb && ev.kind !== 'noteoff') { const cb = this.learnCb; this.learnCb = null; cb(ev); return; }
      if (BTS.settings.midi && BTS.settings.midi.enabled === false) return;
      for (const map of this.mappings) {
        if (map.kind !== (ev.kind === 'noteoff' ? 'note' : ev.kind) || map.ch !== ev.ch || map.num !== ev.num) continue;
        this._apply(map, ev);
      }
    }

    _apply(map, ev) {
      const st = this.studio;
      const v = ev.value / 127;
      switch (map.action) {
        case 'tbar': st.setTbar(map.invert ? 1 - v : v, { release: v <= 0.001 || v >= 0.999 }); break;
        case 'master': st.audio.setBusVolume('M', U.faderToGain(v)); st.emit('mixer-values'); break;
        case 'volume': { const i = st.resolve(map.params?.Input); if (i && i.channel) { i.channel.set({ volume: U.faderToGain(v) }); st.emit('mixer-values'); } break; }
        default: // function on press (note on / CC > 63)
          if (ev.kind === 'noteoff' || (ev.kind === 'cc' && ev.value < 64 && !map.anyValue)) return;
          BTS.Functions.call(map.fn, map.params || {}).then(r => { if (!r.ok) U.toast(`MIDI ${map.fn}: ${r.error}`, 'error', 2500); });
      }
    }
  }

  BTS.Midi = Midi;
})(window.BTS);
