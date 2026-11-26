import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../src/lib/locomotion3d.js';

const S = 200;
const quad = (x0, z0, x1, z1, ya, yb) => [x0, ya, z0, x0, yb, z1, x1, yb, z1, x0, ya, z0, x1, yb, z1, x1, ya, z0];
const FLOOR = quad(-S, -S, S, S, 0, 0);
const near = (a, b, e, m = '') => assert.ok(Math.abs(a - b) <= e, `${m} ${a} vs ${b}`);
const mk = (cfg = {}, o = {}) => { const l = L.createLocomotion(cfg, o); for (let i = 0; i < 20; i++) L.stepLocomotion(l, {}, L.DT, o.world || FLOOR, o.env || {}); return l; };
const run = (l, n, input, world = FLOOR, env = {}) => { let o, evs = []; for (let i = 0; i < n; i++) { o = L.stepLocomotion(l, typeof input === 'function' ? input(i) : input, L.DT, world, env); evs.push(...o.events); } return { o, evs }; };

test('config: defaults valid, merge, cross-field and range errors', () => {
  assert.deepEqual(L.validateConfig({}), []);
  assert.deepEqual(L.validateConfig(L.defaultConfig()), []);
  assert.ok(L.validateConfig({ ground: { walkSpeed: 9, runSpeed: 5 } }).some((e) => /walkSpeed/.test(e)));
  assert.ok(L.validateConfig({ dodge: { iframeEnd: 0.9, duration: 0.5 } }).some((e) => /iframeEnd/.test(e)));
  assert.ok(L.validateConfig({ swim: { wadeDepth: 2, swimDepth: 1 } }).length);
  assert.ok(L.validateConfig({ jump: { speed: -1 } }).length);
  assert.ok(L.validateConfig({ jump: { nope: 1 } }).length);
  assert.ok(L.validateConfig({ bogus: {} }).length);
  assert.equal(L.mergeConfig({ jump: { speed: 3 } }).jump.coyoteTime, 0.1);
  assert.throws(() => L.createLocomotion({ jump: { speed: -1 } }));
});

test('camera-relative movement and facing', () => {
  const l = mk(); run(l, 90, { move: [0, 1], camYaw: 0 });
  assert.ok(l.ch.pos[2] < -3 && Math.abs(l.ch.pos[0]) < 1e-6, 'camYaw 0 forward = -Z');
  const l2 = mk(); run(l2, 90, { move: [0, 1], camYaw: Math.PI / 2 });
  assert.ok(l2.ch.pos[0] < -3 && Math.abs(l2.ch.pos[2]) < 1e-6, 'camYaw +90deg forward = -X');
  const l3 = mk(); run(l3, 90, { move: [1, 0], camYaw: 0 });
  assert.ok(l3.ch.pos[0] > 3, 'right stick = +X');
  near(L.forward(l2.yaw)[0], -1, 1e-6, 'facing follows motion');
});

test('speed tiers, acceleration and deceleration are rate-limited', () => {
  const l = mk(); let o = run(l, 1, { move: [0, 1] }).o;
  near(o.speed, 40 / 60, 1e-9, 'one step of accel');
  o = run(l, 60, { move: [0, 1] }).o; near(o.speed, 5.2, 1e-9); assert.equal(o.locomotionState, 'run');
  o = run(l, 60, { move: [0, 1], sprint: true }).o; near(o.speed, 8, 1e-9); assert.equal(o.locomotionState, 'sprint');
  o = run(l, 60, { move: [0, 0.3] }).o; near(o.speed, 2.2 * 0.3 / 0.6, 1e-9); assert.equal(o.locomotionState, 'walk');
  o = run(l, 60, { move: [0, 0] }).o; assert.equal(o.speed, 0); assert.equal(o.locomotionState, 'idle');
});

