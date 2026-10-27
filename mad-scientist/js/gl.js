// Minimal WebGL quad batcher.
// Every sprite is a 4-vertex quad with a multiplicative tint, an optional
// "flash" colour (lerps the sprite towards a solid colour, used for hit
// flashes) and an additive flag. Textures are premultiplied, so additive and
// normal sprites share one blend func and can live in the same batch.

const VERT = `
attribute vec2 aPos;
attribute vec2 aUV;
attribute vec4 aColor;
attribute vec4 aFlash;
attribute float aMode;
uniform vec2 uView;
uniform vec3 uCam;
varying vec2 vUV;
varying vec4 vColor;
varying vec4 vFlash;
varying float vMode;
void main() {
  vUV = aUV; vColor = aColor; vFlash = aFlash; vMode = aMode;
  vec2 p = aPos * uCam.x + uCam.yz;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUV;
varying vec4 vColor;
varying vec4 vFlash;
varying float vMode;
void main() {
  vec4 t = texture2D(uTex, vUV);
  vec3 rgb = mix(t.rgb * vColor.rgb, vFlash.rgb * t.a, vFlash.a);
  gl_FragColor = vec4(rgb, t.a * (1.0 - vMode)) * vColor.a;
}`;

const MAX_QUADS = 4096;
const FLOATS_PER_VERT = 7; // x y u v color flash mode
const BYTES_PER_VERT = FLOATS_PER_VERT * 4;

export class Renderer {
  constructor(canvas) {
    const opts = { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false };
    let gl = canvas.getContext('webgl2', opts);
    this.isGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.canvas = canvas;

    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.uView = gl.getUniformLocation(prog, 'uView');
    this.uCam = gl.getUniformLocation(prog, 'uCam');
    this.cam = [NaN, NaN, NaN];

    this.buffer = new ArrayBuffer(MAX_QUADS * 4 * BYTES_PER_VERT);
    this.f32 = new Float32Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.buffer.byteLength, gl.DYNAMIC_DRAW);

    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0, v = 0; i < idx.length; i += 6, v += 4) {
      idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
      idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
    }
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    const attr = (name, size, type, norm, offset) => {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, norm, BYTES_PER_VERT, offset);
    };
    attr('aPos', 2, gl.FLOAT, false, 0);
    attr('aUV', 2, gl.FLOAT, false, 8);
    attr('aColor', 4, gl.UNSIGNED_BYTE, true, 16);
    attr('aFlash', 4, gl.UNSIGNED_BYTE, true, 20);
    attr('aMode', 1, gl.FLOAT, false, 24);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    this.count = 0;
    this.texture = null;
    this.viewW = 1;
    this.viewH = 1;
    this.drawCalls = 0;
    this.white = this.createTexture(solidCanvas('#fff'));
    // Little-endian packing helpers for the two RGBA byte attributes.
    this.tint = 0xffffffff;
    this.flash = 0;
    this.mode = 0;
  }

  createTexture(source, { mipmap = true } = {}) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const w = source.width, h = source.height;
    const pot = (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
    const canMip = mipmap && (this.isGL2 || pot);
    if (canMip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, canMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texture = null; // force rebind on next draw
    return { tex, width: w, height: h };
  }

  begin(viewW, viewH, clear = [0, 0, 0]) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.viewW = viewW;
    this.viewH = viewH;
    gl.uniform2f(this.uView, viewW, viewH);
    this.cam[0] = NaN;
    this.setCamera(1, 0, 0);
    this.drawCalls = 0;
  }

  /** Screen position = world position * scale + (tx, ty). */
  setCamera(scale, tx, ty) {
    const c = this.cam;
    if (c[0] === scale && c[1] === tx && c[2] === ty) return;
    this.flush();
    c[0] = scale; c[1] = tx; c[2] = ty;
    this.gl.uniform3f(this.uCam, scale, tx, ty);
  }

  flush() {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32.subarray(0, this.count * 4 * FLOATS_PER_VERT));
    gl.drawElements(gl.TRIANGLES, this.count * 6, gl.UNSIGNED_SHORT, 0);
    this.count = 0;
    this.drawCalls++;
  }

  end() { this.flush(); }

  /** Pack 0..1 floats into an RGBA8 little-endian uint. */
  static rgba(r, g, b, a) {
    return ((clamp255(a) << 24) | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0;
  }

  /**
   * Emit an arbitrary quad (vertices in order BL, UL, UR, BR or any winding).
   * `tint`/`flash` are packed RGBA uints from Renderer.rgba.
   */
  quad(texture, v, uv, tint = 0xffffffff, flash = 0, additive = 0) {
    if (this.texture !== texture) {
      this.flush();
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture.tex);
      this.texture = texture;
    } else if (this.count >= MAX_QUADS) {
      this.flush();
    }
    const f = this.f32, u = this.u32;
    let o = this.count * 4 * FLOATS_PER_VERT;
    for (let i = 0; i < 4; i++) {
      f[o] = v[i * 2]; f[o + 1] = v[i * 2 + 1];
      f[o + 2] = uv[i * 2]; f[o + 3] = uv[i * 2 + 1];
      u[o + 4] = tint; u[o + 5] = flash;
      f[o + 6] = additive;
      o += FLOATS_PER_VERT;
    }
    this.count++;
  }

  /**
   * Draw a (sub-)image centred at (x, y) with rotation (radians) and size.
   * `src` = {texture, u0, v0, u1, v1} or a texture (full image).
   */
  sprite(src, x, y, w, h, rot = 0, tint = 0xffffffff, additive = 0, flash = 0, ax = 0.5, ay = 0.5) {
    const tex = src.texture || src;
    const u0 = src.u0 ?? 0, v0 = src.v0 ?? 0, u1 = src.u1 ?? 1, v1 = src.v1 ?? 1;
    const c = Math.cos(rot), s = Math.sin(rot);
    const l = -w * ax, r = w * (1 - ax), t = -h * ay, b = h * (1 - ay);
    const V = SPR_V, U = SPR_U;
    V[0] = x + l * c - b * s; V[1] = y + l * s + b * c;
    V[2] = x + l * c - t * s; V[3] = y + l * s + t * c;
    V[4] = x + r * c - t * s; V[5] = y + r * s + t * c;
    V[6] = x + r * c - b * s; V[7] = y + r * s + b * c;
    U[0] = u0; U[1] = v1; U[2] = u0; U[3] = v0; U[4] = u1; U[5] = v0; U[6] = u1; U[7] = v1;
    this.quad(tex, V, U, tint, flash, additive);
  }

  /** Solid rectangle, handy for bars and screen flashes. */
  rect(x, y, w, h, tint) {
    this.sprite(this.white, x, y, w, h, 0, tint, 0, 0, 0, 0);
  }
}

const SPR_V = new Float32Array(8);
const SPR_U = new Float32Array(8);

function clamp255(v) {
  v = (v * 255 + 0.5) | 0;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function solidCanvas(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 4, 4);
  return c;
}

export const rgba = Renderer.rgba;
