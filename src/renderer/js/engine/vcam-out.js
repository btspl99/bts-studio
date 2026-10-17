/* BTS Studio — Virtual camera output (Windows).
 * The chosen source (Output, Clean feed, Preview, a multiview or one input) is scaled to the camera size and
 * packed on the GPU into 24-bit BGR rows (the DirectShow camera format), read back asynchronously through a
 * pixel-buffer object and handed to the main process, which passes it to the virtual camera driver.
 */
(function (BTS) {
  'use strict';
  const U = BTS.U;

  const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  // Output texel x of row y holds bytes 4x..4x+3 of the BGR row: byte b → pixel b/3, channel b%3 (0 B, 1 G, 2 R).
  // readPixels returns the bottom framebuffer row first, so framebuffer row y carries image row y (top-down result).
  const FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D src; uniform int W;
out vec4 o;
float byteAt(int b, int row){
  int px = b / 3, ch = b - px * 3;
  vec4 c = texelFetch(src, ivec2(min(px, W - 1), row), 0);
  return ch == 0 ? c.b : (ch == 1 ? c.g : c.r);
}
void main(){
  int x = int(gl_FragCoord.x), row = int(gl_FragCoord.y);
  int b = x * 4;
  o = vec4(byteAt(b, row), byteAt(b + 1, row), byteAt(b + 2, row), byteAt(b + 3, row));
}`;

  /** GPU packer: canvas (RGBA) → BGR24 bytes, top-down. Async readback with a PBO + fence. */
  class BgrPacker {
    constructor(w, h) {
      this.w = w; this.h = h; this.ow = w * 3 / 4;
      const c = this.canvas = document.createElement('canvas');
      c.width = this.ow; c.height = h;
      const gl = this.gl = c.getContext('webgl2', { antialias: false, depth: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
      if (!gl) throw new Error('WebGL 2 is not available');
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      const p = this.prog = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      gl.useProgram(p);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.uniform1i(gl.getUniformLocation(p, 'src'), 0);
      gl.uniform1i(gl.getUniformLocation(p, 'W'), w);
      this.bytes = this.ow * 4 * h; // = w * h * 3
      this.pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.bytes, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.pending = null;
    }
    /** start packing a frame (source must already be w × h); returns false while the previous one is in flight */
    pack(source) {
      if (this.pending) return false;
      const gl = this.gl;
      gl.viewport(0, 0, this.ow, this.h);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.readPixels(0, 0, this.ow, this.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.pending = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      return true;
    }
    /** bytes of the packed frame once the GPU has finished, else null */
    poll() {
      if (!this.pending) return null;
      const gl = this.gl;
      const st = gl.clientWaitSync(this.pending, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) return null;
      gl.deleteSync(this.pending); this.pending = null;
      const out = new Uint8Array(this.bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return out;
    }
    destroy() { try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* noop */ } }
  }

  class VcamOut {
    constructor(studio) {
      this.studio = studio;
      this.rec = null;
      studio.on('frame', (now) => { if (this.rec) { try { this._tick(this.rec, now); } catch (e) { this.rec.errors++; if (this.rec.errors === 1) console.warn('[vcam]', e); } } });
    }
    cfg() {
      const s = BTS.settings; s.vcam = { source: 'program', size: '1080', fps: 30, autoStart: false, ...(s.vcam || {}) };
      return s.vcam;
    }
    save() { return window.bts.settings.set(BTS.settings); }
    get live() { return !!this.rec; }
    status() { const r = this.rec; return r ? { frames: r.frames, dropped: r.dropped, w: r.w, h: r.h, source: r.cfg.source } : null; }

    async start() {
      this.stop();
      const c = this.cfg(), st = this.studio;
      const [w, h] = c.size === '720' ? [1280, 720] : c.size === 'project' ? [Math.round(st.W / 4) * 4, Math.round(st.H / 2) * 2] : [1920, 1080];
      const fps = Math.min(60, c.fps || st.fps || 30);
      const r = await window.bts.vcam.start(w, h, fps);
      if (!r.ok) { U.toast(`Virtual camera: ${r.error}`, 'error', 9000); return false; }
      let packer;
      try { packer = new BgrPacker(r.width, r.height); } catch (e) { window.bts.vcam.stop(); U.toast('Virtual camera: ' + e.message, 'error', 9000); return false; }
      const rec = { cfg: { ...c }, w: r.width, h: r.height, fps, last: 0, frames: 0, dropped: 0, errors: 0, packer, scale: null };
      if (c.source === 'clean') { st.cleanUsers = (st.cleanUsers || 0) + 1; rec.clean = true; }
      if (String(c.source).startsWith('multiview:')) { rec.mv = st.multiviews.get(c.source.slice(10)); if (rec.mv) rec.mv.users++; }
      this.rec = rec;
      st.emit('vcam');
      return true;
    }
    stop() {
      const rec = this.rec; if (!rec) return;
      this.rec = null;
      const st = this.studio;
      if (rec.clean) st.cleanUsers = Math.max(0, (st.cleanUsers || 1) - 1);
      if (rec.mv) rec.mv.users = Math.max(0, rec.mv.users - 1);
      rec.packer.destroy();
      window.bts.vcam.stop();
      st.emit('vcam');
    }
    toggle() { return this.rec ? (this.stop(), true) : this.start(); }

    _source(rec) {
      const st = this.studio, s = rec.cfg.source;
      if (s === 'program') return st.programCanvas;
      if (s === 'clean') return st.cleanCanvas || st.programCanvas;
      if (s === 'preview') return st.previewCanvas;
      if (String(s).startsWith('multiview:')) return rec.mv ? rec.mv.canvas : null;
      if (String(s).startsWith('input:')) {
        const i = st.byId(s.slice(6)); if (!i) return null;
        const sc = rec.scratch || (rec.scratch = document.createElement('canvas'));
        if (sc.width !== rec.w || sc.height !== rec.h) { sc.width = rec.w; sc.height = rec.h; rec.sg = sc.getContext('2d', { alpha: false }); }
        rec.sg.fillStyle = '#000'; rec.sg.fillRect(0, 0, rec.w, rec.h);
        if (i.type === 'title' && !i.live) i.drawStatic(rec.sg, 0, 0, rec.w, rec.h); else i.draw(rec.sg, 0, 0, rec.w, rec.h);
        return sc;
      }
      return st.programCanvas;
    }

    _tick(rec, now) {
      const done = rec.packer.poll();
      if (done) { window.bts.vcam.frame(done); rec.frames++; }
      if (now - rec.last < 1000 / rec.fps - 2) return;
      let src = this._source(rec); if (!src) return;
      if (src.width !== rec.w || src.height !== rec.h) { // fit into the camera size (letterbox)
        const c = rec.scale || (rec.scale = document.createElement('canvas'));
        if (c.width !== rec.w || c.height !== rec.h) { c.width = rec.w; c.height = rec.h; rec.g = c.getContext('2d', { alpha: false }); rec.g.imageSmoothingQuality = 'high'; }
        const g = rec.g; g.fillStyle = '#000'; g.fillRect(0, 0, rec.w, rec.h);
        const r = U.fit(src.width, src.height, rec.w, rec.h, 'contain'); g.drawImage(src, r.x, r.y, r.w, r.h); src = c;
      }
      if (rec.packer.pack(src)) rec.last = now; else rec.dropped++;
    }
  }

  VcamOut.BgrPacker = BgrPacker;
  BTS.VcamOut = VcamOut;
})(window.BTS);
