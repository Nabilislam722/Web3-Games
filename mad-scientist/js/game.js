// World simulation and rendering: camera, parallax lab, wave director,
// combat, pickups and all the juice (hit-stop, shake, slow-mo, flashes).

import { rgba } from './gl.js';
import { Hero, Enemy } from './actors.js';
import { Particles, Popups, GlyphFont, SpineFx, makeTextures } from './fx.js';
import {
  GROUND_Y, VIEW_H, WEAPONS, WEAPON_BY_KEY, ENEMIES, ENEMY_UNLOCK, WAVES_PER_SECTOR, ZONES, raidSetup,
} from './data.js';
import { clamp, rand, randInt, chance, damp, lerp, ease, wobble, segmentHitsBox, seededRng } from './util.js';

const PANEL_W = 3257 * (VIEW_H / 799);

export class Game {
  constructor({ renderer, assets, input, sfx, profile, ui }) {
    this.r = renderer;
    this.skel = assets.skel;
    this.img = assets.img;
    this.input = input;
    this.audio = sfx;
    this.profile = profile;
    this.ui = ui;
    this.tex = makeTextures(renderer);
    this.font = new GlyphFont(renderer);
    this.particles = new Particles(this.tex);
    this.popups = new Popups(this.font);
    this.viewW = 1422;
    this.viewH = VIEW_H;
    this.cam = { x: 0, minX: 0, lockX: null, look: 0 };
    this.enemies = [];
    this.shots = [];
    this.hostile = [];
    this.bombs = [];
    this.pickups = [];
    this.fx = [];
    this.bolts = [];
    this.timers = [];
    this.motes = [];
    this.time = 0;
    this.trauma = 0;
    this.zoomKick = 0;
    this.hitstopT = 0;
    this.slowT = 0;
    this.slowScale = 1;
    this.timeScale = 1;
    this.flashA = 0;
    this.hurtA = 0;
    this.zoneIndex = 0;
    this.paused = false;
    this.mode = 'menu';
    this.raid = null;
    this.rng = Math.random;
    this.hero = new Hero(this, this.skel[profile.equipped], WEAPON_BY_KEY[profile.equipped]);
    this.enterMenu();
  }

  // ------------------------------------------------------------- modes --

  resize(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
  }

  clearWorld() {
    this.enemies.length = 0;
    this.shots.length = 0;
    this.hostile.length = 0;
    this.bombs.length = 0;
    this.pickups.length = 0;
    this.fx.length = 0;
    this.bolts.length = 0;
    this.timers.length = 0;
    this.particles.clear();
    this.popups.list.length = 0;
    this.slowT = 0;
    this.hitstopT = 0;
    this.trauma = 0;
  }

  resetHero(x) {
    const key = this.profile.equipped;
    this.hero = new Hero(this, this.skel[key], WEAPON_BY_KEY[key]);
    this.hero.x = x;
    this.cam.x = x - this.viewW * 0.38;
    this.cam.minX = this.cam.x;
    this.cam.lockX = null;
  }

  enterMenu() {
    this.mode = 'menu';
    this.paused = false;
    this.clearWorld();
    this.zoneIndex = 0;
    this.resetHero(400);
    this.hero.control = 'auto';
    this.menuT = 0;
  }

  enterArmory() {
    this.mode = 'armory';
    this.hero.control = 'auto';
    this.hero.autoAxis = 0;
    this.hero.autoFire = false;
  }

  /** Equip a weapon on the live hero (used by the armory preview). */
  previewWeapon(key) {
    const h = this.hero;
    h.setWeapon(this.skel[key], WEAPON_BY_KEY[key]);
    h.fireCd = 0.25;
    this.demoFireT = 1.1;
    this.particles.ring(h.x, h.y - 90, 260, WEAPON_BY_KEY[key].color, 0.45, 0);
  }

  /** Start a run. A Block Raid passes its Bitcoin-seeded `raid` info. */
  startRun(raid = null) {
    this.mode = 'play';
    this.paused = false;
    this.clearWorld();
    this.raid = raid;
    this.rng = raid ? seededRng(raid.seed) : Math.random;
    const setup = raid ? raidSetup(raid.seed) : null;
    this.mod = setup?.modifier || null;
    this.zoneStart = setup?.zone || 0;
    this.zoneIndex = this.zoneStart;
    this.sector = 0;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboT = 0;
    this.bestCombo = 0;
    this.potionsEarned = 0;
    this.resetHero(260);
    this.hero.control = 'player';
    this.phase = 'intro';
    this.phaseT = 0;
    this.triggerX = this.hero.x + 320;
    this.input.reset();
    this.ui.onRunStart();
    if (raid) this.ui.banner(`BLOCK RAID #${raid.raidId.toLocaleString()}`, `${this.mod.name} · ${ZONES[this.zoneIndex].name}`);
    else this.ui.banner('SECTOR 1', ZONES[0].name);
    this.audio.play('wave');
  }

  // ------------------------------------------------------------ effects --

