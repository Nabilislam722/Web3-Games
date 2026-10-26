// Game tuning: weapons, enemies and wave composition.

export const GROUND_Y = 700;
export const VIEW_H = 800;
export const HERO_SCALE = 0.7;
export const ENEMY_SCALE = 0.68;

// `muzzle` = barrel tip as a fraction of the Hand_W_Gun image (x from the
// left, y from the bottom), measured from the art.
export const WEAPONS = [
  {
    key: 'Gun01', name: 'Plasma Claw', cost: 0, blurb: 'Trusty plasma bolts. Point, squeeze, giggle maniacally.',
    kind: 'bullet', rate: 0.16, dmg: 13, speed: 1500, proj: 'shotBlue', projScale: 0.75, radius: 10, spread: 1.5,
    life: 0.9, color: [0.35, 0.75, 1], muzzle: [0.86, 0.35], anim: 'ShootFX1', sfx: 'plasma', recoil: 40, shake: 0.04,
    stats: { power: 2, rate: 4 }, special: 'Balanced',
  },
  {
    key: 'Gun02', name: 'Goo Slinger', cost: 60, blurb: 'Lobs corrosive goo that keeps eating through hazmat suits.',
    kind: 'bullet', rate: 0.22, dmg: 8, speed: 1050, gravity: 320, proj: 'orbGreen', projScale: 0.38, radius: 14, spread: 2,
    life: 1.2, color: [0.55, 1, 0.3], muzzle: [0.992, 0.221], anim: 'ShootFX1', sfx: 'goo', recoil: 30, shake: 0.04,
    effect: { type: 'acid', dps: 14, dur: 2.5 }, stats: { power: 2, rate: 3 }, special: 'Acid damage over time',
  },
  {
    key: 'Gun03', name: 'Inferno Horn', cost: 140, blurb: 'A blunderbuss that belches piercing fireballs.',
    kind: 'bullet', rate: 0.5, dmg: 30, speed: 950, proj: 'fireball', projScale: 0.62, radius: 26, spread: 0,
    life: 1.1, pierce: 3, color: [1, 0.55, 0.15], muzzle: [0.992, 0.393], anim: 'ShootFX2', sfx: 'fire', recoil: 120, shake: 0.16,
    effect: { type: 'burn', dps: 16, dur: 2 }, stats: { power: 4, rate: 2 }, special: 'Pierces · Burns',
  },
  {
    key: 'Gun04', name: 'Tesla Ray', cost: 220, blurb: 'Chain lightning that fries a whole conga line of guards.',
    kind: 'beam', rate: 0.38, dmg: 20, range: 600, color: [0.6, 0.85, 1], muzzle: [0.992, 0.294], anim: 'ShootFX2',
    sfx: 'zap', recoil: 60, shake: 0.08, effect: { type: 'shock', dur: 0.7, chain: 2 }, stats: { power: 3, rate: 3 },
    special: 'Stuns · Chains',
  },
  {
    key: 'Gun05', name: 'Rail Rifle', cost: 300, blurb: 'Hypersonic slugs that go through everything. Everything.',
    kind: 'bullet', rate: 0.45, dmg: 40, speed: 3000, proj: 'shotYellow', projScale: 0.85, radius: 10, spread: 0,
    life: 0.6, pierce: 99, color: [1, 0.9, 0.4], muzzle: [0.996, 0.331], anim: 'ShootFX2', sfx: 'rail', recoil: 100, shake: 0.12,
    stats: { power: 5, rate: 2 }, special: 'Infinite pierce',
  },
  {
    key: 'Gun06', name: 'Cryo Cannon', cost: 380, blurb: 'Freezes goons solid. Frozen goons take extra damage.',
    kind: 'bullet', rate: 0.3, dmg: 14, speed: 1150, proj: 'orbBlue', projScale: 0.42, radius: 16, spread: 1,
    life: 1, color: [0.45, 0.85, 1], muzzle: [0.996, 0.383], anim: 'ShootFX1', sfx: 'cryo', recoil: 50, shake: 0.06,
    effect: { type: 'freeze', amount: 0.36 }, stats: { power: 3, rate: 3 }, special: 'Freezes',
  },
  {
    key: 'Gun07', name: 'Buzz Blaster', cost: 470, blurb: 'Why fire one bullet when you can fire all of them?',
    kind: 'bullet', rate: 0.075, dmg: 6, speed: 1700, proj: 'shotYellowSmall', projScale: 0.6, radius: 8, spread: 5,
    life: 0.8, color: [1, 0.85, 0.3], muzzle: [0.995, 0.289], anim: 'ShootFX1', sfx: 'rapid', recoil: 18, shake: 0.03,
    stats: { power: 1, rate: 5 }, special: 'Bullet hose',
  },
  {
    key: 'Gun08', name: 'Boom Tube', cost: 580, blurb: 'Shells that turn crowds into confetti.',
    kind: 'bullet', rate: 0.65, dmg: 18, speed: 950, proj: 'shellGreen', projScale: 0.45, radius: 16, spread: 0,
    life: 1.2, color: [1, 0.6, 0.2], muzzle: [0.995, 0.401], anim: 'ShootFX2', sfx: 'boom', recoil: 150, shake: 0.18,
    effect: { type: 'explode', radius: 150, dmg: 32 }, stats: { power: 5, rate: 1 }, special: 'Explosive splash',
  },
  {
    key: 'Gun09', name: 'Haymaker', cost: 700, blurb: 'A spring-loaded boxing glove. Science!',
    kind: 'punch', rate: 0.5, dmg: 36, reach: 300, knock: 950, color: [1, 0.35, 0.3], muzzle: [0.99, 0.374],
    anim: 'ShootFX2', sfx: 'punch', recoil: 40, shake: 0.15, stats: { power: 4, rate: 2 }, special: 'Massive knockback',
  },
  {
    key: 'Gun10', name: 'Shark Spitter', cost: 850, blurb: 'Close-range spread of searing orbs. Bite included.',
    kind: 'bullet', rate: 0.34, dmg: 10, count: 5, speed: 1250, proj: 'orbOrange', projScale: 0.3, radius: 13, spread: 15,
    life: 0.5, color: [1, 0.6, 0.2], muzzle: [0.995, 0.402], anim: 'ShootFX2', sfx: 'spit', recoil: 90, shake: 0.1,
    effect: { type: 'burn', dps: 8, dur: 1.5 }, stats: { power: 4, rate: 3 }, special: 'Shotgun spread',
  },
];

