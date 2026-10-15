'use strict';
/**
 * Audio engine (Web Audio): per-input channel strips with trim, delay, 3-band EQ, compressor,
 * noise gate, fader, balance, mute, solo and bus routing (Master / A / B), audio-follow-video,
 * master limiter, metering and headphone monitoring.
 */
(function (BTS) {
  const U = BTS.U;

  const GATE_WORKLET = `
class BtsGate extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'threshold', defaultValue:-50, minValue:-100, maxValue:0},
    {name:'enabled', defaultValue:0, minValue:0, maxValue:1}
  ]; }
  constructor(){ super(); this.env = 0; this.g = 1; }
  process(inputs, outputs, params){
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const en = params.enabled[0] > 0.5;
    const thr = Math.pow(10, params.threshold[0]/20);
    const n = inp[0].length;
    const att = Math.exp(-1/(sampleRate*0.002)), rel = Math.exp(-1/(sampleRate*0.12));
    for (let i=0;i<n;i++){
      let peak = 0;
      for (let c=0;c<inp.length;c++){ const v = Math.abs(inp[c][i]); if (v>peak) peak=v; }
      this.env = peak > this.env ? peak : this.env*0.9995;
      const target = (!en || this.env >= thr) ? 1 : 0;
      this.g = target > this.g ? target + (this.g-target)*att : target + (this.g-target)*rel;
      for (let c=0;c<out.length;c++){ out[c][i] = (inp[c] || inp[0])[i] * this.g; }
    }
    return true;
  }
}
registerProcessor('bts-gate', BtsGate);
// PCM player for network-stream audio: interleaved s16 stereo chunks in, low-latency ring buffer out
class BtsPcm extends AudioWorkletProcessor {
  constructor(){ super(); this.size = sampleRate; this.L = new Float32Array(this.size); this.R = new Float32Array(this.size); this.w = 0; this.r = 0; this.fill = 0; this.primed = false;
    this.port.onmessage = (e) => { const d = new Int16Array(e.data.buffer || e.data, e.data.byteOffset || 0, (e.data.byteLength || e.data.length) >> 1); const n = d.length >> 1;
      for (let i = 0; i < n; i++) { this.L[this.w] = d[2*i] / 32768; this.R[this.w] = d[2*i+1] / 32768; this.w = (this.w + 1) % this.size; }
      this.fill += n; const max = sampleRate * 0.35; if (this.fill > max) { const drop = this.fill - Math.floor(sampleRate * 0.12); this.r = (this.r + drop) % this.size; this.fill -= drop; } };
  }
  process(inputs, outputs){ const o = outputs[0]; const n = o[0].length;
    if (!this.primed) { if (this.fill < sampleRate * 0.08) return true; this.primed = true; }
    for (let i = 0; i < n; i++) { if (this.fill > 0) { o[0][i] = this.L[this.r]; if (o[1]) o[1][i] = this.R[this.r]; this.r = (this.r + 1) % this.size; this.fill--; } else { o[0][i] = 0; if (o[1]) o[1][i] = 0; this.primed = false; } }
    return true; }
}
registerProcessor('bts-pcm', BtsPcm);`;

  class AudioEngine {
    constructor(sampleRate = 48000) {
      this.ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
      this.channels = new Set();
      this.workletReady = this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([GATE_WORKLET], { type: 'application/javascript' }))).then(() => true).catch(e => { console.warn('Gate worklet unavailable', e); return false; });
      this.buses = {};
      for (const name of ['M', 'A', 'B']) this.buses[name] = this._makeBus(name);
      // master gets a limiter
      const m = this.buses.M;
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.08;
      m.post.disconnect(); m.post.connect(this.limiter); this.limiter.connect(m.meterIn); this.limiter.connect(m.dest);
      this.limiterOn = true;
      // headphones
      this.monitor = this.ctx.createGain();
      this.monitor.gain.value = 1;
      this.soloBus = this.ctx.createGain();
      this.soloBus.connect(this.ctx.destination);
      m.meterIn.connect(this.monitor);
      this.monitor.connect(this.ctx.destination);
      this.monitorOn = true;
      this.masterDelay = 0;
      document.addEventListener('pointerdown', () => { if (this.ctx.state !== 'running') this.ctx.resume(); }, { capture: true });
    }

    _makeBus(name) {
      const ctx = this.ctx;
      const sum = ctx.createGain();
      const fader = ctx.createGain();
      const mute = ctx.createGain();
      const post = ctx.createGain();
      const meterIn = ctx.createGain();
      sum.connect(fader); fader.connect(mute); mute.connect(post);
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 2;
      post.connect(meterIn); post.connect(dest);
      const split = ctx.createChannelSplitter(2);
      meterIn.connect(split);
      const aL = ctx.createAnalyser(), aR = ctx.createAnalyser();
      aL.fftSize = aR.fftSize = 1024;
      split.connect(aL, 0); split.connect(aR, 1);
      return { name, sum, fader, mute, post, meterIn, dest, aL, aR, volume: 1, muted: false, peak: [0, 0], hold: [0, 0] };
    }

    get masterStream() { return this.buses.M.dest.stream; }
    busStream(name) { return (this.buses[name] || this.buses.M).dest.stream; }

    setBusVolume(name, v) { const b = this.buses[name]; if (!b) return; b.volume = v; b.fader.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
    setBusMute(name, m) { const b = this.buses[name]; if (!b) return; b.muted = m; b.mute.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.01); }
    setMonitor(on) { this.monitorOn = on; this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02); this._updateSolo(); }
    setLimiter(on) { this.limiterOn = on; this.limiter.threshold.value = on ? -1 : 0; this.limiter.ratio.value = on ? 20 : 1; }

    _updateSolo() {
      const anySolo = [...this.channels].some(c => c.s.solo);
      // when soloing, cut master from headphones and only play solo bus
      this.monitor.gain.setTargetAtTime(this.monitorOn && !anySolo ? 1 : 0, this.ctx.currentTime, 0.02);
    }

    createChannel(opts) { const c = new AudioChannel(this, opts); this.channels.add(c); return c; }
    removeChannel(c) { this.channels.delete(c); c.dispose(); }

    static peak(analyser, buf) {
      analyser.getFloatTimeDomainData(buf);
      let p = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; }
      return p;
    }

    /** Update meter values (call ~30 fps) */
    tickMeters() {
      const buf = this._buf || (this._buf = new Float32Array(1024));
      const now = performance.now();
      const upd = (obj, aL, aR) => {
        const l = AudioEngine.peak(aL, buf), r = AudioEngine.peak(aR, buf);
        obj.peak = [Math.max(l, obj.peak[0] * 0.85), Math.max(r, obj.peak[1] * 0.85)];
        for (let i = 0; i < 2; i++) {
          const v = i ? r : l;
          if (v >= obj.hold[i] || now - (obj.holdT?.[i] || 0) > 1500) { obj.hold[i] = v; obj.holdT = obj.holdT || [0, 0]; obj.holdT[i] = now; }
        }
      };
      for (const b of Object.values(this.buses)) upd(b, b.aL, b.aR);
      for (const c of this.channels) if (c.hasSource) upd(c, c.aL, c.aR); else { c.peak = [0, 0]; c.hold = [0, 0]; }
    }
  }

  class AudioChannel {
    constructor(engine, opts = {}) {
      this.engine = engine;
      const ctx = engine.ctx;
      this.s = Object.assign({
        volume: 1, trimDb: 0, muted: false, balance: 0, delayMs: 0, solo: false,
        buses: { M: true, A: false, B: false }, followVideo: false,
        eq: { enabled: false, low: 0, mid: 0, high: 0 },
        comp: { enabled: false, threshold: -18, ratio: 3 },
        gate: { enabled: false, threshold: -50 },
        mono: false
      }, U.deepClone(opts));
      this.peak = [0, 0]; this.hold = [0, 0];
      this.hasSource = false;
      this.input = ctx.createGain();
      this.trim = ctx.createGain();
      this.delay = ctx.createDelay(2.0);
      this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 120;
      this.mid = ctx.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1200; this.mid.Q.value = 0.8;
      this.high = ctx.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 8000;
      this.comp = ctx.createDynamicsCompressor();
      this.fader = ctx.createGain();
      this.pan = ctx.createStereoPanner();
      this.mute = ctx.createGain();
      this.follow = ctx.createGain();
      this.post = ctx.createGain();
      this.input.connect(this.trim);
      this.trim.connect(this.delay);
      this.delay.connect(this.low); this.low.connect(this.mid); this.mid.connect(this.high);
      this.high.connect(this.comp);
      this.gateNode = null;
      this.comp.connect(this.fader);
      engine.workletReady.then(ok => {
        if (!ok || this.disposed) return;
        try {
          this.gateNode = new AudioWorkletNode(ctx, 'bts-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
          this.comp.disconnect(); this.comp.connect(this.gateNode); this.gateNode.connect(this.fader);
          this.apply();
        } catch (e) { console.warn(e); }
      });
      this.fader.connect(this.pan); this.pan.connect(this.mute); this.mute.connect(this.follow); this.follow.connect(this.post);
      // meters (post-fader, pre-follow so operators can see levels even when not live)
      const split = ctx.createChannelSplitter(2);
      this.mute.connect(split);
      this.aL = ctx.createAnalyser(); this.aR = ctx.createAnalyser();
      this.aL.fftSize = this.aR.fftSize = 1024;
      split.connect(this.aL, 0); split.connect(this.aR, 1);
      // bus sends
      this.sends = {};
      for (const [name, bus] of Object.entries(engine.buses)) { const g = ctx.createGain(); this.post.connect(g); g.connect(bus.sum); this.sends[name] = g; }
      this.soloSend = ctx.createGain(); this.soloSend.gain.value = 0; this.mute.connect(this.soloSend); this.soloSend.connect(engine.soloBus);
      this.onAir = true;
      this.apply();
    }

    setSource(node) {
      if (this.source) { try { this.source.disconnect(this.input); } catch { /* noop */ } }
      this.source = node;
      this.hasSource = !!node;
      if (node) node.connect(this.input);
    }

    apply() {
      const t = this.engine.ctx.currentTime, s = this.s, T = 0.015;
      this.trim.gain.setTargetAtTime(U.fromDb(s.trimDb || 0), t, T);
      this.delay.delayTime.setTargetAtTime(U.clamp((s.delayMs || 0) / 1000, 0, 2), t, T);
      const eqOn = s.eq && s.eq.enabled;
      this.low.gain.setTargetAtTime(eqOn ? s.eq.low : 0, t, T);
      this.mid.gain.setTargetAtTime(eqOn ? s.eq.mid : 0, t, T);
      this.high.gain.setTargetAtTime(eqOn ? s.eq.high : 0, t, T);
      const cOn = s.comp && s.comp.enabled;
      this.comp.threshold.setTargetAtTime(cOn ? s.comp.threshold : 0, t, T);
      this.comp.ratio.setTargetAtTime(cOn ? s.comp.ratio : 1, t, T);
      this.comp.knee.value = cOn ? 6 : 0;
      this.comp.attack.value = 0.005; this.comp.release.value = 0.15;
      if (this.gateNode) {
        this.gateNode.parameters.get('enabled').setValueAtTime(s.gate && s.gate.enabled ? 1 : 0, t);
        this.gateNode.parameters.get('threshold').setValueAtTime(s.gate ? s.gate.threshold : -50, t);
      }
      this.fader.gain.setTargetAtTime(s.volume, t, T);
      this.pan.pan.setTargetAtTime(U.clamp(s.balance || 0, -1, 1), t, T);
      this.mute.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.008);
      this.follow.gain.setTargetAtTime(!s.followVideo || this.onAir ? 1 : 0, t, 0.05);
      for (const [n, g] of Object.entries(this.sends)) g.gain.setTargetAtTime(s.buses[n] ? 1 : 0, t, 0.01);
      this.soloSend.gain.setTargetAtTime(s.solo ? 1 : 0, t, 0.01);
      this.engine._updateSolo();
    }

    set(patch) { Object.assign(this.s, patch); this.apply(); }
    setOnAir(on) { if (this.onAir === on) return; this.onAir = on; this.apply(); }
    /** volume fade over ms */
    fadeTo(volume, ms) {
      const t = this.engine.ctx.currentTime;
      this.fader.gain.cancelScheduledValues(t);
      this.fader.gain.setValueAtTime(this.fader.gain.value, t);
      this.fader.gain.linearRampToValueAtTime(volume, t + ms / 1000);
      this.s.volume = volume;
    }
    dispose() {
      this.disposed = true;
      try { if (this.source) this.source.disconnect(); } catch { /* noop */ }
      for (const n of [this.input, this.post, this.mute, this.soloSend, ...Object.values(this.sends)]) { try { n.disconnect(); } catch { /* noop */ } }
    }
    serialize() { return U.deepClone(this.s); }
  }

  BTS.AudioEngine = AudioEngine;
})(window.BTS);
