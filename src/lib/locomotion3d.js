// locomotion3d: third-person movement layer over collision3d's capsule character.
// Pure, deterministic (fixed step, no Date/Math.random), zero deps, Y-up, metres, plain JSON state. Spec: spec/v4/locomotion3d.md
// Yaw convention: yaw 0 faces -Z, +yaw turns toward -X (counter-clockwise seen from above). forward(yaw)=[-sin,0,-cos], right(yaw)=[cos,0,-sin].
import { createCharacter, moveAndSlide } from './collision3d.js';

export const DT = 1 / 60;
// section -> key -> [default, min, max]. Strings/booleans live in ENUMS/BOOLS. This table is the single source for defaults, validation and the JSON schema.
export const CONFIG_SPEC = {
  body: { radius: [0.4, 0.05, 5], height: [1.8, 0.2, 10], stepHeight: [0.35, 0, 2], slopeLimitDeg: [50, 5, 85] },
  ground: { walkSpeed: [2.2, 0, 30], runSpeed: [5.2, 0.1, 40], sprintSpeed: [8, 0.1, 60], runThreshold: [0.6, 0.05, 1], accel: [40, 0.1, 500], decel: [50, 0.1, 500], turnRateDeg: [720, 10, 5000] },
  air: { accel: [14, 0, 500], decel: [3, 0, 500], turnRateDeg: [360, 10, 5000], gravity: [28, 0.1, 200], fallGravityMul: [1.25, 0.1, 10], maxFallSpeed: [40, 1, 200] },
  jump: { speed: [9, 0, 60], coyoteTime: [0.1, 0, 1], bufferTime: [0.12, 0, 1], cutMultiplier: [0.45, 0, 1], airJumps: [0, 0, 5], airJumpSpeed: [8, 0, 60] },
  land: { minSpeed: [3, 0, 100], time: [0.08, 0, 2], hardSpeed: [14, 0, 200], hardTime: [0.45, 0, 3], hardMoveMul: [0.2, 0, 1] },
  dodge: { distance: [4, 0.1, 30], duration: [0.5, 0.05, 3], iframeStart: [0.05, 0, 3], iframeEnd: [0.3, 0, 3], cooldown: [0.25, 0, 10], exitSpeed: [2, 0, 40], airDodges: [0, 0, 5] },
  swim: { wadeDepth: [0.25, 0, 5], swimDepth: [1.2, 0.1, 10], wadeSpeedMul: [0.7, 0.05, 1], speed: [3, 0.1, 20], accel: [10, 0.1, 200], floatOffset: [1.4, 0, 10], buoyancy: [4, 0.1, 50], maxVerticalSpeed: [3, 0.1, 30], verticalDamp: [8, 0.1, 100], exitJumpMul: [0.8, 0, 2], exitJumpWindow: [0.4, 0, 3] },
  slide: { minAngleDeg: [38, 0, 89], accel: [18, 0, 200], maxSpeed: [12, 0.1, 60], control: [0.25, 0, 1] },
  knockback: { groundDecel: [14, 0.1, 500], airDecel: [1.5, 0, 500], stunDefault: [0.35, 0, 5] },
};
export const ENUMS = { dodge: { curve: ['constant', 'easeOut'] } };
const BOOLS = { jump: { inheritPlatform: true }, dodge: { turnToDir: true } };
export const STATES = ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'dodge', 'stagger', 'launched', 'wade', 'swim', 'slide'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function defaultConfig() {
  const c = { name: 'hero' };
  for (const [s, ks] of Object.entries(CONFIG_SPEC)) { c[s] = {}; for (const [k, v] of Object.entries(ks)) c[s][k] = v[0]; }
  c.dodge.curve = 'easeOut'; c.jump.inheritPlatform = true; c.dodge.turnToDir = true;
  return c;
}
export function mergeConfig(cfg = {}) {
  const c = defaultConfig();
  for (const [k, v] of Object.entries(cfg)) { if (isObj(v) && isObj(c[k])) Object.assign(c[k], v); else c[k] = v; }
  return c;
}
// Returns string[] of problems ("path: message"); [] = valid. Accepts partial configs (missing keys use defaults).
export function validateConfig(cfg) {
  const errs = [];
  if (!isObj(cfg)) return ['$: config must be an object'];
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'name' || k === '$schema' || k === 'description') { if (typeof v !== 'string') errs.push(`${k}: must be a string`); continue; }
    if (!CONFIG_SPEC[k]) { errs.push(`${k}: unknown section`); continue; }
    if (!isObj(v)) { errs.push(`${k}: must be an object`); continue; }
    for (const [kk, vv] of Object.entries(v)) {
      const spec = CONFIG_SPEC[k][kk];
      if (spec) { if (typeof vv !== 'number' || !Number.isFinite(vv)) errs.push(`${k}.${kk}: must be a finite number`); else if (vv < spec[1] || vv > spec[2]) errs.push(`${k}.${kk}: ${vv} outside [${spec[1]}, ${spec[2]}]`); }
      else if (ENUMS[k]?.[kk]) { if (!ENUMS[k][kk].includes(vv)) errs.push(`${k}.${kk}: must be one of ${ENUMS[k][kk].join(', ')}`); }
      else if (BOOLS[k]?.[kk]) { if (typeof vv !== 'boolean') errs.push(`${k}.${kk}: must be boolean`); }
      else errs.push(`${k}.${kk}: unknown property`);
    }
  }
  if (errs.length) return errs;
  const c = mergeConfig(cfg), { ground: g, dodge: d, swim: s, land: l, body: b } = c;
  if (g.walkSpeed > g.runSpeed) errs.push('ground: walkSpeed must be <= runSpeed');
  if (g.runSpeed > g.sprintSpeed) errs.push('ground: runSpeed must be <= sprintSpeed');
  if (d.iframeStart > d.iframeEnd) errs.push('dodge: iframeStart must be <= iframeEnd');
  if (d.iframeEnd > d.duration) errs.push('dodge: iframeEnd must be <= duration');
  if (s.wadeDepth >= s.swimDepth) errs.push('swim: wadeDepth must be < swimDepth');
  if (s.floatOffset > b.height) errs.push('swim: floatOffset must be <= body.height');
  if (l.time > l.hardTime) errs.push('land: time must be <= hardTime');
  if (b.stepHeight >= b.height) errs.push('body: stepHeight must be < height');
  return errs;
}