test('turn rate limits yaw change per step', () => {
  const l = mk(); const o = run(l, 1, { move: [0, -1], camYaw: 0 }).o; // wants to face +Z (yaw pi)
  near(Math.abs(o.yaw), 720 * Math.PI / 180 / 60, 1e-9);
  run(l, 30, { move: [0, -1], camYaw: 0 }); near(Math.abs(Math.abs(l.yaw) - Math.PI), 0, 1e-9);
});

test('jump: height matches ballistic profile, variable height, state flow', () => {
  const l = mk(); const evs = []; let apex = 0, seen = new Set();
  for (let i = 0; i < 80; i++) { const o = L.stepLocomotion(l, { jump: i === 0, jumpHeld: true }, L.DT, FLOOR); evs.push(...o.events); apex = Math.max(apex, o.pos[1]); seen.add(o.locomotionState); }
  near(apex, L.jumpProfile().apexHeight, 1e-3, 'apex'); assert.ok(evs.includes('jump') && evs.includes('land'));
  assert.ok(seen.has('jump') && seen.has('fall') && seen.has('land'));
  const t = mk(); let tapApex = 0; for (let i = 0; i < 80; i++) { const o = L.stepLocomotion(t, { jump: i === 0, jumpHeld: false }, L.DT, FLOOR); tapApex = Math.max(tapApex, o.pos[1]); }
  assert.ok(tapApex < apex * 0.4 && tapApex > 0.1, `tap ${tapApex} vs ${apex}`);
});

test('coyote time and jump buffer', () => {
  const edge = [...quad(-S, -S, S, 0, 0, 0)]; // floor only for z<0
  const l = mk({}, { world: edge, pos: [0, 0, -1] });
  let left = -1;
  for (let i = 0; i < 100 && left < 0; i++) { const o = L.stepLocomotion(l, { move: [0, -1] }, L.DT, edge); if (!o.grounded) left = i; }
  assert.ok(left > 0);
  run(l, 3, { move: [0, -1] }, edge); // ~50ms after leaving
  const r = run(l, 1, { jump: true, jumpHeld: true, move: [0, -1] }, edge); assert.ok(r.evs.includes('jump'), 'coyote jump');
  const l2 = mk({}, { world: edge, pos: [0, 0, -1] }); run(l2, 100, { move: [0, -1] }, edge);
  assert.ok(!run(l2, 1, { jump: true }, edge).evs.includes('jump'), 'too late, no air jump configured');
  // buffer: press just before landing
  const l3 = mk(); run(l3, 1, { jump: true, jumpHeld: true });
  let jumps = 0; for (let i = 0; i < 80; i++) { const o = L.stepLocomotion(l3, { jump: i === 30, jumpHeld: true }, L.DT, FLOOR); jumps += o.events.filter((e) => e === 'jump').length; }
  assert.equal(jumps, 1, 'buffered press fires on landing');
});

test('double jump (airJumps) works once and resets on ground', () => {
  const l = mk({ jump: { airJumps: 1 } }); const ev = [];
  for (let i = 0; i < 40; i++) ev.push(...L.stepLocomotion(l, { jump: i === 0 || i === 15 || i === 25, jumpHeld: true }, L.DT, FLOOR).events);
  assert.equal(ev.filter((e) => e === 'jump').length, 1); assert.equal(ev.filter((e) => e === 'airJump').length, 1);
  run(l, 120, {}); assert.equal(l.airJumps, 1);
});

