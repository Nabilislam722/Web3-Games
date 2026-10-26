// A small, dependency-free player for Spine 3.8 JSON exports.
//
// It covers exactly what the Mad Scientist skeletons use: region attachments,
// bone rotate/translate/scale/shear timelines, slot colour/attachment
// timelines and linear/stepped/bezier curves. On top of that it provides an
// AnimationState with multiple tracks, cross-fade mixing and per-track bone
// masks, so e.g. a "shoot" animation can play on the upper body while the
// legs keep walking.

import { rgba } from './gl.js';

const DEG = Math.PI / 180;
const cosDeg = (d) => Math.cos(d * DEG);
const sinDeg = (d) => Math.sin(d * DEG);
const wrapAngle = (r) => r - (16384 - ((16384.499999999996 - r / 360) | 0)) * 360;

// ---------------------------------------------------------------- atlas ----

export function parseAtlas(text) {
  const pages = [];
  const regions = new Map();
  let page = null;
  let region = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { page = null; region = null; continue; }
    if (!page) { page = { name: line, width: 0, height: 0 }; pages.push(page); continue; }
    const colon = line.indexOf(':');
    if (colon < 0) {
      region = { name: line, page, rotate: false, x: 0, y: 0, w: 0, h: 0, ow: 0, oh: 0, ox: 0, oy: 0 };
      regions.set(line, region);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const vals = line.slice(colon + 1).split(',').map((s) => s.trim());
    if (!region) {
      if (key === 'size') { page.width = +vals[0]; page.height = +vals[1]; }
      continue;
    }
    switch (key) {
      case 'rotate': region.rotate = vals[0] === 'true' || vals[0] === '90'; break;
      case 'xy': region.x = +vals[0]; region.y = +vals[1]; break;
      case 'size': region.w = +vals[0]; region.h = +vals[1]; break;
      case 'orig': region.ow = +vals[0]; region.oh = +vals[1]; break;
      case 'offset': region.ox = +vals[0]; region.oy = +vals[1]; break;
    }
  }
  for (const r of regions.values()) {
    if (!r.ow) { r.ow = r.w; r.oh = r.h; }
  }
  return { pages, regions };
}

// -------------------------------------------------------- skeleton data ----

function parseColor(hex) {
  if (!hex) return [1, 1, 1, 1];
  return [0, 2, 4, 6].map((i) => parseInt(hex.substr(i, 2), 16) / 255);
}

/** Region attachment with its quad pre-computed in slot-bone space. */
function makeRegionAttachment(name, a, region, textures) {
  const sx = a.scaleX ?? 1, sy = a.scaleY ?? 1;
  const width = a.width ?? region.ow, height = a.height ?? region.oh;
  const rsx = (width / region.ow) * sx;
  const rsy = (height / region.oh) * sy;
  const lx = (-width / 2) * sx + region.ox * rsx;
  const ly = (-height / 2) * sy + region.oy * rsy;
  const lx2 = lx + region.w * rsx;
  const ly2 = ly + region.h * rsy;
  const r = (a.rotation || 0) * DEG;
  const cos = Math.cos(r), sin = Math.sin(r);
  const x = a.x || 0, y = a.y || 0;
  // BL, UL, UR, BR
  const offset = new Float32Array([
    lx * cos - ly * sin + x, lx * sin + ly * cos + y,
    lx * cos - ly2 * sin + x, lx * sin + ly2 * cos + y,
    lx2 * cos - ly2 * sin + x, lx2 * sin + ly2 * cos + y,
    lx2 * cos - ly * sin + x, lx2 * sin + ly * cos + y,
  ]);
  const pw = region.page.width, ph = region.page.height;
  const u = region.x / pw, v = region.y / ph;
  const u2 = (region.x + (region.rotate ? region.h : region.w)) / pw;
  const v2 = (region.y + (region.rotate ? region.w : region.h)) / ph;
  const uvs = region.rotate
    ? new Float32Array([u2, v2, u, v2, u, v, u2, v])
    : new Float32Array([u, v2, u, v, u2, v, u2, v2]);
  return { name, offset, uvs, texture: textures[region.page.name], width, height };
}

const BONE_TIMELINES = { rotate: 1, translate: 2, scale: 2, shear: 2 };

class Curve {
  // Per-frame curve: 0 = linear, 1 = stepped, otherwise [c1,c2,c3,c4] bezier.
  static parse(kf) {
    const c = kf.curve;
    if (c === undefined) return 0;
    if (c === 'stepped') return 1;
    if (typeof c === 'number') return [c, kf.c2 ?? 0, kf.c3 ?? 1, kf.c4 ?? 1];
    if (Array.isArray(c)) return c;
    return 0;
  }

