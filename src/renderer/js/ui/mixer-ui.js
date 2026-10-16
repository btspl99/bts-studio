'use strict';
/** Audio mixer strips: Master, aux buses A–G and every input with audio. */
(function (BTS) {
  const U = BTS.U;

  class MixerUI {
    constructor(studio) {
      this.studio = studio;
      this.root = U.$('#mixerStrips');
      this.strips = [];
      studio.on('mixer', () => this.render());
      studio.on('inputs', () => this.render());
      studio.on('mixer-values', () => this.sync());
      studio.on('meters', () => this.meters());
      const hp = U.$('#mixerHp');
      hp.classList.toggle('on', studio.audio.monitorOn);
      hp.onclick = () => { studio.audio.setMonitor(!studio.audio.monitorOn); hp.classList.toggle('on', studio.audio.monitorOn); U.toast(`Headphone monitoring ${studio.audio.monitorOn ? 'on' : 'off'}`); };
      this.render();
    }

    render() {
      const st = this.studio;
      this.root.innerHTML = '';
      this.strips = [];
      const a = st.audio;
      for (const b of BTS.AudioEngine.BUSES) if (this.showBus(b)) this._busStrip(b, b === 'M' ? 'MASTER' : 'BUS ' + b);
      st.inputs.forEach((inp, i) => { if (inp.channel) this._inputStrip(inp, i + 1); });
      this.sync();
    }

    /** Master, A and B always; C–G when in use or when "all buses" is on */
    showBus(b) {
      if (b === 'M' || b === 'A' || b === 'B' || this.allBuses) return true;
      const bus = this.studio.audio.buses[b];
      return bus.toMaster || bus.headphones || bus.device || this.studio.inputs.some(i => i.channel && i.channel.s.buses[b]);
    }
    get allBuses() { try { return localStorage.getItem('bts-mixer-allbuses') === '1'; } catch { return false; } }
    set allBuses(v) { try { localStorage.setItem('bts-mixer-allbuses', v ? '1' : '0'); } catch { /* noop */ } this.render(); }

    _fader(value, onInput) {
      const f = U.el('input', { type: 'range', class: 'vfader', min: 0, max: 1, step: 0.001, value: U.gainToFader(value) });
      f.oninput = () => onInput(U.faderToGain(+f.value));
      f.ondblclick = () => { f.value = 0.75; onInput(1); };
      f.addEventListener('wheel', (e) => { e.preventDefault(); f.value = U.clamp(+f.value - Math.sign(e.deltaY) * 0.01, 0, 1); onInput(U.faderToGain(+f.value)); }, { passive: false });
      return f;
    }

    _meterPair() {
      const L = U.el('div', { class: 'meter' }, [U.el('i'), U.el('b')]);
      const R = U.el('div', { class: 'meter' }, [U.el('i'), U.el('b')]);
      return [L, R];
    }

    _busStrip(name, label) {
      const a = this.studio.audio, bus = a.buses[name];
      const [L, R] = this._meterPair();
      const db = U.el('div', { class: 'db' });
      const fader = this._fader(bus.volume, (g) => { a.setBusVolume(name, g); this._db(db, g); });
      const mute = U.el('button', { class: 'mute-big', text: 'MUTE', onclick: () => { a.setBusMute(name, !bus.muted); this.sync(); } });
      const flags = name === 'M' ? null : U.el('div', { class: 'row bus-flags' }, [
        U.el('button', { text: '→M', title: 'Send this bus to Master (sub-group)', class: bus.toMaster ? 'on' : '', onclick: () => { a.setBusToMaster(name, !bus.toMaster); this.render(); } }),
        U.el('button', { text: '🎧', title: 'Listen to this bus in headphones', class: bus.headphones ? 'on' : '', onclick: () => { a.setBusHeadphones(name, !bus.headphones); this.render(); } }),
        U.el('button', { text: '🔈', title: bus.device ? 'Output device: ' + (this._devName(bus.device) || 'set') : 'Send to an audio output device', class: bus.device ? 'on' : '', onclick: (e) => this._deviceMenu(name, e) })
      ]);
      const el = U.el('div', { class: 'strip master', title: name === 'M' ? 'Master output (stream / record). Limiter at -1 dBFS.' : `Bus ${name} — aux mix for in-ear monitors, IFB, a second stream or a sub-group. Right-click for options.` }, [
        U.el('div', { class: 'num', text: name === 'M' ? '★' : name }),
        U.el('div', { class: 'name', text: label }),
        U.el('div', { class: 'fader-wrap' }, [L, fader, R]),
        db, flags, mute
      ]);
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (name === 'M') return BTS.Dialog.ctxMenu(e.clientX, e.clientY, [{ label: (a.limiterOn ? '✓ ' : '') + 'Master limiter (-1 dBFS)', onClick: () => a.setLimiter(!a.limiterOn) }, '-', { label: (this.allBuses ? '✓ ' : '') + 'Show all buses (A–G)', onClick: () => { this.allBuses = !this.allBuses; } }]);
        BTS.Dialog.ctxMenu(e.clientX, e.clientY, [
          { label: (bus.toMaster ? '✓ ' : '') + 'Send to Master', onClick: () => { a.setBusToMaster(name, !bus.toMaster); this.render(); } },
          { label: (bus.headphones ? '✓ ' : '') + 'Headphones', onClick: () => { a.setBusHeadphones(name, !bus.headphones); this.render(); } },
          { label: 'Output device…', onClick: () => this._deviceMenu(name, e) },
          '-', { label: (this.allBuses ? '✓ ' : '') + 'Show all buses (A–G)', onClick: () => { this.allBuses = !this.allBuses; } }
        ]);
      });
      this.root.append(el);
      this.strips.push({ kind: 'bus', name, el, L, R, fader, mute, db, obj: bus });
    }

    _inputStrip(inp, n) {
      const ch = inp.channel;
      const [L, R] = this._meterPair();
      const db = U.el('div', { class: 'db' });
      const fader = this._fader(ch.s.volume, (g) => { ch.set({ volume: g }); this._db(db, g); });
      const busBtn = (b) => U.el('button', { text: b, title: `Route to ${b === 'M' ? 'Master' : 'Bus ' + b}`, onclick: () => { ch.s.buses[b] = !ch.s.buses[b]; ch.apply(); if (this.strips.some(x => x.kind === 'bus' && x.name === b) === this.showBus(b)) this.sync(); else this.render(); } });
      const busBtns = Object.fromEntries(BTS.AudioEngine.BUSES.map(b => [b, busBtn(b)]));
      const solo = U.el('button', { class: 'solo', text: 'S', title: 'Solo (headphones)', onclick: () => { ch.set({ solo: !ch.s.solo }); this.sync(); } });
      const afv = U.el('button', { text: '⚡', title: 'Audio follows video (only audible when live)', onclick: () => { ch.set({ followVideo: !ch.s.followVideo }); this.sync(); } });
      const gear = U.el('button', { text: '⚙', title: 'Audio settings (EQ, compressor, gate, delay)', onclick: () => BTS.ui.inputSettings(inp, 'audio') });
      const mute = U.el('button', { class: 'mute-big', text: 'MUTE', onclick: () => { ch.set({ muted: !ch.s.muted }); this.sync(); this.studio.emit('mixer-values'); } });
      const el = U.el('div', { class: 'strip', title: inp.title }, [
        U.el('div', { class: 'num', text: String(n) }),
        U.el('div', { class: 'name', text: inp.title }),
        U.el('div', { class: 'fader-wrap' }, [L, fader, R]),
        db,
        U.el('div', { class: 'bus-grid' }, Object.values(busBtns)),
        U.el('div', { class: 'row' }, [solo, afv, gear]),
        mute
      ]);
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); BTS.ui.inputSettings(inp, 'audio'); });
      this.root.append(el);
      this.strips.push({ kind: 'input', inp, el, L, R, fader, mute, db, busBtns, solo, afv, obj: ch });
    }

    async _deviceMenu(name, e) {
      const a = this.studio.audio, bus = a.buses[name];
      const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
      this._outs = outs;
      BTS.Dialog.ctxMenu(e.clientX, e.clientY, [
        { label: (!bus.device ? '✓ ' : '') + 'None', onClick: () => { a.setBusDevice(name, ''); this.render(); } },
        ...outs.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').map(d => ({ label: (bus.device === d.deviceId ? '✓ ' : '') + (d.label || 'Output device'), onClick: async () => { if (!await a.setBusDevice(name, d.deviceId)) U.toast('Could not open that output device', 'error'); this.render(); } }))
      ]);
    }
    _devName(id) { return (this._outs || []).find(d => d.deviceId === id)?.label || ''; }

    _db(el, g) { const d = U.db(g); el.textContent = d === -Infinity ? '-∞' : (d > 0 ? '+' : '') + d.toFixed(1); }

    sync() {
      for (const s of this.strips) {
        if (s.kind === 'bus') {
          s.fader.value = U.gainToFader(s.obj.volume); this._db(s.db, s.obj.volume);
          s.mute.classList.toggle('on', s.obj.muted);
        } else {
          const c = s.obj.s;
          s.fader.value = U.gainToFader(c.volume); this._db(s.db, c.volume);
          s.mute.classList.toggle('on', !!c.muted);
          for (const [b, btn] of Object.entries(s.busBtns)) btn.classList.toggle('on', !!c.buses[b]);
          s.solo.classList.toggle('on', !!c.solo); s.afv.classList.toggle('on', !!c.followVideo);
        }
      }
    }

    meters() {
      if (this.root.offsetParent === null) return;
      const set = (m, v, hold) => {
        const p = U.clamp((U.db(v) + 60) / 60, 0, 1) * 100;
        m.firstChild.style.height = p + '%';
        m.lastChild.style.bottom = (U.clamp((U.db(hold) + 60) / 60, 0, 1) * 100) + '%';
      };
      for (const s of this.strips) {
        const o = s.obj;
        set(s.L, o.peak[0], o.hold[0]); set(s.R, o.peak[1], o.hold[1]);
      }
    }
  }

  BTS.MixerUI = MixerUI;
})(window.BTS);