test('dodge: exact distance, i-frame window, cooldown, direction', () => {
  const l = mk(); const p0 = [...l.ch.pos]; let inv = 0, frames = 0, first = -1;
  let at30 = null;
  for (let i = 0; i < 60; i++) { const o = L.stepLocomotion(l, { dodge: i === 0, move: [1, 0] }, L.DT, FLOOR); if (i === 29) at30 = o.pos[0] - p0[0]; if (o.locomotionState === 'dodge') frames++; if (o.invulnerable) { inv++; if (first < 0) first = i; } }
  near(at30, 4, 1e-6, 'roll covers exactly dodge.distance');
  assert.equal(frames, 30); near(inv, 15, 1); assert.ok(first >= 3 && first <= 4);
  const l2 = mk(); run(l2, 1, { dodge: true }); const again = run(l2, 40, { dodge: true });
  assert.ok(again.evs.filter((e) => e === 'dodge').length <= 1, 'cooldown');
  const l3 = mk({ dodge: { exitSpeed: 0 } }); run(l3, 40, (i) => ({ dodge: i === 0 })); near(Math.hypot(l3.ch.pos[0], l3.ch.pos[2]), 4, 1e-6, 'facing -Z, no input roll');
  assert.ok(l3.ch.pos[2] < 0);
  const c = L.createLocomotion({ dodge: { curve: 'constant', exitSpeed: 0 } }); L.stepLocomotion(c, { dodge: true }, L.DT, FLOOR);
});

test('dodge stops at walls (collision still applies)', () => {
  const wall = FLOOR.concat([-S, 0, -1, S, 0, -1, S, 5, -1, -S, 0, -1, S, 5, -1, -S, 5, -1]);
  const l = mk({ dodge: { exitSpeed: 0 } }, { world: wall, pos: [0, 0, 0] }); run(l, 50, (i) => ({ dodge: i === 0, move: [0, 1] }), wall);
  assert.ok(l.ch.pos[2] > -1 + 0.39, 'did not tunnel');
});

test('knockback / launch: impulse, stun lock, launched state, recovery', () => {
  const l = mk(); L.applyImpulse(l, [3, 6, 0], { stun: 0.5 });
  let o = run(l, 1, { move: [0, 1] }).o; assert.equal(o.locomotionState, 'launched'); assert.ok(o.verticalVelocity > 0);
  const x0 = o.pos[0]; run(l, 10, { move: [0, 1] }); assert.ok(l.ch.pos[2] > -0.05, 'input ignored while stunned');
  assert.ok(l.ch.pos[0] > x0);
  run(l, 120, {}); assert.equal(l.state, 'idle');
  const g = mk(); L.applyImpulse(g, [4, 0, 0], { stun: 0.4 }); assert.equal(run(g, 1, {}).o.locomotionState, 'stagger'); assert.ok(g.ch.pos[0] > 0);
  const d = mk(); run(d, 3, { dodge: true }); L.applyImpulse(d, [1, 0, 0]); assert.equal(d.dodge, null, 'impulse cancels dodge');
});

test('fall and hard landing lock', () => {
  const l = mk({ land: { hardSpeed: 8 } }, { pos: [0, 12, 0] }); const { evs } = run(l, 120, {});
  assert.ok(evs.includes('hardLand')); assert.equal(l.state === 'land' || l.state === 'idle', true);
  const s = mk({ land: { hardSpeed: 8 } }, { pos: [0, 12, 0] }); let st = new Set(); for (let i = 0; i < 80; i++) st.add(L.stepLocomotion(s, {}, L.DT, FLOOR).locomotionState);
  assert.ok(st.has('fall') && st.has('land'));
});

test('slippery surface (friction hook) slows accel and decel', () => {
  const ice = () => ({ friction: 0.1 });
  const a = mk(), b = mk();
  run(a, 30, { move: [0, 1] }); run(b, 30, { move: [0, 1] }, FLOOR, { surface: ice });
  assert.ok(b.ch.pos[2] > a.ch.pos[2], 'ice: slower ramp-up');
  run(a, 10, {}); run(b, 10, {}, FLOOR, { surface: ice });
  assert.equal(Math.hypot(...a.hv), 0); assert.ok(Math.hypot(...b.hv) > 0.5, 'ice: keeps sliding');
});

