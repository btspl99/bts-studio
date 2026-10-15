'use strict';
/**
 * Shared WebGL processor: colour correction, chroma key, luma key, and BGRA upload for browser sources.
 * One GL context is shared by every input (avoids the browser's context limit); the result of each pass
 * is copied into a per-input 2D canvas that the compositor draws.
 */
(function (BTS) {
  const VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){ v_uv = vec2(a_pos.x*0.5+0.5, 0.5-a_pos.y*0.5); gl_Position = vec4(a_pos,0.0,1.0); }`;

  const FS = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_swizzle;      // 1 = BGRA premultiplied input (browser source)
uniform int u_premulIn;
uniform float u_bright, u_contrast, u_sat, u_hue, u_gamma, u_temp, u_tint;
uniform int u_chroma; uniform vec3 u_key; uniform float u_sim, u_smooth, u_spill;
uniform int u_luma; uniform float u_lumaLo, u_lumaHi, u_lumaSmooth; uniform int u_lumaInvert;
uniform float u_opacity;

vec2 cbcr(vec3 c){ return vec2(-0.168736*c.r - 0.331264*c.g + 0.5*c.b, 0.5*c.r - 0.418688*c.g - 0.081312*c.b); }
vec3 hueRotate(vec3 c, float a){
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c*ca + cross(k,c)*sin(a) + k*dot(k,c)*(1.0-ca);
}
void main(){
  vec4 t = texture2D(u_tex, v_uv);
  if (u_swizzle == 1) t = t.bgra;
  vec3 rgb = t.rgb; float a = t.a;
  if (u_premulIn == 1 && a > 0.0001) rgb /= a;

  // colour correction
  rgb = rgb + u_bright;
  rgb = (rgb - 0.5) * u_contrast + 0.5;
  rgb.r += u_temp * 0.1 + u_tint * 0.05; rgb.b -= u_temp * 0.1 - u_tint * 0.05; rgb.g -= u_tint * 0.1;
  float l = dot(rgb, vec3(0.2126,0.7152,0.0722));
  rgb = mix(vec3(l), rgb, u_sat);
  if (u_hue != 0.0) rgb = hueRotate(rgb, u_hue);
  rgb = pow(max(rgb, 0.0), vec3(1.0/u_gamma));
  rgb = clamp(rgb, 0.0, 1.0);

  if (u_chroma == 1) {
    float d = distance(cbcr(t.rgb / max(t.a, 0.0001)), cbcr(u_key));
    float base = d - u_sim;
    float mask = pow(clamp(base / max(u_smooth, 0.0001), 0.0, 1.0), 1.5);
    float spillv = pow(clamp(base / max(u_spill, 0.0001), 0.0, 1.0), 1.5);
    float desat = dot(rgb, vec3(0.2126,0.7152,0.0722));
    rgb = mix(vec3(desat), rgb, spillv);
    a *= mask;
  }
  if (u_luma == 1) {
    float lum = dot(rgb, vec3(0.2126,0.7152,0.0722));
    float m = smoothstep(u_lumaLo - u_lumaSmooth, u_lumaLo + u_lumaSmooth, lum) * (1.0 - smoothstep(u_lumaHi - u_lumaSmooth, u_lumaHi + u_lumaSmooth, lum));
    if (u_lumaInvert == 1) m = 1.0 - m;
    a *= m;
  }
  a *= u_opacity;
  gl_FragColor = vec4(rgb * a, a);
}`;

  class GLProcessor {
    constructor(maxW = 1920, maxH = 1080) {
      this.W = maxW; this.H = maxH;
      this.canvas = document.createElement('canvas');
      this.canvas.width = maxW; this.canvas.height = maxH;
      const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!gl) { this.gl = null; console.warn('WebGL unavailable — effects disabled'); return; }
      this.gl = gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      gl.useProgram(p);
      this.prog = p;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.u = {};
      ['u_tex', 'u_swizzle', 'u_premulIn', 'u_bright', 'u_contrast', 'u_sat', 'u_hue', 'u_gamma', 'u_temp', 'u_tint', 'u_chroma', 'u_key', 'u_sim', 'u_smooth', 'u_spill', 'u_luma', 'u_lumaLo', 'u_lumaHi', 'u_lumaSmooth', 'u_lumaInvert', 'u_opacity']
        .forEach(n => { this.u[n] = gl.getUniformLocation(p, n); });
      gl.clearColor(0, 0, 0, 0);
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
      this.canvas.addEventListener('webglcontextrestored', () => { const n = new GLProcessor(this.W, this.H); Object.assign(this, n); this.lost = false; });
    }

    get ok() { return !!this.gl && !this.lost; }

    _setUniforms(fx = {}, opts = {}) {
      const gl = this.gl, u = this.u;
      const cc = fx.color || {};
      const ck = fx.chroma || {};
      const lk = fx.luma || {};
      gl.uniform1i(u.u_tex, 0);
      gl.uniform1i(u.u_swizzle, opts.swizzle ? 1 : 0);
      gl.uniform1i(u.u_premulIn, opts.premul ? 1 : 0);
      const ccOn = cc.enabled !== false && cc.enabled !== undefined;
      gl.uniform1f(u.u_bright, ccOn ? (cc.brightness || 0) : 0);
      gl.uniform1f(u.u_contrast, ccOn ? (cc.contrast ?? 1) : 1);
      gl.uniform1f(u.u_sat, ccOn ? (cc.saturation ?? 1) : 1);
      gl.uniform1f(u.u_hue, ccOn ? ((cc.hue || 0) * Math.PI / 180) : 0);
      gl.uniform1f(u.u_gamma, ccOn ? (cc.gamma || 1) : 1);
      gl.uniform1f(u.u_temp, ccOn ? (cc.temperature || 0) : 0);
      gl.uniform1f(u.u_tint, ccOn ? (cc.tint || 0) : 0);
      gl.uniform1i(u.u_chroma, ck.enabled ? 1 : 0);
      const [r, g, b] = BTS.U.hexToRgb(ck.color || '#00ff00');
      gl.uniform3f(u.u_key, r / 255, g / 255, b / 255);
      gl.uniform1f(u.u_sim, (ck.similarity ?? 400) / 1000);
      gl.uniform1f(u.u_smooth, (ck.smoothness ?? 80) / 1000);
      gl.uniform1f(u.u_spill, (ck.spill ?? 100) / 1000);
      gl.uniform1i(u.u_luma, lk.enabled ? 1 : 0);
      gl.uniform1f(u.u_lumaLo, lk.low ?? 0);
      gl.uniform1f(u.u_lumaHi, lk.high ?? 1);
      gl.uniform1f(u.u_lumaSmooth, lk.smooth ?? 0.02);
      gl.uniform1i(u.u_lumaInvert, lk.invert ? 1 : 0);
      gl.uniform1f(u.u_opacity, 1);
    }

    _copyOut(w, h, out) {
      if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
      const ctx = out._ctx2d || (out._ctx2d = out.getContext('2d'));
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(this.canvas, 0, this.H - h, w, h, 0, 0, w, h);
      return out;
    }

    _target(sw, sh) {
      const s = Math.min(1, this.W / sw, this.H / sh);
      return [Math.max(1, Math.round(sw * s)), Math.max(1, Math.round(sh * s))];
    }

    /** Apply effects to a drawable (video/img/canvas) — returns `out` canvas */
    process(source, sw, sh, fx, out) {
      if (!this.ok || !sw || !sh) return null;
      const gl = this.gl;
      const [w, h] = this._target(sw, sh);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch (e) { return null; }
      this._setUniforms(fx, {});
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this._copyOut(w, h, out);
    }

    /** Upload a raw BGRA premultiplied bitmap (from an off-screen browser) — returns `out` canvas */
    uploadBGRA(bytes, w, h, fx, out) {
      if (!this.ok) return null;
      const gl = this.gl;
      const [tw, th] = this._target(w, h);
      gl.viewport(0, 0, tw, th);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      this._setUniforms(fx || {}, { swizzle: true, premul: true });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this._copyOut(tw, th, out);
    }
  }

  BTS.GLProcessor = GLProcessor;
})(window.BTS);
