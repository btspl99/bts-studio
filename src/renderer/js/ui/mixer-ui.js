'use strict';
/** Audio mixer strips: Master, Bus A, Bus B and every input with audio. */
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
      const busLabel = { M: 'MASTER', A: 'BUS A', B: 'BUS B' };
      for (const b of ['M', 'A', 'B']) this._busStrip(b, busLabel[b]);
      st.inputs.forEach((inp, i) => { if (inp.channel) this._inputStrip(inp, i + 1); });
      this.sync();
    }

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
      const el = U.el('div', { class: 'strip master', title: name === 'M' ? 'Master output (stream / record). Limiter at -1 dBFS.' : `Bus ${name} — route inputs here for ISO/aux mixes` }, [
        U.el('div', { class: 'num', text: name === 'M' ? '★' : name }),
        U.el('div', { class: 'name', text: label }),
        U.el('div', { class: 'fader-wrap' }, [L, fader, R]),
        db, mute
      ]);
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (name !== 'M') return;
        BTS.Dialog.ctxMenu(e.clientX, e.clientY, [{ label: (a.limiterOn ? '✓ ' : '') + 'Master limiter (-1 dBFS)', onClick: () => a.setLimiter(!a.limiterOn) }]);
      });
      this.root.append(el);
      this.strips.push({ kind: 'bus', name, el, L, R, fader, mute, db, obj: bus });
    }

    _inputStrip(inp, n) {
      const ch = inp.channel;
      const [L, R] = this._meterPair();
      const db = U.el('div', { class: 'db' });
      const fader = this._fader(ch.s.volume, (g) => { ch.set({ volume: g }); this._db(db, g); });
      const busBtn = (b) => U.el('button', { text: b, title: `Route to ${b === 'M' ? 'Master' : 'Bus ' + b}`, onclick: () => { ch.s.buses[b] = !ch.s.buses[b]; ch.apply(); this.sync(); } });
      const bM = busBtn('M'), bA = busBtn('A'), bB = busBtn('B');
      const solo = U.el('button', { class: 'solo', text: 'S', title: 'Solo (headphones)', onclick: () => { ch.set({ solo: !ch.s.solo }); this.sync(); } });
      const afv = U.el('button', { text: '⚡', title: 'Audio follows video (only audible when live)', onclick: () => { ch.set({ followVideo: !ch.s.followVideo }); this.sync(); } });
      const gear = U.el('button', { text: '⚙', title: 'Audio settings (EQ, compressor, gate, delay)', onclick: () => BTS.ui.inputSettings(inp, 'audio') });
      const mute = U.el('button', { class: 'mute-big', text: 'MUTE', onclick: () => { ch.set({ muted: !ch.s.muted }); this.sync(); this.studio.emit('mixer-values'); } });
      const el = U.el('div', { class: 'strip', title: inp.title }, [
        U.el('div', { class: 'num', text: String(n) }),
        U.el('div', { class: 'name', text: inp.title }),
        U.el('div', { class: 'fader-wrap' }, [L, fader, R]),
        db,
        U.el('div', { class: 'row' }, [bM, bA, bB]),
        U.el('div', { class: 'row' }, [solo, afv, gear]),
        mute
      ]);
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); BTS.ui.inputSettings(inp, 'audio'); });
      this.root.append(el);
      this.strips.push({ kind: 'input', inp, el, L, R, fader, mute, db, bM, bA, bB, solo, afv, obj: ch });
    }

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
          s.bM.classList.toggle('on', !!c.buses.M); s.bA.classList.toggle('on', !!c.buses.A); s.bB.classList.toggle('on', !!c.buses.B);
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