  static percent(curve, p) {
    if (curve === 0) return p;
    if (curve === 1) return 0;
    // Cubic bezier from (0,0) to (1,1); solve x(t) = p, return y(t).
    const [x1, y1, x2, y2] = curve;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const it = 1 - t;
      const x = 3 * it * it * t * x1 + 3 * it * t * t * x2 + t * t * t - p;
      const dx = 3 * it * it * x1 + 6 * it * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(x) < 1e-5 || !dx) break;
      t = Math.min(1, Math.max(0, t - x / dx));
    }
    const it = 1 - t;
    return 3 * it * it * t * y1 + 3 * it * t * t * y2 + t * t * t;
  }
}

/** Find the keyframe index i such that times[i] <= time < times[i+1]. */
function findFrame(times, time) {
  let i = 0;
  const n = times.length;
  while (i < n - 1 && times[i + 1] <= time) i++;
  return i;
}

export class Animation {
  constructor(name, json, data) {
    this.name = name;
    this.timelines = [];
    let duration = 0;
    for (const [boneName, tls] of Object.entries(json.bones || {})) {
      const bone = data.boneIndex[boneName];
      if (bone === undefined) continue;
      for (const [type, frames] of Object.entries(tls)) {
        if (!BONE_TIMELINES[type]) continue;
        const def = type === 'scale' ? 1 : 0;
        const times = frames.map((f) => f.time || 0);
        const values = type === 'rotate'
          ? frames.map((f) => [f.angle ?? 0])
          : frames.map((f) => [f.x ?? def, f.y ?? def]);
        this.timelines.push({ kind: type, bone, times, values, curves: frames.map(Curve.parse) });
        duration = Math.max(duration, times[times.length - 1]);
      }
    }
    for (const [slotName, tls] of Object.entries(json.slots || {})) {
      const slot = data.slotIndex[slotName];
      if (slot === undefined) continue;
      if (tls.color) {
        const times = tls.color.map((f) => f.time || 0);
        this.timelines.push({
          kind: 'color', slot, times,
          values: tls.color.map((f) => parseColor(f.color)),
          curves: tls.color.map(Curve.parse),
        });
        duration = Math.max(duration, times[times.length - 1]);
      }
      if (tls.attachment) {
        const times = tls.attachment.map((f) => f.time || 0);
        this.timelines.push({ kind: 'attachment', slot, times, names: tls.attachment.map((f) => f.name ?? null) });
        duration = Math.max(duration, times[times.length - 1]);
      }
    }
    this.duration = duration;
  }

  /** Remove timelines, e.g. baked root motion the game drives with physics. */
  strip(boneIndex, kind) {
    this.timelines = this.timelines.filter((t) => !(t.bone === boneIndex && t.kind === kind));
  }

  /**
   * Blend this animation at `time` into the skeleton's current pose by `alpha`.
   * `mask` (Set of bone indices) and `slotMask` (Set of slot indices) restrict
   * which timelines apply.
   */
  apply(skel, time, alpha, mask, slotMask) {
    for (const tl of this.timelines) {
      const times = tl.times;
      if (time < times[0]) continue;
      if (tl.bone !== undefined) {
        if (mask && !mask.has(tl.bone)) continue;
      } else if (slotMask && !slotMask.has(tl.slot)) continue;

      const i = findFrame(times, time);
      const last = i === times.length - 1;
      let p = 0;
      if (!last && tl.kind !== 'attachment') {
        const t0 = times[i], t1 = times[i + 1];
        p = Curve.percent(tl.curves[i], (time - t0) / (t1 - t0));
      }

      switch (tl.kind) {
        case 'rotate': {
          const bone = skel.bones[tl.bone];
          let r = tl.values[i][0];
          if (!last) r += wrapAngle(tl.values[i + 1][0] - r) * p;
          const target = bone.data.rotation + r;
          bone.rotation += wrapAngle(target - bone.rotation) * alpha;
          break;
        }
        case 'translate':
        case 'shear':
        case 'scale': {
          const bone = skel.bones[tl.bone];
          const a = tl.values[i];
          let x = a[0], y = a[1];
          if (!last) {
            const b = tl.values[i + 1];
            x += (b[0] - x) * p;
            y += (b[1] - y) * p;
          }
          if (tl.kind === 'translate') {
            bone.x += (bone.data.x + x - bone.x) * alpha;
            bone.y += (bone.data.y + y - bone.y) * alpha;
          } else if (tl.kind === 'shear') {
            bone.shearX += (bone.data.shearX + x - bone.shearX) * alpha;
            bone.shearY += (bone.data.shearY + y - bone.shearY) * alpha;
          } else {
            bone.scaleX += (bone.data.scaleX * x - bone.scaleX) * alpha;
            bone.scaleY += (bone.data.scaleY * y - bone.scaleY) * alpha;
          }
          break;
        }
        case 'color': {
          const c = skel.slots[tl.slot].color;
          const a = tl.values[i];
          const b = last ? a : tl.values[i + 1];
          for (let k = 0; k < 4; k++) {
            const v = a[k] + (b[k] - a[k]) * p;
            c[k] += (v - c[k]) * alpha;
          }
          break;
        }
        case 'attachment':
          if (alpha >= 0.5) skel.slots[tl.slot].attachmentName = tl.names[i];
          break;
      }
    }
  }
}

