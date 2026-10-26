import { Renderer } from './gl.js';
import { loadSkeletonData } from './spine.js';
import { SKELETONS, IMAGES, ROOT, loadImage } from './assets.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { VIEW_H } from './data.js';
import { loadProfile } from './util.js';
import { Hemi } from './hemi.js';

const canvas = document.getElementById('game');

function fatal(msg) {
  const el = document.getElementById('fatal');
  el.hidden = false;
  el.textContent = msg;
}

async function boot() {
  let renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (e) {
    fatal('This game needs WebGL. Please try a different browser or enable hardware acceleration.');
    throw e;
  }

  const profile = loadProfile();
  const sfx = new Sfx(profile.muted);
  const input = new Input(canvas);
  const hemi = new Hemi();
  const ui = new UI({ profile, sfx, input, hemi });
  const unlockAudio = () => { sfx.unlock(); sfx.startMusic(); };
  addEventListener('pointerdown', unlockAudio);
  addEventListener('keydown', unlockAudio);

  let game = null;
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    let dpr = Math.min(devicePixelRatio || 1, 2);
    if (w * h * dpr * dpr > 4.2e6) dpr = Math.sqrt(4.2e6 / (w * h));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    let viewH = VIEW_H, viewW = (VIEW_H * w) / h;
    if (viewW < 1000) { viewW = 1000; viewH = (1000 * h) / w; }
    game?.resize(viewW, viewH);
    return [viewW, viewH];
  };
  addEventListener('resize', resize);
  const [vw, vh] = resize();

  // Fonts are needed before the glyph atlas for damage numbers is baked.
  const fonts = Promise.race([
    Promise.all([document.fonts.load('64px "Luckiest Guy"'), document.fonts.load('20px "Passion One"')]),
    new Promise((r) => setTimeout(r, 4000)),
  ]).catch(() => {});

  const assets = { skel: {}, img: {} };
  const jobs = [
    ...Object.entries(SKELETONS).map(([key, dir]) => () =>
      loadSkeletonData(renderer, dir, loadImage).then((d) => { assets.skel[key] = d; })),
    ...Object.entries(IMAGES).map(([key, path]) => () =>
      loadImage(ROOT + path).then((img) => { assets.img[key] = renderer.createTexture(img); })),
  ];
  let done = 0;
  await Promise.all(jobs.map((job) => job().then(() => ui.setLoading(++done / jobs.length))));
  await fonts;

  // The jump is driven by physics, so drop the leap baked into the animation.
  for (const [key, data] of Object.entries(assets.skel)) {
    if (key.startsWith('Gun')) data.animations.Jump.strip(data.boneIndex.AllBone, 'translate');
  }

  game = new Game({ renderer, assets, input, sfx, profile, ui });
  game.resize(vw, vh);
  ui.attach(game);
  window.__game = game; // handy for debugging from the console
  window.__hemi = hemi;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { ui.autoPause(); sfx.ctx?.suspend(); } else sfx.ctx?.resume();
  });

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    game.update(dt);
    game.render();
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setTimeout(() => ui.show('title'), 250);
}

boot().catch((e) => {
  console.error(e);
  if (document.getElementById('fatal').hidden) fatal('Something went wrong while loading the lab: ' + e.message);
});