export const WEAPON_BY_KEY = Object.fromEntries(WEAPONS.map((w) => [w.key, w]));

// Enemy art faces left. `cost` feeds the wave budget.
export const ENEMIES = {
  Enemy01: { kind: 'melee', hp: 55, speed: 120, dmg: 12, reach: 120, score: 100, potions: [1, 2], cost: 1 },
  Enemy02: { kind: 'gunner', hp: 45, speed: 105, dmg: 9, range: [420, 620], fireCd: [1.9, 2.7], burst: 1, score: 120, potions: [1, 2], cost: 1.4 },
  Enemy03: { kind: 'melee', hp: 100, speed: 95, dmg: 18, reach: 130, score: 170, potions: [2, 3], cost: 1.9 },
  Enemy04: { kind: 'gunner', hp: 80, speed: 90, dmg: 11, range: [460, 680], fireCd: [1.8, 2.4], burst: 2, score: 180, potions: [2, 3], cost: 2 },
  Enemy05: { kind: 'melee', hp: 50, speed: 175, dmg: 10, reach: 112, score: 130, potions: [1, 2], cost: 1.2 },
  Enemy06: { kind: 'gunner', hp: 55, speed: 125, dmg: 7, range: [380, 560], fireCd: [1.1, 1.6], burst: 1, score: 140, potions: [1, 2], cost: 1.5 },
  Enemy07: { kind: 'melee', hp: 80, speed: 135, dmg: 15, reach: 120, score: 150, potions: [1, 3], cost: 1.5 },
  Enemy08: { kind: 'gunner', hp: 65, speed: 110, dmg: 9, range: [400, 600], fireCd: [1.8, 2.5], burst: 3, score: 170, potions: [2, 3], cost: 1.9 },
  Enemy09: { kind: 'drone', hp: 34, speed: 230, dmg: 14, attack: 'dynamite', fireCd: [2.2, 3.2], hover: 300, score: 150, potions: [1, 2], cost: 1.6 },
  Enemy10: { kind: 'drone', hp: 70, speed: 170, dmg: 11, attack: 'orb', fireCd: [1.9, 2.6], hover: 350, score: 220, potions: [2, 3], cost: 2.2 },
};

// Global wave index at which each enemy joins the pool.
export const ENEMY_UNLOCK = {
  Enemy01: 0, Enemy02: 0, Enemy05: 1, Enemy09: 2, Enemy06: 3, Enemy03: 4,
  Enemy07: 5, Enemy04: 5, Enemy10: 6, Enemy08: 7,
};

export const WAVES_PER_SECTOR = 5;

export const ZONES = [
  {
    name: 'Cryo Labs', panels: ['bg1', 'bg2', 'bg3'], clear: [0.02, 0.2, 0.3],
    fg: [
      { img: 'ceilB', factor: 1.12, y: 'top', alpha: 0.9 },
      { img: 'ceilA', factor: 1.3, y: 'top' },
      { img: 'floorA', factor: 1.45, y: 'bottom' },
    ],
    motes: [0.6, 0.9, 1],
  },
  {
    name: 'Bio Vault', panels: ['bg4', 'bg6', 'bg4', 'bg6', 'bg5'], clear: [0.02, 0.06, 0.08],
    fg: [
      { img: 'ceilD', factor: 1.12, y: 'top', alpha: 0.9 },
      { img: 'ceilC', factor: 1.3, y: 'top' },
      { img: 'hangB', factor: 1.5, y: 'bottom' },
    ],
    motes: [0.4, 1, 0.9],
  },
];

// Bitcoin Block Raids: each raid's seed (a Bitcoin block hash) picks one.
export const RAID_MODIFIERS = [
  { name: 'Drone Swarm', blurb: 'Drones arrive from wave 1, up to three at a time.', early: ['Enemy09'], boost: 'drone', droneCap: 3 },
  { name: 'Gunline', blurb: 'Twice as many gunners hold the line.', boost: 'gunner' },
  { name: 'Rush Hour', blurb: 'Guards pour in 35% faster.', spawnRate: 0.65 },
  { name: 'Elite Escort', blurb: 'Every wave brings an elite guard.', eliteEvery: true },
  { name: 'Brawl', blurb: 'Twice as many baton guards.', boost: 'melee' },
];

/** Everything a raid's Bitcoin block hash decides, besides the spawn RNG. */
export function raidSetup(seed) {
  const last = parseInt(seed.slice(-2), 16), prev = parseInt(seed.slice(-4, -2), 16);
  return { modifier: RAID_MODIFIERS[last % RAID_MODIFIERS.length], zone: prev % ZONES.length };
}
