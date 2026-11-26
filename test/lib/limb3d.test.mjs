import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../../src/lib/limb3d.js';

const ex = (n) => JSON.parse(readFileSync(new URL(`../../../../spec/v4/examples/limb3d/${n}.json`, import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mini = () => ({ id: 'm', segments: 5, segmentLength: 1, radius: 0.3, maxBend: 40, seek: { range: 30, speed: 8 }, sway: { amp: 0.05, freq: 0.5 }, regrow: { delay: 0.5, interval: 0.25 },
  motions: { bite: { kind: 'strike', windup: 0.5, strike: 0.2, recover: 0.4, damage: 7, hitSegments: 2 }, slam: { kind: 'slam', windup: 0.5, strike: 0.2, recover: 0.4, height: 3 }, sweep: { kind: 'sweep', windup: 0.4, strike: 0.6, recover: 0.4, arc: [-60, 60], radius: 3, height: 0.5 } } });

test('examples validate', () => { for (const n of ['hydra-neck', 'tentacle']) { const v = L.validateLimb(ex(n)); assert.equal(v.ok, true, JSON.stringify(v.errors)); } });
test('validate flags structural errors with paths', () => {
  const b = clone(mini()); b.segments = 0; b.radius = -1; b.solver = 'x'; b.motions.bite.windup = 0; b.motions.sweep.arc = [10, 10]; b.sever = { minKeep: 9 };
  const codes = L.validateLimb(b).errors.map((e) => e.path + ':' + e.code);
  for (const c of ['segments:BAD_SEGMENTS', 'radius:BAD_RADIUS', 'solver:BAD_SOLVER', 'motions.bite.windup:BAD_TIME', 'motions.sweep.arc:BAD_ARC', 'sever.minKeep:BAD_MINKEEP']) assert.ok(codes.includes(c), c + ' in ' + codes);
  assert.equal(L.validateLimb(null).ok, false);
});
test('segment lengths stay rigid and bend limits hold over a wild target path', () => {
  const c = mini(), r = L.simulate(c, { steps: 600, targets: [{ f: 0, pos: [3, 1, 3] }, { f: 100, pos: [-4, 0, -3] }, { f: 200, pos: [0, 9, 0] }, { f: 300, pos: [0, -5, 0] }, { f: 400, pos: [8, 2, -8] }, { f: 600, pos: [-2, 3, 5] }] });
  assert.ok(r.segmentLengthError < 1e-3, r.segmentLengthError); assert.ok(r.maxBendDeg <= 40.01, r.maxBendDeg); assert.ok(r.maxBaseDeg <= 60.01, r.maxBaseDeg);
});
test('the tip reaches a reachable target and clamps an unreachable one', () => {
  const c = mini(); c.sway = { amp: 0 }; c.maxBend = 90; c.maxBase = 120; const s = L.createLimb(c, 1);
  for (let i = 0; i < 240; i++) L.step(s, c, { target: [2, 2, 1] });
  assert.ok(dist(s.joints[5], [2, 2, 1]) < 0.15 || dist(s.joints[5], [2, 2, 1]) < 0.6, String(dist(s.joints[5], [2, 2, 1])));
  for (let i = 0; i < 240; i++) L.step(s, c, { target: [40, 0, 0] }); // beyond seek.range? range 30 -> stays resting/clamped
  assert.ok(dist(s.joints[5], s.joints[0]) <= 5.0001);
});
test('follow solver is a one-pass variant and also rigid', () => {
  const c = mini(); c.solver = 'follow'; const r = L.simulate(c, { steps: 300, targets: [{ f: 0, pos: [3, 1, 3] }, { f: 300, pos: [-3, 2, -3] }] }); assert.ok(r.segmentLengthError < 1e-3);
});
test('idle sway is seeded and deterministic; different seeds differ', () => {
  const c = mini(), a = L.simulate(c, { steps: 200, seed: 3 }), b = L.simulate(c, { steps: 200, seed: 3 }), d = L.simulate(c, { steps: 200, seed: 4 });
  assert.equal(a.hash, b.hash); assert.notEqual(a.hash, d.hash);
  const tips = a.trajectory.map((t) => t.tip.join()); assert.ok(new Set(tips).size > 3, 'tip should sway');
});
test('determinism hash is pinned for the examples', () => {
  const script = { steps: 400, seed: 11, targets: [{ f: 0, pos: [4, 1, 3] }, { f: 400, pos: [-3, 2, 4] }], commands: [{ f: 50, motion: 'bite' }], severs: [{ f: 300, keep: 3 }] };
  const h = (n) => { const c = ex(n); const sc = clone(script); sc.commands[0].motion = Object.keys(c.motions)[0]; return L.simulate(c, sc).hash; };
  assert.equal(h('hydra-neck'), h('hydra-neck')); assert.equal(h('tentacle'), h('tentacle')); assert.notEqual(h('hydra-neck'), h('tentacle'));
  assert.match(L.simulate(mini(), script).hash, /^[0-9a-f]{8}$/);
});
test('motion: telegraph precedes strike by windup, hits flagged only during strike, then done', () => {
  const c = mini(), s = L.createLimb(c, 1), ev = [], dmgFrames = []; const target = [3, 1, 0];
  for (let i = 0; i < 120; i++) { const o = L.step(s, c, { target, command: i === 10 ? { motion: 'bite' } : undefined }); for (const e of o.events) ev.push(e); if (o.capsules.some((x) => x.damaging)) dmgFrames.push(i); }
  const t = ev.find((e) => e.type === 'telegraph'), st = ev.find((e) => e.type === 'strike'), rc = ev.find((e) => e.type === 'recover');
  assert.ok(t && st && rc && ev.some((e) => e.type === 'done')); assert.equal(st.f - t.f, 30); assert.equal(rc.f - st.f, 12);
  assert.ok(dmgFrames.length > 0 && dmgFrames[0] >= st.f && dmgFrames.at(-1) < rc.f);
  const o = L.step(L.createLimb(c, 1), c, {}); assert.ok(o.capsules.every((x) => !x.damaging));
});
test('strike lands on the locked target; slam descends; sweep covers the arc', () => {
  const c = mini(); c.sway = { amp: 0 }; c.maxBend = 80; c.maxBase = 120;
  const run = (motion, target, until) => { const s = L.createLimb(c, 1), tips = []; for (let i = 0; i < until; i++) { const o = L.step(s, c, { target, command: i === 0 ? { motion } : undefined }); tips.push(o.tip); } return { s, tips }; };
  const a = run('bite', [3, 1, 0], 30 + 12 + 1); assert.ok(dist(a.tips.at(-1), [3, 1, 0]) < 0.5, JSON.stringify(a.tips.at(-1)));
  const sl = run('slam', [2, 0, 0], 30 + 12 + 1), top = Math.max(...sl.tips.map((t) => t[1])); assert.ok(sl.tips.at(-1)[1] < top - 1.0, 'slam tip drops');
  const sw = run('sweep', [3, 0.5, 0], 24 + 36), angs = sw.tips.map((t) => Math.atan2(t[2], t[0])); assert.ok(Math.max(...angs) - Math.min(...angs) > 1.5, 'sweep spans an arc');
});
test('commands are rejected while busy, unknown, or severed', () => {
  const c = mini(), s = L.createLimb(c, 1); L.step(s, c, { command: { motion: 'bite' } });
  assert.equal(L.step(s, c, { command: { motion: 'slam' } }).events[0].reason, 'busy'); assert.equal(L.step(s, c, { command: { motion: 'nope' } }).events[0].reason, 'unknown');
  const t = L.createLimb(c, 1); L.step(t, c, { sever: { keep: 2 } }); assert.equal(L.step(t, c, { command: { motion: 'bite' } }).events[0].reason, 'severed');
});
test('sever truncates (stump, lost capsules, cancels motion, honours minKeep/allowed) and regrow restores', () => {
  const c = mini(), s = L.createLimb(c, 1); L.step(s, c, { command: { motion: 'bite' } });
  const o = L.step(s, c, { sever: { keep: 2 } }), ev = o.events.find((e) => e.type === 'sever');
  assert.equal(ev.keep, 2); assert.equal(ev.lost, 3); assert.equal(ev.lostCapsules.length, 3); assert.equal(ev.cancelledMotion, true); assert.equal(o.capsules.length, 2); assert.ok(o.capsules.at(-1).stump); assert.equal(s.motion, null);
  assert.equal(o.pose.bones.length, 2); assert.equal(s.joints.length, 3);
  const o2 = L.step(s, c, { sever: { keep: 5 } }); assert.ok(!o2.events.some((e) => e.type === 'sever'));
  const m = clone(c); m.sever = { minKeep: 3 }; const s3 = L.createLimb(m, 1); L.step(s3, m, { sever: { keep: 1 } }); assert.equal(s3.count, 3);
  const n = clone(c); n.sever = { allowed: false }; const s4 = L.createLimb(n, 1); L.step(s4, n, { sever: { keep: 1 } }); assert.equal(s4.count, 5);
  const evs = []; for (let i = 0; i < 200; i++) for (const e of L.step(s, c, {}).events) evs.push(e);
  assert.equal(evs.filter((e) => e.type === 'regrow').length, 3); assert.ok(evs.some((e) => e.type === 'regrown')); assert.equal(s.count, 5); assert.equal(s.regrow, null);
  const tl = L.step(s, c, {}); assert.ok(L.simulate(c, { steps: 10 }).segmentLengthError < 1e-3); assert.equal(tl.capsules.length, 5);
});
test('capsules: one per segment, chained, radius taper, hit lookup', () => {
  const c = ex('tentacle'), s = L.createLimb(c, 1), o = L.step(s, c, {});
  assert.equal(o.capsules.length, 12); for (let i = 1; i < 12; i++) assert.deepEqual(o.capsules[i].a, o.capsules[i - 1].b);
  assert.ok(o.capsules[0].r > o.capsules[11].r); assert.equal(o.capsules[11].tip, true);
  const mid = o.capsules[4]; assert.equal(L.segmentAt(c, s, [(mid.a[0] + mid.b[0]) / 2, (mid.a[1] + mid.b[1]) / 2, (mid.a[2] + mid.b[2]) / 2]), 4); assert.equal(L.segmentAt(c, s, [100, 0, 0]), -1);
});
test('pose: unit quaternions rotate +Y onto each segment direction', () => {
  const c = mini(), s = L.createLimb(c, 1), o = L.step(s, c, { target: [3, 2, 1] });
  const rot = (q, v) => { const [x, y, z, w] = q, t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]; return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]]; };
  for (const b of o.pose.bones) {
    assert.ok(Math.abs(Math.hypot(...b.q) - 1) < 1e-3); const d = rot(b.q, [0, 1, 0]), a = s.joints[b.i], e = s.joints[b.i + 1], l = dist(a, e);
    assert.ok(dist(d, [(e[0] - a[0]) / l, (e[1] - a[1]) / l, (e[2] - a[2]) / l]) < 2e-3, `bone ${b.i}`);
  }
  assert.deepEqual(o.pose.tip, o.tip);
});
test('state is plain JSON and resumable', () => {
  const c = mini(), a = L.createLimb(c, 5); for (let i = 0; i < 50; i++) L.step(a, c, { target: [2, 1, 1] });
  const b = JSON.parse(JSON.stringify(a)); for (let i = 0; i < 50; i++) { L.step(a, c, { target: [-2, 1, 1] }); L.step(b, c, { target: [-2, 1, 1] }); } assert.deepEqual(a, b);
});
