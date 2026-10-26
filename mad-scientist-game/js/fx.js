// Visual effects: procedurally generated textures, a pooled particle system,
// floating text and one-shot Spine effects (muzzle flashes, impacts...).

import { rgba } from './gl.js';
import { Skeleton, AnimationState, drawSkeleton } from './spine.js';
import { rand, ease, lerp } from './util.js';

function canvasTexture(renderer, w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  return renderer.createTexture(c);
}

export function makeTextures(renderer) {
  const radial = (stops) => (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  };
  return {
    glow: canvasTexture(renderer, 128, 128, radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']])),
    puff: canvasTexture(renderer, 64, 64, radial([[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']])),
    ring: canvasTexture(renderer, 128, 128, (g) => {
      g.strokeStyle = '#fff';
      g.shadowColor = '#fff';
      g.shadowBlur = 8;
      g.lineWidth = 7;
      g.beginPath();
      g.arc(64, 64, 52, 0, Math.PI * 2);
      g.stroke();
    }),
    spark: canvasTexture(renderer, 64, 16, (g) => {
      const gr = g.createLinearGradient(0, 0, 64, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.7, 'rgba(255,255,255,.9)');
      gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(32, 8, 32, 6, 0, 0, Math.PI * 2);
      g.fill();
    }),
    shard: canvasTexture(renderer, 32, 32, (g) => {
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(16, 0); g.lineTo(27, 16); g.lineTo(16, 32); g.lineTo(5, 16);
      g.closePath();
      g.fill();
    }),
    vignette: canvasTexture(renderer, 256, 256, radial([[0, 'rgba(0,0,0,0)'], [0.62, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']])),
  };
}

// ------------------------------------------------------------- glyphs ----

const GLYPHS = '0123456789+-x!%ABCDEFGHIJKLMNOPQRSTUVWXYZ ';

export class GlyphFont {
  constructor(renderer, family = '"Luckiest Guy", Impact, sans-serif') {
    const size = 64, pad = 10;
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    g.font = `${size}px ${family}`;
    const widths = [...GLYPHS].map((ch) => Math.ceil(g.measureText(ch).width) + pad * 2);
    const perRow = 21;
    const cellH = size + pad * 2 + 8;
    c.width = 1400;
    c.height = cellH * Math.ceil(GLYPHS.length / perRow);
    g.font = `${size}px ${family}`;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    this.glyphs = {};
    let x = 0, y = 0;
    [...GLYPHS].forEach((ch, i) => {
      if (i && i % perRow === 0) { x = 0; y += cellH; }
      const w = widths[i];
      g.lineWidth = 10;
      g.strokeStyle = '#1b1024';
      g.strokeText(ch, x + pad, y + cellH / 2 + 4);
      g.fillStyle = '#fff';
      g.fillText(ch, x + pad, y + cellH / 2 + 4);
      this.glyphs[ch] = { x, y, w, h: cellH };
      x += w;
    });
    this.texture = renderer.createTexture(c);
    this.cw = c.width;
    this.ch = c.height;
    this.size = size;
    this.pad = pad;
  }

  measure(text, size) {
    const s = size / this.size;
    let w = 0;
    for (const ch of text) w += ((this.glyphs[ch]?.w || 0) - this.pad * 2 + 2) * s;
    return w;
  }

  draw(r, text, x, y, size, tint = 0xffffffff, rot = 0) {
    const s = size / this.size;
    let cx = x - this.measure(text, size) / 2;
    const src = { texture: this.texture, u0: 0, v0: 0, u1: 0, v1: 0 };
    for (const ch of text) {
      const gl = this.glyphs[ch];
      if (!gl) continue;
      src.u0 = gl.x / this.cw; src.u1 = (gl.x + gl.w) / this.cw;
      src.v0 = gl.y / this.ch; src.v1 = (gl.y + gl.h) / this.ch;
      const w = gl.w * s;
      r.sprite(src, cx + w / 2 - this.pad * s, y, w, gl.h * s, rot, tint);
      cx += (gl.w - this.pad * 2 + 2) * s;
    }
  }
}

// ---------------------------------------------------------- particles ----

export class Particles {
  constructor(textures) {
    this.tex = textures;
    this.list = [];
    this.pool = [];
  }

  /**
   * Spawn a particle. Notable fields: life, size/size1, color/color1 [r,g,b],
   * alpha/alpha1, gravity, drag, add (additive), stretch (velocity-aligned),
   * front (draw over actors).
   */
  spawn(o) {
    const p = this.pool.pop() || {};
    p.x = o.x; p.y = o.y;
    p.vx = o.vx || 0; p.vy = o.vy || 0;
    p.gravity = o.gravity || 0;
    p.drag = o.drag || 0;
    p.life = o.life || 0.5;
    p.t = 0;
    p.size = o.size || 20;
    p.size1 = o.size1 ?? p.size;
    p.rot = o.rot ?? rand(0, Math.PI * 2);
    p.vr = o.vr || 0;
    p.color = o.color || [1, 1, 1];
    p.color1 = o.color1 || p.color;
    p.alpha = o.alpha ?? 1;
    p.alpha1 = o.alpha1 ?? 0;
    p.tex = o.tex || this.tex.puff;
    p.add = o.add ?? 1;
    p.stretch = o.stretch || 0;
    p.front = o.front ?? 1;
    p.floor = o.floor ?? Infinity;
    p.aspect = o.aspect || 1;
    this.list.push(p);
    return p;
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.t += dt;
      if (p.t >= p.life) {
        L[i] = L[L.length - 1];
        L.pop();
        this.pool.push(p);
        continue;
      }
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy *= k;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y > p.floor) { p.y = p.floor; p.vy *= -0.35; p.vx *= 0.7; }
      p.rot += p.vr * dt;
    }
  }

  draw(r, front) {
    for (const p of this.list) {
      if (p.front !== front) continue;
      const k = p.t / p.life;
      const e = ease.outQuad(k);
      const size = lerp(p.size, p.size1, e);
      const a = lerp(p.alpha, p.alpha1, k);
      const c = p.color, c1 = p.color1;
      const tint = rgba(lerp(c[0], c1[0], k), lerp(c[1], c1[1], k), lerp(c[2], c1[2], k), a);
      if (p.stretch) {
        const sp = Math.hypot(p.vx, p.vy);
        const len = Math.max(size, sp * p.stretch);
        r.sprite(this.tex.spark, p.x, p.y, len, size * 0.45, Math.atan2(p.vy, p.vx), tint, p.add, 0, 0.9, 0.5);
      } else {
        r.sprite(p.tex, p.x, p.y, size, size * p.aspect, p.rot, tint, p.add);
      }
    }
  }

  clear() {
    this.pool.push(...this.list);
    this.list.length = 0;
  }

  // ------------------------------------------------------------ recipes --

  sparks(x, y, dir, color, n = 8, speed = 600, spread = 0.9) {
    for (let i = 0; i < n; i++) {
      const a = (dir < 0 ? Math.PI : 0) + rand(-spread, spread);
      const s = rand(0.35, 1) * speed;
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, gravity: 900, drag: 3, life: rand(0.2, 0.45), size: rand(10, 18), stretch: 0.05, color: [1, 1, 1], color1: color, alpha: 1, alpha1: 0 });
    }
  }

  glow(x, y, size, color, life = 0.18, alpha = 0.9) {
    this.spawn({ x, y, tex: this.tex.glow, size, size1: size * 1.4, color, life, alpha, alpha1: 0 });
  }

  ring(x, y, size, color, life = 0.35, front = 1) {
    this.spawn({ x, y, tex: this.tex.ring, size: size * 0.2, size1: size, color, life, alpha: 0.9, alpha1: 0, rot: 0, front });
  }

  dust(x, y, n = 6, spread = 80, color = [0.75, 0.82, 0.88]) {
    for (let i = 0; i < n; i++) {
      const s = rand(-1, 1);
      this.spawn({
        x: x + s * 18, y: y - 4, vx: s * spread * rand(0.6, 1.4), vy: rand(-70, -20), drag: 4,
        life: rand(0.35, 0.6), size: rand(18, 30), size1: rand(45, 70), color, alpha: 0.35, alpha1: 0, add: 0, front: 0,
      });
    }
  }

  explosion(x, y, radius) {
    const k = radius / 150;
    this.glow(x, y, 520 * k, [1, 0.7, 0.3], 0.3, 1);
    this.ring(x, y, radius * 2.6, [1, 0.85, 0.55], 0.4);
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2), s = rand(80, 420) * k;
      this.spawn({
        x: x + Math.cos(a) * 20, y: y + Math.sin(a) * 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, drag: 3.5,
        life: rand(0.45, 0.8), size: rand(50, 80) * k, size1: rand(110, 170) * k,
        color: [1, 0.85, 0.4], color1: [0.35, 0.3, 0.3], alpha: 0.95, alpha1: 0, add: 0, vr: rand(-2, 2),
      });
    }
    for (let i = 0; i < 10; i++) {
      this.spawn({
        x: x + rand(-30, 30) * k, y: y + rand(-20, 10) * k, vx: rand(-60, 60), vy: rand(-140, -60), drag: 1.5,
        life: rand(0.9, 1.4), size: rand(60, 90) * k, size1: rand(150, 220) * k,
        color: [0.25, 0.25, 0.28], alpha: 0.45, alpha1: 0, add: 0, front: 1, vr: rand(-1, 1),
      });
    }
    this.sparks(x, y, 1, [1, 0.6, 0.2], 10, 900 * k, Math.PI);
  }

  shards(x, y, color, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0), s = rand(200, 520);
      this.spawn({
        x: x + rand(-20, 20), y: y + rand(-30, 30), vx: Math.cos(a) * s, vy: Math.sin(a) * s, gravity: 1400,
        life: rand(0.5, 0.9), size: rand(10, 22), aspect: 1.6, tex: this.tex.shard, color, alpha: 1, alpha1: 0.4,
        add: 0, vr: rand(-12, 12), floor: y + 60,
      });
    }
  }

  burst(x, y, color, n = 10, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
      this.spawn({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 5, life: 0.45, size: 14, size1: 4, color, alpha: 1, alpha1: 0 });
    }
  }
}

