import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as K from '../../src/lib/combat3d.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../../../../spec/v4/examples/combat3d/${n}.json`, import.meta.url), 'utf8'));
const hero = () => load('hero'), ghoul = () => load('enemy-swipe');
const slab = (over = {}) => ({ startup: 3, active: 2, recovery: 5, damage: 10, hitstun: 12, blockstun: 8, hitstop: 0, poiseDamage: 5, knockback: [0, 0, 1],
  hitboxes: [{ offset: [0, 1, 0.6], shape: { type: 'sphere', r: 0.5 } }], ...over });
const fighter = (id, team, moves, extra = {}) => ({ id, team, maxHp: 100, maxPoise: 50, actions: Object.fromEntries(Object.keys(moves).map((m) => [m, m])), moves, ...extra });
// A at z=0 facing +Z, B at z=1 facing -Z
function duel(da, db, o = {}) {
  const a = K.createFighter(da, { pos: [0, 0, 0], yaw: 0 }), b = K.createFighter(db, { pos: [0, 0, o.dist ?? 1], yaw: Math.PI });
  return K.createWorld({ fighters: [a, b], seed: o.seed ?? 1, groundY: 0, statuses: o.statuses });
}
const run = (w, n, inputs = () => ({})) => { for (let i = 0; i < n; i++) K.step(w, inputs(w.frame + 1) || {}); return w; };
const types = (w) => w.events.map((e) => e.type);