  sfx(name, pitch) { this.audio.play(name, pitch); }
  shake(t) { this.trauma = Math.min(1, this.trauma + t); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  slowmo(duration, scale) { this.slowT = duration; this.slowDur = duration; this.slowScale = scale; }
  later(t, fn) { this.timers.push({ t, fn }); }

  // ------------------------------------------------------------- update --

  update(rawDt) {
    if (this.paused) return;
    this.time += rawDt;

    // Hit-stop freezes the world for a few frames but keeps the camera alive.
    let dt = rawDt;
    if (this.hitstopT > 0) {
      this.hitstopT -= rawDt;
      dt = 0;
    }
    if (this.slowT > 0) {
      this.slowT -= rawDt;
      const k = clamp(this.slowT / this.slowDur, 0, 1);
      this.timeScale = lerp(1, this.slowScale, ease.outCubic(Math.min(1, k * 2.2)));
    } else {
      this.timeScale = damp(this.timeScale, 1, 10, rawDt);
    }
    dt *= this.timeScale;

    this.trauma = Math.max(0, this.trauma - rawDt * 1.6);
    this.zoomKick = damp(this.zoomKick, 0, 6, rawDt);
    this.flashA = damp(this.flashA, 0, 9, rawDt);
    this.hurtA = damp(this.hurtA, 0, 3, rawDt);

    if (this.mode === 'menu') this.updateMenu(dt);
    if (this.mode === 'armory') {
      this.hero.autoAxis = 0;
      this.demoFireT = (this.demoFireT || 0) - dt;
      this.hero.autoFire = this.demoFireT > 0;
    }

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }

    const h = this.hero;
    if (this.mode === 'play') {
      h.minX = this.cam.x + 50;
      h.maxX = this.cam.x + this.viewW - 50;
    } else {
      h.minX = -Infinity;
      h.maxX = Infinity;
    }
    h.update(dt, this.input);

    for (const e of this.enemies) e.update(dt);
    this.separateEnemies(dt);
    this.enemies = this.enemies.filter((e) => !e.remove);

    this.updateShots(dt);
    this.updateHostile(dt);
    this.updateBombs(dt);
    this.updatePickups(dt);
    for (const f of this.fx) f.update(dt);
    this.fx = this.fx.filter((f) => !f.dead);
    for (const b of this.bolts) b.t += dt;
    this.bolts = this.bolts.filter((b) => b.t < b.life);
    this.particles.update(dt);
    this.popups.update(dt);
    this.updateMotes(dt);

    if (this.mode === 'play') this.updateDirector(dt);
    this.updateCamera(rawDt);
  }

  updateMenu(dt) {
    const h = this.hero;
    this.menuT += dt;
    const cycle = this.menuT % 7;
    h.autoAxis = cycle < 5 ? 1 : 0;
    h.autoFire = cycle > 5.3 && cycle < 6.6;
    if (h.autoFire) h.facing = 1;
  }

  updateCamera(dt) {
    const c = this.cam, h = this.hero;
    c.look = damp(c.look, h.facing * 70, 2.2, dt);
    let target;
    if (this.mode === 'armory') target = h.x - this.viewW * 0.24;
    else if (c.lockX !== null) target = c.lockX;
    else target = h.x - this.viewW * 0.4 + c.look;
    if (this.mode === 'play') target = Math.max(target, c.minX);
    c.x = damp(c.x, target, c.lockX !== null ? 3.2 : 4, dt);
    if (this.mode === 'play') c.minX = Math.max(c.minX, Math.min(c.x, target));
  }

  separateEnemies(dt) {
    const E = this.enemies;
    for (let i = 0; i < E.length; i++) {
      const a = E[i];
      if (a.dead || a.kind === 'drone') continue;
      for (let j = i + 1; j < E.length; j++) {
        const b = E[j];
        if (b.dead || b.kind === 'drone') continue;
        const d = b.x - a.x;
        const min = 70;
        if (Math.abs(d) < min) {
          const push = (min - Math.abs(d)) * 4 * dt * (d >= 0 ? 1 : -1);
          a.x -= push;
          b.x += push;
        }
      }
    }
  }

  // ----------------------------------------------------------- director --

