'use strict';
/**
 * Encode engine (output engine v2).
 *
 * The programme is encoded ONCE per video profile with WebCodecs (GPU hardware H.264 when available — NVIDIA, Intel,
 * AMD through Windows Media Foundation — software otherwise). Encoded packets go to the main process, which fans
 * them out to every stream / recording that uses the profile. Audio is captured losslessly from the mix bus as
 * 48 kHz PCM on the same timeline. Outputs either copy the GPU stream (single generation: what you set is what
 * you get) or transcode a near-lossless mezzanine with x264 / x265 / NVENC / QSV / AMF / ProRes / DNxHR.
 */
(function (BTS) {
  const U = BTS.U;

  const TAP_WORKLET = `
class BtsTap extends AudioWorkletProcessor {
  constructor(){ super(); this.n = 2048; this.buf = new Int16Array(this.n * 2); this.fill = 0; this.start = -1; }
  process(inputs){ const i = inputs[0]; const L = i[0], R = i[1] || i[0]; const len = L ? L.length : 128;
    for (let k = 0; k < len; k++) {
      if (this.fill === 0) this.start = currentFrame + k;
      const l = L ? L[k] : 0, r = R ? R[k] : 0;
      this.buf[this.fill * 2] = l <= -1 ? -32768 : l >= 1 ? 32767 : (l * 32767) | 0;
      this.buf[this.fill * 2 + 1] = r <= -1 ? -32768 : r >= 1 ? 32767 : (r * 32767) | 0;
      if (++this.fill === this.n) { const out = this.buf; this.port.postMessage({ frame: this.start, data: out }, [out.buffer]); this.buf = new Int16Array(this.n * 2); this.fill = 0; }
    }
    return true; }
}
registerProcessor('bts-tap', BtsTap);`;

  // H.264 level for a given picture size and frame rate (High profile)
  function avcCodec(w, h, fps) {
    const mbps = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
    const levels = [[40, 245760, 8192], [42, 522240, 8704], [50, 589824, 22080], [51, 983040, 36864], [52, 2073600, 36864]];
    const fs = Math.ceil(w / 16) * Math.ceil(h / 16);
    const lv = levels.find(([, maxMbps, maxFs]) => mbps <= maxMbps && fs <= maxFs) || levels[levels.length - 1];
    return 'avc1.6400' + lv[0].toString(16).padStart(2, '0').toUpperCase();
  }

  /** Quality presets → encoder configuration. Recording presets use constant quality (QP) where the encoder allows it. */
  const QUALITY = {
    lossless: { qp: 10, bppf: 0.45, label: 'Visually lossless (huge files)' },
    'lossless-ish': { qp: 14, bppf: 0.3, label: 'Near lossless' },
    high: { qp: 18, bppf: 0.18, label: 'High' },
    medium: { qp: 22, bppf: 0.11, label: 'Medium' },
    low: { qp: 27, bppf: 0.06, label: 'Low (small files)' },
    mezzanine: { qp: 12, bppf: 0.35, label: 'Mezzanine for FFmpeg encoders' }
  };

  class Session {
    constructor(engine, key, prof) {
      this.engine = engine; this.key = key; this.prof = prof;
      this.sid = U.uid('enc');
      this.t0 = 0; this.frames = 0; this.dropped = 0; this.encoded = 0; this.bytes = 0;
      this.needKey = true; this.lastKey = -1e9; this.configured = false; this.restarts = 0;
      this.users = 0;
    }
    async open() {
      const { w, h, fps } = this.prof;
      const qual = QUALITY[this.prof.quality] || QUALITY.high;
      const bitrate = this.prof.bitrate ? this.prof.bitrate * 1000 : Math.round(w * h * fps * qual.bppf);
      const base = { codec: avcCodec(w, h, fps), width: w, height: h, framerate: fps, bitrate, latencyMode: 'realtime', avc: { format: 'avc' } };
      const wantQp = this.prof.mode === 'quality';
      const tries = [];
      for (const hw of this.engine.hwOrder()) {
        if (wantQp) tries.push({ ...base, hardwareAcceleration: hw, bitrateMode: 'quantizer' });
        tries.push({ ...base, hardwareAcceleration: hw, bitrateMode: this.prof.mode === 'cbr' ? 'constant' : 'variable' });
      }
      let cfg = null;
      for (const c of tries) { try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch { /* try next */ } }
      if (!cfg) throw new Error(`No H.264 encoder for ${w}×${h} @ ${fps} fps on this PC`);
      this.cfg = cfg; this.qp = qual.qp;
      this.hardware = cfg.hardwareAcceleration === 'prefer-hardware';
      this._make();
    }
    _make() {
      this.enc = new VideoEncoder({
        output: (chunk, meta) => this._out(chunk, meta),
        error: (e) => this._fail(e)
      });
      this.enc.configure(this.cfg);
      this.configured = true;
      this.needKey = true;
    }
    _fail(e) {
      console.error('[encoder]', e);
      window.bts.log('error', `Encoder ${this.prof.w}x${this.prof.h}: ${e.message || e}`);
      this.configured = false;
      if (++this.restarts > 20) { U.toast('Video encoder keeps failing — switch Settings → Outputs → Engine to Classic', 'error', 10000); return; }
      // recover automatically: a GPU driver reset or a lost device must not end the show
      setTimeout(() => { try { this.enc.close(); } catch { /* noop */ } try { this._make(); } catch (err) { console.error(err); } }, 250);
    }
    _out(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description) {
        const d = meta.decoderConfig.description;
        window.bts.enc.config(this.sid, new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset || 0, (d.byteOffset || 0) + d.byteLength) : d));
      }
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      this.encoded++; this.bytes += buf.length;
      window.bts.enc.video(this.sid, chunk.timestamp / 1000, chunk.type === 'key', buf);
    }
    /** called every render tick with the programme canvas */
    encodeFrame(src, now) {
      if (!this.configured || this.enc.state !== 'configured') return;
      if (!this.t0) { this.t0 = now; this.engine.alignAudio(this); }
      const { fps } = this.prof;
      const ts = now - this.t0;
      // keep the encoder ahead of the GPU: when it falls behind, skip a frame rather than queue (no growing latency)
      if (this.enc.encodeQueueSize > 2) { this.dropped++; return; }
      const gop = Math.max(1, Math.round(fps * (this.prof.keyint || 2)));
      const key = this.needKey || this.frames % gop === 0;
      let frame;
      try {
        frame = new VideoFrame(src, { timestamp: Math.round(ts * 1000), duration: Math.round(1e6 / fps), alpha: 'discard' });
        const opts = { keyFrame: key };
        if (this.cfg.bitrateMode === 'quantizer') opts.avc = { quantizer: this.qp };
        this.enc.encode(frame, opts);
        this.frames++;
        if (key) { this.needKey = false; this.lastKey = ts; }
      } catch (e) { this.dropped++; if (!this._warned) { this._warned = true; console.warn('[encoder] frame', e); } }
      finally { if (frame) frame.close(); }
    }
    close() { try { if (this.enc && this.enc.state !== 'closed') this.enc.close(); } catch { /* noop */ } this.configured = false; }
    stats() { return { sid: this.sid, w: this.prof.w, h: this.prof.h, fps: this.prof.fps, hardware: this.hardware, codec: this.cfg && this.cfg.codec, mode: this.cfg && this.cfg.bitrateMode, frames: this.frames, dropped: this.dropped, queue: this.enc ? this.enc.encodeQueueSize : 0, mbps: 0, users: this.users }; }
  }

  class EncodeEngine extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.sessions = new Map(); // key -> Session
      this.taps = new Map();     // bus -> { node, sessions:Set }
      this.scalers = new Map();  // "WxH" -> canvas
      this.supported = typeof VideoEncoder !== 'undefined';
      this.tapReady = studio.audio.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }))).then(() => true).catch((e) => { console.error('tap worklet', e); return false; });
      window.bts.enc.onNeedKey((sid) => { for (const s of this.sessions.values()) if (s.sid === sid) s.needKey = true; });
      studio.on('frame', (now) => this._tick(now));
      this._rate = { t: performance.now(), bytes: 0 };
    }
    get settings() { return (BTS.settings && BTS.settings.encoding) || {}; }
    hwOrder() { const m = this.settings.hardware || 'auto'; return m === 'software' ? ['prefer-software'] : m === 'hardware' ? ['prefer-hardware'] : ['prefer-hardware', 'prefer-software']; }

    /** Probe what this PC can do (for the settings page and the status bar). */
    async capabilities() {
      if (!this.supported) return { webcodecs: false };
      const out = { webcodecs: true, rows: [] };
      for (const [label, w, h, fps] of [['1080p30', 1920, 1080, 30], ['1080p60', 1920, 1080, 60], ['1440p60', 2560, 1440, 60], ['4K30', 3840, 2160, 30], ['4K60', 3840, 2160, 60]]) {
        const row = { label };
        for (const hw of ['prefer-hardware', 'prefer-software']) {
          try { row[hw === 'prefer-hardware' ? 'gpu' : 'cpu'] = (await VideoEncoder.isConfigSupported({ codec: avcCodec(w, h, fps), width: w, height: h, framerate: fps, bitrate: w * h * fps * 0.15, hardwareAcceleration: hw, avc: { format: 'avc' } })).supported; } catch { row[hw === 'prefer-hardware' ? 'gpu' : 'cpu'] = false; }
        }
        out.rows.push(row);
      }
      try { out.quantizer = (await VideoEncoder.isConfigSupported({ codec: avcCodec(1920, 1080, 30), width: 1920, height: 1080, framerate: 30, bitrateMode: 'quantizer', avc: { format: 'avc' } })).supported; } catch { out.quantizer = false; }
      return out;
    }

    /**
     * Get (or create) the shared session for a profile.
     * prof: { w, h, fps, mode: 'cbr'|'vbr'|'quality', bitrate (kbps, optional), quality, keyint, bus }
     */
    async acquire(prof) {
      const st = this.studio;
      prof = { w: st.W, h: st.H, fps: st.fps, keyint: 2, bus: 'M', source: 'program', framing: 'fit', cropX: 0.5, ...prof };
      prof.w = Math.round(prof.w / 2) * 2; prof.h = Math.round(prof.h / 2) * 2;
      const key = JSON.stringify([prof.w, prof.h, prof.fps, prof.mode, prof.bitrate || 0, prof.quality || '', prof.keyint, prof.bus, prof.source, prof.framing, prof.cropX]);
      let s = this.sessions.get(key);
      if (!s) {
        s = new Session(this, key, prof);
        await s.open();
        if (prof.source === 'clean') st.cleanUsers = (st.cleanUsers || 0) + 1;
        if (String(prof.source).startsWith('multiview:')) { s.mv = st.multiviews.get(prof.source.slice(10)); if (s.mv) s.mv.users++; }
        this.sessions.set(key, s);
        await this._tap(prof.bus, s);
      }
      s.users++;
      s.needKey = true;
      this.emit('change');
      return s;
    }
    release(s) {
      if (!s || --s.users > 0) return;
      this.sessions.delete(s.key);
      if (s.prof.source === 'clean') this.studio.cleanUsers = Math.max(0, (this.studio.cleanUsers || 1) - 1);
      if (s.mv) s.mv.users = Math.max(0, s.mv.users - 1);
      const t = this.taps.get(s.prof.bus);
      if (t) { t.sessions.delete(s); if (!t.sessions.size && !t.tracks.size) { try { t.src.disconnect(t.node); t.node.disconnect(); } catch { /* noop */ } this.taps.delete(s.prof.bus); } }
      s.close();
      this.emit('change');
    }

    async _tap(bus, s) {
      if (!await this.tapReady) throw new Error('Audio capture unavailable');
      let t = this.taps.get(bus);
      if (!t) {
        const a = this.studio.audio, b = a.buses[bus] || a.buses.M;
        const src = bus === 'M' || !a.buses[bus] ? a.limiter : b.post;
        const node = new AudioWorkletNode(a.ctx, 'bts-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
        const mute = a.ctx.createGain(); mute.gain.value = 0;
        src.connect(node); node.connect(mute); mute.connect(a.ctx.destination);
        t = { node, src, sessions: new Set(), tracks: new Map() };
        node.port.onmessage = (e) => {
          const { frame, data } = e.data;
          for (const ss of t.sessions) {
            if (ss.sampleOffset == null) continue;
            window.bts.enc.audio(ss.sid, frame - ss.sampleOffset, data);
          }
          // extra recording tracks: same timeline as the session's main audio
          for (const [ss, n] of t.tracks) if (n > 0 && ss.sampleOffset != null) window.bts.enc.audio(ss.sid + ':' + bus, frame - ss.sampleOffset, data);
        };
        this.taps.set(bus, t);
      }
      if (s) t.sessions.add(s);
      return t;
    }
    /** multi-track recording: also send buses (A–G) as separate audio tracks for this session */
    async addTracks(s, buses) {
      for (const b of buses) { const t = await this._tap(b, null); t.tracks.set(s, (t.tracks.get(s) || 0) + 1); }
    }
    removeTracks(s, buses) {
      for (const b of buses) {
        const t = this.taps.get(b); if (!t) continue;
        const n = (t.tracks.get(s) || 0) - 1; if (n > 0) t.tracks.set(s, n); else t.tracks.delete(s);
        if (!t.sessions.size && !t.tracks.size) { try { t.src.disconnect(t.node); t.node.disconnect(); } catch { /* noop */ } this.taps.delete(b); }
      }
    }
    /** Map the audio clock to the session's video timeline (sample 0 = first video frame). */
    alignAudio(s) {
      const ctx = this.studio.audio.ctx;
      const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
      let ctxFrameAtT0;
      if (ts && ts.performanceTime) ctxFrameAtT0 = Math.round((ts.contextTime + (s.t0 - ts.performanceTime) / 1000) * ctx.sampleRate);
      else ctxFrameAtT0 = Math.round(ctx.currentTime * ctx.sampleRate);
      // add the output latency so sound lines up with what the picture shows
      // user lip-sync trim: positive values delay the sound
      const trim = Math.round(((BTS.settings.encoding || {}).audioOffsetMs || 0) * ctx.sampleRate / 1000);
      s.sampleOffset = ctxFrameAtT0 + Math.round((ctx.baseLatency || 0) * ctx.sampleRate) - trim;
    }

    /** the picture an output encodes: program (default), clean feed, preview, a multiview or one input */
    _from(prof) {
      const st = this.studio, src = prof.source || 'program';
      if (src === 'program') return st.programCanvas;
      if (src === 'clean') return st.cleanCanvas || st.programCanvas;
      if (src === 'preview') return st.previewCanvas;
      if (src.startsWith('multiview:')) { const mv = st.multiviews.get(src.slice(10)); return mv ? mv.canvas : st.programCanvas; }
      if (src.startsWith('input:')) {
        const k = 'in:' + src, c = this._inputCanvas(k);
        if (c._frame !== st.frameId) {
          c._g.fillStyle = '#000'; c._g.fillRect(0, 0, c.width, c.height);
          const i = st.byId(src.slice(6));
          if (i) { if (i.type === 'title' && !i.live) i.drawStatic(c._g, 0, 0, c.width, c.height); else i.draw(c._g, 0, 0, c.width, c.height); }
          c._frame = st.frameId;
        }
        return c;
      }
      return st.programCanvas;
    }
    _inputCanvas(k) {
      const st = this.studio; let c = this.scalers.get(k);
      if (!c || c.width !== st.W || c.height !== st.H) { c = document.createElement('canvas'); c.width = st.W; c.height = st.H; c._g = c.getContext('2d', { alpha: false }); this.scalers.set(k, c); }
      return c;
    }
    _src(prof) {
      const st = this.studio, w = prof.w, h = prof.h;
      const from = this._from(prof);
      // 16-bit mixing: encoders read 8-bit frames, so convert through an 8-bit canvas (one GPU copy)
      const same = from.width === w && from.height === h && st.colorType !== 'float16';
      if (same) return from;
      const k = [w, h, prof.source, prof.framing, prof.cropX].join('|');
      let c = this.scalers.get(k);
      if (!c || c._frame !== st.frameId) {
        if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; c._g = c.getContext('2d', { alpha: false }); c._g.imageSmoothingQuality = 'high'; this.scalers.set(k, c); }
        const g = c._g, fw = from.width, fh = from.height;
        const sa = fw / fh, da = w / h;
        if (Math.abs(sa - da) < 0.01 || prof.framing === 'stretch') g.drawImage(from, 0, 0, w, h);
        else if (prof.framing === 'fill') { // crop: vertical (9:16) / square versions of a 16:9 show
          let sw = fw, sh = fh, sx = 0, sy = 0;
          if (sa > da) { sw = fh * da; sx = (fw - sw) * Math.min(1, Math.max(0, prof.cropX ?? 0.5)); } else { sh = fw / da; sy = (fh - sh) / 2; }
          g.drawImage(from, sx, sy, sw, sh, 0, 0, w, h);
        } else { // fit with black bars
          g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
          const sc = Math.min(w / fw, h / fh), dw = fw * sc, dh = fh * sc;
          g.drawImage(from, (w - dw) / 2, (h - dh) / 2, dw, dh);
        }
        c._frame = st.frameId;
      }
      return c;
    }
    _tick(now) {
      if (!this.sessions.size) return;
      for (const s of this.sessions.values()) s.encodeFrame(this._src(s.prof), now);
    }
    stats() {
      const el = (performance.now() - this._rate.t) / 1000;
      const list = [...this.sessions.values()].map(s => s.stats());
      if (el >= 1) {
        for (const s of this.sessions.values()) { s._mbps = ((s.bytes - (s._lastBytes || 0)) * 8 / 1e6) / el; s._lastBytes = s.bytes; }
        this._rate.t = performance.now();
      }
      list.forEach((x, i) => { x.mbps = [...this.sessions.values()][i]._mbps || 0; });
      return list;
    }
  }

  BTS.EncodeEngine = EncodeEngine;
  BTS.EncodeEngine.QUALITY = QUALITY;
  BTS.EncodeEngine.avcCodec = avcCodec;
})(window.BTS);
