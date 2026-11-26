// Frozen constants — binding with ARCHITECTURE.md.
export const W = 320;
export const H = 180;
export const TILE = 16;
export const DT = 1 / 60;

export const TUNING = Object.freeze({
  playerSpeed: 90,
  playerR: 6,
  playerHp: 5,
  downTime: 2.0,
  respawnInv: 1.5,
  registerR: 10,
  registerHp: 20,
  mouseR: 5,
  mouseHp: 2,
  mouseSpeed: 38,
  mouseBite: 1,
  mouseBiteCd: 0.7,
  peteR: 10,
  peteHp: 40,
  peteSpeed: 55,
  peteDashCd: 2.4,
  peteDashDur: 0.35,
  peteDashSpeed: 140,
  peteSpawnMiceEvery: 10.0,
  entityCap: 120,
  flowRebuild: 10,
  grenadeBounce: 1,
  tauntGap: 3,
  idleTauntAfter: 8,
  introTime: 1.6,
  intermissionDefault: 1.2,
  maxDt: 1 / 30,
});

export const WEAPONS = Object.freeze({
  scanner: Object.freeze({
    id: 'scanner', mode: 'projectile', ammo: 'infinite',
    cooldown: 0.14, damage: 1, speed: 280, range: 220,
    spread: 0, pierce: 0, knockback: 12, sfx: 'scan',
  }),
  bawlz: Object.freeze({
    id: 'bawlz', mode: 'lobbed', ammo: 'counted',
    cooldown: 0.6, damage: 4, speed: 140, range: 160,
    spread: 0, pierce: 0, fuse: 0.9, splashR: 28,
    knockback: 40, sfx: 'throw',
  }),
});

export const PAL16 = Object.freeze({
  bg: '#1a1c2c', floor: '#3e3546', floor2: '#2a2433',
  wall: '#5d576b', shelf: '#7a6f8a', counter: '#8b7355',
  outline: '#0d0b12', white: '#e8e6f0', red: '#e83b3b',
  amber: '#f0a030', green: '#3dd68c', blue: '#4d9de0',
  yellow: '#f5d76e', pink: '#e87ad6', skin: '#f0c8a0',
  orange: '#e8883a', dark: '#0d0b12', pete: '#6b4f3a',
  peteEye: '#e83b3b', can: '#2ec4b6', can2: '#1a8f85',
});

export const PAL32 = Object.freeze({
  ...PAL16,
  floorHi: '#4a4158', shelfHi: '#9a8fb0', glow: '#7ef9c0',
  metal: '#a8b0c0', glass: '#8ecae6', shadow: '#12101a',
});

/** Art manifest: every pack must export these names. */
export const ART = Object.freeze([
  { name: 'player_idle', w: 16, h: 16, frames: 2 },
  { name: 'player_run', w: 16, h: 16, frames: 4 },
  { name: 'player_down', w: 16, h: 16, frames: 1 },
  { name: 'mouse', w: 16, h: 16, frames: 2 },
  { name: 'pete', w: 24, h: 24, frames: 2 },
  { name: 'register', w: 16, h: 16, frames: 2 },
  { name: 'projectile', w: 8, h: 8, frames: 1 },
  { name: 'grenade', w: 8, h: 8, frames: 2 },
  { name: 'pickup_bawlz', w: 12, h: 12, frames: 1 },
  { name: 'pickup_hp', w: 12, h: 12, frames: 1 },
  { name: 'tile_floor', w: 16, h: 16, frames: 1 },
  { name: 'tile_wall', w: 16, h: 16, frames: 1 },
  { name: 'tile_shelf', w: 16, h: 16, frames: 1 },
  { name: 'tile_counter', w: 16, h: 16, frames: 1 },
  { name: 'tile_door', w: 16, h: 16, frames: 1 },
  { name: 'fx_explode', w: 24, h: 24, frames: 4 },
  { name: 'fx_spark', w: 8, h: 8, frames: 2 },
]);

export const EVENTS = Object.freeze([
  'wave_start', 'wave_clear', 'spawn', 'shot', 'hit', 'kill',
  'register_hit', 'register_lost', 'throw', 'explode', 'pickup',
  'player_down', 'pete_phase', 'taunt', 'sfx', 'music', 'game_over', 'fx', 'popup',
]);

export const SFX = Object.freeze([
  'scan', 'throw', 'explode', 'hit', 'kill', 'pickup', 'hurt', 'down',
  'register_hit', 'wave', 'pete', 'taunt_beep', 'win', 'lose',
]);

export const MUSIC = Object.freeze(['title', 'store', 'boss', 'victory']);

export const TAUNTS = Object.freeze({
  wave_start: [
    'Move it, tech — registers are bleeding!',
    'Christopher here: STOP standing around!',
    'Mice. On. My. Floor. Fix it!',
  ],
  wave_clear: [
    'Barely acceptable. Next wave.',
    'Clock is ticking. Don\'t get cute.',
  ],
  register_hit: [
    'That register costs more than you!',
    'Protect the checkouts or clean out your locker!',
  ],
  register_lost: [
    'REGISTER DOWN. Christopher is NOT happy.',
    'Do you even work here?!',
  ],
  player_down: [
    'Get UP. Break\'s over.',
    'Christopherrrr — I mean YOU — quit lying there!',
  ],
  pete_arrive: [
    'Parkway Pete? In MY store?!',
    'Big rat incoming. Scanner. NOW.',
  ],
  pete_phase: [
    'He\'s getting meaner. So should you.',
  ],
  pete_down: [
    'Finally. Sweep the aisle.',
  ],
  idle: [
    'Hellooo? Customers? Mice? Anyone?',
    'I\'m watching the cameras, genius.',
  ],
  streak: [
    'Okay, that was almost competent.',
  ],
  victory: [
    'Store saved. Don\'t expect a raise.',
  ],
  defeat: [
    'Registers gone. You\'re on inventory forever.',
  ],
  pete_lines: [
    'Squeak for me, store boy!',
    'Perring Parkway owns this aisle!',
    'Micro-mice, feast!',
  ],
});

export const SOLID = Object.freeze(new Set(['shelf', 'wall', 'counter']));
