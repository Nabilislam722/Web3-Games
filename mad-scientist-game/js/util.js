export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

/** Frame-rate independent exponential smoothing towards `b`. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const ease = {
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inCubic: (t) => t * t * t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

/** Damped spring; great for squash & stretch, recoil and UI wobble. */
export class Spring {
  constructor(stiffness = 320, damping = 18, value = 0) {
    this.k = stiffness;
    this.d = damping;
    this.x = value;
    this.v = 0;
    this.target = value;
  }

  kick(v) { this.v += v; }

  update(dt) {
    const f = -this.k * (this.x - this.target) - this.d * this.v;
    this.v += f * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/** Smooth 1D noise in [-1, 1] built from incommensurate sines. */
export function wobble(t, seed = 0) {
  return (
    Math.sin(t * 13.7 + seed) * 0.5 +
    Math.sin(t * 27.1 + seed * 1.7) * 0.3 +
    Math.sin(t * 43.3 + seed * 2.9) * 0.2
  );
}

/** Does the segment (x0,y0)->(x1,y1), thickened by r, touch the box? */
export function segmentHitsBox(x0, y0, x1, y1, r, bx, by, bw, bh) {
  const minX = bx - r, maxX = bx + bw + r, minY = by - r, maxY = by + bh + r;
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, x0 - minX) && clip(dx, maxX - x0) && clip(-dy, y0 - minY) && clip(dy, maxY - y0);
}

export function loadProfile() {
  const fallback = { potions: 0, best: 0, unlocked: ['Gun01'], equipped: 'Gun01', muted: false, tutorial: true };
  try {
    const raw = localStorage.getItem('madsci.profile.v1');
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveProfile(p) {
  try { localStorage.setItem('madsci.profile.v1', JSON.stringify(p)); } catch { /* private mode */ }
}