test('steep slope slides (walkable but steeper than slide angle) and surface.slide forces it', () => {
  const ang = 45 * Math.PI / 180, run_ = 60, rise = Math.tan(ang) * run_;
  const w = quad(-S, 0, S, S, 0, 0).concat(quad(-S, -run_, S, 0, rise, 0), quad(-S, -S, S, -run_, rise, rise)); // rises toward -z
  const l = mk({}, { world: w, pos: [0, 30.2, -30] }); // 45deg: walkable (50) but > slide 38
  run(l, 30, {}, w); assert.equal(l.state, 'slide'); assert.ok(l.ch.pos[2] > -30, 'slid downhill (+z)');
  assert.ok(l.hv[1] > 1, 'downhill speed');
  const f = mk(); run(f, 20, {}, FLOOR, { surface: () => ({ slide: true }) }); // flat: no downhill vector, state still reported
  assert.equal(f.state, 'slide');
  const flat = mk(); run(flat, 20, {}); assert.notEqual(flat.state, 'slide');
});

test('moving platform carry and inherited jump momentum', () => {
  const plat = () => [2, 0, 0], l = mk();
  run(l, 60, {}, FLOOR, { platform: plat }); near(l.ch.pos[0], 2, 0.05, 'carried 2m in 1s');
  const j = mk(); L.stepLocomotion(j, { jump: true, jumpHeld: true }, L.DT, FLOOR, { platform: plat });
  assert.ok(j.hv[0] > 1.9, 'inherits platform velocity on jump');
});

test('swim / wade state, buoyancy float and flow force; jump out of water', () => {
  const deep = () => ({ surfaceY: 2.5, flow: [3, 0, 0] }), shallow = () => ({ surfaceY: 0.6 });
  const l = mk({}, {}); let o = run(l, 1, {}, FLOOR, { water: shallow }).o; assert.equal(o.locomotionState, 'wade');
  const w = run(mk(), 60, { move: [0, 1] }, FLOOR, { water: shallow }); near(w.o.speed, 5.2 * 0.7, 1e-9);
  const s = mk(); const { o: so } = run(s, 120, {}, FLOOR, { water: deep });
  assert.equal(so.locomotionState, 'swim'); assert.equal(so.mode, 'swim');
  near(s.ch.pos[1], 2.5 - 1.4, 0.15, 'floats with head out'); assert.ok(s.ch.pos[0] > 4, 'current carries the swimmer');
  const j = run(s, 1, { jump: true, jumpHeld: true }, FLOOR, { water: deep }); assert.ok(j.evs.includes('jump') || s.vy > 0, 'water jump');
  const f = mk(); run(f, 60, { move: [0, 1] }, FLOOR, { water: deep }); assert.ok(Math.hypot(f.hv[0], f.hv[1]) <= 3 + 1e-6, 'swim speed cap');
});

test('force field callback (whirlpool pull) accelerates the swimmer', () => {
  const l = mk(); const env = { water: () => ({ surfaceY: 2.5 }), force: () => [0, 0, 30] };
  run(l, 60, {}, FLOOR, env); assert.ok(l.ch.pos[2] > 1.5);
});

test('output params for the animation graph', () => {
  const o = run(mk(), 40, { move: [0, 1] }).o;
  for (const k of ['locomotionState', 'speed', 'speedNorm', 'grounded', 'verticalVelocity', 'yaw', 'invulnerable', 'events', 'stateTime']) assert.ok(k in o, k);
  assert.ok(L.STATES.includes(o.locomotionState)); assert.equal(o.grounded, true);
  JSON.parse(JSON.stringify(mk())); // state is plain JSON
});

test('determinism: identical input -> identical hash; different input differs', () => {
  const sim = (extra) => {
    const l = mk({ jump: { airJumps: 1 } }), log = [];
    for (let i = 0; i < 600; i++) { const o = L.stepLocomotion(l, { move: [Math.sin(i / 40), Math.cos(i / 25)], camYaw: i / 100, sprint: i % 90 < 30, jump: i % 70 === 0, jumpHeld: i % 70 < 20, dodge: i % 130 === 5 }, L.DT, FLOOR, extra || {}); log.push(o); }
    return L.hashState({ log, l });
  };
  assert.equal(sim(), sim());
  assert.notEqual(sim(), sim({ force: () => [1, 0, 0] }));
});