export class SkeletonData {
  /**
   * @param json     parsed skeleton.json
   * @param atlas    result of parseAtlas
   * @param textures map of atlas page name -> renderer texture
   */
  constructor(json, atlas, textures) {
    this.json = json;
    this.boneIndex = {};
    this.bones = json.bones.map((b, i) => {
      this.boneIndex[b.name] = i;
      return {
        index: i, name: b.name,
        parent: b.parent !== undefined ? this.boneIndex[b.parent] : -1,
        x: b.x || 0, y: b.y || 0, rotation: b.rotation || 0,
        scaleX: b.scaleX ?? 1, scaleY: b.scaleY ?? 1,
        shearX: b.shearX || 0, shearY: b.shearY || 0,
      };
    });
    this.slotIndex = {};
    this.slots = json.slots.map((s, i) => {
      this.slotIndex[s.name] = i;
      return {
        index: i, name: s.name, bone: this.boneIndex[s.bone],
        color: parseColor(s.color), attachment: s.attachment ?? null,
        additive: s.blend === 'additive',
      };
    });
    // Only the default skin is used by these assets.
    this.attachments = this.slots.map(() => new Map());
    const skins = Array.isArray(json.skins) ? json.skins : [{ name: 'default', attachments: json.skins?.default || {} }];
    for (const skin of skins) {
      for (const [slotName, atts] of Object.entries(skin.attachments || {})) {
        const si = this.slotIndex[slotName];
        if (si === undefined) continue;
        for (const [name, a] of Object.entries(atts)) {
          if (a.type && a.type !== 'region') continue;
          const region = atlas.regions.get(a.path || name);
          if (!region) continue;
          this.attachments[si].set(name, makeRegionAttachment(name, a, region, textures));
        }
      }
    }
    this.animations = {};
    for (const [name, a] of Object.entries(json.animations || {})) {
      this.animations[name] = new Animation(name, a, this);
    }
  }

  /** Bone indices of the named bones and all their descendants. */
  boneSet(...names) {
    const roots = new Set(names.map((n) => this.boneIndex[n]));
    const set = new Set();
    for (const b of this.bones) {
      let p = b.index;
      while (p !== -1) {
        if (roots.has(p)) { set.add(b.index); break; }
        p = this.bones[p].parent;
      }
    }
    return set;
  }
}

// -------------------------------------------------------------- skeleton ----

export class Skeleton {
  constructor(data) {
    this.data = data;
    this.bones = data.bones.map((bd) => ({
      data: bd, parent: null, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
      a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0,
    }));
    for (const b of this.bones) b.parent = b.data.parent >= 0 ? this.bones[b.data.parent] : null;
    this.slots = data.slots.map((sd) => ({ data: sd, color: [1, 1, 1, 1], attachmentName: null }));
    this.setToSetupPose();
  }

  setToSetupPose() {
    for (const b of this.bones) {
      const d = b.data;
      b.x = d.x; b.y = d.y; b.rotation = d.rotation;
      b.scaleX = d.scaleX; b.scaleY = d.scaleY; b.shearX = d.shearX; b.shearY = d.shearY;
    }
    for (const s of this.slots) {
      const c = s.data.color;
      s.color[0] = c[0]; s.color[1] = c[1]; s.color[2] = c[2]; s.color[3] = c[3];
      s.attachmentName = s.data.attachment;
    }
  }

