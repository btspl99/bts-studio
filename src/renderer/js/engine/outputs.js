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
      window.bts.output.onStatus((s) => this._onStatus(s));
    }

    pickMime() {
      const c = [
        ['video/webm;codecs=h264,opus', 'h264'], ['video/x-matroska;codecs=avc1,opus', 'h264'],
        ['video/webm;codecs=avc1,opus', 'h264'], ['video/webm;codecs=vp9,opus', 'vp9'], ['video/webm;codecs=vp8,opus', 'vp8'], ['video/webm', 'vp8']
      ];
      for (const [m, codec] of c) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return { mime: m, codec };
      return { mime: '', codec: 'unknown' };
    }

    programStream() {
      const st = this.studio;
      if (!this._pgm || this._pgmFps !== st.fps || this._pgmCanvas !== st.programCanvas) {
        const v = st.programCanvas.captureStream(st.fps);
        this._pgm = new MediaStream([...v.getVideoTracks(), ...st.audio.masterStream.getAudioTracks()]);
        this._pgmFps = st.fps; this._pgmCanvas = st.programCanvas;
      }
      return this._pgm;
    }

    get settings() { return this.studio.settings; }

    /* ---------- public API ---------- */
    isStreaming() { return [...this.outs.entries()].some(([id, o]) => id.startsWith('stream') && o.want); }
    isRecording() { const o = this.outs.get('record'); return !!(o && o.want); }
    isMultiCorder() { return [...this.outs.keys()].some(k => k.startsWith('iso-')); }

    async startStreaming() {
      const dests = (this.settings.stream.destinations || []).map((d, i) => ({ ...d, n: i + 1 })).filter(d => d.enabled && d.url);
      if (!dests.length) { U.toast('No stream destination configured. Open Stream Settings.', 'error'); this.emit('need-stream-settings'); return false; }
      for (const d of dests) {
        const base = d.url.trim();
        const url = d.key ? (base.endsWith('/') || base.endsWith('=') ? base + d.key.trim() : base + '/' + d.key.trim()) : base;
        await this._start(`stream-${d.n}`, { kind: 'stream', url, key: d.key, name: d.name, videoBitrate: d.videoBitrate || undefined, encoder: d.encoder || undefined }, this.programStream(), 250,
          Math.max(8000, (d.videoBitrate || this.settings.stream.videoBitrate) * 1.6));
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
      const ok = await this._start('record', { kind: 'record', file, passthrough: r.mode === 'passthrough', encoder: r.encoder }, this.programStream(), 1000, r.videoBitrate || 20000);
      // Recorder 2: a second, independently formatted recording of the same programme (e.g. MP4 for editing + MKV safety copy)
      const r2 = this.settings.record2;
      if (ok && r2 && r2.enabled) {
        const f2 = file.replace(/\.[^.]+$/, '') + (r2.suffix || '-2') + '.' + (r2.format || 'mkv');
        await this._start('record2', { kind: 'record', file: f2, passthrough: r2.mode === 'passthrough', encoder: r2.encoder, quality: r2.quality, name: 'Recorder 2' }, this.programStream(), 1000, r2.videoBitrate || 12000);
      }
      if (ok) window.bts.power(true);
      return ok;
    }
    async stopRecording() { await this._stop('record'); await this._stop('record2'); this._power(); }
    toggleRecording() { return this.isRecording() ? this.stopRecording() : this.startRecording(); }

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

    _power() { if (!this.isStreaming() && !this.isRecording()) window.bts.power(false); }

    /* ---------- internals ---------- */
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
      o.stats = { fps: s.fps, kbps: s.kbps, time: s.time, speed: s.speed, buffered: s.buffered };
      if (s.state === 'stopped') {
        this.outs.delete(s.id);
        if (s.file && (s.id === 'record' || s.id === 'record2')) U.toast(`Recording saved: ${s.file}`, 'ok', 6000);
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
