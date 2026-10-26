// Tiny WebAudio synthesiser: every sound effect (and the music loop) is
// generated on the fly, so the game ships without audio files.

// Bass line in semitones above A1, one entry per 8th note (null = rest).
const BASS = [
  0, null, 0, 12, null, 0, 3, null, 0, null, 0, 12, 10, null, 7, 3,
  -2, null, -2, 10, null, -2, 3, null, 5, null, 5, 3, 2, null, 0, -2,
];
const ARP = [0, 3, 7, 12, 10, 7, 3, 5, 0, 7, 12, 15];

export class Sfx {
  constructor(muted = false) {
    this.ctx = null;
    this.muted = muted;
    this.last = new Map();
  }

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(comp);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  tone(type, f0, f1, dur, vol, delay = 0, attack = 0.004, dest = this.master, at = 0) {
    const ctx = this.ctx, t = (at || ctx.currentTime) + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol, filter = 'lowpass', f0 = 2000, f1 = f0, q = 1, delay = 0, dest = this.master, at = 0) {
    const ctx = this.ctx, t = (at || ctx.currentTime) + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------- music --

  /** Start the looping lab groove (A minor, 112 bpm, 8th-note steps). */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.music = this.ctx.createGain();
    this.music.gain.value = 0;
    this.music.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.8);
    this.music.connect(this.master);
    this.step = 0;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 40);
  }

  setMusicLevel(level) {
    if (this.music) this.music.gain.setTargetAtTime(0.5 * level, this.ctx.currentTime, 0.25);
  }

  scheduleMusic() {
    const spb = 60 / 112 / 2;
    while (this.nextStep < this.ctx.currentTime + 0.25) {
      this.musicStep(this.step, this.nextStep);
      this.nextStep += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  musicStep(s, t) {
    const out = this.music;
    const bar = Math.floor(s / 8) % 8, beat = s % 8;
    const bass = BASS[s % 32];
    if (bass !== null) {
      const f = 55 * 2 ** (bass / 12);
      this.tone('sawtooth', f, f * 0.99, 0.2, 0.09, 0, 0.005, out, t);
      this.tone('square', f / 2, f / 2, 0.16, 0.05, 0, 0.005, out, t);
    }
    if (beat === 0 || beat === 4 || (beat === 7 && bar % 2)) this.tone('sine', 150, 42, 0.22, 0.42, 0, 0.002, out, t);
    if (beat === 2 || beat === 6) this.noise(0.13, 0.13, 'bandpass', 1900, 1200, 0.8, 0, out, t);
    this.noise(0.03, beat % 2 ? 0.05 : 0.025, 'highpass', 7500, 7500, 1, 0, out, t);
    if (bar >= 4) {
      const n = ARP[(s + bar) % ARP.length];
      const f = 440 * 2 ** (n / 12);
      this.tone('triangle', f, f, 0.14, 0.035, 0, 0.004, out, t);
    }
  }

  play(name, pitch = 1) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - (this.last.get(name) || 0) < 35) return; // avoid stacking identical sounds
    this.last.set(name, now);
    const p = pitch * (0.94 + Math.random() * 0.12);
    switch (name) {
      case 'plasma': this.tone('square', 900 * p, 260 * p, 0.09, 0.16); this.noise(0.04, 0.08, 'highpass', 3000); break;
      case 'goo': this.tone('sine', 240 * p, 700 * p, 0.11, 0.3); this.tone('sine', 520 * p, 180 * p, 0.08, 0.12, 0.04); break;
      case 'fire': this.noise(0.28, 0.32, 'lowpass', 1800, 220, 1); this.tone('sawtooth', 220 * p, 70, 0.22, 0.16); break;
      case 'zap': this.tone('sawtooth', 1600 * p, 240, 0.16, 0.14); this.noise(0.16, 0.16, 'bandpass', 3500, 1500, 4); break;
      case 'rail': this.tone('sawtooth', 2400 * p, 90, 0.26, 0.17); this.noise(0.1, 0.18, 'highpass', 5000); break;
      case 'cryo': this.tone('sine', 1500 * p, 700, 0.14, 0.2); this.tone('triangle', 2300 * p, 1100, 0.12, 0.1); break;
      case 'rapid': this.tone('square', 1300 * p, 500, 0.05, 0.1); this.noise(0.03, 0.06, 'highpass', 4000); break;
      case 'boom': this.tone('sawtooth', 320 * p, 60, 0.2, 0.22); this.noise(0.22, 0.3, 'lowpass', 1500, 200); break;
      case 'punch': this.noise(0.12, 0.35, 'lowpass', 900, 150, 2); this.tone('sine', 170 * p, 55, 0.14, 0.4); break;
      case 'spit': this.tone('square', 700 * p, 240, 0.08, 0.12); this.tone('sine', 400 * p, 120, 0.1, 0.18); break;
      case 'hit': this.noise(0.05, 0.22, 'bandpass', 1600 * p, 900, 2); this.tone('square', 220 * p, 110, 0.05, 0.06); break;
      case 'crit': this.tone('square', 1200 * p, 1800, 0.07, 0.1); this.noise(0.06, 0.25, 'bandpass', 2600, 1200, 2); break;
      case 'explode':
        this.noise(0.7, 0.75, 'lowpass', 1400 * p, 70, 1);
        this.tone('sine', 130 * p, 28, 0.55, 0.7);
        break;
      case 'enemyShot': this.tone('square', 640 * p, 280, 0.08, 0.08); this.noise(0.05, 0.08, 'bandpass', 2000); break;
      case 'swing': this.noise(0.18, 0.14, 'bandpass', 500, 2200, 3); break;
      case 'hurt': this.tone('sawtooth', 420 * p, 110, 0.26, 0.25); this.noise(0.12, 0.2, 'lowpass', 1200, 300); break;
      case 'potion': this.tone('triangle', 1250 * p, 1900 * p, 0.07, 0.12); break;
      case 'powerup': [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f * 1.01, 0.1, 0.09, i * 0.06)); break;
      case 'jump': this.tone('sine', 280 * p, 640 * p, 0.12, 0.14); break;
      case 'land': this.noise(0.08, 0.16, 'lowpass', 500, 120); break;
      case 'throw': this.noise(0.22, 0.16, 'bandpass', 600, 2400, 3); break;
      case 'freeze': this.tone('sine', 2100 * p, 3300, 0.28, 0.08); this.noise(0.3, 0.12, 'highpass', 6000); break;
      case 'shatter': this.noise(0.25, 0.3, 'highpass', 3000, 6000); this.tone('triangle', 2600 * p, 1200, 0.15, 0.08); break;
      case 'shock': this.noise(0.25, 0.18, 'bandpass', 2500, 4000, 6); this.tone('sawtooth', 90, 110, 0.25, 0.08); break;
      case 'enemyDie': this.tone('square', 520 * p, 70, 0.3, 0.1); break;
      case 'droneDie': this.tone('sawtooth', 900 * p, 60, 0.4, 0.13); this.noise(0.3, 0.2, 'bandpass', 1500, 400, 2); break;
      case 'ui': this.tone('sine', 660, 990, 0.06, 0.16); break;
      case 'uiBack': this.tone('sine', 880, 560, 0.06, 0.14); break;
      case 'deny': this.tone('square', 220, 180, 0.12, 0.1); this.tone('square', 180, 150, 0.12, 0.1, 0.1); break;
      case 'unlock': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.14, i * 0.07)); break;
      case 'wave': [392, 523, 659].forEach((f, i) => this.tone('square', f, f, 0.14, 0.08, i * 0.09)); break;
      case 'clear': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('triangle', f, f, 0.2, 0.13, i * 0.08)); break;
      case 'gameover': [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.32, 0.16, i * 0.22)); break;
      case 'step': this.noise(0.04, 0.05, 'lowpass', 300, 120); break;
    }
  }
}
