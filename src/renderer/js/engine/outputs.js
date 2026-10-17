'use strict';
/**
 * Output manager (renderer side): captures the programme canvas + master audio with MediaRecorder
 * and feeds FFmpeg (main process) for multi-destination streaming, recording and ISO MultiCorder.
 */
(function (BTS) {
  const U = BTS.U;

  class OutputManager extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.outs = new Map(); // id -> {state, recorder, cfg, queue, want, attempts, startedAt, stats}
      this.mime = this.pickMime();
      this.encoder = typeof VideoEncoder !== 'undefined' ? new BTS.EncodeEngine(studio) : null;
      this.ndi = new BTS.NdiOut(studio);
      this.vcam = new BTS.VcamOut(studio);
      this.decklinkKey = new BTS.DecklinkKey(studio);
      window.bts.output.onStatus((s) => this._onStatus(s));
    }
    /** Output engine v2 (shared GPU encode) unless the user chose the classic engine or WebCodecs is missing. */
    get v2() { return !!this.encoder && ((BTS.settings.encoding || {}).engine || 'v2') !== 'classic'; }
    static isGpu(enc) { return !enc || enc === 'gpu'; }
    static parseRes(r, W, H) { if (!r || r === 'program') return [W, H]; const m = /^(\d+)x(\d+)$/.exec(r); return m ? [+m[1], +m[2]] : [W, H]; }

    pickMime() {
      const c = [
        ['video/webm;codecs=h264,opus', 'h264'], ['video/x-matroska;codecs=avc1,opus', 'h264'],
        ['video/webm;codecs=avc1,opus', 'h264'], ['video/webm;codecs=vp9,opus', 'vp9'], ['video/webm;codecs=vp8,opus', 'vp8'], ['video/webm', 'vp8']
      ];
      for (const [m, codec] of c) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return { mime: m, codec };
      return { mime: '', codec: 'unknown' };
    }

    /** Program video with the Master mix, or with an aux bus (A–G) as the audio — e.g. a second stream in another language. */
    programStream(bus = 'M') {
      const st = this.studio;
      if (!this._pgm || this._pgmFps !== st.fps || this._pgmCanvas !== st.programCanvas) {
        const v = st.programCanvas.captureStream(st.fps);
        this._pgm = new MediaStream([...v.getVideoTracks(), ...st.audio.masterStream.getAudioTracks()]);
        this._pgmFps = st.fps; this._pgmCanvas = st.programCanvas; this._pgmBus = {};
      }
      if (!bus || bus === 'M' || !st.audio.buses[bus]) return this._pgm;
      if (!this._pgmBus[bus]) this._pgmBus[bus] = new MediaStream([...this._pgm.getVideoTracks(), ...st.audio.busStream(bus).getAudioTracks()]);
      return this._pgmBus[bus];
    }

    get settings() { return this.studio.settings; }

    /* ---------- public API ---------- */
    isStreaming() { return [...this.outs.entries()].some(([id, o]) => id.startsWith('stream') && o.want); }
    isRecording() { const o = this.outs.get('record'); return !!(o && o.want); }
    isMultiCorder() { return [...this.outs.keys()].some(k => k.startsWith('iso-')); }

    async startStreaming() {
      const dests = (this.settings.stream.destinations || []).map((d, i) => ({ ...d, n: i + 1 })).filter(d => d.enabled && d.url);
      if (!dests.length) { U.toast('No stream destination configured. Open Stream Settings.', 'error'); this.emit('need-stream-settings'); return false; }
      const st = this.settings.stream;
      for (const d of dests) {
        const base = d.url.trim();
        const url = d.key ? (base.endsWith('/') || base.endsWith('=') ? base + d.key.trim() : base + '/' + d.key.trim()) : base;
        const cfg = { kind: 'stream', url, key: d.key, name: d.name || `Destination ${d.n}`, videoBitrate: d.videoBitrate || undefined, encoder: d.encoder || st.encoder || 'gpu', delaySec: Math.max(0, Math.min(300, Number(d.delaySec) || 0)) };
        const look = { source: d.source || 'program', framing: d.framing || 'fit', cropX: d.cropX ?? 0.5 };
        if (this.v2) {
          const [w, h] = OutputManager.parseRes(d.resolution || st.resolution, this.studio.W, this.studio.H);
          const kbps = d.videoBitrate || st.videoBitrate;
          const gpu = OutputManager.isGpu(cfg.encoder);
          await this._startV2(`stream-${d.n}`, cfg, gpu
            ? { w, h, mode: 'cbr', bitrate: kbps, keyint: st.keyint || 2, bus: d.audioBus || 'M', ...look }
            : { ...(look.framing !== 'fit' || look.source !== 'program' ? { w, h } : {}), mode: 'quality', quality: 'mezzanine', keyint: 1, bus: d.audioBus || 'M', ...look },
          { videoCopy: gpu, scaleTo: !gpu && (w !== this.studio.W || h !== this.studio.H) && look.framing === 'fit' && look.source === 'program' ? [w, h] : null });
        } else {
          if (OutputManager.isGpu(cfg.encoder)) cfg.encoder = 'libx264';
          await this._start(`stream-${d.n}`, cfg, this.programStream(d.audioBus), 250, Math.max(8000, (d.videoBitrate || st.videoBitrate) * 1.6));
        }
      }
      window.bts.power(true);
      return true;
    }
    async stopStreaming() { for (const id of [...this.outs.keys()]) if (id.startsWith('stream')) await this._stop(id); this._power(); }
    toggleStreaming() { return this.isStreaming() ? this.stopStreaming() : this.startStreaming(); }

    recordFile(sub, ext, title) {
      const r = this.settings.record;
      const { date, time } = U.stamp();
      const name = (r.filenamePattern || 'BTS-Studio-{date}-{time}').replace('{date}', date).replace('{time}', time).replace('{title}', title || '') + (sub ? '' : '');
      const sep = navigator.userAgent.includes('Windows') ? '\\' : '/';
      const folder = r.folder + (sub ? sep + sub : '');
      return `${folder}${sep}${(title ? title.replace(/[\\/:*?"<>|]/g, '_') + '-' : '')}${name}.${ext}`;
    }

    async startRecording() {
      const r = this.settings.record;
      const file = this.recordFile('', r.format || 'mp4');
      const rec = (id, rr, f, name) => {
        const enc = rr.encoder || 'gpu';
        const audioOnly = /\.wav$/i.test(f);
        const tracks = (rr.tracks || []).filter(b => /^[A-G]$/.test(b) && b !== (rr.audioBus || 'M'));
        const cfg = { kind: 'record', file: f, encoder: enc, quality: rr.quality, name, audioCodec: rr.audioCodec, preset: rr.preset, passthrough: rr.mode === 'passthrough', audioOnly, tracks: audioOnly ? [] : tracks, splitMinutes: Number(rr.splitMinutes) || 0 };
        const look = { source: rr.source || 'program', framing: 'fit' };
        if (!this.v2) { if (OutputManager.isGpu(enc)) cfg.encoder = 'libx264'; return this._start(id, cfg, this.programStream(rr.audioBus), 1000, rr.videoBitrate || 20000); }
        const gpu = OutputManager.isGpu(enc);
        const bitrateMode = rr.rateControl === 'bitrate';
        return this._startV2(id, cfg, gpu
          ? (bitrateMode ? { mode: 'vbr', bitrate: rr.videoBitrate || 40000, keyint: 1, bus: rr.audioBus || 'M', ...look } : { mode: 'quality', quality: rr.quality || 'high', keyint: 1, bus: rr.audioBus || 'M', ...look })
          : { mode: 'quality', quality: 'mezzanine', keyint: 1, bus: rr.audioBus || 'M', ...look }, { videoCopy: gpu });
      };
      const ok = await rec('record', r, file, 'Recorder');
      // Recorder 2: a second, independently formatted recording of the same programme (e.g. MP4 for editing + MKV safety copy)
      const r2 = this.settings.record2;
      if (ok && r2 && r2.enabled) {
        const f2 = file.replace(/\.[^.]+$/, '') + (r2.suffix || '-2') + '.' + (r2.format || 'mkv');
        await rec('record2', r2, f2, 'Recorder 2');
      }
      if (ok) window.bts.power(true);
      return ok;
    }
    async stopRecording() { await this._stop('record'); await this._stop('record2'); this._power(); }
    toggleRecording() { return this.isRecording() ? this.stopRecording() : this.startRecording(); }

    /* ---------- Blackmagic DeckLink / UltraStudio playout (SDI / HDMI out) ---------- */
    isDecklink(n) { return [...this.outs.entries()].some(([id, o]) => (n == null ? id.startsWith('decklink') : id === 'decklink-' + n) && o.want); }
    /** n: 1..4, device: Blackmagic device name, mode: '1080p' | '1080i' | '720p' | '2160p' | 'program', bus: audio bus */
    async startDecklink(n, { device, mode = 'program', bus = 'M' } = {}) {
      if (!this.v2) { U.toast('Blackmagic output needs the GPU output engine (Settings → Encoders → Engine).', 'error', 9000); return false; }
      if (!device) { U.toast('Choose a Blackmagic device first', 'error'); return false; }
      const probe = await window.bts.output.decklink().catch(() => null);
      if (probe && probe.error === 'nosupport') { U.toast('Blackmagic output needs an FFmpeg built with DeckLink support — set it in External Outputs → “FFmpeg with DeckLink”.', 'error', 12000); return false; }
      if (probe && probe.error === 'nodriver') { U.toast('Blackmagic Desktop Video is not installed — install it from blackmagicdesign.com/support and restart the PC.', 'error', 12000); return false; }
      if (probe && probe.devices.length && !probe.devices.includes(device)) { U.toast(`Blackmagic device “${device}” was not found. Available: ${probe.devices.join(', ')}`, 'error', 10000); return false; }
      const st = this.studio, fps = st.fps;
      const size = { '1080p': [1920, 1080], '1080i': [1920, 1080], '720p': [1280, 720], '2160p': [3840, 2160] }[mode] || [st.W, st.H];
      const interlaced = mode === '1080i';
      const cfg = { kind: 'decklink', name: `Blackmagic ${n} (${device})`, device, size, interlaced, rate: fps };
      // mezzanine (near-lossless) picture; shares the recorder's encode. A keyframe is requested as soon as playout attaches.
      const ok = await this._startV2('decklink-' + n, cfg, { mode: 'quality', quality: 'mezzanine', keyint: 1, bus }, {});
      if (ok) window.bts.power(true);
      return ok;
    }
    async stopDecklink(n) { if (n == null) { for (const id of [...this.outs.keys()]) if (id.startsWith('decklink')) await this._stop(id); } else await this._stop('decklink-' + n); this._power(); }

    async startIso(inputId) {
      const inp = this.studio.byId(inputId); if (!inp) return false;
      const ms = inp.getMediaStream();
      if (!ms) { U.toast(`${inp.title}: ISO recording is available for cameras, screens, audio devices and media files`, 'error'); return false; }
      const audioOnly = ms.getVideoTracks().length === 0;
      const file = this.recordFile('ISO', audioOnly ? 'wav' : 'mkv', inp.title);
      const ok = await this._start(`iso-${inputId}`, { kind: 'iso', file, passthrough: true, audioOnly }, ms, 1000, this.settings.record.videoBitrate || 20000);
      inp.iso = ok; this.studio.emit('inputs');
      return ok;
    }
    async stopIso(inputId) { const inp = this.studio.byId(inputId); if (inp) inp.iso = false; await this._stop(`iso-${inputId}`); this.studio.emit('inputs'); }
    async toggleMultiCorder() {
      if (this.isMultiCorder()) { for (const id of [...this.outs.keys()]) if (id.startsWith('iso-')) await this.stopIso(id.slice(4)); return; }
      const targets = this.studio.inputs.filter(i => i.cfg.isoEnabled || (['camera', 'screen'].includes(i.type) && i.cfg.isoEnabled !== false));
      if (!targets.length) { U.toast('MultiCorder: add a camera or screen input (or enable ISO in input settings)', 'error'); return; }
      for (const t of targets) await this.startIso(t.id);
      U.toast(`MultiCorder recording ${targets.length} input(s)`, 'ok');
    }

    stopAll() { for (const id of [...this.outs.keys()]) this._stop(id); }

    _power() { if (!this.isStreaming() && !this.isRecording() && !this.isDecklink()) window.bts.power(false); }

    /* ---------- internals: engine v2 ---------- */
    async _startV2(id, cfg, prof, extra = {}) {
      const prev = this.outs.get(id);
      if (prev && prev.want && prev.session) return true;
      const o = prev || { attempts: 0 };
      Object.assign(o, { cfg, prof, extra, want: true, state: 'starting', stats: {}, v2: true });
      if (!o.startedAt) o.startedAt = Date.now();
      this.outs.set(id, o);
      try {
        if (!o.session) o.session = await this.encoder.acquire(prof);
      } catch (e) {
        this.outs.delete(id); U.toast(`${cfg.name || id}: ${e.message}`, 'error', 9000); this.emit('change'); return false;
      }
      if (o.session.prof.w > 1920 && !o.session.hardware && !this._swWarned) { this._swWarned = true; U.toast('No GPU video encoder found — 4K encoding on the CPU may not keep up. Update your graphics driver or lower the output resolution.', 'error', 12000); }
      if (cfg.tracks && cfg.tracks.length) { try { await this.encoder.addTracks(o.session, cfg.tracks); o.tracks = cfg.tracks; } catch (e) { console.warn('tracks', e); } }
      const full = { ...cfg, ...extra, v2: true, session: o.session.sid, fps: this.studio.fps };
      const r = await window.bts.output.start(id, full);
      if (!r.ok) { this.encoder.release(o.session); o.session = null; o.want = false; this.outs.delete(id); U.toast(`Output failed: ${r.error}`, 'error'); this.emit('change'); return false; }
      o.file = r.file;
      this.emit('change');
      return true;
    }
    _releaseV2(o) { if (o && o.session) { if (o.tracks) this.encoder.removeTracks(o.session, o.tracks); o.tracks = null; this.encoder.release(o.session); o.session = null; } }

    /* ---------- internals: classic engine ---------- */
    async _start(id, cfg, stream, timeslice, kbps) {
      const prev = this.outs.get(id);
      if (prev && prev.recorder && prev.recorder.state !== 'inactive') return true;
      const o = prev || { attempts: 0 };
      Object.assign(o, { cfg, stream, timeslice, kbps, want: true, state: 'starting', queue: Promise.resolve(), stats: {} });
      if (!o.startedAt) o.startedAt = Date.now();
      this.outs.set(id, o);
      cfg.inputCodec = this.mime.codec;
      cfg.fps = this.studio.fps;
      const r = await window.bts.output.start(id, cfg);
      if (!r.ok) { o.state = 'error'; o.want = false; this.outs.delete(id); U.toast(`Output failed: ${r.error}`, 'error'); this.emit('change'); return false; }
      o.file = r.file;
      let rec;
      try {
        rec = new MediaRecorder(stream, { mimeType: this.mime.mime || undefined, videoBitsPerSecond: Math.round(kbps * 1000), audioBitsPerSecond: 256000 });
      } catch (e) {
        window.bts.output.stop(id); this.outs.delete(id); U.toast('MediaRecorder error: ' + e.message, 'error'); this.emit('change'); return false;
      }
      o.recorder = rec;
      rec.ondataavailable = (ev) => {
        if (!ev.data || !ev.data.size) return;
        o.queue = o.queue.then(() => ev.data.arrayBuffer()).then(buf => window.bts.output.chunk(id, buf)).catch(() => {});
      };
      rec.onerror = (e) => { console.error('recorder', e); U.toast(`Recorder error on ${id}`, 'error'); };
      rec.start(timeslice);
      this.emit('change');
      return true;
    }

    async _stop(id) {
      const o = this.outs.get(id); if (!o) return;
      o.want = false;
      clearTimeout(o.retry);
      if (o.v2) { await window.bts.output.stop(id); this._releaseV2(o); o.state = 'stopping'; this.emit('change'); return; }
      if (o.recorder && o.recorder.state !== 'inactive') {
        await new Promise(res => { o.recorder.addEventListener('stop', res, { once: true }); try { o.recorder.stop(); } catch { res(); } });
      }
      await o.queue;
      await window.bts.output.stop(id);
      o.state = 'stopping';
      this.emit('change');
    }

    _onStatus(s) {
      const o = this.outs.get(s.id);
      if (!o) return;
      o.state = s.state;
      o.stats = { fps: s.fps, kbps: s.kbps, time: s.time, speed: s.speed, buffered: s.buffered, dropped: s.dropped };
      if (s.state === 'stopped') {
        this.outs.delete(s.id);
        this._releaseV2(o);
        if (s.file && (s.id === 'record' || s.id === 'record2')) U.toast(`Recording saved: ${s.file}`, 'ok', 6000);
      } else if (s.state === 'reconnecting' && o.want && o.v2) {
        o.attempts++;
        const delay = Math.min(15000, 2000 * o.attempts);
        U.toast(`${o.cfg.name || s.id}: connection lost — reconnecting in ${Math.round(delay / 1000)}s (attempt ${o.attempts})`, 'error');
        clearTimeout(o.retry);
        // the shared encoder keeps running; only the FFmpeg process for this destination restarts
        o.retry = setTimeout(() => { if (o.want) window.bts.output.start(s.id, { ...o.cfg, ...o.extra, v2: true, session: o.session.sid, fps: this.studio.fps }); }, delay);
      } else if (s.state === 'reconnecting' && o.want) {
        if (o.recorder && o.recorder.state !== 'inactive') { try { o.recorder.stop(); } catch { /* noop */ } }
        o.recorder = null;
        o.attempts++;
        const delay = Math.min(15000, 2000 * o.attempts);
        U.toast(`${o.cfg.name || s.id}: connection lost — reconnecting in ${Math.round(delay / 1000)}s (attempt ${o.attempts})`, 'error');
        clearTimeout(o.retry);
        o.retry = setTimeout(() => { if (o.want) this._start(s.id, o.cfg, o.stream, o.timeslice, o.kbps); }, delay);
      } else if (s.state === 'live') {
        if (o.attempts && s.id.startsWith('stream')) { U.toast(`${o.cfg.name || s.id}: reconnected`, 'ok'); o.attempts = 0; }
      } else if (s.state === 'error') {
        o.want = false;
        if (o.recorder && o.recorder.state !== 'inactive') { try { o.recorder.stop(); } catch { /* noop */ } }
        this.outs.delete(s.id);
        this._releaseV2(o);
        U.toast(`${o.cfg.name || s.id} stopped: ${s.message || 'FFmpeg error'}`, 'error', 9000);
        this._power();
      }
      this.emit('change');
    }

    summary() {
      const list = [];
      for (const [id, o] of this.outs) list.push({ id, state: o.state, kbps: o.stats?.kbps || 0, fps: o.stats?.fps || 0, time: o.stats?.time || '', since: o.startedAt });
      return list;
    }
    elapsed(prefix) {
      const o = [...this.outs.entries()].find(([id, x]) => id.startsWith(prefix) && x.want);
      return o ? (Date.now() - o[1].startedAt) / 1000 : 0;
    }
  }

  BTS.OutputManager = OutputManager;
})(window.BTS);
