// DOM overlay: menus, armory, HUD, modals and touch controls. All motion is
// CSS transitions/animations so it stays smooth while the canvas renders.

import { WEAPONS, WEAPON_BY_KEY } from './data.js';
import { ROOT, uiPath } from './assets.js';
import { saveProfile } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const gunImage = (key) => encodeURI(`${ROOT}Spine/Main Characters/${key}/Images/Hand_W_Gun.png`);

function countUp(el, to, dur = 900) {
  const from = 0, t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - (1 - k) ** 3;
    el.textContent = Math.round(from + (to - from) * e).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth; // restart the animation
  el.classList.add('bump');
}

export class UI {
  constructor({ profile, sfx, input }) {
    this.profile = profile;
    this.sfx = sfx;
    this.input = input;
    this.game = null;
    this.current = 'loading';
    this.selected = profile.equipped;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.body.classList.toggle('touch', this.isTouch);

    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (b) this.action(b.dataset.action, b);
    });
    addEventListener('keydown', (e) => this.onKey(e));
    this.buildArmory();
    this.buildTouch();
    this.updateSoundIcon();
  }

  attach(game) {
    this.game = game;
    this.refreshTitle();
  }

  saveProfile() { saveProfile(this.profile); }

  // ---------------------------------------------------------- screens --

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id || (id === 'pause' && s.id === 'hud') || (id === 'gameover' && s.id === 'hud'));
    this.current = id;
    document.body.dataset.screen = id;
    if (id === 'title') this.refreshTitle();
  }

  setLoading(frac) {
    $('#loading .loadbar i').style.transform = `scaleX(${frac})`;
  }

  refreshTitle() {
    $('#tPotions').textContent = this.profile.potions.toLocaleString();
    $('#tBest').textContent = this.profile.best.toLocaleString();
    $('#tGun').textContent = WEAPON_BY_KEY[this.profile.equipped].name;
  }

  action(a, el) {
    const g = this.game;
    this.sfx.unlock();
    switch (a) {
      case 'play':
        this.sfx.play('ui');
        this.show('hud');
        g.startRun();
        break;
      case 'armory':
        this.sfx.play('ui');
        if (g.mode !== 'menu') g.enterMenu();
        g.enterArmory();
        this.openArmory();
        break;
      case 'back':
        this.sfx.play('uiBack');
        g.previewWeapon(this.profile.equipped);
        g.demoFireT = 0;
        g.mode = 'menu';
        this.show('title');
        break;
      case 'pause': this.togglePause(); break;
      case 'resume': this.togglePause(false); break;
      case 'restart':
        this.sfx.play('ui');
        this.show('hud');
        g.startRun();
        break;
      case 'menu':
        this.sfx.play('uiBack');
        this.sfx.setMusicLevel(1);
        this.saveProfile();
        g.enterMenu();
        this.show('title');
        break;
      case 'sound':
        this.profile.muted = !this.profile.muted;
        this.sfx.setMuted(this.profile.muted);
        this.saveProfile();
        this.updateSoundIcon();
        this.sfx.play('ui');
        break;
      case 'weapon':
        this.selectWeapon(el.dataset.key);
        break;
      case 'equip':
        this.equipSelected();
        break;
    }
  }

  onKey(e) {
    const g = this.game;
    if (!g) return;
    if (this.current === 'title' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      this.action('play');
    } else if (this.current === 'armory' && e.code === 'Escape') this.action('back');
    else if ((this.current === 'hud' || this.current === 'pause') && (e.code === 'Escape' || e.code === 'KeyP')) this.togglePause();
    else if (this.current === 'gameover' && e.code === 'Enter') this.action('restart');
    else if (e.code === 'KeyM') this.action('sound');
  }

  togglePause(force) {
    const g = this.game;
    if (g.mode !== 'play' || g.hero.dead) return;
    const p = force ?? !g.paused;
    g.paused = p;
    this.sfx.setMusicLevel(p ? 0.3 : 1);
    this.input.reset();
    this.sfx.play(p ? 'uiBack' : 'ui');
    this.show(p ? 'pause' : 'hud');
  }

  autoPause() {
    if (this.game?.mode === 'play' && !this.game.paused && !this.game.hero.dead && this.current === 'hud') this.togglePause(true);
  }

  updateSoundIcon() {
    document.body.classList.toggle('muted', this.profile.muted);
  }

  fadeThrough(cb) {
    const f = $('#fade');
    f.classList.add('on');
    setTimeout(() => {
      cb();
      f.classList.remove('on');
    }, 650);
  }

  // ------------------------------------------------------------ armory --

  buildArmory() {
    const grid = $('#weaponGrid');
    grid.innerHTML = WEAPONS.map((w, i) => `
      <button class="card" data-action="weapon" data-key="${w.key}" style="--i:${i}" aria-label="${w.name}">
        <span class="gun" style="background-image:url('${gunImage(w.key)}')"></span>
        <span class="name">${w.name}</span>
        <span class="cost"><img src="${uiPath('Potion.png')}" alt="">${w.cost}</span>
        <img class="lock" src="${uiPath('LockedIcon.png')}" alt="Locked">
        <img class="check" src="${uiPath('Checklist.png')}" alt="Equipped">
      </button>`).join('');
  }

  openArmory() {
    this.selected = this.profile.equipped;
    this.show('armory');
    this.refreshArmory();
    this.selectWeapon(this.selected, true);
  }

  refreshArmory() {
    const p = this.profile;
    $('#aPotions').textContent = p.potions.toLocaleString();
    for (const card of document.querySelectorAll('#weaponGrid .card')) {
      const k = card.dataset.key, w = WEAPON_BY_KEY[k];
      const owned = p.unlocked.includes(k);
      card.classList.toggle('locked', !owned);
      card.classList.toggle('affordable', !owned && p.potions >= w.cost);
      card.classList.toggle('equipped', p.equipped === k);
      card.classList.toggle('selected', this.selected === k);
    }
    const w = WEAPON_BY_KEY[this.selected];
    const owned = p.unlocked.includes(w.key);
    const btn = $('#wAction');
    btn.classList.remove('deny');
    if (p.equipped === w.key) { btn.textContent = 'EQUIPPED'; btn.disabled = true; }
    else if (owned) { btn.textContent = 'EQUIP'; btn.disabled = false; }
    else if (p.potions >= w.cost) { btn.innerHTML = `UNLOCK <small><img src="${uiPath('Potion.png')}" alt="">${w.cost}</small>`; btn.disabled = false; }
    else { btn.innerHTML = `NEED <small><img src="${uiPath('Potion.png')}" alt="">${w.cost}</small>`; btn.disabled = false; btn.classList.add('deny'); }
  }

  selectWeapon(key, silent = false) {
    const w = WEAPON_BY_KEY[key];
    this.selected = key;
    const d = $('#weaponDetail');
    d.classList.remove('swap');
    void d.offsetWidth;
    d.classList.add('swap');
    $('#wName').textContent = w.name;
    $('#wBlurb').textContent = w.blurb;
    $('#wSpecial').textContent = w.special;
    $('#wPower').style.setProperty('--v', w.stats.power / 5);
    $('#wRate').style.setProperty('--v', w.stats.rate / 5);
    this.refreshArmory();
    if (!silent) this.sfx.play('ui');
    this.game.previewWeapon(key);
  }

  equipSelected() {
    const p = this.profile, w = WEAPON_BY_KEY[this.selected];
    const g = this.game;
    if (p.equipped === w.key) return;
    if (!p.unlocked.includes(w.key)) {
      if (p.potions < w.cost) {
        this.sfx.play('deny');
        bump($('#wAction'));
        bump($('#aPotions').parentElement);
        return;
      }
      p.potions -= w.cost;
      p.unlocked.push(w.key);
      this.sfx.play('unlock');
      g.particles.burst(g.hero.x, g.hero.y - 100, w.color, 24, 420);
      g.particles.ring(g.hero.x, g.hero.y - 100, 420, w.color, 0.6, 0);
    } else this.sfx.play('ui');
    p.equipped = w.key;
    this.saveProfile();
    const card = document.querySelector(`#weaponGrid .card[data-key="${w.key}"]`);
    bump(card);
    g.demoFireT = 1.4;
    this.refreshArmory();
  }

  // --------------------------------------------------------------- HUD --

  onRunStart() {
    const g = this.game;
    this.sfx.setMusicLevel(1);
    this.updateHp(g.hero.hp, g.hero.maxHp, true);
    this.updateScore(0);
    this.updatePotions(this.profile.potions);
    this.updateBombs();
    this.updateCombo(0, 0, 0);
    this.updateWave(1, 0);
    this.showGo(false);
    $('#rageBar').classList.remove('on');
    $('#hint').classList.toggle('on', !!this.profile.tutorial);
    if (this.profile.tutorial) {
      clearTimeout(this.hintTimer);
      this.hintTimer = setTimeout(() => {
        $('#hint').classList.remove('on');
        this.profile.tutorial = false;
        this.saveProfile();
      }, 9000);
    }
  }

  updateHp(hp, max, instant = false) {
    const k = Math.max(0, hp / max);
    const hud = $('#hud');
    if (instant) hud.classList.add('instant');
    $('#hpFill').style.transform = `scaleX(${k})`;
    $('#hpGhost').style.transform = `scaleX(${k})`;
    $('#hpText').textContent = `${Math.ceil(hp)} / ${max}`;
    hud.classList.toggle('low', k < 0.3 && k > 0);
    if (instant) requestAnimationFrame(() => hud.classList.remove('instant'));
    else bump($('.profile'));
  }

  updateScore(s) {
    const el = $('#score');
    el.textContent = s.toLocaleString();
    if (s) bump(el);
  }

  updatePotions(n, pulse = false) {
    $('#potions').textContent = n.toLocaleString();
    if (pulse) bump($('.potionbar'));
  }

  updateBombs() {
    const n = this.game.hero.bombs;
    for (const el of document.querySelectorAll('.bomb-count')) el.textContent = n;
    document.body.classList.toggle('no-bombs', n <= 0);
  }

  bombDenied() { for (const el of document.querySelectorAll('.bomb-hud, .t-bomb')) bump(el); }

  updateWave(sector, wave) {
    $('#waveLabel').innerHTML = `SECTOR ${sector}${wave ? ` <i></i> WAVE ${wave}/5` : ''}`;
  }

  updateCombo(n, mult, frac) {
    const c = $('#combo');
    if (n < 2) { c.classList.remove('on'); return; }
    c.classList.add('on');
    const num = $('#comboNum');
    if (num.textContent !== String(n)) {
      num.textContent = n;
      bump(num);
    }
    $('#comboMult').textContent = mult > 1 ? `×${mult}` : '';
    $('#comboBar').style.transform = `scaleX(${frac})`;
  }

  rage(sec) {
    const r = $('#rageBar');
    r.classList.remove('on');
    void r.offsetWidth;
    r.style.setProperty('--dur', sec + 's');
    r.classList.add('on');
  }

  banner(title, sub = '', style = '') {
    const b = $('#banner');
    $('h2', b).textContent = title;
    $('p', b).textContent = sub;
    b.className = 'banner ' + style;
    void b.offsetWidth;
    b.classList.add('play');
  }

  showGo(on) {
    $('#go').classList.toggle('on', on);
  }

  showGameOver(s) {
    this.show('gameover');
    this.sfx.setMusicLevel(0.35);
    $('#goScore').textContent = '0';
    countUp($('#goScore'), s.score, 1100);
    $('#goBest').textContent = s.best.toLocaleString();
    $('#goKills').textContent = s.kills;
    $('#goWave').textContent = `${s.sector}-${s.wave}`;
    $('#goPotions').textContent = '+' + s.potions;
    $('#goCombo').textContent = s.combo;
    $('#gameover').classList.toggle('new-best', s.newBest);
  }

  // ------------------------------------------------------------- touch --

  buildTouch() {
    const input = this.input;
    const stick = $('#stick'), knob = $('#stick i');
    let id = null, cx = 0;
    const move = (x) => {
      const dx = Math.max(-1, Math.min(1, (x - cx) / 55));
      knob.style.transform = `translate(${dx * 46}px, 0)`;
      input.stick = Math.abs(dx) < 0.2 ? 0 : dx;
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      stick.setPointerCapture(id);
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      move(e.clientX);
      this.sfx.unlock();
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e.clientX); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      input.stick = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    for (const btn of document.querySelectorAll('[data-touch]')) {
      const a = btn.dataset.touch;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('down');
        input.press(a);
        this.sfx.unlock();
      });
      const up = () => { btn.classList.remove('down'); input.release(a); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    }
    addEventListener('touchstart', () => {
      if (!this.isTouch) { this.isTouch = true; document.body.classList.add('touch'); }
    }, { passive: true });
  }
}
