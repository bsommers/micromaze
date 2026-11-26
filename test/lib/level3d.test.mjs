import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as L from '../../src/lib/level3d.js';
import * as BVH from '../../src/lib/bvh.js';

const ex = (n) => JSON.parse(readFileSync(new URL(`../../../../spec/v4/examples/level3d/${n}.json`, import.meta.url), 'utf8'));
const NAMES = ['arena-towers', 'river-arena', 'tutorial-yard'];
const flat = (extra = {}) => ({ version: 1, id: 't', bounds: { min: [-6, -1, -6], max: [6, 6, 6] }, nav: { cellSize: 0.5 }, pieces: [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [12, 1, 12] }], spawns: [{ id: 'p', kind: 'player', pos: [0, 0, 0] }], ...extra });

test('examples validate clean and reach everything', () => {
  for (const n of NAMES) { const r = L.validate(ex(n)); assert.deepEqual(r.errors, [], n); assert.deepEqual(r.warnings, [], n); assert.equal(r.report.reachability.unreachable.length, 0); assert.ok(r.report.reachability.reachableNodes > 500); }
});
test('example JSON is schema-shaped (required keys, known kinds)', () => {
  const schema = JSON.parse(readFileSync(new URL('../../../../spec/v4/schemas/level3d.schema.json', import.meta.url), 'utf8'));
  for (const n of NAMES) { const lv = ex(n); for (const k of schema.required) assert.ok(k in lv, `${n}.${k}`); for (const s of lv.spawns) assert.ok(schema.properties.spawns.items.properties.kind.enum.includes(s.kind)); }
  assert.deepEqual(schema.properties.hazards.items.allOf[1].properties.kind.enum, L.HAZARD_KINDS);
});
test('bake is deterministic: identical hash, key order independent, pinned', () => {
  for (const n of NAMES) { const a = L.bake(ex(n)), b = L.bake(JSON.parse(JSON.stringify(ex(n)))); assert.equal(a.hash, b.hash); assert.equal(Buffer.compare(Buffer.from(a.bvhBuffer), Buffer.from(b.bvhBuffer)), 0); assert.match(a.hash, /^[0-9a-f]{16}$/); }
  const rev = Object.fromEntries(Object.entries(ex('tutorial-yard')).reverse()); assert.equal(L.bake(rev).hash, L.bake(ex('tutorial-yard')).hash);
  assert.equal(L.bake(ex('tutorial-yard')).hash, '4dd9bb9fced53f15');
  assert.notEqual(L.bake(flat()).hash, L.bake(flat({ pieces: [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [12, 1, 12.5] }] })).hash);
});
test('bvh buffer round-trips and nav serialises and reloads to the same provider', () => {
  const b = L.bake(ex('arena-towers')), bv = BVH.deserialize(b.bvhBuffer); assert.equal(bv.count, b.triCount);
  const hit = BVH.raycast(bv, [0, 5, -11], [0, -1, 0]); assert.ok(Math.abs(5 - hit.t) < 1e-6, 'ground at y=0');
  const nav = L.navFromJSON(JSON.parse(JSON.stringify(b.navData))), p1 = b.nav.findPath([0, 0, -11], [7, 2, 0]), p2 = nav.findPath([0, 0, -11], [7, 2, 0]);
  assert.deepEqual(p1, p2); assert.ok(p1.length >= 2);
});
test('box geometry: closed, outward winding, yaw follows the Godot convention', () => {
  const t = L.pieceTriangles({ type: 'box', pos: [0, 0, 0], size: [2, 2, 2] }); assert.equal(t.length, 12);
  let vol = 0; for (const [a, b, c] of t) vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  assert.ok(Math.abs(vol - 8) < 1e-9, `volume ${vol}`);
  const y = L.pieceTriangles({ type: 'box', pos: [0, 0, 0], size: [4, 1, 1], yaw: 90 }).flat(); assert.ok(Math.max(...y.map((v) => Math.abs(v[2]))) > 1.99 && Math.max(...y.map((v) => Math.abs(v[0]))) < 0.51);
  const r = L.pieceTriangles({ type: 'ramp', pos: [0, 0, 0], size: [2, 2, 4] }); assert.equal(r.length, 8);
  const top = r.flatMap((tr) => tr).reduce((m, v) => Math.max(m, v[1]), -9), zAtTop = r.flatMap((tr) => tr).filter((v) => v[1] === top).map((v) => v[2]); assert.ok(zAtTop.every((z) => z === 2), 'high edge at +z');
});
test('nav: walls block, steps within limit connect, steep or tall rises do not', () => {
  const lv = flat({ pieces: [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [12, 1, 12] }, { id: 'wall', type: 'box', pos: [0, 1, 0], size: [0.5, 2, 12] }, { id: 'curb', type: 'box', pos: [-3, 0.15, 3], size: [1, 0.3, 1] }], spawns: [{ id: 'p', kind: 'player', pos: [-3, 0, 0] }, { id: 'e', kind: 'enemy', pos: [3, 0, 0], config: 'x' }] });
  const r = L.validate(lv); assert.ok(r.errors.some((e) => /spawns\[1\].*not reachable/.test(e)), r.errors.join('|'));
  assert.equal(r.baked.nav.findPath([-3, 0, 0], [3, 0, 0]), null);
  const open = flat({ spawns: [{ id: 'p', kind: 'player', pos: [-3, 0, 0] }, { id: 'e', kind: 'enemy', pos: [3, 0, 0], config: 'x' }] });
  const nav = L.bake(open).nav, path = nav.findPath([-3, 0, 0], [3, 0, 0]); assert.ok(path && path.length === 1 && path[0][0] === 3, JSON.stringify(path)); assert.equal(nav.isClear([-3, 0, 0], [3, 0, 0]), true);
  const curb = L.bake(lv).nav; const n = curb.nearest([-3, 0.3, 3], 0); assert.ok(Math.abs(curb.pos(n)[1] - 0.3) < 1e-9, 'curb top is a node'); assert.ok(curb.flood([curb.nearest([-3, 0, 0])])[n], 'curb of 0.3 <= step 0.35 is reachable');
  const hi = L.bake({ ...lv, locomotion: { stepHeight: 0.2 } }).nav; assert.equal(hi.flood([hi.nearest([-3, 0, 0])])[hi.nearest([-3, 0.3, 3], 0)], 0, 'lower step limit cuts it off');
});
test('nav: slope limit read from locomotion config, walkable ramp connects deck to ground', () => {
  const mk = (h) => flat({ pieces: [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [12, 1, 12] }, { id: 'r', type: 'ramp', pos: [0, h / 2, 0], size: [3, h, 4] }, { id: 'd', type: 'box', pos: [0, h / 2, 3.5], size: [3, h, 3] }], spawns: [{ id: 'p', kind: 'player', pos: [0, 0, -4] }, { id: 'e', kind: 'enemy', pos: [0, h, 3.5], config: 'x' }] });
  assert.deepEqual(L.validate(mk(2)).errors, []); // 26.6 degrees
  const steep = L.validate(mk(2), { locomotion: { body: { slopeLimitDeg: 20 } } }); assert.ok(steep.errors.some((e) => /not reachable|no walkable/.test(e)), steep.errors.join('|'));
  assert.equal(L.validate(mk(2), { locomotion: { slopeLimitDeg: 30, stepHeight: 0.3 } }).errors.length, 0);
});
test('validate: spawn over void, floating, inside a wall', () => {
  const lv = flat({ spawns: [{ id: 'p', kind: 'player', pos: [0, 0, 0] }, { id: 'v', kind: 'pickup', pos: [9, 0, 0] }, { id: 'f', kind: 'pickup', pos: [1, 3, 1] }, { id: 'w', kind: 'pickup', pos: [2, 0, 2] }], pieces: [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [12, 1, 12] }, { id: 'blk', type: 'box', pos: [2, 1, 2], size: [1, 2, 1] }] });
  const r = L.validate({ ...lv, bounds: { min: [-12, -1, -6], max: [12, 6, 6] } });
  assert.ok(r.errors.some((e) => /"v".*no ground/.test(e)), r.errors.join('|')); assert.ok(r.errors.some((e) => /"f".*floats/.test(e))); assert.ok(r.errors.some((e) => /"w"/.test(e)));
});
test('reachability flags an unreachable pickup island and honours allowUnreachable', () => {
  const lv = flat({ pieces: [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [12, 1, 12] }, { id: 'tower', type: 'box', pos: [3, 2, 3], size: [2, 4, 2] }], spawns: [{ id: 'p', kind: 'player', pos: [0, 0, 0] }, { id: 'top', kind: 'pickup', pos: [3, 4, 3] }] });
  assert.ok(L.validate(lv).errors.some((e) => /"top" is not reachable/.test(e)));
  assert.deepEqual(L.validate({ ...lv, spawns: [lv.spawns[0], { ...lv.spawns[1], allowUnreachable: true }] }).errors, []);
});
test('arena closure: open ring fails, gate or wall closes it', () => {
  const ring = (gap) => { const ps = [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [20, 1, 20] }]; const sides = [['n', [0, 2, 5], [11, 4, 1]], ['s', [0, 2, -5], [11, 4, 1]], ['e', [5, 2, 0], [1, 4, 11]], ['w', [-5, 2, 0], [1, 4, 11]]]; for (const [id, pos, size] of sides) if (id !== gap) ps.push({ id, type: 'box', pos, size }); return ps; };
  const mk = (gap, gates) => ({ version: 1, id: 'a', bounds: { min: [-10, -1, -10], max: [10, 6, 10] }, pieces: ring(gap), spawns: [{ id: 'p', kind: 'player', pos: [0, 0, 0] }, { id: 'b', kind: 'boss', pos: [0, 0, 1] }], arena: { shape: 'box', min: [-5.5, -5.5], max: [5.5, 5.5], boss: 'b', gates } });
  assert.deepEqual(L.validate(mk(null)).errors, []);
  const open = L.validate(mk('n')); assert.ok(open.errors.some((e) => /not closed/.test(e)), open.errors.join('|')); assert.equal(open.report.arena.closed, false);
  assert.deepEqual(L.validate(mk('n', [{ pos: [0, 0, 5], radius: 5.6 }])).errors, []);
  assert.ok(L.validate({ ...mk(null), arena: { ...mk(null).arena, max: [20, 5.5] } }).errors.some((e) => /outside level.bounds/.test(e)));
});
test('nav links add edges, blockers remove nodes', () => {
  const lv = flat({ pieces: [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [12, 1, 12] }, { id: 'wall', type: 'box', pos: [0, 2, 0], size: [0.5, 4, 12] }], spawns: [{ id: 'p', kind: 'player', pos: [-3, 0, 0] }, { id: 'e', kind: 'enemy', pos: [3, 0, 0], config: 'x' }] });
  assert.ok(L.validate(lv).errors.length > 0);
  assert.deepEqual(L.validate({ ...lv, nav: { cellSize: 0.5, links: [{ from: [-1, 0, 0], to: [1, 0, 0] }] } }).errors, []);
  const bl = L.bake(flat({ nav: { cellSize: 0.5, blockers: [{ min: [-1, -1, -1], max: [1, 1, 1] }] } })); assert.equal(bl.nav.walkable([0, 0, 0]), false); assert.equal(bl.nav.walkable([3, 0, 3]), true);
});
test('structure validation reports paths, and bake refuses bad levels', () => {
  const bad = { version: 2, id: '', bounds: { min: [0, 0, 0], max: [0, 1, 1] }, pieces: [{ id: 'a', type: 'sphere', pos: [0, 0, 0] }, { id: 'a', type: 'box', pos: [0, 0, 0] }, { type: 'glb', id: 'g', pos: [0, 0, 0], asset: 'x.png' }, { id: 'h', type: 'heightmap', pos: [0, 0, 0], cellSize: 1, heights: [[1], [1, 2]] }], spawns: [], triggers: [{ id: 't', shape: 'box', pos: [0, 0, 0], event: 'e', activates: ['nope'] }], hazards: [{ id: 'h', kind: 'lava2', shape: 'sphere', pos: [0, 0, 0] }], checkpoints: [{ id: 'c', pos: [0, 0, 0], radius: 1, respawn: 'zz' }], arena: { shape: 'circle', center: [0, 0], radius: 5, boss: 'nb', hazards: ['q'] } };
  const { errors } = L.validateStructure(bad);
  for (const re of [/^version/, /^id/, /^bounds/, /pieces\[0\].type/, /duplicate "a"/, /asset: must be a .glb/, /proxy.size/, /heights/, /player/, /activates/, /hazards\[0\].kind/, /radius: must be > 0/, /respawn/, /arena.boss/, /arena.hazards/]) assert.ok(errors.some((e) => re.test(e)), String(re));
  assert.throws(() => L.bake(bad), (e) => e.code === 'BAD_INPUT' && e.details.length > 5);
  assert.ok(L.validateStructure(ex('arena-towers'), { refs: { ai: ['grunt'], boss: ['nope'], hazards: ['gas'] } }).errors.some((e) => /unknown boss3d definition/.test(e)));
  assert.ok(L.validateStructure(ex('tutorial-yard'), { refs: { assets: [] } }).errors.some((e) => /does not resolve/.test(e)));
  assert.equal(L.validate(ex('arena-towers'), { deep: false }).report, null);
});
test('heightmap pieces produce a walkable surface', () => {
  const lv = flat({ pieces: [{ id: 'g', type: 'box', pos: [0, -0.5, 0], size: [12, 1, 12] }, { id: 'h', type: 'heightmap', pos: [-2, 0, -2], cellSize: 1, heights: [[0, 0, 0, 0, 0], [0, 0.2, 0.2, 0.2, 0], [0, 0.2, 0.3, 0.2, 0], [0, 0.2, 0.2, 0.2, 0], [0, 0, 0, 0, 0]] }] });
  const b = L.bake(lv); assert.ok(Math.abs(b.nav.pos(b.nav.nearest([0, 0.3, 0], 0, 0.05))[1] - 0.3) < 0.1); assert.equal(L.analyze(lv, b).errors.length, 0);
});
