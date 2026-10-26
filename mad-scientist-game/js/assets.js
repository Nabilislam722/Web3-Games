// Asset manifest. Everything is loaded straight from the "Mad scientist"
// asset pack at the repository root, so the art is never duplicated.

export const ROOT = '../Mad scientist/';

const pad = (n) => String(n).padStart(2, '0');

export const SKELETONS = {};
for (let i = 1; i <= 10; i++) SKELETONS[`Gun${pad(i)}`] = `${ROOT}Spine/Main Characters/Gun${pad(i)}/`;
for (let i = 1; i <= 10; i++) SKELETONS[`Enemy${pad(i)}`] = `${ROOT}Spine/Enemy/Enemy Character${pad(i)}/`;
Object.assign(SKELETONS, {
  ItemGreen: `${ROOT}Spine/Items/Green/`,
  ItemRed: `${ROOT}Spine/Items/Red/`,
  ItemPurple: `${ROOT}Spine/Items/Purple/`,
  FxCollision: `${ROOT}Spine/FX/Collision Fx/`,
  FxLightning: `${ROOT}Spine/FX/Projectile/Fx01/`,
  FxGlove: `${ROOT}Spine/FX/Projectile/Fx02/`,
  FxMuzzle: `${ROOT}Spine/FX/ShootFx/Fx01/`,
  FxSmoke: `${ROOT}Spine/FX/ShootFx/Fx02/`,
});

export const IMAGES = {
  bg1: 'PNG/Backgrounds/1.png',
  bg2: 'PNG/Backgrounds/2.png',
  bg3: 'PNG/Backgrounds/3.png',
  bg4: 'PNG/Backgrounds/4.png',
  bg5: 'PNG/Backgrounds/5.png',
  bg6: 'PNG/Backgrounds/6.png',
  ceilA: 'PNG/Backgrounds/7.png',
  floorA: 'PNG/Backgrounds/8.png',
  ceilB: 'PNG/Backgrounds/9.png',
  hangB: 'PNG/Backgrounds/10.png',
  ceilC: 'PNG/Backgrounds/11.png',
  ceilD: 'PNG/Backgrounds/12.png',
  shotYellowSmall: 'PNG/Projectile/Other/08.png',
  shotBlue: 'PNG/Projectile/Other/09.png',
  bomb: 'PNG/Projectile/Other/1.png',
  dynamite: 'PNG/Projectile/Other/2.png',
  shotYellow: 'PNG/Projectile/Other/3.png',
  shellBrown: 'PNG/Projectile/Other/4.png',
  shellGreen: 'PNG/Projectile/Other/5.png',
  orbOrange: 'PNG/Projectile/Other/6.png',
  orbBlue: 'PNG/Projectile/Other/7.png',
  orbGreen: 'PNG/Projectile/Other/8.png',
  fireball: 'PNG/Projectile/Other/10.png',
  fireballRed: 'PNG/Projectile/Other/11.png',
  shotOrange: 'PNG/Projectile/Other/12.png',
  flask: 'PNG/Projectile/Other/13.png',
  potion: 'PNG/User Interfaces/Potion.png',
  heart: 'PNG/User Interfaces/HpICon.png',
};

const imageCache = new Map();

export function loadImage(path) {
  if (imageCache.has(path)) return imageCache.get(path);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + path));
    img.src = encodeURI(path);
  });
  imageCache.set(path, p);
  return p;
}

export const uiPath = (file) => encodeURI(`${ROOT}PNG/User Interfaces/${file}`);