  updateWorldTransform() {
    for (const b of this.bones) {
      const rotY = b.rotation + 90 + b.shearY;
      const la = cosDeg(b.rotation + b.shearX) * b.scaleX;
      const lb = cosDeg(rotY) * b.scaleY;
      const lc = sinDeg(b.rotation + b.shearX) * b.scaleX;
      const ld = sinDeg(rotY) * b.scaleY;
      const p = b.parent;
      if (!p) {
        b.a = la; b.b = lb; b.c = lc; b.d = ld;
        b.worldX = b.x; b.worldY = b.y;
        continue;
      }
      b.worldX = p.a * b.x + p.b * b.y + p.worldX;
      b.worldY = p.c * b.x + p.d * b.y + p.worldY;
      b.a = p.a * la + p.b * lc;
      b.b = p.a * lb + p.b * ld;
      b.c = p.c * la + p.d * lc;
      b.d = p.c * lb + p.d * ld;
    }
  }

  findBone(name) { return this.bones[this.data.boneIndex[name]]; }
  findSlot(name) { return this.slots[this.data.slotIndex[name]]; }

  /** Axis-aligned bounds of all visible attachments in skeleton space. */
  bounds(skip = null) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of this.slots) {
      if (skip && skip.has(s.data.index)) continue;
      const att = s.attachmentName && this.data.attachments[s.data.index].get(s.attachmentName);
      if (!att || s.color[3] <= 0.001) continue;
      const b = this.bones[s.data.bone];
      for (let i = 0; i < 8; i += 2) {
        const ox = att.offset[i], oy = att.offset[i + 1];
        const x = b.a * ox + b.b * oy + b.worldX, y = b.c * ox + b.d * oy + b.worldY;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { x0, y0, x1, y1 };
  }
}

// ------------------------------------------------------ animation state ----

export class AnimationState {
  constructor(data) {
    this.data = data;
    this.tracks = [];
    this.timeScale = 1;
    this.defaultMix = 0.15;
  }

  /**
   * Play `name` on `track`. Options:
   *   loop, mix (cross-fade seconds), timeScale, mask (Set of bones),
   *   slotMask (Set of slots), onComplete(entry), autoFade (seconds; fade the
   *   track out when a non-looping animation finishes), start (seconds).
   */
  set(track, name, { loop = false, mix, timeScale = 1, mask = null, slotMask = null, onComplete = null, autoFade = 0, start = 0 } = {}) {
    const anim = this.data.animations[name];
    if (!anim) throw new Error(`No animation "${name}"`);
    const cur = this.tracks[track] || null;
    const entry = {
      anim, name, loop, timeScale, mask, slotMask, onComplete, autoFade,
      time: start, mixTime: 0, mixDuration: mix ?? this.defaultMix,
      from: cur && !cur.fadeOut ? cur : (cur && cur.alpha() > 0 ? cur : null),
      fadeOut: 0, fadeTime: 0, done: false,
      // Higher tracks without a predecessor fade in over the lower tracks.
      fadeIn: track > 0 && !cur,
      alpha() { return this.fadeOut ? Math.max(0, 1 - this.fadeTime / this.fadeOut) : 1; },
    };
    if (entry.from) entry.from.from = null; // keep at most one level of mixing
    if (!entry.from && !entry.fadeIn) entry.mixDuration = 0;
    this.tracks[track] = entry;
    return entry;
  }

  /** Is `name` currently the active animation on `track`? */
  is(track, name) {
    const t = this.tracks[track];
    return !!t && !t.fadeOut && t.name === name;
  }

  current(track) {
    const t = this.tracks[track];
    return t && !t.fadeOut ? t : null;
  }

  /** Fade a track out over `duration` seconds. */
  clear(track, duration = 0.15) {
    const t = this.tracks[track];
    if (!t) return;
    if (duration <= 0) { this.tracks[track] = null; return; }
    if (!t.fadeOut) { t.fadeOut = duration; t.fadeTime = 0; }
  }

  update(dt) {
    dt *= this.timeScale;
    for (let i = 0; i < this.tracks.length; i++) {
      const e = this.tracks[i];
      if (!e) continue;
      const d = e.anim.duration;
      const prev = e.time;
      e.time += dt * e.timeScale;
      e.mixTime += dt;
      if (e.from) {
        e.from.time += dt * e.from.timeScale;
        if (e.mixTime >= e.mixDuration) e.from = null;
      }
      if (e.fadeOut) {
        e.fadeTime += dt;
        if (e.fadeTime >= e.fadeOut) { this.tracks[i] = null; continue; }
      }
      if (d > 0 && !e.done) {
        const completed = e.loop ? Math.floor(e.time / d) > Math.floor(prev / d) : e.time >= d;
        if (completed) {
          if (!e.loop) e.done = true;
          if (e.onComplete) e.onComplete(e);
          if (!e.loop && e.autoFade && this.tracks[i] === e) this.clear(i, e.autoFade);
        }
      }
    }
  }

