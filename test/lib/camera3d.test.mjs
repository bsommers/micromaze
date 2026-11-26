import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/lib/camera3d.js';

const cfg = C.createConfig(), dt = 1 / 60, dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const run = (c, st, inp, w, n) => { for (let i = 0; i < n; i++) C.stepCamera(st, c, inp, w, dt); return st; };

test('config: defaults fill, overrides merge deep, checkConfig catches bad ranges', () => {
  const c = C.createConfig({ follow: { distance: 8 } });
  assert.equal(c.follow.distance, 8); assert.equal(c.follow.height, cfg.follow.height); assert.deepEqual(C.checkConfig(cfg), []);
  assert.ok(C.checkConfig(C.createConfig({ follow: { minPitch: 1, maxPitch: 0 } })).length);
  assert.ok(C.checkConfig(C.createConfig({ follow: { minDistance: 99 } })).length);
});
test('follow: settles at boom distance behind pivot, converges to a moving target', () => {
  const st = C.createCamera(cfg, { target: [0, 0, 0] });
  assert.ok(Math.abs(dist(st.out.pos, st.pivot) - cfg.follow.distance) < 1e-9);
  run(cfg, st, { target: [10, 0, 0] }, null, 240);
  assert.ok(Math.abs(st.pivot[0] - 10) < 1e-3);
  assert.ok(st.out.pos[2] > st.pivot[2], 'yaw 0 puts camera at +z');
});
test('orbit: yaw input rotates around pivot at constant distance; pitch clamps', () => {
  const st = C.createCamera(cfg, { target: [0, 0, 0] });
  run(cfg, st, { target: [0, 0, 0], yawDelta: 0.05, pitchDelta: 0.1 }, null, 100);
  assert.ok(Math.abs(dist(st.out.pos, st.pivot) - cfg.follow.distance) < 1e-6);
  assert.equal(st.pitch, cfg.follow.maxPitch);
});
test('smoothing is frame independent-ish: lag 0 follows instantly', () => {
  const c = C.createConfig({ follow: { positionLag: 0 } }), st = C.createCamera(c, { target: [0, 0, 0] });
  C.stepCamera(st, c, { target: [5, 0, 0] }, null, dt); assert.equal(st.pivot[0], 5);
});
test('collision boom: wall behind player shortens boom, never clips, recovers after', () => {
  const wall = C.boxToTris([-5, -1, 2], [5, 6, 3]);          // wall at z 2..3, camera wants z=+4.5
  const st = C.createCamera(cfg, { target: [0, 0, 0] });
  run(cfg, st, { target: [0, 0, 0] }, wall, 30);
  assert.ok(st.collided); assert.ok(st.out.distance < cfg.follow.distance);
  assert.ok(st.out.pos[2] < 2 - cfg.follow.probeRadius + 1e-3, 'camera stays in front of wall: ' + st.out.pos[2]);
  assert.ok(st.out.distance >= cfg.follow.minDistance - 1e-9);
  run(cfg, st, { target: [0, 0, 0] }, null, 600);            // wall removed
  assert.ok(Math.abs(st.out.distance - cfg.follow.distance) < 0.01); assert.ok(!st.collided);
});
test('collision boom: respects minDistance when wall is right behind', () => {
  const wall = C.boxToTris([-5, -1, 0.2], [5, 6, 1]);
  const st = C.createCamera(cfg, { target: [0, 0, 0] }); run(cfg, st, { target: [0, 0, 0] }, wall, 10);
  assert.ok(Math.abs(st.out.distance - cfg.follow.minDistance) < 1e-9);
});
test('lock-on: camera ends up behind player facing target, framed, with longer boom', () => {
  const st = C.createCamera(cfg, { target: [0, 0, 0] }), tgtPt = [10, 1, 0];
  run(cfg, st, { target: [0, 0, 0], lock: tgtPt }, null, 400);
  assert.ok(st.out.pos[0] < 0, 'camera behind player (opposite side from target)');
  assert.ok(Math.abs(st.out.pos[2]) < 0.05 * cfg.follow.distance + 0.2);
  assert.ok(st.out.distance > cfg.follow.distance, 'framing lengthens boom');
  const fx = st.out.target[0] - st.out.pos[0]; assert.ok(fx > 0);
  assert.ok(st.out.target[0] > st.pivot[0] + 1, 'look point shifted toward target');
  // release: no snap, yaw kept
  const yaw = st.yaw; C.stepCamera(st, cfg, { target: [0, 0, 0] }, null, dt); assert.ok(Math.abs(st.yaw - yaw) < 1e-9);
});
test('lock-on picks shortest yaw path across the +-pi seam', () => {
  const st = C.createCamera(cfg, { target: [0, 0, 0], yaw: 3.0 });
  for (let i = 0; i < 120; i++) { C.stepCamera(st, cfg, { target: [0, 0, 0], lock: [0.2, 0, 10] }, null, dt); assert.ok(Math.abs(st.yaw) > 2.99, 'never swings through 0: ' + st.yaw); }
});
test('aim: blends distance, shoulder offset and fov', () => {
  const st = C.createCamera(cfg, { target: [0, 0, 0] }); run(cfg, st, { target: [0, 0, 0], aim: true }, null, 300);
  assert.ok(Math.abs(st.out.fov - cfg.aim.fov) < 0.01); assert.ok(Math.abs(st.out.distance - cfg.aim.distance) < 0.01);
  assert.ok(st.out.pos[0] > st.pivot[0] + 0.5, 'camera shifted right');
});
test('fov kick adds then decays', () => {
  const st = C.createCamera(cfg, { target: [0, 0, 0] }); C.kickFov(st, 20); C.stepCamera(st, cfg, { target: [0, 0, 0] }, null, dt);
  assert.ok(st.out.fov > cfg.fov.base + 15); run(cfg, st, { target: [0, 0, 0] }, null, 300); assert.ok(Math.abs(st.out.fov - cfg.fov.base) < 0.01);
});
test('shake: deterministic by seed, decays to zero, bounded, does not move the rig', () => {
  const go = (seed) => { const c = C.createConfig({ shake: { seed } }), st = C.createCamera(c, { target: [0, 0, 0] }); C.addTrauma(st, 1); const ps = []; for (let i = 0; i < 90; i++) { C.stepCamera(st, c, { target: [0, 0, 0] }, null, dt); ps.push([...st.out.pos]); } return { st, ps }; };
  const a = go(1), b = go(1), c2 = go(2);
  assert.deepEqual(a.ps, b.ps); assert.notDeepEqual(a.ps, c2.ps);
  const quiet = C.createCamera(cfg, { target: [0, 0, 0] }), base = quiet.out.pos;
  for (const p of a.ps) assert.ok(dist(p, base) < cfg.shake.maxOffset * 2 + 0.2);
  assert.ok(dist(a.ps[0], base) > 1e-4, 'shaking');
  const st = a.st; run(cfg, st, { target: [0, 0, 0] }, null, 120);
  assert.equal(st.trauma, 0); assert.ok(dist(st.out.pos, base) < 1e-6, 'settled'); assert.equal(st.out.roll, 0);
});
test('state is JSON round-trippable and resumes identically', () => {
  const st = C.createCamera(cfg, { target: [0, 0, 0] }); C.addTrauma(st, 0.5); run(cfg, st, { target: [1, 0, 0], yawDelta: 0.01 }, null, 20);
  const copy = JSON.parse(JSON.stringify(st)); run(cfg, st, { target: [2, 0, 0] }, null, 10); run(cfg, copy, { target: [2, 0, 0] }, null, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(st)), JSON.parse(JSON.stringify(copy)));
});
test('pickLockTarget: prefers centred/near, rejects out of range and occluded; switch flicks', () => {
  const cands = [{ id: 'a', pos: [0, 0, -5] }, { id: 'b', pos: [3, 0, -5] }, { id: 'c', pos: [-3, 0, -5] }, { id: 'far', pos: [0, 0, -50] }];
  const p = C.pickLockTarget([0, 0, 0], [0, 0, -1], cands, cfg); assert.equal(p.id, 'a');
  const wall = C.boxToTris([-1, -1, -3], [1, 3, -2]);
  assert.notEqual(C.pickLockTarget([0, 0, 0], [0, 0, -1], cands, cfg, wall).id, 'a');
  const r = C.switchLockTarget([0, 0, 0], p, cands, 1, cfg), l = C.switchLockTarget([0, 0, 0], p, cands, -1, cfg);
  assert.equal(r.id, 'b'); assert.equal(l.id, 'c');
});
test('noise1 is smooth, bounded and seeded', () => {
  for (let i = 0; i < 200; i++) { const v = C.noise1(3, 1, i * 0.37); assert.ok(v >= -1 && v <= 1); assert.ok(Math.abs(C.noise1(3, 1, i * 0.37 + 1e-4) - v) < 1e-2); }
  assert.notEqual(C.noise1(3, 1, 0.5), C.noise1(4, 1, 0.5));
});
