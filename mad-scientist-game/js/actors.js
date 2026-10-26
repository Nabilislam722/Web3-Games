// The mad scientist and his hazmat-suited adversaries.

import { Skeleton, AnimationState, drawSkeleton, drawAttachment } from './spine.js';
import { rgba } from './gl.js';
import { GROUND_Y, HERO_SCALE, ENEMY_SCALE } from './data.js';
import { clamp, rand, pick, Spring, damp, lerp } from './util.js';

const DEG = Math.PI / 180;
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));

/** Per-skeleton measurements, cached on the SkeletonData. */
function meta(data) {
  if (data._meta) return data._meta;
  const skel = new Skeleton(data);
  skel.updateWorldTransform();
  const skip = new Set();
  let shadow = null, ax = 0, ay = 0;
  data.slots.forEach((s) => {
    if (/^box$/i.test(s.name)) skip.add(s.index);
    if (/shadow/i.test(s.name) && s.attachment) {
      skip.add(s.index);
      shadow = data.attachments[s.index].get(s.attachment);
      const b = skel.bones[s.bone], o = shadow.offset;
      const cx = (o[0] + o[2] + o[4] + o[6]) / 4, cy = (o[1] + o[3] + o[5] + o[7]) / 4;
      ax = b.a * cx + b.b * cy + b.worldX;
      ay = b.c * cx + b.d * cy + b.worldY;
    }
  });
  const bb = skel.bounds(skip);
  if (!shadow) { ax = (bb.x0 + bb.x1) / 2; ay = (bb.y0 + bb.y1) / 2; }
  data._meta = {
    ax, ay, shadow, skip,
    top: bb.y1 - ay, bottom: bb.y0 - ay, left: bb.x0 - ax, right: bb.x1 - ax,
    width: clamp((bb.x1 - bb.x0) * 0.5, 60, 150),
  };
  return data._meta;
}

class Actor {
  constructor(game, data, scale) {
    this.game = game;
    this.data = data;
    this.skel = new Skeleton(data);
    this.state = new AnimationState(data);
    this.m = meta(data);
    this.scale = scale;
    this.x = 0;
    this.y = GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.faceX = 1; // animated towards `facing` for a smooth paper-flip turn
    this.flashT = 0;
    this.alpha = 1;
    this.tilt = 0;
    this.squash = new Spring(420, 15);
    this.t = rand(0, 10);
  }

  /** Art faces right (hero) or left (enemies). */
  get artFlip() { return false; }

  get sx() {
    return this.scale * (1 + this.squash.x * 0.55) * (this.artFlip ? -this.faceX : this.faceX);
  }

  turn(dt) {
    this.faceX = approach(this.faceX, this.facing, dt * 11);
  }

  get sy() { return this.scale * (1 - this.squash.x); }

  pose() {
    const s = this.skel;
    s.setToSetupPose();
    this.state.apply(s);
    if (this.tilt) s.bones[0].rotation += this.tilt;
    this.adjustPose(s);
    s.updateWorldTransform();
  }

  adjustPose() {}

  /** Skeleton space (y-up) -> world space. */
  toWorld(lx, ly, out = {}) {
    out.x = this.x + (lx - this.m.ax) * this.sx;
    out.y = this.y - (ly - this.m.ay) * this.sy;
    return out;
  }

  boneWorld(name, out = {}) {
    const b = this.skel.findBone(name);
    return this.toWorld(b.worldX, b.worldY, out);
  }

  /** Hit box in world space. */
  box() {
    const m = this.m, s = this.scale;
    const w = m.width * s;
    const top = this.y - m.top * s, bottom = this.y - m.bottom * s;
    const h = (bottom - top) * 0.92;
    return { x: this.x - w / 2, y: bottom - h, w, h };
  }

  get top() { return this.y - this.m.top * this.scale; }