test('frame data: hit lands on first active frame, not before', () => {
  const w = duel(fighter('a', 'x', { hit: slab() }), fighter('b', 'y', {}));
  run(w, 3, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
  assert.ok(!types(w).includes('hit'));
  run(w, 1);
  const e = w.events.find((x) => x.type === 'hit');
  assert.equal(e.f, 4); assert.equal(e.who, 'a'); assert.equal(e.victim, 'b');
  assert.equal(K.fighterOf(w, 'b').hp, 90);
});
test('a hitbox hits a target once per move; multihit re-hits every N frames', () => {
  const w = duel(fighter('a', 'x', { hit: slab({ active: 8 }) }), fighter('b', 'y', {}));
  run(w, 20, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
  assert.equal(w.events.filter((e) => e.type === 'hit').length, 1);
  const w2 = duel(fighter('a', 'x', { hit: slab({ active: 8, multihit: { every: 3 }, hitstun: 0 }) }), fighter('b', 'y', {}));
  run(w2, 20, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
  assert.equal(w2.events.filter((e) => e.type === 'hit').length, 3);
});
test('hit-stop freezes both fighters', () => {
  const w = duel(fighter('a', 'x', { hit: slab({ hitstop: 5 }) }), fighter('b', 'y', {}));
  run(w, 4, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
  const fr = K.fighterOf(w, 'a').move.frame; assert.equal(K.fighterOf(w, 'a').hitstop, 5);
  run(w, 5); assert.equal(K.fighterOf(w, 'a').move.frame, fr);
  run(w, 1); assert.equal(K.fighterOf(w, 'a').move.frame, fr + 1);
});
test('hurtbox multipliers and weak points', () => {
  const dB = fighter('b', 'y', {}, { hurtboxes: [{ id: 'head', shape: { type: 'sphere', r: 0.3 }, offset: [0, 1, 0], mult: 2, weak: true }, { id: 'leg', shape: { type: 'sphere', r: 0.3 }, offset: [0, 0.2, 0], mult: 0.5 }] });
  const w = duel(fighter('a', 'x', { hit: slab() }), dB);
  run(w, 4, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
  const e = w.events.find((x) => x.type === 'hit');
  assert.equal(e.part, 'head'); assert.equal(e.weak, true); assert.equal(e.damage, 20);
});
test('damage types and resistances, immunity and weakness', () => {
  for (const [res, expect] of [[0.5, 5], [1, 0], [-1, 20]]) {
    const w = duel(fighter('a', 'x', { hit: slab({ damageType: 'fire' }) }), fighter('b', 'y', {}, { resist: { fire: res } }));
    run(w, 4, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
    assert.equal(K.fighterOf(w, 'b').taken, expect, `resist ${res}`);
  }
});
test('team filtering: no friendly fire, hostility table, friendlyFire flag', () => {
  const w = duel(fighter('a', 'red', { hit: slab() }), fighter('b', 'red', {}));
  run(w, 8, (f) => (f === 1 ? { a: { action: 'hit' } } : {})); assert.equal(K.fighterOf(w, 'b').hp, 100);
  const w2 = duel(fighter('a', 'red', { hit: slab() }), fighter('b', 'red', {})); w2.friendlyFire = true;
  run(w2, 8, (f) => (f === 1 ? { a: { action: 'hit' } } : {})); assert.equal(K.fighterOf(w2, 'b').hp, 90);
  const w3 = duel(fighter('a', 'red', { hit: slab() }), fighter('b', 'blue', {})); w3.hostility = { red: [], blue: ['red'] };
  run(w3, 8, (f) => (f === 1 ? { a: { action: 'hit' } } : {})); assert.equal(K.fighterOf(w3, 'b').hp, 100);
});
test('block: chip damage, blockstun, no hitstun; attacker connected=block', () => {
  const w = duel(fighter('a', 'x', { hit: slab() }), fighter('b', 'y', {}, { block: { arc: 180, parryWindow: 0, chip: 0.2 } }));
  run(w, 10, (f) => ({ ...(f === 1 ? { a: { action: 'hit' } } : {}), b: { block: true } }));
  const e = w.events.find((x) => x.type === 'block'); assert.ok(e); assert.equal(e.damage, 2);
  assert.equal(K.fighterOf(w, 'b').state, 'block'); assert.ok(!types(w).includes('hit'));
});
test('block only works from the front arc', () => {
  const a = K.createFighter(fighter('a', 'x', { hit: slab() }), { pos: [0, 0, 0], yaw: 0 }), b = K.createFighter(fighter('b', 'y', {}, { block: { arc: 120 } }), { pos: [0, 0, 1], yaw: 0 }); // b faces away
  const w = K.createWorld({ fighters: [a, b], groundY: 0 });
  run(w, 6, (f) => ({ ...(f === 1 ? { a: { action: 'hit' } } : {}), b: { block: true } }));
  assert.ok(types(w).includes('hit') && !types(w).includes('block'));
});
test('parry window staggers the attacker and deals no damage', () => {
  const w = duel(fighter('a', 'x', { hit: slab({ startup: 3 }) }), fighter('b', 'y', {}, { block: { arc: 180, parryWindow: 6, parryStun: 30 } }));
  run(w, 5, (f) => ({ ...(f === 1 ? { a: { action: 'hit' } } : {}), b: { block: true } }));
  assert.ok(types(w).includes('parry')); assert.equal(K.fighterOf(w, 'b').hp, 100);
  assert.equal(K.fighterOf(w, 'a').state, 'stagger');
});
test('i-frames evade; armor absorbs below threshold but not above', () => {
  const dodge = { startup: 1, active: 1, recovery: 20, damage: 0, iframes: { from: 1, to: 15 } };
  const w = duel(fighter('a', 'x', { hit: slab() }), fighter('b', 'y', { dodge }));
  run(w, 5, (f) => ({ ...(f === 1 ? { a: { action: 'hit' }, b: { action: 'dodge' } } : {}) }));
  assert.ok(types(w).includes('evade')); assert.equal(K.fighterOf(w, 'b').hp, 100);
  for (const [pd, armored] of [[5, true], [30, false]]) {
    const heavy = { startup: 1, active: 1, recovery: 30, damage: 0, armor: { from: 1, to: 25, threshold: 10 } };
    const w2 = duel(fighter('a', 'x', { hit: slab({ poiseDamage: pd, startup: 2 }) }), fighter('b', 'y', { heavy }));
    run(w2, 5, (f) => (f === 1 ? { a: { action: 'hit' }, b: { action: 'heavy' } } : {}));
    const e = w2.events.find((x) => x.type === 'hit'); assert.equal(e.armored, armored);
    assert.equal(K.fighterOf(w2, 'b').state, armored ? 'move' : 'hitstun');
    assert.ok(K.fighterOf(w2, 'b').hp < 100);
  }
});
test('poise break staggers once and resets poise', () => {
  const w = duel(fighter('a', 'x', { hit: slab({ poiseDamage: 60 }) }), fighter('b', 'y', {}, { maxPoise: 50, staggerFrames: 40 }));
  run(w, 5, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
  const b = K.fighterOf(w, 'b'); assert.equal(b.state, 'stagger'); assert.equal(b.poise, 50);
  assert.equal(w.events.filter((e) => e.type === 'stagger').length, 1);
  run(w, 45); assert.equal(b.state, 'idle');
});
test('death: hp 0 emits death once and the fighter stops', () => {
  const w = duel(fighter('a', 'x', { hit: slab({ damage: 500 }) }), fighter('b', 'y', {}));
  run(w, 10, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
  assert.equal(w.events.filter((e) => e.type === 'death').length, 1); assert.equal(K.fighterOf(w, 'b').state, 'dead'); assert.equal(K.fighterOf(w, 'b').hp, 0);
});
test('combo chain: cancel on contact, input buffering, whiff does not cancel', () => {
  const moves = { l1: slab({ cancels: [{ into: 'l2', action: 'l', from: 4, to: 9, on: 'contact' }] }), l2: slab({ damage: 20 }) };
  const dA = fighter('a', 'x', moves, { actions: { l: 'l1' }, bufferFrames: 8 });
  const w = duel(dA, fighter('b', 'y', {}));
  run(w, 14, (f) => (f === 1 || f === 3 ? { a: { action: 'l' } } : {}));
  assert.ok(w.events.some((e) => e.type === 'cancel' && e.into === 'l2'));
  // whiff: target out of range, cancel on contact never fires
  const w2 = duel(dA, fighter('b', 'y', {}), { dist: 5 });
  run(w2, 14, (f) => (f === 1 || f === 3 ? { a: { action: 'l' } } : {}));
  assert.ok(!w2.events.some((e) => e.type === 'cancel'));
});
test('hitbox keyframes sweep across the active window', () => {
  const m = slab({ startup: 1, active: 6, hitboxes: [{ shape: { type: 'sphere', r: 0.2 }, keys: [{ frame: 2, offset: [-3, 1, 1] }, { frame: 7, offset: [3, 1, 1] }] }] });
  assert.deepEqual(K.hitboxOffset(m.hitboxes[0], 4.5), [0, 1, 1]);
  assert.deepEqual(K.hitboxOffset(m.hitboxes[0], 1), [-3, 1, 1]); assert.deepEqual(K.hitboxOffset(m.hitboxes[0], 99), [3, 1, 1]);
  const w = duel(fighter('a', 'x', { m }), fighter('b', 'y', {}));
  run(w, 8, (f) => (f === 1 ? { a: { action: 'm' } } : {}));
  const e = w.events.find((x) => x.type === 'hit'); assert.ok(e && e.f >= 4 && e.f <= 6, `hit frame ${e && e.f}`);
});
test('caller-supplied bone transforms drive hitboxes', () => {
  const m = slab({ hitboxes: [{ bone: 'hand', shape: { type: 'sphere', r: 0.2 } }] });
  const w = duel(fighter('a', 'x', { m }), fighter('b', 'y', {}), { dist: 3 });
  const at = (z) => ({ a: { bones: { hand: { pos: [0, 1, z], quat: [0, 0, 0, 1] } } } });
  for (let i = 0; i < 5; i++) K.step(w, i === 0 ? { a: { action: 'm' } } : {}, at(0)); assert.ok(!types(w).includes('hit'));
  const w2 = duel(fighter('a', 'x', { m }), fighter('b', 'y', {}), { dist: 3 });
  for (let i = 0; i < 5; i++) K.step(w2, i === 0 ? { a: { action: 'm' } } : {}, at(3)); assert.ok(types(w2).includes('hit'));
});
test('box (OBB) and capsule hitboxes overlap hurtboxes', () => {
  for (const shape of [{ type: 'box', h: [0.3, 0.3, 0.3] }, { type: 'capsule', a: [0, 0, 0], b: [0, 0, 0.5], r: 0.2 }]) {
    const w = duel(fighter('a', 'x', { m: slab({ hitboxes: [{ offset: [0, 1, 0.7], shape }] }) }), fighter('b', 'y', {}));
    run(w, 5, (f) => (f === 1 ? { a: { action: 'm' } } : {})); assert.ok(types(w).includes('hit'), shape.type);
  }
});
test('status: poison ticks and expires, burn extinguished by water, slow stretches moves, chance uses seeded rng', () => {
  const w = duel(fighter('a', 'x', { hit: slab({ onHit: [{ id: 'poison' }] }) }), fighter('b', 'y', {}));
  run(w, 4, (f) => (f === 1 ? { a: { action: 'hit' } } : {}));
  assert.equal(K.fighterOf(w, 'b').status[0].type, 'poison');
  run(w, 100); const dots = w.events.filter((e) => e.type === 'dot'); assert.equal(dots.length, 3); assert.equal(dots[0].damage, 2);
  run(w, 300); assert.equal(K.fighterOf(w, 'b').status.length, 0); assert.ok(w.events.some((e) => e.op === 'expire'));
  const w2 = duel(fighter('a', 'x', { fire: slab({ onHit: [{ id: 'burn' }], damageType: 'fire' }), splash: slab({ damageType: 'water', damage: 0, startup: 1 }) }, { actions: { fire: 'fire', splash: 'splash' } }), fighter('b', 'y', {}));
  run(w2, 4, (f) => (f === 1 ? { a: { action: 'fire' } } : {})); assert.ok(K.fighterOf(w2, 'b').status.some((s) => s.type === 'burn'));
  const fb = K.fighterOf(w2, 'b'); fb.state = 'idle'; fb.hitstop = 0; fb.stun = 0;
  run(w2, 40, (f) => (f === 30 ? { a: { action: 'splash' } } : {}));
  assert.ok(w2.events.some((e) => e.op === 'extinguish'));
  const slow = duel(fighter('a', 'x', { hit: slab({ recovery: 20 }) }), fighter('b', 'y', {})); K.applyStatus(slow, K.fighterOf(slow, 'a'), 'slow');
  run(slow, 6, (f) => (f === 1 ? { a: { action: 'hit' } } : {})); assert.ok(K.fighterOf(slow, 'a').move.frame <= 4);
  const roll = (seed) => { const x = duel(fighter('a', 'x', { hit: slab({ onHit: [{ id: 'slow', chance: 0.5 }] }) }), fighter('b', 'y', {}), { seed }); run(x, 4, (f) => (f === 1 ? { a: { action: 'hit' } } : {})); return K.fighterOf(x, 'b').status.length; };
  assert.equal(roll(5), roll(5));
});
test('projectiles: straight, arc and homing share the hit pipeline', () => {
  const proj = (kind, extra = {}) => ({ kind, dir: [0, 0, 1], speed: 20, radius: 0.2, life: 60, hit: { damage: 7, hitstun: 5 }, ...extra });
  for (const kind of ['straight', 'arc', 'homing']) {
    const sh = { startup: 1, active: 1, recovery: 10, damage: 0, spawns: [{ frame: 1, offset: [0, 1, 0.2], projectile: proj(kind, kind === 'arc' ? { gravity: 1 } : {}) }] };
    const w = duel(fighter('a', 'x', { sh }), fighter('b', 'y', {}), { dist: 6 });
    run(w, 40, (f) => (f === 1 ? { a: { action: 'sh' } } : {}));
    const e = w.events.find((x) => x.type === 'hit'); assert.ok(e, kind); assert.equal(e.damage, 7); assert.equal(K.fighterOf(w, 'a').dealt, 7);
    assert.equal(w.projectiles.length, 0);
  }
  const w = duel(fighter('a', 'x', {}), fighter('b', 'y', {}, { block: { arc: 180, parryWindow: 0 } }), { dist: 4 });
  K.spawnProjectile(w, K.fighterOf(w, 'a'), proj('straight', { pierce: 0 })); run(w, 20, () => ({ b: { block: true } }));
  assert.ok(types(w).includes('block'));
  const w2 = duel(fighter('a', 'x', {}), fighter('b', 'y', {}), { dist: 4 }); K.spawnProjectile(w2, K.fighterOf(w2, 'a'), proj('straight', { dir: [1, 0, 0], life: 5 }));
  run(w2, 10); assert.ok(w2.events.some((e) => e.type === 'projectile-expire' && e.why === 'life'));
  // homing steers toward a target that is off-axis
  const w3 = duel(fighter('a', 'x', {}), fighter('b', 'y', {}), { dist: 6 }); K.fighterOf(w3, 'b').pos = [3, 0, 6];
  K.spawnProjectile(w3, K.fighterOf(w3, 'a'), proj('homing', { speed: 12, turn: 0.2, life: 200 })); run(w3, 120);
  assert.ok(w3.events.some((e) => e.type === 'hit'));
});
test('same-frame trade: both fighters land their hits', () => {
  const w = duel(fighter('a', 'x', { hit: slab() }), fighter('b', 'y', { hit: slab() }));
  run(w, 5, (f) => (f === 1 ? { a: { action: 'hit' }, b: { action: 'hit' } } : {}));
  assert.equal(w.events.filter((e) => e.type === 'hit').length, 2);
});
test('validateFighter: ordering, windows, cancel targets, statuses', () => {
  const good = K.validateFighter(hero()); assert.deepEqual(good.errors, []);
  const d = fighter('z', 'x', { a: slab({ cancels: [{ into: 'nope', action: 'q', from: 5, to: 3 }], iframes: { from: 1, to: 99 }, onHit: [{ id: 'bogus' }], hitboxes: [{ from: 1, to: 2, shape: { type: 'sphere', r: 1 }, keys: [{ frame: 3, offset: [0, 0, 0] }, { frame: 2, offset: [0, 0, 0] }] }] }), b: slab({ active: 0 }) }, { actions: { x: 'ghost' } });
  const { errors, warnings } = K.validateFighter(d);
  for (const frag of ['"nope" does not exist', 'from (5) after to (3)', 'outside 1..', 'unknown status "bogus"', 'strictly ascending', 'move "ghost"', 'moves.b.active']) assert.ok(errors.some((e) => e.includes(frag)), frag);
  assert.ok(warnings.some((w) => w.includes('not reachable')));
});
test('frame-data table: advantage on hit/block', () => {
  const row = K.frameDataTable(fighter('a', 'x', { m: slab({ startup: 5, active: 3, recovery: 9, hitstun: 20, blockstun: 10 }) }))[0];
  assert.equal(row.total, 17); assert.equal(row.onHit, 20 - (2 + 9)); assert.equal(row.onBlock, 10 - 11);
  assert.match(K.frameDataMarkdown(hero()), /light1/);
});
test('determinism: identical runs give identical hashes and plain-JSON state', () => {
  const play = (seed) => K.simulateDuel(hero(), ghoul(), { seed, frames: 400, distance: 1.4, script: { hero: [{ at: 1, action: 'light' }, { at: 2, action: 'light' }, { at: 3, action: 'heavy' }, { at: 80, action: 'light' }], ghoul: [{ at: 40, action: 'swipe' }, { at: 120, action: 'spit' }, { at: 200, action: 'swipe' }] } });
  const a = play(7), b = play(7); assert.equal(a.hash, b.hash); assert.equal(K.hashWorld(a.world), K.hashWorld(b.world));
  assert.deepEqual(JSON.parse(JSON.stringify(a.world)), a.world); // plain JSON state
  assert.ok(a.counts.hit > 0);
});