// ---------------------------------------------------- floating text ----

export class Popups {
  constructor(font) {
    this.font = font;
    this.list = [];
  }

  add(x, y, text, color = [1, 1, 1], size = 34, life = 0.8) {
    this.list.push({ x, y, text: String(text), color, size, life, t: 0, vx: rand(-40, 40), vy: -220 });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.vy *= Math.exp(-4 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t >= p.life) this.list.splice(i, 1);
    }
  }

  draw(r) {
    for (const p of this.list) {
      const k = p.t / p.life;
      const pop = p.t < 0.15 ? ease.outBack(p.t / 0.15) : 1;
      const a = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      const c = p.color;
      this.font.draw(r, p.text, p.x, p.y, p.size * pop, rgba(c[0], c[1], c[2], a));
    }
  }
}

// ------------------------------------------------------- spine effects ----

/** A short-lived Spine animation placed in the world (removed when done). */
export class SpineFx {
  /**
   * anchor: 'center' | 'left' — which point of the export bounds is placed
   * at (x, y). `follow` is an optional callback returning {x, y}.
   */
  constructor(data, anim, x, y, { scale = 1, scaleX = 1, rot = 0, flip = false, anchor = 'center', speed = 1, loop = false, life = 0, tint = null, follow = null } = {}) {
    this.skel = new Skeleton(data);
    this.state = new AnimationState(data);
    this.state.set(0, anim, { loop, timeScale: speed });
    const sk = data.json.skeleton;
    this.ax = anchor === 'left' ? sk.x : sk.x + sk.width / 2;
    this.ay = sk.y + sk.height / 2;
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.scaleX = scaleX;
    this.rot = rot;
    this.flip = flip;
    this.tint = tint;
    this.follow = follow;
    this.duration = life || data.animations[anim].duration / speed;
    this.t = 0;
    this.dead = false;
  }

  update(dt) {
    this.t += dt;
    this.state.update(dt);
    if (this.follow) {
      const p = this.follow();
      if (p) { this.x = p.x; this.y = p.y; }
    }
    if (this.t >= this.duration) this.dead = true;
  }

  draw(r) {
    const skel = this.skel;
    skel.setToSetupPose();
    this.state.apply(skel);
    // Stretch/rotate through the root bone, then pin the anchor to (x, y).
    const root = skel.bones[0];
    if (this.rot) root.rotation += this.rot;
    if (this.scaleX !== 1) root.scaleX *= this.scaleX;
    skel.updateWorldTransform();
    const lx = this.ax - root.data.x, ly = this.ay - root.data.y;
    const wx = root.a * lx + root.b * ly + root.worldX, wy = root.c * lx + root.d * ly + root.worldY;
    const s = this.scale, sx = this.flip ? -s : s;
    drawSkeleton(r, skel, this.x - wx * sx, this.y + wy * s, sx, s, this.tint);
  }
}