  drawShadow(r) {
    const h = clamp((GROUND_Y - this.y) / 420, 0, 1);
    const k = (1 - h * 0.55) * this.alpha;
    if (this.m.shadow) {
      drawAttachment(r, this.m.shadow, this.x, GROUND_Y, this.scale * (1 - h * 0.4), this.scale * (1 - h * 0.4), rgba(1, 1, 1, k));
    } else {
      const w = this.m.width * this.scale * 1.3 * (1 - h * 0.35);
      r.sprite(this.game.tex.puff, this.x, GROUND_Y, w, w * 0.22, 0, rgba(0, 0, 0, 0.45 * k));
    }
  }

  drawBody(r, tint) {
    const m = this.m, sx = this.sx, sy = this.sy;
    const flash = this.flashT > 0 ? rgba(1, 1, 1, Math.min(1, this.flashT / 0.08) * 0.6) : 0;
    drawSkeleton(r, this.skel, this.x - m.ax * sx, this.y + m.ay * sy, sx, sy, tint, flash, m.skip);
  }
}

// ---------------------------------------------------------------- hero ----

export class Hero extends Actor {
  constructor(game, data, weapon) {
    super(game, data, HERO_SCALE);
    this.upper = data.boneSet('Body', 'Gun', 'Splash');
    this.setWeapon(data, weapon);
    this.maxHp = 100;
    this.hp = 100;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.fireCd = 0;
    this.bombCd = 0;
    this.bombs = 3;
    this.invuln = 0;
    this.dead = false;
    this.rage = 0;
    this.recoil = new Spring(520, 24);
    this.aim = 0; // degrees the gun arm is raised towards the current target
    this.throwing = null;
    this.stepPhase = 0;
    this.control = 'player'; // 'player' | 'auto'
    this.autoAxis = 0;
    this.autoFire = false;
    this.minX = -Infinity;
    this.maxX = Infinity;
    this.state.set(0, 'Idle', { loop: true });
  }

  setWeapon(data, weapon) {
    if (data !== this.data) {
      this.data = data;
      this.skel = new Skeleton(data);
      const old = this.state;
      this.state = new AnimationState(data);
      this.m = meta(data);
      this.upper = data.boneSet('Body', 'Gun', 'Splash');
      const base = old.current(0);
      this.state.set(0, base ? base.name : 'Idle', { loop: base ? base.loop : true });
      this.throwing = null;
    }
    this.weapon = weapon;
    this.aimBone = data.boneIndex.Hand_W_gun;
    // Barrel tip in the gun bone's local space.
    const si = data.slotIndex.Hand_W_Gun;
    const att = data.json.skins[0].attachments.Hand_W_Gun.Hand_W_Gun;
    const px = -att.width / 2 + weapon.muzzle[0] * att.width;
    const py = -att.height / 2 + weapon.muzzle[1] * att.height;
    const r = (att.rotation || 0) * DEG;
    this.muzzle = {
      bone: data.slots[si].bone,
      x: att.x + px * Math.cos(r) - py * Math.sin(r),
      y: att.y + px * Math.sin(r) + py * Math.cos(r),
    };
    this.pose();
  }

  muzzleWorld(out = {}) {
    const b = this.skel.bones[this.muzzle.bone], mx = this.muzzle.x, my = this.muzzle.y;
    this.toWorld(b.a * mx + b.b * my + b.worldX, b.c * mx + b.d * my + b.worldY, out);
    out.x += this.recoil.x * this.facing * 0.5;
    return out;
  }

  get chestY() { return this.y - 85; }

  adjustPose(s) {
    if (this.aim) s.bones[this.aimBone].rotation += this.aim;
  }