  updateDirector(dt) {
    const h = this.hero;
    this.phaseT += dt;
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) { this.combo = 0; this.ui.updateCombo(0, 0, 0); }
      else this.ui.updateCombo(this.combo, this.comboMult(), this.comboT / 2.8);
    }
    if (h.dead) return;

    switch (this.phase) {
      case 'intro':
        if (this.phaseT > 1.2) this.setPhase('advance');
        break;
      case 'advance':
        this.ui.showGo(h.x < this.triggerX - 120 && this.phaseT > 0.6);
        if (h.x >= this.triggerX) this.startWave();
        break;
      case 'fight': {
        this.spawnT -= dt;
        const alive = this.enemies.filter((e) => !e.dead).length;
        if (this.budget > 0 && this.spawnT <= 0 && alive < this.maxAlive) this.spawnGroup();
        if (this.budget <= 0 && alive === 0) this.waveCleared();
        break;
      }
      case 'cleared':
        if (this.phaseT > 1.6) {
          if (this.wave >= WAVES_PER_SECTOR) this.sectorCleared();
          else {
            this.cam.lockX = null;
            this.triggerX = this.cam.x + this.viewW + 200;
            this.setPhase('advance');
          }
        }
        break;
      case 'sector':
        if (this.phaseT > 2.8 && !this.transitioning) {
          this.transitioning = true;
          this.ui.fadeThrough(() => this.nextSector());
        }
        break;
    }
  }

  setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
  }

  get globalWave() { return this.sector * WAVES_PER_SECTOR + this.wave - 1; }

  // Wave composition draws from `rng`. A Block Raid seeds it with its Bitcoin
  // block hash, so every player meets the same guards in the same order.
  rr(a, b) { return a + this.rng() * (b - a); }
  rpick(arr) { return arr[Math.floor(this.rng() * arr.length)]; }

  startWave() {
    this.wave++;
    const g = this.globalWave;
    this.cam.lockX = Math.max(this.cam.minX, this.hero.x - this.viewW * 0.36);
    this.budget = 4.5 + g * 1.7 + this.sector * 2;
    this.maxAlive = Math.min(9, 3 + Math.floor(g * 0.6));
    this.spawnT = 0.9;
    const mod = this.mod;
    let pool = Object.keys(ENEMY_UNLOCK).filter((k) => ENEMY_UNLOCK[k] <= g);
    if (mod?.early) pool = [...new Set([...pool, ...mod.early])];
    if (mod?.boost) pool = pool.concat(pool.filter((k) => ENEMIES[k].kind === mod.boost));
    this.pool = pool;
    this.newest = Object.keys(ENEMY_UNLOCK).filter((k) => ENEMY_UNLOCK[k] === g);
    this.eliteLeft = this.wave === WAVES_PER_SECTOR ? 1 + this.sector : mod?.eliteEvery || (g >= 6 && this.rng() < 0.4) ? 1 : 0;
    this.setPhase('fight');
    this.ui.showGo(false);
    this.ui.banner(`WAVE ${this.wave}`, this.wave === WAVES_PER_SECTOR ? 'Elite guards incoming!' : `Sector ${this.sector + 1} · ${ZONES[this.zoneIndex].name}`);
    this.ui.updateWave(this.sector + 1, this.wave);
    this.sfx('wave');
  }

  spawnGroup() {
    const g = this.globalWave;
    const n = 1 + Math.floor(this.rng() * Math.min(3, 1 + Math.floor(g / 3)));
    const droneCap = this.mod?.droneCap ?? 2;
    for (let i = 0; i < n && this.budget > 0; i++) {
      let key = this.newest.length && this.rng() < 0.45 ? this.rpick(this.newest) : this.rpick(this.pool);
      // Keep drones from dominating a wave.
      if (ENEMIES[key].kind === 'drone' && this.enemies.filter((e) => e.kind === 'drone' && !e.dead).length >= droneCap) key = 'Enemy01';
      const elite = this.eliteLeft > 0 && this.budget < 6 && ENEMIES[key].kind !== 'drone';
      if (elite) this.eliteLeft--;
      this.budget -= ENEMIES[key].cost * (elite ? 2 : 1);
      this.spawnEnemy(key, elite, i);
    }
    this.spawnT = this.rr(1.3, 2.6) * Math.max(0.5, 1 - g * 0.035) * (this.mod?.spawnRate ?? 1);
  }

  spawnEnemy(key, elite = false, i = 0) {
    const def = ENEMIES[key];
    const g = this.globalWave;
    const fromLeft = g >= 2 && this.rng() < 0.28;
    const x = fromLeft ? this.cam.x - this.rr(80, 160) - i * 70 : this.cam.x + this.viewW + this.rr(80, 160) + i * 70;
    const y = def.kind === 'drone' ? GROUND_Y - def.hover - 160 : GROUND_Y;
    const e = new Enemy(this, key, this.skel[key], def, {
      x, y, elite,
      hpMul: 1 + this.sector * 0.35 + g * 0.03,
      dmgMul: 1 + this.sector * 0.15,
    });
    e.facing = e.faceX = fromLeft ? 1 : -1;
    this.enemies.push(e);
  }

  waveCleared() {
    this.setPhase('cleared');
    this.ui.banner('WAVE CLEAR!', `+${100 * this.wave} bonus`, 'good');
    this.addScore(100 * this.wave);
    this.sfx('clear');
    this.saveProfile();
  }

  sectorCleared() {
    this.setPhase('sector');
    this.transitioning = false;
    this.hero.heal(35);
    this.hero.bombs = Math.max(this.hero.bombs, 3);
    this.ui.updateHp(this.hero.hp, this.hero.maxHp);
    this.ui.updateBombs();
    this.ui.banner('SECTOR CLEARED!', 'Patched up · bombs restocked', 'good');
    this.ui.showGo(true);
  }

  nextSector() {
    this.sector++;
    this.wave = 0;
    this.zoneIndex = (this.zoneStart + this.sector) % ZONES.length;
    const hero = this.hero;
    this.clearWorld();
    hero.x = 260;
    hero.vx = 0;
    this.cam.x = hero.x - this.viewW * 0.38;
    this.cam.minX = this.cam.x;
    this.cam.lockX = null;
    this.triggerX = hero.x + 320;
    this.setPhase('intro');
    this.ui.showGo(false);
    this.ui.updateWave(this.sector + 1, 0);
    this.ui.banner(`SECTOR ${this.sector + 1}`, ZONES[this.zoneIndex].name);
    this.sfx('wave');
  }

  // ------------------------------------------------------------- combat --

  comboMult() { return Math.min(4, 1 + Math.floor(this.combo / 5) * 0.5); }

  addScore(n) {
    this.score += n;
    this.ui.updateScore(this.score);
  }

  /** `aim` is the gun's elevation in degrees (positive = up). */
  heroFire(hero, mx, my, dir, w, aim = 0) {
    this.sfx(w.sfx);
    this.shake(w.shake);
    const big = w.anim === 'ShootFX2';
    this.fx.push(new SpineFx(this.skel.FxMuzzle, 'animation', mx - dir * 6, my, { scale: big ? 1.1 : 0.75, rot: aim, flip: dir < 0, anchor: 'left', speed: 1.4 }));
    if (big) this.fx.push(new SpineFx(this.skel.FxSmoke, 'animation', mx - dir * 30, my - 10, { scale: 0.55, rot: aim, flip: dir < 0, anchor: 'left', speed: 1.2 }));
    this.particles.glow(mx, my, big ? 170 : 110, w.color, 0.12);

    if (w.kind === 'beam') return this.fireBeam(mx, my, dir, w, aim);
    if (w.kind === 'punch') return this.firePunch(mx, my, dir, w);

    const count = w.count || 1;
    for (let i = 0; i < count; i++) {
      const spread = count > 1 ? lerp(-w.spread, w.spread, i / (count - 1)) + rand(-2, 2) : rand(-w.spread, w.spread);
      const a = (spread - aim) * (Math.PI / 180);
      const speed = w.speed * (count > 1 ? rand(0.9, 1.1) : 1);
      this.shots.push({
        x: mx, y: my, px: mx, py: my, fromX: hero.x, // first sweep starts at the body: no point-blank misses
        vx: Math.cos(a) * speed * dir, vy: Math.sin(a) * speed,
        w, life: w.life, pierce: w.pierce || 0, hit: new Set(), t: 0,
      });
    }
  }

  damageFor(w) {
    const crit = chance(0.12);
    return { dmg: w.dmg * (this.hero.rage > 0 ? 2 : 1) * (crit ? 2 : 1), crit };
  }

  hitEnemy(e, w, x, y, dir, knock = 90) {
    const { dmg, crit } = this.damageFor(w);
    e.damage(dmg, { dir, knock: w.knock || knock, effect: w.effect && w.effect.type !== 'explode' ? w.effect : null, crit });
    this.fx.push(new SpineFx(this.skel.FxCollision, 'Fx1', x, y, { scale: crit ? 0.75 : 0.5, speed: 1.3 }));
    this.particles.sparks(x, y, -dir, w.color, crit ? 10 : 5, 520);
    this.sfx(crit ? 'crit' : 'hit');
    if (crit) this.hitstop(0.035);
  }

  updateShots(dt) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const w = s.w;
      s.t += dt;
      s.px = s.fromX ?? s.x; s.py = s.y;
      s.fromX = undefined;
      s.vy += (w.gravity || 0) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (Math.random() < dt * 60) {
        this.particles.spawn({
          x: s.x - s.vx * 0.02, y: s.y, vx: s.vx * 0.05, vy: rand(-20, 20), life: 0.22,
          size: w.radius * 2.2, size1: w.radius * 0.6, color: w.color, alpha: 0.5, alpha1: 0,
        });
      }
      let dead = s.life <= 0;
      const dir = Math.sign(s.vx) || 1;
      for (const e of this.enemies) {
        if (dead || e.dead || s.hit.has(e)) continue;
        const b = e.box();
        if (!segmentHitsBox(s.px, s.py, s.x, s.y, w.radius, b.x, b.y, b.w, b.h)) continue;
        s.hit.add(e);
        const hy = clamp(s.y, b.y + 10, b.y + b.h - 10);
        this.hitEnemy(e, w, s.x, hy, dir);
        if (w.effect?.type === 'explode') {
          this.explosion(s.x, hy, w.effect.radius, w.effect.dmg, true);
          dead = true;
        } else if (s.pierce-- <= 0) dead = true;
      }
      if (!dead && s.y >= GROUND_Y - 8) {
        dead = true;
        if (w.effect?.type === 'explode') this.explosion(s.x, GROUND_Y - 20, w.effect.radius, w.effect.dmg, true);
        else {
          this.particles.burst(s.x, GROUND_Y - 8, w.color, 8, 180);
          this.particles.dust(s.x, GROUND_Y, 3, 60);
        }
      }
      if (s.x < this.cam.x - 300 || s.x > this.cam.x + this.viewW + 300) dead = true;
      if (dead) this.shots.splice(i, 1);
    }
  }

  fireBeam(mx, my, dir, w, aim = 0) {
    const a = (-aim * Math.PI) / 180;
    const dx = Math.cos(a) * dir, dy = Math.sin(a);
    const ex = mx + dx * w.range, ey = my + dy * w.range;
    const targets = this.enemies
      .filter((e) => { if (e.dead) return false; const b = e.box(); return segmentHitsBox(mx, my, ex, ey, 30, b.x, b.y, b.w, b.h); })
      .sort((p, q) => Math.abs(p.x - mx) - Math.abs(q.x - mx));
    const first = targets[0];
    const len = first ? Math.min(w.range, Math.abs(first.x - mx) / Math.max(0.3, Math.abs(Math.cos(a)))) : w.range;
    const endX = mx + dx * len, endY = my + dy * len;
    this.fx.push(new SpineFx(this.skel.FxLightning, 'animation', mx, my, { scale: 0.62, scaleX: (len + 40) / 520, rot: aim, flip: dir < 0, anchor: 'left', loop: true, life: 0.16 }));
    this.addBolt(mx, my, endX, endY + rand(-10, 10), w.color);
    if (!first) return;
    my = endY;
    this.hitEnemy(first, w, first.x, my, dir, 40);
    // Chain to nearby enemies.
    let from = first;
    const done = new Set([first]);
    for (let c = 0; c < (w.effect.chain || 0); c++) {
      const next = this.enemies
        .filter((e) => !e.dead && !done.has(e) && Math.abs(e.x - from.x) < 280)
        .sort((a, b) => Math.abs(a.x - from.x) - Math.abs(b.x - from.x))[0];
      if (!next) break;
      done.add(next);
      const fb = from.box(), nb = next.box();
      const ny = nb.y + nb.h * 0.45;
      this.addBolt(from.x, fb.y + fb.h * 0.45, next.x, ny, w.color);
      const fx = from;
      this.later(0.05 * (c + 1), () => {
        if (!next.dead) this.hitEnemy(next, { ...w, dmg: w.dmg * 0.7 }, next.x, ny, Math.sign(next.x - fx.x) || dir, 30);
      });
      from = next;
    }
  }

  addBolt(x0, y0, x1, y1, color) {
    const pts = [];
    const n = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 38));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const j = i === 0 || i === n ? 0 : rand(-22, 22);
      pts.push(lerp(x0, x1, k) + rand(-6, 6), lerp(y0, y1, k) + j);
    }
    this.bolts.push({ pts, color, t: 0, life: 0.18 });
    this.particles.glow(x1, y1, 150, color, 0.2);
  }

  firePunch(mx, my, dir, w) {
    this.fx.push(new SpineFx(this.skel.FxGlove, 'animation', mx - dir * 10, my, { scale: 0.78, flip: dir < 0, anchor: 'left', speed: 1.5 }));
    this.later(0.07, () => {
      let hits = 0;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const b = e.box();
        const reachX = dir > 0 ? [mx, mx + w.reach] : [mx - w.reach, mx];
        if (b.x + b.w < reachX[0] || b.x > reachX[1] || my < b.y - 50 || my > b.y + b.h + 50) continue;
        this.hitEnemy(e, w, e.x - dir * 20, my, dir);
        hits++;
      }
      if (hits) {
        this.hitstop(0.06);
        this.shake(0.2);
        this.zoomKick += 0.02;
      }
    });
  }

  explosion(x, y, radius, dmg, friendly = true) {
    this.particles.explosion(x, y, radius);
    this.fx.push(new SpineFx(this.skel.FxCollision, 'Fx2', x, y, { scale: radius / 80, speed: 1.2 }));
    this.shake(clamp(radius / 300, 0.25, 0.6));
    this.zoomKick += 0.025;
    this.hitstop(0.045);
    this.flashA = Math.min(0.35, this.flashA + 0.18);
    this.sfx('explode', clamp(160 / radius, 0.7, 1.4));
    if (!dmg) return;
    if (friendly) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const b = e.box();
        const cx = clamp(x, b.x, b.x + b.w), cy = clamp(y, b.y, b.y + b.h);
        const d = Math.hypot(cx - x, cy - y);
        if (d > radius) continue;
        const falloff = 1 - (d / radius) * 0.5;
        e.damage(dmg * falloff * (this.hero.rage > 0 ? 2 : 1), { dir: Math.sign(e.x - x) || 1, knock: 420 });
      }
    } else {
      const h = this.hero;
      if (Math.hypot(h.x - x, h.y - 70 - y) < radius + 30) h.hurt(dmg, Math.sign(h.x - x) || 1);
    }
  }

  spawnBomb(x, y, vx, vy) {
    this.bombs.push({ x, y, vx, vy, rot: 0, vr: vx > 0 ? 9 : -9, t: 0 });
  }

  updateBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;
      b.vy += 1900 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      if (Math.random() < dt * 50) {
        const fx = b.x + Math.cos(b.rot - 1.2) * 20, fy = b.y + Math.sin(b.rot - 1.2) * 20;
        this.particles.spawn({ x: fx, y: fy, vx: rand(-60, 60), vy: rand(-120, -30), life: 0.3, size: 12, size1: 2, color: [1, 0.85, 0.3], alpha: 1, alpha1: 0 });
      }
      let boom = b.y >= GROUND_Y - 18 || b.t > 2;
      if (!boom) {
        for (const e of this.enemies) {
          if (e.dead) continue;
          const bx = e.box();
          if (b.x > bx.x && b.x < bx.x + bx.w && b.y > bx.y && b.y < bx.y + bx.h) { boom = true; break; }
        }
      }
      if (boom) {
        this.bombs.splice(i, 1);
        this.explosion(b.x, Math.min(b.y, GROUND_Y - 30), 200, 75, true);
        this.particles.dust(b.x, GROUND_Y, 10, 260);
      }
    }
  }

  enemyFire(e) {
    const h = this.hero;
    const m = e.muzzle();
    const dir = e.facing;
    const a = clamp(Math.atan2(h.chestY - m.y, Math.abs(h.x - m.x)), -0.22, 0.22) + rand(-0.03, 0.03);
    const speed = 640;
    this.hostile.push({ kind: 'bullet', x: m.x, y: m.y, px: m.x, py: m.y, vx: Math.cos(a) * speed * dir, vy: Math.sin(a) * speed, dmg: e.dmg, img: this.img.shotOrange, scale: 0.42, r: 9, life: 2.4 });
    this.fx.push(new SpineFx(this.skel.FxMuzzle, 'animation', m.x, m.y, { scale: 0.6, flip: dir < 0, anchor: 'left', speed: 1.4 }));
    this.particles.glow(m.x, m.y, 90, [1, 0.6, 0.3], 0.1);
    e.squash.kick(-1.5);
    e.vx -= dir * 60;
    this.sfx('enemyShot');
  }

  droneAttack(e) {
    const h = this.hero;
    if (e.def.attack === 'dynamite') {
      this.hostile.push({ kind: 'dynamite', x: e.x, y: e.y + 30, px: e.x, py: e.y, vx: e.vx * 0.4, vy: -60, rot: 0, vr: rand(-7, 7), dmg: e.dmg, img: this.img.dynamite, scale: 0.6, r: 14, life: 4 });
      this.sfx('throw');
    } else {
      const a = Math.atan2(h.chestY - e.y, h.x - e.x);
      const speed = 420;
      this.hostile.push({ kind: 'orb', x: e.x, y: e.y + 10, px: e.x, py: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg: e.dmg, img: this.img.fireballRed, scale: 0.42, r: 14, life: 3 });
      this.particles.glow(e.x, e.y + 10, 110, [1, 0.4, 0.3], 0.14);
      this.sfx('enemyShot', 0.7);
    }
  }

  updateHostile(dt) {
    const h = this.hero;
    const hb = h.box();
    for (let i = this.hostile.length - 1; i >= 0; i--) {
      const s = this.hostile[i];
      s.px = s.x; s.py = s.y;
      if (s.kind === 'dynamite') { s.vy += 1500 * dt; s.rot += s.vr * dt; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.kind === 'orb' && Math.random() < dt * 40) {
        this.particles.spawn({ x: s.x, y: s.y, vx: -s.vx * 0.1, vy: -s.vy * 0.1, life: 0.3, size: 24, size1: 6, color: [1, 0.4, 0.2], alpha: 0.6, alpha1: 0 });
      }
      if (s.kind === 'dynamite' && Math.random() < dt * 40) {
        this.particles.spawn({ x: s.x, y: s.y - 20, vx: rand(-50, 50), vy: rand(-90, -20), life: 0.25, size: 10, size1: 2, color: [1, 0.85, 0.3], alpha: 1, alpha1: 0 });
      }
      let dead = s.life <= 0;
      if (!dead && !h.dead && h.invuln <= 0 && segmentHitsBox(s.px, s.py, s.x, s.y, s.r, hb.x, hb.y, hb.w, hb.h)) {
        if (s.kind === 'dynamite') this.explosion(s.x, s.y, 120, s.dmg, false);
        else {
          h.hurt(s.dmg, Math.sign(s.vx) || 1);
          this.fx.push(new SpineFx(this.skel.FxCollision, 'Fx1', s.x, s.y, { scale: 0.5, speed: 1.3 }));
        }
        dead = true;
      }
      if (!dead && s.y >= GROUND_Y - 6) {
        if (s.kind === 'dynamite') this.explosion(s.x, GROUND_Y - 30, 120, s.dmg, false);
        else this.particles.burst(s.x, GROUND_Y - 6, [1, 0.5, 0.3], 6, 160);
        dead = true;
      }
      if (s.x < this.cam.x - 300 || s.x > this.cam.x + this.viewW + 300) dead = true;
      if (dead) this.hostile.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ pickups --

  spawnPotions(x, y, n) {
    for (let i = 0; i < n; i++) {
      this.pickups.push({
        type: 'potion', x, y, vx: rand(-240, 240), vy: rand(-820, -460), rot: rand(-1, 1), vr: rand(-10, 10), t: 0,
        magnet: false, life: 10,
      });
    }
  }

  spawnItem(x, color) {
    const fx = new SpineFx(this.skel['Item' + color], 'animation', x, GROUND_Y - 70, { scale: 0.42, loop: true, life: Infinity });
    this.pickups.push({ type: 'item', color, x, y: GROUND_Y - 70, t: 0, fx, life: 11 });
  }

  updatePickups(dt) {
    const h = this.hero;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      let collect = false;
      if (p.type === 'potion') {
        const dx = h.x - p.x, dy = h.y - 70 - p.y;
        const d = Math.hypot(dx, dy);
        if (!p.magnet && p.t > 0.5 && (d < 260 || p.t > 3.5) && !h.dead) p.magnet = true;
        if (p.magnet) {
          const sp = Math.min(1800, 300 + (p.t - 0.5) * 1400);
          p.vx = damp(p.vx, (dx / d) * sp, 10, dt);
          p.vy = damp(p.vy, (dy / d) * sp, 10, dt);
          p.rot = damp(p.rot, 0, 8, dt);
          if (d < 40) collect = true;
        } else {
          p.vy += 1900 * dt;
          if (p.y >= GROUND_Y - 14 && p.vy > 0) {
            p.y = GROUND_Y - 14;
            p.vy = Math.abs(p.vy) > 120 ? -p.vy * 0.45 : 0;
            p.vx *= 0.6;
            p.vr *= 0.5;
          }
          p.rot += p.vr * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (collect) {
          this.potionsEarned++;
          this.profile.potions++;
          this.ui.updatePotions(this.profile.potions, true);
          this.particles.burst(p.x, p.y, [0.6, 1, 0.3], 6, 160);
          this.sfx('potion', 1 + Math.min(0.6, (this.potionStreak = (this.time - (this.lastPotion || 0) < 0.4 ? (this.potionStreak || 0) + 1 : 0)) * 0.05));
          this.lastPotion = this.time;
        }
      } else {
        p.fx.update(dt);
        p.fx.x = p.x;
        p.fx.y = p.y + Math.sin(p.t * 3) * 8;
        if (!h.dead && Math.abs(h.x - p.x) < 70 && h.y > GROUND_Y - 160) {
          collect = true;
          this.applyItem(p);
        }
      }
      if (collect || p.t > p.life) this.pickups.splice(i, 1);
    }
  }

  applyItem(p) {
    const h = this.hero;
    const col = { Green: [0.5, 1, 0.3], Red: [1, 0.35, 0.3], Purple: [0.75, 0.45, 1] }[p.color];
    if (p.color === 'Green') {
      h.heal(30);
      this.popups.add(p.x, p.y - 60, '+30 HP', col, 36, 1.1);
      this.ui.updateHp(h.hp, h.maxHp);
    } else if (p.color === 'Red') {
      h.rage = 8;
      this.popups.add(p.x, p.y - 60, 'RAGE x2', col, 36, 1.1);
      this.ui.rage(8);
    } else {
      h.bombs = Math.min(9, h.bombs + 2);
      this.popups.add(p.x, p.y - 60, '+2 BOMBS', col, 36, 1.1);
      this.ui.updateBombs();
    }
    this.particles.ring(p.x, p.y, 300, col, 0.45);
    this.particles.burst(p.x, p.y, col, 16, 340);
    this.sfx('powerup');
  }

  // ------------------------------------------------------------- events --

  onEnemyKilled(e) {
    this.kills++;
    this.combo++;
    this.comboT = 2.8;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const mult = this.comboMult();
    this.addScore(Math.round(e.def.score * (e.elite ? 3 : 1) * mult));
    this.ui.updateCombo(this.combo, mult, 1);

    const cy = e.y - e.m.top * e.scale * 0.5;
    this.particles.burst(e.x, cy, [1, 0.85, 0.4], 10, 300);
    this.particles.glow(e.x, cy, 220, [1, 0.8, 0.5], 0.2);
    this.sfx(e.kind === 'drone' ? 'droneDie' : 'enemyDie');
    this.hitstop(e.elite ? 0.09 : 0.03);
    this.shake(e.elite ? 0.4 : 0.14);

    const n = randInt(...e.def.potions) * (e.elite ? 3 : 1);
    this.spawnPotions(e.x, cy, n);
    const h = this.hero;
    if (chance(e.elite ? 0.8 : 0.085)) {
      const r = Math.random();
      const color = h.hp < h.maxHp * 0.5 && r < 0.6 ? 'Green' : r < 0.4 ? 'Green' : r < 0.7 ? 'Red' : 'Purple';
      this.spawnItem(e.x, color);
    }

    // Last guard of the wave: cinematic slow-mo.
    if (this.mode === 'play' && this.phase === 'fight' && this.budget <= 0 && this.enemies.every((o) => o.dead)) {
      this.slowmo(0.9, 0.25);
      this.zoomKick += 0.06;
    }
  }

  onHeroHurt(dmg) {
    this.shake(0.45);
    this.hitstop(0.07);
    this.hurtA = 1;
    this.sfx('hurt');
    this.popups.add(this.hero.x, this.hero.top - 10, '-' + Math.round(dmg), [1, 0.35, 0.3], 36);
    this.particles.sparks(this.hero.x, this.hero.y - 90, 0, [1, 0.5, 0.3], 10, 400, Math.PI);
    this.combo = 0;
    this.comboT = 0;
    this.ui.updateCombo(0, 0, 0);
    this.ui.updateHp(this.hero.hp, this.hero.maxHp);
  }

  onHeroDeath() {
    this.slowmo(2, 0.3);
    this.zoomKick += 0.08;
    this.ui.showGo(false);
    this.later(2.4, () => this.gameOver());
  }

  gameOver() {
    if (this.mode !== 'play') return;
    const p = this.profile;
    const newBest = this.score > p.best;
    if (newBest) p.best = this.score;
    this.saveProfile();
    this.sfx('gameover');
    this.ui.showGameOver({
      score: this.score, best: p.best, newBest, kills: this.kills,
      sector: this.sector + 1, wave: Math.max(1, this.wave), potions: this.potionsEarned, combo: this.bestCombo,
      raid: this.raid, globalWave: Math.max(1, this.globalWave + 1),
      weapon: WEAPONS.findIndex((w) => w.key === this.hero.weapon.key) + 1,
    });
  }

  saveProfile() { this.ui.saveProfile(); }

  // ------------------------------------------------------------- motes ----

  updateMotes(dt) {
    if (!this.motes.length) {
      for (let i = 0; i < 46; i++) {
        this.motes.push({ x: rand(0, 2400), y: rand(60, GROUND_Y), s: rand(3, 9), v: rand(6, 22), ph: rand(0, 6.28), depth: rand(0.6, 1) });
      }
    }
    for (const m of this.motes) {
      m.y -= m.v * dt;
      m.ph += dt * 0.7;
      if (m.y < 40) m.y = GROUND_Y;
    }
  }

  // ------------------------------------------------------------- render ----

  render() {
    const r = this.r;
    const zone = ZONES[this.zoneIndex];
    const W = this.viewW, H = this.viewH;
    r.begin(W, H, zone.clear);

    const zoom = 1 + this.zoomKick;
    const tr = this.trauma * this.trauma;
    const shx = wobble(this.time * 1.4, 1) * 26 * tr;
    const shy = wobble(this.time * 1.4, 7) * 20 * tr;
    const camCX = this.cam.x + W / 2;
    const camCY = VIEW_H - H / 2;
    const layer = (f) => r.setCamera(zoom, W / 2 - camCX * f * zoom + shx * f, H / 2 - camCY * zoom + shy);

    // Lab backdrop.
    layer(1);
    const left = camCX - W / 2 / zoom - 40, right = camCX + W / 2 / zoom + 40;
    const n = zone.panels.length;
    for (let k = Math.floor(left / PANEL_W); k * PANEL_W < right; k++) {
      const key = zone.panels[((k % n) + n) % n];
      r.sprite(this.img[key], k * PANEL_W, 0, PANEL_W + 1, VIEW_H, 0, 0xffffffff, 0, 0, 0, 0);
    }

    // Floating dust in the lamp light.
    const mc = zone.motes;
    for (const m of this.motes) {
      const span = right - left + 100;
      const wx = m.x + Math.sin(m.ph) * 30 + this.cam.x * (1 - m.depth) - (left - 50);
      const x = left - 50 + (((wx % span) + span) % span);
      r.sprite(this.tex.glow, x, m.y, m.s * 3, m.s * 3, 0, rgba(mc[0], mc[1], mc[2], 0.22 * m.depth), 1);
    }

    for (const e of this.enemies) e.drawShadow(r);
    this.hero.drawShadow(r);
    this.particles.draw(r, 0);

    for (const p of this.pickups) {
      if (p.type !== 'potion') continue;
      const blink = p.t > p.life - 2 ? 0.5 + 0.5 * Math.cos(p.t * 18) : 1;
      r.sprite(this.tex.glow, p.x, p.y, 70, 70, 0, rgba(0.5, 1, 0.3, 0.35 * blink), 1);
      r.sprite(this.img.potion, p.x, p.y, 26, 33, p.rot, rgba(1, 1, 1, blink));
    }
    for (const p of this.pickups) {
      if (p.type !== 'item') continue;
      const pop = p.t < 0.4 ? ease.outBack(p.t / 0.4) : 1;
      const blink = p.t > p.life - 2.5 ? 0.55 + 0.45 * Math.cos(p.t * 16) : 1;
      const col = { Green: [0.5, 1, 0.3], Red: [1, 0.35, 0.3], Purple: [0.75, 0.45, 1] }[p.color];
      r.sprite(this.tex.glow, p.fx.x, p.fx.y, 150 * pop, 150 * pop, 0, rgba(col[0], col[1], col[2], 0.45 * blink), 1);
      p.fx.scale = 0.42 * pop;
      p.fx.tint = [1, 1, 1, blink];
      p.fx.draw(r);
    }

    // Actors: corpses, then ground troops, the hero, and drones on top.
    for (const e of this.enemies) if (e.dead) e.draw(r);
    for (const e of this.enemies) if (!e.dead && e.kind !== 'drone') e.draw(r);
    this.hero.draw(r);
    for (const e of this.enemies) if (!e.dead && e.kind === 'drone') e.draw(r);
    for (const e of this.enemies) e.drawOverlay(r);

    for (const b of this.bombs) r.sprite(this.img.bomb, b.x, b.y, 40, 50, b.rot);
    for (const s of this.hostile) {
      const img = s.img;
      if (s.kind === 'dynamite') r.sprite(img, s.x, s.y, img.width * s.scale, img.height * s.scale, s.rot);
      else {
        r.sprite(this.tex.glow, s.x, s.y, 60, 60, 0, rgba(1, 0.45, 0.25, 0.6), 1);
        r.sprite(img, s.x, s.y, img.width * s.scale, img.height * s.scale, Math.atan2(s.vy, s.vx));
      }
    }
    for (const s of this.shots) {
      const img = this.img[s.w.proj];
      const sc = s.w.projScale * (s.t < 0.05 ? 0.6 + 8 * s.t : 1);
      const c = s.w.color;
      r.sprite(this.tex.glow, s.x, s.y, s.w.radius * 6, s.w.radius * 6, 0, rgba(c[0], c[1], c[2], 0.5), 1);
      const rot = Math.atan2(s.vy, s.vx);
      // Streak images have their head on the right: anchor there so they trail behind.
      const elongated = img.width > img.height * 2;
      r.sprite(img, s.x, s.y, img.width * sc, img.height * sc, rot, 0xffffffff, 0, 0, elongated ? 0.85 : 0.5, 0.5);
    }

    for (const f of this.fx) f.draw(r);
    for (const b of this.bolts) this.drawBolt(r, b);
    this.particles.draw(r, 1);
    this.popups.draw(r);

    // Foreground silhouettes scroll faster for depth.
    for (const l of zone.fg) {
      const img = this.img[l.img];
      layer(l.factor);
      const lc = camCX * l.factor;
      const lw = img.width;
      const y = l.y === 'top' ? 0 : VIEW_H - img.height;
      const a = l.alpha ?? 1;
      for (let k = Math.floor((lc - W / zoom) / lw); k * lw < lc + W / zoom; k++) {
        r.sprite(img, k * lw, y, lw + 1, img.height, 0, rgba(a, a, a, a), 0, 0, 0, 0);
      }
    }

    // Screen-space overlays.
    r.setCamera(1, 0, 0);
    r.sprite(this.tex.vignette, W / 2, H / 2, W * 1.2, H * 1.5, 0, rgba(1, 1, 1, 0.6));
    if (this.hurtA > 0.01) r.sprite(this.tex.vignette, W / 2, H / 2, W * 1.05, H * 1.25, 0, rgba(1, 1, 1, this.hurtA * 0.85), 0, rgba(0.85, 0.05, 0.05, 1));
    if (this.flashA > 0.01) r.rect(0, 0, W, H, rgba(1, 0.92, 0.75, this.flashA));
    r.end();
  }

  drawBolt(r, b) {
    const a = 1 - b.t / b.life;
    const c = b.color;
    const P = b.pts;
    for (let i = 0; i + 3 < P.length; i += 2) {
      const x0 = P[i], y0 = P[i + 1], x1 = P[i + 2], y1 = P[i + 3];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const rot = Math.atan2(y1 - y0, x1 - x0);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      r.sprite(this.tex.glow, cx, cy, len * 1.6, 30, rot, rgba(c[0], c[1], c[2], 0.5 * a), 1);
      r.sprite(r.white, cx, cy, len + 3, 4, rot, rgba(0.9, 0.97, 1, a), 1);
    }
  }
}
