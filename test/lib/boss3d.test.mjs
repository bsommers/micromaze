import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from '../../src/lib/boss3d.js';

const ex = (n) => JSON.parse(readFileSync(new URL(`../../../../spec/v4/examples/boss3d/${n}.json`, import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const idleStep = (s, d, input = {}) => B.step(s, d, { target: { pos: [0, 0, 12] }, ...input });
const mini = () => ({ id: 'm', arena: { radius: 12 }, core: { hp: 100, exposedWhen: { partsDownAtLeast: 1 } }, parts: [{ id: 'h1', hp: 20, pos: [4, 1, 0], weakPoint: { multiplier: 3, open: ['recovery'] }, regrow: { time: 2, blockedBy: 'sealed' }, onDeath: { coreDamageFrac: 0.1, stagger: 1 } }],
  phases: [{ id: 'a', openingDelay: 0.1, gap: 1, attacks: [{ id: 'bite', part: 'h1', weight: 1, cooldown: 2, windup: 0.6, active: 0.2, recovery: 0.5, damage: 10, zone: { shape: 'circle', r: 30 }, warning: { vfx: 'x' } }] },
    { id: 'b', enter: { partsDown: 1 }, attacks: [{ id: 'slam', weight: 1, cooldown: 1, windup: 0.5, active: 0.2, recovery: 0.3, damage: 5, zone: { shape: 'ring', rInner: 1, rOuter: 3 }, warning: { sfx: 'x' } }] }] });

test('zones: circle, cone, line, ring, sweep, maxY', () => {
  const o = [0, 0, 0], tgt = [10, 0, 0], aim = 0, z = (spec) => B.resolveZone(spec, o, tgt, aim);
  assert.ok(B.zoneContains(z({ shape: 'circle', r: 2 }), [1, 0, 1]) && !B.zoneContains(z({ shape: 'circle', r: 2 }), [2, 0, 2]));
  const cone = z({ shape: 'cone', r: 8, angle: 60 }); assert.ok(B.zoneContains(cone, [5, 0, 1])); assert.ok(!B.zoneContains(cone, [5, 0, 4])); assert.ok(!B.zoneContains(cone, [-3, 0, 0]));
  const line = z({ shape: 'line', length: 6, width: 2 }); assert.ok(B.zoneContains(line, [5, 0, 0.9])); assert.ok(!B.zoneContains(line, [5, 0, 1.2])); assert.ok(!B.zoneContains(line, [7, 0, 0]));
  const ring = z({ shape: 'ring', rInner: 3, rOuter: 5 }); assert.ok(!B.zoneContains(ring, [1, 0, 0])); assert.ok(B.zoneContains(ring, [4, 0, 0])); assert.ok(!B.zoneContains(ring, [6, 0, 0]));
  const sw = z({ shape: 'sweep', r: 6, width: 1, arc: [-90, 90] }); assert.ok(B.zoneContains(sw, [0, 0, 4])); assert.ok(!B.zoneContains(sw, [-4, 0, 0]));
  assert.ok(B.zoneContains(sw, [0, 0, 4], 0, 0, 0.1) === false && B.zoneContains(sw, [0, 0, -4], 0, 0, 0.05)); // beam starts at -90deg (z negative)
  const hop = z({ shape: 'circle', r: 3, maxY: 0.8 }); assert.ok(B.zoneContains(hop, [0, 0.5, 0]) && !B.zoneContains(hop, [0, 1.2, 0]));
  assert.ok(B.zoneContains(z({ shape: 'circle', r: 2, at: 'target' }), [10, 0, 1]));
});

test('telegraph precedes damage by the windup, zone locked, hit applied once', () => {
  const d = mini(), s = B.createBoss(d, 5); let tele = null, dmg = null;
  for (let i = 0; i < 400 && !dmg; i++) for (const e of idleStep(s, d).events) { if (e.type === 'telegraph' && !tele) tele = e; if (e.type === 'damage' && !dmg) dmg = e; }
  assert.ok(tele && dmg); assert.equal(tele.attack, 'bite'); assert.deepEqual(tele.warning, { vfx: 'x' }); assert.ok(Math.abs((dmg.f - tele.f) / 60 - 0.6) < 0.05, `${dmg.f - tele.f} frames`);
  const n = s.log.filter((e) => e.type === 'damage').length; assert.equal(n, 1);
});
test('invulnerable target (i-frames) takes no damage', () => {
  const d = mini(), s = B.createBoss(d, 5); let total = 0; for (let i = 0; i < 600; i++) total += idleStep(s, d, { target: { pos: [0, 0, 12], invulnerable: true } }).playerDamage;
  assert.equal(total, 0);
});
test('core covered until parts fall; weak point only when open; sever, regrow and sealed timer', () => {
  const d = mini(), s = B.createBoss(d, 1), ev = (inp) => idleStep(s, d, inp).events;
  assert.equal(ev({ hits: [{ part: 'core', damage: 10 }] })[0].reason, 'covered');
  const a = ev({ hits: [{ part: 'h1', weak: true, damage: 4 }] }).find((e) => e.type === 'hit'); assert.equal(a.weak, false); assert.equal(a.dmg, 4);
  const e2 = ev({ commands: [{ type: 'sever', part: 'h1' }, { type: 'flag', name: 'sealed' }] }); assert.ok(e2.some((e) => e.type === 'partDown') && e2.some((e) => e.type === 'coreDamaged'));
  assert.equal(s.hp, 90); assert.equal(s.phaseId, 'b'); assert.ok(B.coreExposed(d, s));
  for (let i = 0; i < 300; i++) ev({}); assert.equal(s.parts.h1.alive, false, 'sealed blocks regrow');
  ev({ flags: { sealed: false } }); for (let i = 0; i < 130; i++) ev({}); assert.equal(s.parts.h1.alive, true);
});
test('weak point multiplier applies during recovery', () => {
  const d = mini(); d.parts[0].weakPoint.open = 'always'; const s = B.createBoss(d, 1);
  assert.equal(idleStep(s, d, { hits: [{ part: 'h1', weak: true, damage: 4 }] }).events.find((e) => e.type === 'hit').dmg, 12);
});
test('phase advance, transition invuln, adds schedule, hazards start with warning', () => {
  const d = ex('vortex'), s = B.createBoss(d, 3), seen = new Set(); let blocked = 0;
  for (let i = 0; i < 4000; i++) { const hits = s.frame > 300 ? [{ part: 'lip_east', damage: 40 }, { part: 'lip_west', damage: 40 }, { part: 'throat', damage: 30, weak: true }] : []; for (const e of B.step(s, d, { target: { pos: [0, 0, 16], invulnerable: true }, hits }).events) { seen.add(e.type); if (e.type === 'blocked' && e.reason === 'invuln') blocked++; } }
  for (const t of ['phase', 'partDown', 'hazardStart', 'spawn', 'stagger']) assert.ok(seen.has(t), t);
  assert.ok(blocked > 0); assert.ok(s.phaseIdx >= 1);
  assert.ok(s.log.find((e) => e.type === 'hazardStart' && e.hazard === 'whirl').warning.ui);
});
test('vortex force: toward centre, grows with proximity, ramps, resist reduces', () => {
  const h = ex('vortex').hazards[0], hs = { startF: 0 }, f = (x, fr = 600, res = false) => B.vortexForce(h, hs, fr, [x, 0, 0], res);
  assert.ok(f(-8)[0] > 0 && f(8)[0] < 0); assert.ok(Math.abs(f(-3)[0]) > Math.abs(f(-12)[0])); assert.deepEqual(f(-30), [0, 0, 0]);
  assert.ok(Math.abs(B.vortexForce(h, hs, 30, [-8, 0, 0])[0]) < Math.abs(f(-8, 30 + 600)[0])); assert.ok(Math.abs(f(-8, 600, true)[0]) < Math.abs(f(-8)[0]));
});
test('flood damages below the water level only; debris is telegraphed', () => {
  const d = { id: 'f', arena: { radius: 10, platforms: [{ center: [5, 0, 0], radius: 2, y: 2 }] }, core: { hp: 10 }, phases: [{ id: 'a', openingDelay: 999, attacks: [{ id: 'x', weight: 1, windup: 1, zone: { shape: 'circle', r: 1 }, damage: 1, warning: { vfx: 'v' } }] }],
    hazards: [{ id: 'w', kind: 'flood', start: 0, fromY: 0, toY: 1, rise: 1, dps: 60 }, { id: 'r', kind: 'debris', start: 0, interval: 1, count: 1, r: 1, damage: 5, telegraph: 0.5 }] };
  const s = B.createBoss(d, 2); let low = 0, high = 0; for (let i = 0; i < 120; i++) { low += B.step(s, d, { target: { pos: [0, 0, 0] } }).playerDamage; } const s2 = B.createBoss(d, 2); for (let i = 0; i < 120; i++) high += B.step(s2, d, { target: { pos: [0, 2, 0] } }).events.filter((e) => e.type === 'damage' && e.source === 'w').length;
  assert.ok(low > 20); assert.equal(high, 0); const t = s.log.find((e) => e.type === 'telegraph' && e.hazard); assert.ok(t && t.windup === 0.5);
});
test('stagger meter stuns a part and cancels its attack; enrage multiplies', () => {
  const d = mini(); d.parts[0].stagger = { threshold: 5, duration: 2 }; d.enrage = { afterSeconds: 1, speedMult: 2, damageMult: 2 }; const s = B.createBoss(d, 1);
  let stun = false; for (let i = 0; i < 200; i++) { const r = idleStep(s, d, { hits: i === 40 ? [{ part: 'h1', damage: 6 }] : [] }); if (r.events.some((e) => e.type === 'stun')) stun = true; } assert.ok(stun); assert.ok(s.enraged);
  assert.equal(s.log.find((e) => e.type === 'enrage').speed, 2);
});
test('determinism: same seed = same log hash and state; different seed differs; state is JSON', () => {
  const run = (seed) => B.runFight(ex('hydra'), { seed, log: true }), a = run(11), b = run(11), c = run(12);
  assert.equal(a.logHash, b.logHash); assert.deepEqual(a.log, b.log); assert.notEqual(a.logHash, c.logHash);
  const s = B.createBoss(ex('hydra'), 2); for (let i = 0; i < 500; i++) idleStep(s, ex('hydra')); assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.equal(B.simulate(ex('vortex'), { runs: 4, seed: 3 }).hash, B.simulate(ex('vortex'), { runs: 4, seed: 3 }).hash);
});
test('examples validate and pass the fairness gate; sim produces sane stats', () => {
  for (const n of ['hydra', 'vortex']) {
    const d = ex(n), v = B.validateBoss(d); assert.ok(v.ok, JSON.stringify(v.errors)); const f = B.fairness(d); assert.ok(f.pass, JSON.stringify(f.findings));
    const r = B.simulate(d, { runs: 10 }); assert.ok(r.winRate > 0, `${n} winnable`); assert.ok(r.timeToKill.mean > 5 && r.timeToKill.mean < 300);
  }
  const weak = B.simulate(ex('hydra'), { runs: 10, profile: { dodgeSkill: 0, hp: 1000 } }), strong = B.simulate(ex('hydra'), { runs: 10, profile: { hp: 1000 } });
  assert.ok(weak.damageTaken.mean > strong.damageTaken.mean, 'unskilled bot is hurt more');
});
test('planted unfair bosses are rejected by the fairness gate', () => {
  const codes = (d, o) => B.fairness(d, o).findings.filter((f) => f.severity === 'error').map((f) => f.code);
  const short = clone(ex('hydra')); short.phases[0].attacks[0].windup = 0.15; assert.ok(codes(short).includes('TELEGRAPH_TOO_SHORT'));
  // a huge one-shot zone is avoidable only with an i-frame roll; a long active window is not
  const huge = clone(ex('hydra')); huge.phases[0].attacks[1].zone = { shape: 'circle', r: 40 }; huge.phases[0].attacks[1].active = 1.0; assert.ok(codes(huge).includes('UNAVOIDABLE_ATTACK'));
  const nowarn = clone(ex('hydra')); delete nowarn.phases[0].attacks[0].warning; assert.ok(codes(nowarn).includes('NO_WARNING_DATA'));
  const rush = clone(ex('hydra')); rush.phases[1].attacks.forEach((a) => { a.windup = 0.4; a.active = 1; a.zone = { shape: 'circle', r: 25 }; }); const rc = codes(rush); assert.ok(rc.includes('UNAVOIDABLE_ATTACK') && rc.includes('NO_SAFE_ZONE'), rc.join());
  const pull = clone(ex('vortex')); pull.hazards[0].strength = 9; delete pull.hazards[0].resistFactor; assert.ok(codes(pull).includes('VORTEX_INESCAPABLE'));
  const flood = clone(ex('vortex')); flood.arena.platforms = []; assert.ok(codes(flood).includes('NO_HIGH_GROUND'));
  const swarm = clone(ex('hydra')); swarm.phases[1].maxConcurrent = 3; swarm.hazards.push({ id: 'd', kind: 'debris', phase: 'p2', start: 1, interval: 0.5, count: 3, r: 1, damage: 5, telegraph: 1.5 }); assert.ok(codes(swarm).includes('TOO_MANY_THREATS'));
  const tight = clone(ex('hydra')); assert.ok(codes(tight, { reactionMs: 1200 }).includes('TELEGRAPH_TOO_SHORT'), 'configurable reaction floor');
  const enr = clone(ex('hydra')); enr.enrage.windupMult = 0.3; assert.ok(codes(enr).includes('TELEGRAPH_TOO_SHORT'), 'enrage can not shrink telegraphs below the floor');
  const sim = clone(ex('hydra')); sim.phases[0].attacks[0] = { ...sim.phases[0].attacks[0], windup: 0.36, active: 0.3, rehit: 0.1, damage: 30, zone: { shape: 'cone', r: 9, angle: 340 } };
  assert.ok(codes(sim).some((c) => ['UNAVOIDABLE_ATTACK', 'SIM_ATTACK_HITS_ORACLE', 'SIM_UNAVOIDABLE_DAMAGE', 'NO_SAFE_ZONE'].includes(c)));
});
test('validateBoss reports structural errors with paths', () => {
  const bad = clone(ex('hydra')); bad.parts.push({ id: 'head_a', hp: 5, pos: [0, 0, 0] }); bad.phases[1].enter = {}; bad.phases[0].attacks[0].part = 'ghost'; bad.phases[0].attacks[1].zone.shape = 'blob'; bad.hazards[0].kind = 'lava';
  const v = B.validateBoss(bad), c = v.errors.map((e) => e.code); for (const k of ['BAD_ID', 'REQUIRED', 'UNKNOWN_REF', 'BAD_SHAPE', 'BAD_KIND']) assert.ok(c.includes(k), k);
  assert.ok(v.errors.every((e) => e.path)); assert.equal(B.validateBoss(null).ok, false);
  const unreachable = clone(ex('hydra')); unreachable.core.exposedWhen = { partsDownAtLeast: 9 }; assert.ok(B.validateBoss(unreachable).errors.some((e) => e.code === 'UNREACHABLE'));
});