// ---- state ----
export function createLocomotion(cfg = {}, o = {}) {
  const c = mergeConfig(cfg), er = validateConfig(c);
  if (er.length) throw new Error('locomotion3d config: ' + er.join('; '));
  const ch = createCharacter({ pos: o.pos || [0, 0, 0], radius: c.body.radius, height: c.body.height, stepHeight: c.body.stepHeight, minGroundY: Math.cos(c.body.slopeLimitDeg * Math.PI / 180) });
  return {
    cfg: c, ch, hv: [0, 0], vy: 0, yaw: o.yaw ?? 0, t: 0, state: 'idle', stateTime: 0,
    coyote: 0, buffer: 0, airJumps: c.jump.airJumps, airDodges: c.dodge.airDodges, jumping: false, cutDone: false,
    dodge: null, dodgeCd: 0, stun: 0, launched: false, landLock: 0, landMul: 1,
    invulnerable: false, mode: 'ground',
  };
}
export const forward = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];
export const right = (yaw) => [Math.cos(yaw), 0, -Math.sin(yaw)];
const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; return d; };
const yawOf = (x, z) => Math.atan2(-x, -z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function approach2(v, tx, tz, rate, dt) {
  const dx = tx - v[0], dz = tz - v[1], d = Math.hypot(dx, dz), m = rate * dt;
  if (d <= m || d < 1e-12) return [tx, tz];
  return [v[0] + dx / d * m, v[1] + dz / d * m];
}
const cdf = (curve, u) => { u = clamp(u, 0, 1); return curve === 'constant' ? u : 1 - (1 - u) * (1 - u); };

// Knockback / launch: adds a velocity impulse [x,y,z] (world space). stun = seconds of lost control (default cfg.knockback.stunDefault).
// An impulse with y > 0 leaves the ground. Cancels an active dodge.
export function applyImpulse(l, impulse, opts = {}) {
  l.hv = [l.hv[0] + impulse[0], l.hv[1] + impulse[2]];
  if (opts.setVertical) l.vy = impulse[1]; else if (impulse[1] !== 0) l.vy = Math.max(l.vy, 0) + impulse[1];
  if (impulse[1] > 0) { l.ch.grounded = false; l.launched = true; l.jumping = false; l.coyote = 0; }
  l.stun = Math.max(l.stun, opts.stun ?? l.cfg.knockback.stunDefault); l.dodge = null;
  return l;
}

// input: {move:[x,y] (x right, y forward, each -1..1), camYaw, sprint, jump (pressed this step), jumpHeld, dodge (pressed this step)}
// env (all optional, all pure callbacks):
//   water(pos) -> null | {surfaceY, flow?:[x,y,z] velocity of the current}
//   surface(pos, groundNormal) -> null | {friction?:1, flow?:[x,y,z] (conveyor/current drift), slide?:bool, platform?:[x,y,z]}
//   platform(pos, groundNormal) -> null | [vx,vy,vz] velocity of the moving platform under the feet (horizontal part carries the character)
//   force(pos, state) -> null | [ax,ay,az] acceleration field (wind, whirlpool pull) applied to the self-propelled velocity
export function stepLocomotion(l, input = {}, dt = DT, world = [], env = {}) {
  const c = l.cfg, ch = l.ch, events = [];
  l.t += dt;
  const was = { grounded: ch.grounded, vy: l.vy };
  const move = input.move || [0, 0], mm = Math.hypot(move[0], move[1]), mag = Math.min(1, mm);
  const camYaw = input.camYaw ?? 0, f = forward(camYaw), r = right(camYaw);
  let dx = r[0] * move[0] + f[0] * move[1], dz = r[2] * move[0] + f[2] * move[1];
  const dl = Math.hypot(dx, dz); if (dl > 1e-9) { dx /= dl; dz /= dl; } else { dx = 0; dz = 0; }
  const hasMove = mag > 0.05 && dl > 1e-9;

  // timers
  l.dodgeCd = Math.max(0, l.dodgeCd - dt); l.stun = Math.max(0, l.stun - dt); l.landLock = Math.max(0, l.landLock - dt);
  l.coyote = Math.max(0, l.coyote - dt); l.buffer = Math.max(0, l.buffer - dt);
  if (input.jump) l.buffer = c.jump.bufferTime > 0 ? c.jump.bufferTime : dt * 0.5;

  // environment
  const pos = ch.pos;
  const water = env.water ? env.water(pos) : null;
  const depth = water ? water.surfaceY - pos[1] : 0;
  const swimming = !!water && depth >= c.swim.swimDepth, wading = !!water && !swimming && depth >= c.swim.wadeDepth && ch.grounded;
  const surf = ch.grounded && env.surface ? env.surface(pos, ch.groundNormal) : null;
  const plat = ch.grounded && env.platform ? env.platform(pos, ch.groundNormal) : null;
  const fric = surf && surf.friction !== undefined ? surf.friction : 1;
  const steep = ch.grounded && ch.groundNormal[1] < Math.cos(c.slide.minAngleDeg * Math.PI / 180) - 1e-9;
  const sliding = ch.grounded && (steep || (surf && surf.slide)) && !swimming;
  const locked = l.stun > 0;

  // dodge start
  if (input.dodge && !l.dodge && l.dodgeCd <= 0 && !locked && !swimming) {
    const air = !ch.grounded;
    if (!air || l.airDodges > 0) {
      if (air) l.airDodges--;
      const dir = hasMove ? [dx, dz] : (() => { const ff = forward(l.yaw); return [ff[0], ff[2]]; })();
      l.dodge = { dir, u: 0 }; if (c.dodge.turnToDir) l.yaw = yawOf(dir[0], dir[1]);
      l.jumping = false; events.push('dodge');
    }
  }

  let tx = 0, tz = 0, rate = 0;
  const dodgeActive = !!l.dodge; let exitHv = null;
  if (l.dodge) {
    const D = c.dodge, u0 = l.dodge.u, u1 = u0 + dt / D.duration;
    const dd = D.distance * (cdf(D.curve, u1) - cdf(D.curve, u0)) / dt;
    l.hv = [l.dodge.dir[0] * dd, l.dodge.dir[1] * dd];
    l.dodge.u = u1; l.invulnerable = u0 * D.duration < D.iframeEnd && u1 * D.duration > D.iframeStart;
    if (u1 >= 1 - 1e-12) { exitHv = [l.dodge.dir[0] * D.exitSpeed, l.dodge.dir[1] * D.exitSpeed]; l.dodge = null; l.dodgeCd = D.cooldown; events.push('dodgeEnd'); }
  } else {
    l.invulnerable = false;
    // target velocity
    const g = c.ground;
    let tier = 'walk', speed = 0;
    if (hasMove) {
      if (input.sprint && mag >= g.runThreshold) { tier = 'sprint'; speed = g.sprintSpeed; }
      else if (mag >= g.runThreshold) { tier = 'run'; speed = g.runSpeed; }
      else speed = g.walkSpeed * (mag / g.runThreshold);
    }
    if (swimming) speed = hasMove ? c.swim.speed * mag : 0;
    else if (wading) speed *= c.swim.wadeSpeedMul;
    let ctlMul = 1;
    if (l.landLock > 0) ctlMul = l.landMul;
    if (locked) ctlMul = 0;
    if (sliding) ctlMul *= c.slide.control;
    tx = dx * speed * ctlMul; tz = dz * speed * ctlMul;
    const target = Math.hypot(tx, tz) > 1e-9;
    if (swimming) rate = c.swim.accel;
    else if (locked) rate = ch.grounded ? c.knockback.groundDecel : c.knockback.airDecel;
    else if (ch.grounded) rate = (target ? g.accel : g.decel);
    else rate = target ? c.air.accel : c.air.decel;
    if (ch.grounded && !swimming && !locked) rate *= fric;
    if (sliding && !locked) rate = Math.max(rate * 0.25, 0.1);
    l.hv = approach2(l.hv, tx, tz, rate, dt);
    // slope slide / force fields
    if (sliding) {
      const n = ch.groundNormal, hx = n[1] * n[0], hz = n[1] * n[2], hl = Math.hypot(hx, hz);
      if (hl > 1e-9) { const s = c.slide.accel * dt / hl; let nx = l.hv[0] + hx * s, nz = l.hv[1] + hz * s; const m = Math.hypot(nx, nz); if (m > c.slide.maxSpeed) { nx *= c.slide.maxSpeed / m; nz *= c.slide.maxSpeed / m; } l.hv = [nx, nz]; }
    }
    // turn toward intent
    if (hasMove && !locked && l.landLock <= 0) {
      const want = yawOf(dx, dz), tr = (ch.grounded ? g.turnRateDeg : c.air.turnRateDeg) * Math.PI / 180 * dt, d = angDiff(l.yaw, want);
      l.yaw += Math.abs(d) <= tr ? d : Math.sign(d) * tr;
    }
  }
  if (env.force) { const a = env.force(pos, l.state); if (a) { l.hv[0] += a[0] * dt; l.hv[1] += a[2] * dt; if (a[1]) l.vy += a[1] * dt; } }

  // vertical
  if (swimming) {
    const ty = water.surfaceY - c.swim.floatOffset, vt = clamp((ty - pos[1]) * c.swim.buoyancy, -c.swim.maxVerticalSpeed, c.swim.maxVerticalSpeed);
    l.vy += (vt - l.vy) * Math.min(1, c.swim.verticalDamp * dt);
    l.coyote = c.jump.coyoteTime; l.airJumps = c.jump.airJumps; l.jumping = false;
    if (l.buffer > 0 && !locked && depth < c.swim.swimDepth + c.swim.exitJumpWindow) { l.vy = c.jump.speed * c.swim.exitJumpMul; l.buffer = 0; l.coyote = 0; l.jumping = true; l.cutDone = false; events.push('jump'); }
  } else {
    if (ch.grounded) { l.coyote = c.jump.coyoteTime; l.airJumps = c.jump.airJumps; l.airDodges = c.dodge.airDodges; l.launched = false; l.jumping = false; if (l.vy < 0) l.vy = 0; }
    if (l.buffer > 0 && !locked && !l.dodge) {
      if (l.coyote > 0) {
        l.vy = c.jump.speed; l.coyote = 0; l.buffer = 0; l.jumping = true; l.cutDone = false; events.push('jump');
        if (plat && c.jump.inheritPlatform) { l.hv[0] += plat[0]; l.hv[1] += plat[2]; }
      } else if (!ch.grounded && l.airJumps > 0) {
        l.vy = c.jump.airJumpSpeed; l.airJumps--; l.buffer = 0; l.jumping = true; l.cutDone = false; events.push('airJump');
      }
    }
    if (l.jumping && l.vy > 0 && !input.jumpHeld && !l.cutDone) { l.vy *= c.jump.cutMultiplier; l.cutDone = true; }
    if (!ch.grounded || l.vy > 0) {
      const gv = c.air.gravity * (l.vy < 0 ? c.air.fallGravityMul : 1);
      l.vy = Math.max(-c.air.maxFallSpeed, l.vy - gv * dt);
    }
    if (l.vy <= 0) l.jumping = false;
  }

  // external carry (not stored in hv)
  let ex = 0, ez = 0, ey = 0;
  if (plat) { ex += plat[0]; ez += plat[2]; }
  if (surf && surf.flow) { ex += surf.flow[0]; ez += surf.flow[2]; }
  if (water && water.flow && (swimming || wading || depth > 0)) { ex += water.flow[0]; ez += water.flow[2]; if (swimming) ey += water.flow[1]; }
  const total = [l.hv[0] + ex, l.vy + ey, l.hv[1] + ez];
  moveAndSlide(ch, total, dt, world);
  // remove blocked components from commanded velocity
  l.hv = [l.hv[0] + (ch.vel[0] - total[0]), l.hv[1] + (ch.vel[2] - total[2])];
  if (exitHv) l.hv = exitHv;
  if (Math.abs(l.hv[0]) < 1e-9) l.hv[0] = 0; if (Math.abs(l.hv[1]) < 1e-9) l.hv[1] = 0;
  l.vy = ch.vel[1] - ey; if (ch.grounded) l.vy = 0;

  // landing
  if (ch.grounded && !was.grounded && !swimming) {
    const fs = -was.vy;
    if (fs >= c.land.minSpeed) {
      const hard = fs >= c.land.hardSpeed;
      l.landLock = hard ? c.land.hardTime : c.land.time; l.landMul = hard ? c.land.hardMoveMul : 1;
      events.push(hard ? 'hardLand' : 'land');
    } else events.push('touchdown');
  }
  if (was.grounded && !ch.grounded && l.vy <= 0 && !l.jumping) events.push('leftGround');

  // state
  const speed = Math.hypot(l.hv[0], l.hv[1]);
  let st;
  if (dodgeActive) st = 'dodge';
  else if (swimming) st = 'swim';
  else if (l.stun > 0) st = ch.grounded ? 'stagger' : 'launched';
  else if (l.launched && !ch.grounded) st = 'launched';
  else if (sliding) st = 'slide';
  else if (!ch.grounded) st = l.vy > 0 ? 'jump' : 'fall';
  else if (l.landLock > 0) st = 'land';
  else if (wading) st = 'wade';
  else if (speed < 0.15) st = 'idle';
  else st = speed > (c.ground.runSpeed + 1e-6) ? 'sprint' : speed >= (c.ground.walkSpeed + c.ground.runSpeed) * 0.5 ? 'run' : 'walk';
  if (st !== l.state) { l.state = st; l.stateTime = 0; } else l.stateTime += dt;
  l.mode = swimming ? 'swim' : wading ? 'wade' : 'ground';
  return output(l, speed, events);
}
function output(l, speed, events) {
  const c = l.cfg;
  return {
    locomotionState: l.state, stateTime: l.stateTime, speed, speedNorm: speed / c.ground.runSpeed, grounded: l.ch.grounded, verticalVelocity: l.vy,
    yaw: l.yaw, facing: forward(l.yaw), pos: [...l.ch.pos], invulnerable: l.invulnerable, dodgeProgress: l.dodge ? l.dodge.u : 0, mode: l.mode, events,
  };
}
// Ballistic jump report on flat ground using the same integrator as stepLocomotion (held button = full height; tap = cut).
export function jumpProfile(cfg = {}, o = {}) {
  const c = mergeConfig(cfg), dt = o.dt ?? DT, hold = o.hold ?? true;
  let y = 0, vy = c.jump.speed, apex = 0, t = 0, apexT = 0, cut = false;
  for (let i = 0; i < 6000; i++) {
    if (!hold && !cut) { vy *= c.jump.cutMultiplier; cut = true; }
    vy = Math.max(-c.air.maxFallSpeed, vy - c.air.gravity * (vy < 0 ? c.air.fallGravityMul : 1) * dt); y += vy * dt; t += dt;
    if (y > apex) { apex = y; apexT = t; }
    if (y <= 0) break;
  }
  return { apexHeight: apex, timeToApex: apexT, airTime: t };
}
// Canonical JSON hash (FNV-1a 32) of any plain value; handy for determinism checks in any runtime.
export function hashState(v) {
  const s = JSON.stringify(v); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