  /** Nearest live enemy in front of the hero, if any. */
  aimTarget() {
    const g = this.game;
    let best = null, bestD = Infinity;
    for (const e of g.enemies) {
      if (e.dead) continue;
      const dx = (e.x - this.x) * this.facing;
      if (dx < 20 || dx > 950 || e.x < g.cam.x - 20 || e.x > g.cam.x + g.viewW + 20) continue;
      const d = Math.hypot(dx, e.y - this.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  updateAim(dt) {
    let want = 0;
    const t = !this.dead && this.weapon.kind !== 'punch' ? this.aimTarget() : null;
    if (t) {
      const b = t.box();
      const sx = this.x + this.facing * 60, sy = this.y - 100;
      const ang = (Math.atan2(sy - (b.y + b.h * 0.45), Math.abs(b.x + b.w / 2 - sx)) * 180) / Math.PI;
      want = Math.abs(ang) < 8 ? 0 : clamp(ang, -12, 42);
    }
    this.aim = damp(this.aim, want, 12, dt);
  }

  update(dt, input) {
    const g = this.game;
    this.t += dt;
    this.invuln -= dt;
    this.fireCd -= dt;
    this.bombCd -= dt;
    this.flashT -= dt;
    if (this.rage > 0) this.rage = Math.max(0, this.rage - dt);

    let ax = 0, jump = false, jumpHeld = false, fire = false, bomb = false;
    if (!this.dead) {
      if (this.control === 'player') {
        ax = input.axis;
        jump = input.pressed('jump');
        jumpHeld = input.isDown('jump');
        fire = input.isDown('fire');
        bomb = input.pressed('bomb');
      } else {
        ax = this.autoAxis;
        fire = this.autoFire;
      }
    }

    if (ax !== 0) this.facing = Math.sign(ax);
    this.turn(dt);
    this.updateAim(dt);

    const maxSpeed = 330;
    const target = ax * maxSpeed;
    const accel = this.grounded ? (Math.abs(target) > Math.abs(this.vx) ? 2400 : 3000) : 1500;
    this.vx = approach(this.vx, target, accel * dt);

    if (jump) this.jumpBuffer = 0.13;
    this.jumpBuffer -= dt;
    this.coyote = this.grounded ? 0.09 : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vy = -1120;
      this.grounded = false;
      this.coyote = this.jumpBuffer = 0;
      this.squash.kick(-5);
      this.state.set(0, 'Jump', { mix: 0.08, timeScale: 1.7 });
      g.particles.dust(this.x, GROUND_Y, 5, 90);
      g.sfx('jump');
    }

    if (!this.grounded) {
      this.vy += (this.vy < 0 ? (jumpHeld || this.control !== 'player' ? 2700 : 5200) : 3400) * dt;
      this.y += this.vy * dt;
      if (this.y >= GROUND_Y) {
        const impact = this.vy;
        this.y = GROUND_Y;
        this.vy = 0;
        this.grounded = true;
        this.squash.kick(Math.min(7, impact / 150));
        g.particles.dust(this.x, GROUND_Y, 8, 140);
        g.sfx('land');
        this.state.set(0, Math.abs(this.vx) > 40 ? 'Walk' : 'Idle', { loop: true, mix: 0.12 });
      }
    }

    this.x = clamp(this.x + this.vx * dt, this.minX, this.maxX);

    if (!this.dead && this.grounded) {
      const speed = Math.abs(this.vx);
      if (speed > 40) {
        if (!this.state.is(0, 'Walk')) this.state.set(0, 'Walk', { loop: true, mix: 0.16 });
        const backwards = Math.sign(this.vx) !== this.facing;
        this.state.tracks[0].timeScale = clamp(speed / maxSpeed, 0.45, 1) * 1.6 * (backwards ? -0.85 : 1);
        const before = this.stepPhase;
        this.stepPhase = (this.stepPhase + dt * speed / 120) % 2;
        if (Math.floor(before) !== Math.floor(this.stepPhase)) {
          g.particles.dust(this.x - this.facing * 10, GROUND_Y, 2, 40);
          g.sfx('step');
        }
      } else if (!this.state.is(0, 'Idle')) {
        this.state.set(0, 'Idle', { loop: true, mix: 0.22 });
      }
    }

    // Weapons.
    if (this.throwing && this.state.tracks[1] !== this.throwing) {
      if (!this.thrown) this.bombs++; // interrupted before release: refund
      this.throwing = null;
    }
    if (!this.dead) {
      if (fire && this.fireCd <= 0 && !this.throwing) this.shoot();
      if (bomb) this.throwBomb();
      if (this.throwing && !this.thrown && this.throwing.time >= 0.66) this.releaseBomb();
    }

    this.state.update(dt);
    this.squash.update(dt);
    this.recoil.update(dt);
    this.pose();

    if (this.rage > 0 && Math.random() < dt * 30) {
      g.particles.spawn({
        x: this.x + rand(-30, 30), y: this.y - rand(20, 140), vy: rand(-140, -60), life: 0.5,
        size: rand(16, 26), size1: 4, color: [1, 0.3, 0.2], alpha: 0.8, alpha1: 0,
      });
    }
  }

  shoot() {
    const g = this.game, w = this.weapon;
    this.fireCd = w.rate;
    this.state.set(1, w.anim, { mask: this.upper, mix: 0.04, autoFade: 0.14, timeScale: Math.max(1, 0.17 / w.rate) });
    const m = this.muzzleWorld();
    this.recoil.kick(-w.recoil * 6);
    if (this.grounded) this.vx -= this.facing * w.recoil * 0.5;
    g.heroFire(this, m.x, m.y, this.facing, w, this.aim);
  }

  throwBomb() {
    const g = this.game;
    if (this.throwing || this.bombCd > 0) return;
    if (this.bombs <= 0) { g.sfx('deny'); g.ui.bombDenied(); return; }
    this.bombs--;
    this.bombCd = 0.8;
    this.thrown = false;
    this.throwing = this.state.set(1, 'ThrowBomb', { mask: this.upper, mix: 0.1, timeScale: 1.6, autoFade: 0.18 });
    g.sfx('throw');
    g.ui.updateBombs();
  }

  releaseBomb() {
    this.thrown = true;
    const p = this.boneWorld('HandB');
    this.game.spawnBomb(p.x + this.facing * 20, p.y - 30, this.facing * 640 + this.vx * 0.4, -760);
  }

  hurt(dmg, dir) {
    const g = this.game;
    if (this.invuln > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = 1.1;
    this.flashT = 0.12;
    this.vx += dir * 520;
    this.squash.kick(3);
    this.state.set(1, 'GetHit', { mask: this.upper, mix: 0.04, autoFade: 0.16 });
    g.onHeroHurt(dmg);
    if (this.hp <= 0) this.die();
    return true;
  }

  heal(n) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  die() {
    this.dead = true;
    this.vx *= 0.3;
    this.state.clear(1, 0.1);
    this.state.set(0, 'Death', { mix: 0.12 });
    this.game.onHeroDeath();
  }

  draw(r) {
    let a = this.alpha;
    if (this.invuln > 0 && !this.dead) a *= 0.62 + 0.38 * Math.cos(this.t * 32);
    let tint = null;
    if (this.rage > 0) {
      const p = 0.5 + 0.5 * Math.sin(this.t * 14);
      tint = [1, 0.72 + 0.2 * p, 0.66 + 0.2 * p, a];
    } else if (a < 1) tint = [1, 1, 1, a];
    // Visual recoil: shift the whole body against the shot.
    const x = this.x;
    this.x += this.recoil.x * this.facing * 0.5;
    this.drawBody(r, tint);
    this.x = x;
  }
}

// -------------------------------------------------------------- enemies ----

export class Enemy extends Actor {
  constructor(game, key, data, def, { x, y = GROUND_Y, elite = false, hpMul = 1, dmgMul = 1 }) {
    super(game, data, ENEMY_SCALE * (elite ? 1.2 : 1));
    this.key = key;
    this.def = def;
    this.kind = def.kind;
    this.elite = elite;
    this.maxHp = this.hp = def.hp * hpMul * (elite ? 2.6 : 1);
    this.hpShow = this.hp;
    this.dmg = def.dmg * dmgMul * (elite ? 1.3 : 1);
    this.x = x;
    this.y = y;
    this.facing = this.faceX = -1;
    this.ai = 'move';
    this.cd = rand(0.6, 1.4);
    this.reach = (def.reach || 0) + rand(-10, 12);
    this.prefer = def.range ? rand(def.range[0], def.range[1]) : 0;
    this.freezeMeter = 0;
    this.freezeT = 0;
    this.stunT = 0;
    this.dots = [];
    this.barT = 0;
    this.dead = false;
    this.deadT = 0;
    this.remove = false;
    this.entered = false;
    this.anim = {
      move: data.animations.Walk ? 'Walk' : data.animations.MovingNIdle ? 'MovingNIdle' : 'MovingAndIdle',
      idle: data.animations.Idle ? 'Idle' : data.animations.MovingNIdle ? 'MovingNIdle' : 'MovingAndIdle',
      death: data.animations.Death ? 'Death' : 'Destroyed',
    };
    if (this.kind === 'drone') {
      this.hoverY = GROUND_Y - def.hover + rand(-40, 40);
      this.side = Math.random() < 0.5 ? -1 : 1;
      this.sideT = rand(3, 6);
      this.low = false;
      this.swoopT = rand(4, 7);
    }
    this.state.set(0, this.anim.move, { loop: true, start: rand(0, 1) });
  }

  get artFlip() { return true; }

  get frozen() { return this.ai === 'frozen'; }

  update(dt) {
    const g = this.game, hero = g.hero;
    this.t += dt;
    this.flashT -= dt;
    this.barT -= dt;
    this.hpShow = damp(this.hpShow, this.hp, 6, dt);
    this.turn(dt);

    if (this.dead) {
      this.deadT += dt;
      if (this.kind === 'drone') {
        this.vy += 1500 * dt;
        this.y += this.vy * dt;
        this.tilt += dt * 160 * Math.sign(this.vx || 1);
        if (this.y >= GROUND_Y - 30) {
          g.explosion(this.x, GROUND_Y - 30, 90, 0, false);
          this.remove = true;
        }
      } else if (this.deadT > 1.6) {
        this.alpha = Math.max(0, 1 - (this.deadT - 1.6) / 0.5);
        if (this.alpha <= 0) this.remove = true;
      }
      this.vx = damp(this.vx, 0, 5, dt);
      this.x += this.vx * dt;
      this.state.update(dt);
      this.squash.update(dt);
      this.pose();
      return;
    }

    for (let i = this.dots.length - 1; i >= 0; i--) {
      const d = this.dots[i];
      d.t -= dt;
      d.tick -= dt;
      if (d.tick <= 0) {
        d.tick = 0.33;
        this.damage(d.dps * 0.33, { dot: d.type });
        if (this.dead) return;
      }
      if (d.t <= 0) this.dots.splice(i, 1);
    }

    const dx = hero.x - this.x;
    const dist = Math.abs(dx);
    const cam = g.cam;
    const onScreen = this.x > cam.x + 40 && this.x < cam.x + g.viewW - 40;
    if (onScreen) this.entered = true;

    if (!this.entered && this.kind !== 'drone' && this.ai === 'move') {
      // Walk into the arena before doing anything else.
      const dir = Math.sign(cam.x + g.viewW / 2 - this.x) || -1;
      this.facing = dir;
      this.vx = damp(this.vx, dir * Math.max(this.def.speed, 140), 6, dt);
      this.setMoveAnim(true, dir);
    } else if (this.ai === 'frozen') {
      this.freezeT -= dt;
      this.vx = damp(this.vx, 0, 8, dt);
      if (this.freezeT <= 0) {
        this.ai = 'move';
        this.state.set(0, this.anim.move, { loop: true, mix: 0.25 });
        g.particles.shards(this.x, this.y - 70, [0.7, 0.9, 1], 10);
        g.sfx('shatter');
      }
    } else if (this.ai === 'stun') {
      this.stunT -= dt;
      this.vx = damp(this.vx, 0, 8, dt);
      if (Math.random() < dt * 20) g.particles.sparks(this.x + rand(-30, 30), this.top + rand(10, 80), rand(-1, 1), [0.5, 0.8, 1], 1, 300, Math.PI);
      if (this.stunT <= 0) {
        this.ai = 'move';
        this.state.set(0, this.anim.move, { loop: true, mix: 0.15 });
      }
    } else if (this.kind === 'melee') this.updateMelee(dt, dx, dist);
    else if (this.kind === 'gunner') this.updateGunner(dt, dx, dist, onScreen);
    else this.updateDrone(dt, dx);

    // Keep entered enemies within the arena.
    if (this.entered && this.kind !== 'drone') this.x = clamp(this.x, cam.x + 30, cam.x + g.viewW - 30);

    this.x += this.vx * dt;
    if (this.kind !== 'drone') this.y = GROUND_Y;
    this.state.update(dt);
    this.squash.update(dt);
    this.pose();
  }

  setMoveAnim(moving, dir) {
    if (moving) {
      if (!this.state.is(0, this.anim.move)) this.state.set(0, this.anim.move, { loop: true, mix: 0.18 });
      const back = dir !== this.facing;
      this.state.tracks[0].timeScale = (this.def.speed / 120) * (back ? -0.8 : 1);
    } else if (!this.state.is(0, this.anim.idle)) {
      this.state.set(0, this.anim.idle, { loop: true, mix: 0.22 });
    }
  }

  updateMelee(dt, dx, dist) {
    const g = this.game, hero = g.hero;
    if (this.ai === 'attack') {
      this.attackT += dt;
      const t = this.attackT;
      this.vx = t > 0.32 && t < 0.5 ? this.facing * 160 : damp(this.vx, 0, 10, dt);
      if (!this.struck && t >= 0.46) {
        this.struck = true;
        g.sfx('swing');
        const hx = hero.x - this.x;
        if (Math.sign(hx) === this.facing && Math.abs(hx) <= this.reach + 45 && hero.y > GROUND_Y - 120) {
          if (hero.hurt(this.dmg, this.facing)) g.particles.sparks(hero.x, hero.y - 90, -this.facing, [1, 0.8, 0.4], 8, 500);
        }
      }
      if (t >= 0.67) {
        this.ai = 'move';
        this.cd = rand(0.45, 1.0);
        this.state.set(0, this.anim.idle, { loop: true, mix: 0.15 });
      }
      return;
    }
    this.cd -= dt;
    this.facing = Math.sign(dx) || this.facing;
    if (dist > this.reach || hero.dead) {
      this.vx = damp(this.vx, hero.dead ? 0 : this.facing * this.def.speed, 6, dt);
      this.setMoveAnim(!hero.dead, this.facing);
    } else {
      this.vx = damp(this.vx, 0, 10, dt);
      this.setMoveAnim(false);
      if (this.cd <= 0 && this.data.animations.Hit) {
        this.ai = 'attack';
        this.attackT = 0;
        this.struck = false;
        this.state.set(0, 'Hit', { mix: 0.1 });
      }
    }
  }

  updateGunner(dt, dx, dist, onScreen) {
    const g = this.game, hero = g.hero;
    this.facing = Math.sign(dx) || this.facing;
    let dir = 0;
    if (this.ai === 'aim' || this.ai === 'burst') {
      this.vx = damp(this.vx, 0, 10, dt);
      this.setMoveAnim(false);
      this.aimT += dt;
      if (this.ai === 'aim' && this.aimT >= 0.45) { this.ai = 'burst'; this.shots = this.def.burst; this.shotT = 0; }
      if (this.ai === 'burst') {
        this.shotT -= dt;
        if (this.shotT <= 0) {
          this.shotT = 0.14;
          this.shots--;
          g.enemyFire(this);
          if (this.shots <= 0) { this.ai = 'move'; this.cd = rand(...this.def.fireCd); }
        }
      }
      return;
    }
    // Hold a firing position on our side of the hero, always inside the view.
    const side = Math.sign(this.x - hero.x) || 1;
    const tx = clamp(hero.x + side * this.prefer, g.cam.x + 90, g.cam.x + g.viewW - 90);
    if (Math.abs(tx - this.x) > 40) dir = Math.sign(tx - this.x);
    this.vx = damp(this.vx, dir * this.def.speed, 6, dt);
    this.setMoveAnim(dir !== 0, dir);
    this.cd -= dt;
    if (this.cd <= 0 && onScreen && dist < 950 && !hero.dead) {
      this.ai = 'aim';
      this.aimT = 0;
    }
  }

  /** Approximate barrel tip of gunners, in world space. */
  muzzle() {
    const m = this.m, s = this.scale;
    return { x: this.x + this.facing * Math.max(Math.abs(m.left), m.right) * s * 0.95, y: this.y - m.top * s * 0.46 };
  }

  updateDrone(dt, dx) {
    const g = this.game, hero = g.hero;
    this.sideT -= dt;
    if (this.sideT <= 0) { this.side = -this.side; this.sideT = rand(3, 6); }
    const tx = clamp(hero.x + this.side * 230, g.cam.x + 80, g.cam.x + g.viewW - 80);
    const accel = clamp((tx - this.x) * 4 - this.vx * 2.4, -1400, 1400);
    this.vx = clamp(this.vx + accel * dt, -this.def.speed, this.def.speed);
    // Periodically swoop down into punching range, then climb back up.
    this.swoopT -= dt;
    if (this.swoopT <= 0) {
      this.low = !this.low;
      this.swoopT = this.low ? rand(1.8, 2.6) : rand(3.5, 6);
    }
    const ty = (this.low ? GROUND_Y - 200 : this.hoverY) + Math.sin(this.t * 2.3) * 18;
    this.y = damp(this.y, ty, 2.6, dt);
    this.facing = Math.sign(dx) || this.facing;
    this.tilt = damp(this.tilt, clamp(this.vx * 0.06, -14, 14) * this.facing, 6, dt);
    this.cd -= dt;
    if (this.cd <= 0 && Math.abs(dx) < 420 && !hero.dead && this.x > g.cam.x && this.x < g.cam.x + g.viewW) {
      this.cd = rand(...this.def.fireCd);
      g.droneAttack(this);
    }
  }

  /**
   * Apply damage. Returns true if this hit killed the enemy.
   * opts: dir, knock, effect, crit, dot
   */
  damage(amount, { dir = 0, knock = 0, effect = null, crit = false, dot = null } = {}) {
    if (this.dead) return false;
    const g = this.game;
    if (this.frozen) amount *= 1.5;
    amount = Math.max(1, Math.round(amount));
    this.hp -= amount;
    this.barT = 2.5;
    if (!dot) {
      this.flashT = 0.1;
      this.squash.kick(2.2);
      this.vx += dir * knock * (this.elite ? 0.4 : 1) * (this.kind === 'drone' ? 0.6 : 1);
      if (this.ai !== 'frozen' && this.ai !== 'stun') this.state.set(1, 'GetHit', { mix: 0.03, autoFade: 0.12 });
    }
    const col = dot === 'acid' ? [0.6, 1, 0.3] : dot === 'burn' ? [1, 0.6, 0.2] : crit ? [1, 0.86, 0.2] : [1, 1, 1];
    g.popups.add(this.x + rand(-14, 14), this.top - 6, crit ? amount + '!' : amount, col, dot ? 26 : crit ? 48 : 34);

    if (effect && this.hp > 0) this.applyEffect(effect);
    if (this.hp <= 0) {
      this.die(dir);
      return true;
    }
    return false;
  }

  applyEffect(e) {
    const g = this.game;
    switch (e.type) {
      case 'freeze':
        if (this.ai === 'frozen') { this.freezeT = Math.max(this.freezeT, 1); break; }
        this.freezeMeter += e.amount;
        if (this.freezeMeter >= 1) {
          this.freezeMeter = 0;
          this.ai = 'frozen';
          this.freezeT = 2.3;
          this.state.clear(1, 0);
          this.state.set(0, 'GetFreez', { mix: 0.06 });
          g.sfx('freeze');
          g.particles.burst(this.x, this.y - 70, [0.6, 0.9, 1], 12, 320);
        }
        break;
      case 'shock':
        if (this.ai === 'frozen') break;
        this.ai = 'stun';
        this.stunT = e.dur;
        this.state.clear(1, 0);
        this.state.set(0, 'GetElectric', { loop: true, mix: 0 });
        break;
      case 'acid':
      case 'burn': {
        const cur = this.dots.find((d) => d.type === e.type);
        if (cur) cur.t = e.dur;
        else this.dots.push({ type: e.type, dps: e.dps, t: e.dur, tick: 0.33 });
        break;
      }
    }
  }

  die(dir) {
    const g = this.game;
    const wasFrozen = this.frozen;
    this.dead = true;
    this.ai = 'dead';
    this.dots.length = 0;
    this.state.clear(1, 0);
    if (wasFrozen) {
      g.particles.shards(this.x, this.y - 70, [0.7, 0.9, 1], 18);
      g.sfx('shatter');
    }
    this.state.set(0, this.anim.death, { mix: 0.08 });
    this.vx = dir * 260;
    this.vy = -120;
    g.onEnemyKilled(this);
  }

  draw(r) {
    let tr = 1, tg = 1, tb = 1;
    if (this.elite) { tg = 0.8; tb = 0.78; }
    for (const d of this.dots) {
      const p = 0.5 + 0.5 * Math.sin(this.t * 12);
      if (d.type === 'acid') { tr *= 0.7 + 0.15 * p; tb *= 0.6 + 0.2 * p; }
      if (d.type === 'burn') { tg *= 0.75 + 0.15 * p; tb *= 0.55 + 0.2 * p; }
    }
    if (this.ai === 'aim') {
      const k = Math.min(1, this.aimT / 0.45);
      tg *= 1 - 0.25 * k; tb *= 1 - 0.3 * k;
    }
    this.drawBody(r, [tr, tg, tb, this.alpha]);
  }

  drawOverlay(r) {
    const g = this.game;
    if (this.ai === 'aim') {
      const m = this.muzzle();
      const k = Math.min(1, this.aimT / 0.45);
      const s = 30 + 50 * k + Math.sin(this.t * 40) * 6;
      r.sprite(g.tex.glow, m.x, m.y, s, s, 0, rgba(1, 0.3, 0.2, 0.9 * k), 1);
      r.sprite(g.tex.spark, m.x, m.y, s * 1.4, 8, this.t * 3, rgba(1, 0.8, 0.6, k), 1);
    }
    if (this.barT > 0 && !this.dead) {
      const a = Math.min(1, this.barT / 0.3);
      const w = this.elite ? 110 : 76, h = 9, x = this.x - w / 2, y = this.top - 26;
      r.rect(x - 2, y - 2, w + 4, h + 4, rgba(0.05, 0.05, 0.08, 0.85 * a));
      r.rect(x, y, w * clamp(this.hpShow / this.maxHp, 0, 1), h, rgba(1, 0.85, 0.5, 0.9 * a));
      r.rect(x, y, w * clamp(this.hp / this.maxHp, 0, 1), h, rgba(this.elite ? 1 : 0.95, this.elite ? 0.35 : 0.25, 0.2, a));
    }
  }
}

export { meta as actorMeta };