  static localTime(e) {
    const d = e.anim.duration;
    if (d <= 0) return 0;
    return e.loop ? ((e.time % d) + d) % d : Math.min(e.time, d);
  }

  apply(skel) {
    for (const e of this.tracks) {
      if (!e) continue;
      const mix = e.mixDuration > 0 ? Math.min(1, e.mixTime / e.mixDuration) : 1;
      const fade = e.alpha();
      if (e.from) {
        e.from.anim.apply(skel, AnimationState.localTime(e.from), e.from.alpha() * fade, e.from.mask, e.from.slotMask);
      }
      const alpha = (e.from || e.fadeIn ? mix : 1) * fade;
      e.anim.apply(skel, AnimationState.localTime(e), alpha, e.mask, e.slotMask);
    }
  }
}

// ------------------------------------------------------------- drawing ----

const QV = new Float32Array(8);

/**
 * Draw a posed skeleton.
 *   x, y       screen position of the skeleton origin
 *   scaleX/Y   scale (negative scaleX mirrors horizontally)
 *   tint       [r,g,b,a] multiplied into every slot colour
 *   flash      packed RGBA flash colour (alpha = amount)
 *   skip       optional Set of slot indices not to draw
 */
export function drawSkeleton(renderer, skel, x, y, scaleX, scaleY = Math.abs(scaleX), tint = null, flash = 0, skip = null) {
  const sx = scaleX;
  const sy = -scaleY; // Spine is y-up, the screen is y-down
  const tr = tint ? tint[0] : 1, tg = tint ? tint[1] : 1, tb = tint ? tint[2] : 1, ta = tint ? tint[3] : 1;
  const atts = skel.data.attachments;
  for (const slot of skel.slots) {
    const sd = slot.data;
    if (!slot.attachmentName || (skip && skip.has(sd.index))) continue;
    const c = slot.color;
    const a = c[3] * ta;
    if (a <= 0.003) continue;
    const att = atts[sd.index].get(slot.attachmentName);
    if (!att) continue;
    const bone = skel.bones[sd.bone];
    const o = att.offset;
    for (let i = 0; i < 8; i += 2) {
      const lx = bone.a * o[i] + bone.b * o[i + 1] + bone.worldX;
      const ly = bone.c * o[i] + bone.d * o[i + 1] + bone.worldY;
      QV[i] = x + lx * sx;
      QV[i + 1] = y + ly * sy;
    }
    renderer.quad(att.texture, QV, att.uvs, rgba(c[0] * tr, c[1] * tg, c[2] * tb, a), flash, sd.additive ? 1 : 0);
  }
}

/** Draw a single attachment centred on (cx, cy), e.g. a detached ground shadow. */
export function drawAttachment(renderer, att, cx, cy, sx, sy, tint = 0xffffffff) {
  const o = att.offset;
  const ox = (o[0] + o[2] + o[4] + o[6]) / 4, oy = (o[1] + o[3] + o[5] + o[7]) / 4;
  for (let i = 0; i < 8; i += 2) {
    QV[i] = cx + (o[i] - ox) * sx;
    QV[i + 1] = cy - (o[i + 1] - oy) * sy;
  }
  renderer.quad(att.texture, QV, att.uvs, tint, 0, 0);
}

/** Return the world-space (skeleton space, y-up) position of a bone. */
export function bonePosition(skel, name, out = { x: 0, y: 0 }) {
  const b = skel.findBone(name);
  out.x = b.worldX; out.y = b.worldY;
  return out;
}

// --------------------------------------------------------------- loading ----

/**
 * Load a Spine export directory (skeleton.json + skeleton.atlas + pages).
 * `dir` must end with '/'.
 */
export async function loadSkeletonData(renderer, dir, loadImage) {
  const [json, atlasText] = await Promise.all([
    fetch(encodeURI(dir + 'skeleton.json')).then((r) => r.json()),
    fetch(encodeURI(dir + 'skeleton.atlas')).then((r) => r.text()),
  ]);
  const atlas = parseAtlas(atlasText);
  const textures = {};
  await Promise.all(atlas.pages.map(async (p) => {
    const img = await loadImage(dir + p.name);
    textures[p.name] = renderer.createTexture(img);
  }));
  return new SkeletonData(json, atlas, textures);
}
