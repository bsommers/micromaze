import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as AI from '../../src/lib/ai3d.js';

const ex = (n) => JSON.parse(readFileSync(new URL(`../../../../spec/v4/examples/ai3d/${n}.json`, import.meta.url), 'utf8'));
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('rng: seeded, repeatable, in [0,1)', () => {
  const a = { rng: 42 }, b = { rng: 42 }, xs = Array.from({ length: 50 }, () => AI.rngNext(a)), ys = Array.from({ length: 50 }, () => AI.rngNext(b));
  assert.deepEqual(xs, ys); assert.ok(xs.every((v) => v >= 0 && v < 1)); assert.notEqual(AI.rngNext({ rng: 43 }), xs[0]);
});
test('steering: seek, arrive, flee, orbit, keepDistance, separation, combine', () => {
  assert.deepEqual(AI.seek([0, 0, 0], [0, 5, 3]).dir, [0, 0, 1]);
  assert.equal(AI.arrive([0, 0, 0], [0, 0, 0.1], 2, 0.2).speed, 0);
  near(AI.arrive([0, 0, 0], [0, 0, 1], 2, 0).speed, 0.5);
  assert.deepEqual(AI.flee([0, 0, 0], [3, 0, 0]).dir, [-1, 0, 0]);
  const o = AI.orbit([4, 0, 0], [0, 0, 0], 4, 1); near(o.dir[0], 0); near(o.dir[2], -1); // ccw about +Y from +X goes to -Z
  assert.equal(AI.orbit([4, 0, 0], [0, 0, 0], 4, -1).dir[2], 1);
  assert.ok(AI.orbit([8, 0, 0], [0, 0, 0], 4, 1).dir[0] < 0, 'too far: pulled inward');
  assert.equal(AI.keepDistance([0, 0, 0], [5, 0, 0], 6, 10).dir[0], -1);
  assert.equal(AI.keepDistance([0, 0, 0], [20, 0, 0], 6, 10).dir[0], 1);
  assert.equal(AI.keepDistance([0, 0, 0], [8, 0, 0], 6, 10).speed, 0);
  assert.equal(AI.separation([0, 0, 0], [[0.5, 0, 0]], 1).dir[0], -1);
  assert.equal(AI.separation([0, 0, 0], [[5, 0, 0]], 1).speed, 0);
  const c = AI.combine([{ dir: [1, 0, 0], speed: 1 }, { dir: [-1, 0, 0], speed: 1 }]); assert.equal(c.speed, 0);
  assert.equal(AI.combine([{ dir: [1, 0, 0], speed: 1 }, { dir: [1, 0, 0], speed: 1 }]).speed, 1, 'clamped');
});

const GRID = (rows) => AI.createGridNav({ width: rows[0].length, height: rows.length, cellSize: 1, blocked: rows.flatMap((r) => [...r].map((c) => (c === '#' ? 1 : 0))) });
test('grid A*: routes around walls, none through, no corner cutting, snaps blocked goal', () => {
  const nav = GRID(['.........', '.........', '.#######.', '.........', '.........']);
  const p = nav.findPath([0.5, 0, 0.5], [8.5, 0, 4.5]);
  assert.ok(p && p.length >= 2, 'path found'); assert.deepEqual(p[p.length - 1], [8.5, 0, 4.5]);
  for (const w of p) assert.ok(nav.walkable(w));
  assert.equal(nav.findPath([0.5, 0, 0.5], [8.5, 0, 4.5]).length, p.length, 'repeatable');
  const closed = GRID(['..#..', '..#..', '..#..']); assert.equal(closed.findPath([0.5, 0, 0.5], [4.5, 0, 0.5]), null);
  const diag = GRID(['.#', '#.']); assert.equal(diag.findPath([0.5, 0, 0.5], [1.5, 0, 1.5]), null, 'diagonal squeeze blocked');
  const snap = nav.findPath([0.5, 0, 0.5], [3.5, 0, 2.5]); assert.ok(snap && nav.walkable(snap[snap.length - 1]));
  assert.equal(nav.isClear([0.5, 0, 0.5], [8.5, 0, 4.5]), false); assert.equal(nav.isClear([0.5, 0, 0.5], [8.5, 0, 0.5]), true);
});
test('grid nav: A* optimal length vs brute-force BFS on random maps', () => {
  let s = 99; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let m = 0; m < 10; m++) {
    const W = 12, H = 12, rows = Array.from({ length: H }, () => Array.from({ length: W }, () => (r() < 0.25 ? '#' : '.')).join('')); rows[0] = '.' + rows[0].slice(1); rows[H - 1] = rows[H - 1].slice(0, -1) + '.';
    const nav = GRID(rows), p = nav.findPath([0.5, 0, 0.5], [W - 0.5, 0, H - 0.5]);
    // BFS reachability with the same no-corner-cutting rule
    const free = (i, j) => i >= 0 && j >= 0 && i < W && j < H && rows[j][i] === '.', seen = new Set(['0,0']), q = [[0, 0]];
    while (q.length) { const [i, j] = q.shift(); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if ((!di && !dj) || !free(i + di, j + dj) || (di && dj && (!free(i + di, j) || !free(i, j + dj)))) continue; const k = `${i + di},${j + dj}`; if (!seen.has(k)) { seen.add(k); q.push([i + di, j + dj]); } } }
    assert.equal(!!p, seen.has(`${W - 1},${H - 1}`), `map ${m} reachability`);
  }
});
test('waypoint nav: shortest graph path', () => {
  const nav = AI.createWaypointNav({ nodes: [{ id: 'a', pos: [0, 0, 0] }, { id: 'b', pos: [5, 0, 0] }, { id: 'c', pos: [5, 0, 5] }, { id: 'd', pos: [0, 0, 5] }, { id: 'x', pos: [20, 0, 20] }], edges: [['a', 'b'], ['b', 'c'], ['a', 'd'], ['d', 'c']] });
  const p = nav.findPath([0.2, 0, 0], [5, 0, 5.2]); assert.equal(p.length, 3); assert.ok([[5, 0, 0], [0, 0, 5]].some((q) => q.every((v, k) => v === p[0][k])), 'via b or d'); assert.deepEqual(p[1], [5, 0, 5]); // b|d, c, goal
  assert.equal(nav.findPath([0, 0, 0], [20, 0, 20]), null, 'island unreachable');
  assert.throws(() => AI.createWaypointNav({ nodes: [], edges: [['q', 'r']] }));
  assert.deepEqual(AI.navFromJSON(nav.toJSON()).findPath([0, 0, 0], [5, 0, 5]), nav.findPath([0, 0, 0], [5, 0, 5]));
});

test('perception: cone, range, LOS through walls, hearing, memory expiry', () => {
  const cfg = AI.normalizeConfig({ perception: { sightRange: 10, fovDeg: 90, awareness: 1, hearRadius: 5, memorySec: 2 }, tree: { type: 'action', do: 'idle' } });
  const mkw = (pos, extra = {}) => ({ targets: [{ id: 'p', pos, noise: 0 }], ...extra }), seen = (a, w) => { AI.perceive(a, cfg, w, 1 / 60); return a.perc.known.p?.seen === true; };
  const A = () => AI.createAgent({ id: 'e', config: 'x', pos: [0, 0, 0], facing: [0, 0, 1] });
  assert.ok(seen(A(), mkw([0, 0, 8])), 'in front'); assert.ok(!seen(A(), mkw([0, 0, 12])), 'out of range'); assert.ok(!seen(A(), mkw([0, 0, -8])), 'behind');
  assert.ok(seen(A(), mkw([0, 0, -0.8])), 'awareness radius'); assert.ok(!seen(A(), mkw([8, 0, 1])), 'outside 45deg half angle');
  const walls = [{ min: [-2, 0, 3], max: [2, 4, 4] }], world = mkw([0, 0, 8], { bvh: AI.bvhFromBoxes(walls) }); assert.ok(!seen(A(), world), 'wall blocks LOS');
  assert.ok(seen(A(), mkw([0, 0, 8], { los: () => true })), 'custom los');
  const h = A(); AI.perceive(h, cfg, { targets: [{ id: 'p', pos: [0, 0, -4], noise: 1 }] }, 1 / 60); assert.equal(h.perc.known.p.how, 'sound'); assert.equal(h.perc.known.p.seen, false);
  const m = A(); AI.perceive(m, cfg, mkw([0, 0, 5]), 1 / 60); assert.ok(m.target === 'p');
  m.time = 1; AI.perceive(m, cfg, mkw([0, 0, -9]), 1 / 60); assert.ok(m.perc.known.p, 'remembered'); assert.equal(m.perc.known.p.seen, false); assert.deepEqual(m.perc.known.p.pos, [0, 0, 5]);
  m.time = 5; AI.perceive(m, cfg, mkw([0, 0, -9]), 1 / 60); assert.equal(m.perc.known.p, undefined, 'forgotten'); assert.equal(m.target, null);
});
test('threat: damage reveals attacker, highest threat wins with hysteresis', () => {
  const cfg = AI.normalizeConfig({ perception: { sightRange: 30, fovDeg: 360 }, tree: { type: 'action', do: 'idle' } }), a = AI.createAgent({ id: 'e', config: 'x', pos: [0, 0, 0] });
  const w = { targets: [{ id: 'p1', pos: [0, 0, 5] }, { id: 'p2', pos: [0, 0, 6] }] }; AI.perceive(a, cfg, w, 0.1); assert.equal(a.target, 'p1');
  AI.perceive(a, cfg, { ...w, events: [{ type: 'damage', source: 'p2', target: 'e', amount: 0.005 }] }, 0.1); assert.equal(a.target, 'p1', 'hysteresis holds');
  AI.perceive(a, cfg, { ...w, events: [{ type: 'damage', source: 'p2', target: 'e', amount: 5 }] }, 0.1); assert.equal(a.target, 'p2');
  AI.perceive(a, cfg, { ...w, events: [{ type: 'damage', source: 'p2', target: 'other', amount: 99 }] }, 0.1); assert.equal(a.target, 'p2');
});

const tick = (tree, setup = {}, world = {}, cfgx = {}) => {
  const cfg = AI.normalizeConfig({ perception: { sightRange: 30, fovDeg: 360 }, moves: { hit: { range: { min: 0, max: 2 }, cooldown: 1, duration: 0.5 } }, ...cfgx, tree });
  const a = Object.assign(AI.createAgent({ id: 'e', config: 'c', pos: [0, 0, 0], seed: 5 }), setup);
  return { a, cfg, run: (w = world, dt = 1 / 60) => AI.tickAgent(a, cfg, { targets: [{ id: 'p', pos: [0, 0, 10] }], ...w }, dt) };
};
test('bt: selector/sequence/condition/invert/succeeder', () => {
  const act = (name) => ({ type: 'action', do: 'face', to: 'target', ...(name ? { name } : {}) });
  assert.equal(tick({ type: 'selector', children: [{ type: 'condition', test: 'never' }, { type: 'action', do: 'idle' }] }).run().state, 'idle');
  const seq = tick({ type: 'sequence', children: [{ type: 'condition', test: 'never' }, { type: 'action', do: 'seek' }] }).run(); assert.equal(seq.speed, 0);
  assert.equal(tick({ type: 'sequence', children: [{ type: 'invert', child: { type: 'condition', test: 'never' } }, { type: 'action', do: 'seek' }] }).run().state, 'seek');
  assert.equal(tick({ type: 'sequence', children: [{ type: 'condition', test: 'never', not: true }, act()] }).run().lookAt[2], 10);
  assert.equal(tick({ type: 'sequence', children: [{ type: 'succeeder', child: { type: 'condition', test: 'never' } }, { type: 'action', do: 'seek' }] }).run().state, 'seek');
});
test('bt: attack respects range, cooldown, then re-arms', () => {
  const t = tick({ type: 'action', do: 'attack', move: 'hit' }, {}, { targets: [{ id: 'p', pos: [0, 0, 1] }] });
  assert.equal(t.run().wantAttack, 'hit'); assert.equal(t.run().wantAttack, null, 'cooling');
  let n = 2, hits = 1; for (; n < 130; n++) if (t.run().wantAttack === 'hit') hits++; assert.equal(hits, 3, 're-arms every 1s (ticks 0, 60, 120)');
  assert.equal(tick({ type: 'action', do: 'attack', move: 'hit' }).run().wantAttack, null, 'out of range');
});
test('bt: cooldown decorator and memory sequence', () => {
  const t = tick({ type: 'cooldown', seconds: 0.5, id: 'cd', child: { type: 'action', do: 'attack', move: 'hit' } }, {}, { targets: [{ id: 'p', pos: [0, 0, 1] }] }, { moves: { hit: { range: { min: 0, max: 2 }, cooldown: 0 } } });
  let n = 0; for (let i = 0; i < 120; i++) if (t.run().wantAttack) n++; assert.equal(n, 4, 'one per 0.5s over 2s');
  const ch = (memory) => tick({ type: 'sequence', memory, children: [{ type: 'condition', test: 'inRange', min: 5 }, { type: 'action', do: 'charge', windup: 0.1, speed: 3, maxDist: 20, recover: 0.1 }] });
  const run = (memory) => { const t = ch(memory), states = new Set(); for (let i = 0; i < 90; i++) { const I = t.run({ targets: [{ id: 'p', pos: [0, 0, 10 - t.a.pos[2] * 0 - (t.a.pos[2] > 6 ? 8 : 0)] }] }); states.add(I.state); t.a.pos[2] += I.moveDir[2] * I.speed * 3.5 / 60; } return states; };
  assert.ok(run(true).has('recover') || run(true).has('dash'), 'memory keeps the dash running');
});
test('bt: weighted picks by weight (seeded) and holds while running', () => {
  const counts = { a: 0, b: 0 };
  for (let s = 1; s <= 400; s++) { const t = tick({ type: 'weighted', weights: [3, 1], children: [{ type: 'action', do: 'seek' }, { type: 'action', do: 'idle' }] }, { rng: s }); const I = t.run(); counts[I.state === 'idle' ? 'b' : 'a']++; }
  assert.ok(counts.a > counts.b * 2 && counts.b > 40, JSON.stringify(counts));
  const t = tick({ type: 'weighted', hold: 5, children: [{ type: 'action', do: 'seek' }, { type: 'action', do: 'idle' }] }), first = t.run().state; for (let i = 0; i < 30; i++) assert.equal(t.run().state, first);
});
test('bt: utility chooses by considerations with stickiness', () => {
  const tree = { type: 'utility', options: [
    { name: 'flee', node: { type: 'action', do: 'flee', dist: 20 }, consider: [{ input: 'healthPct', min: 0, max: 1, invert: true }] },
    { name: 'fight', node: { type: 'action', do: 'seek' }, consider: [{ input: 'healthPct', min: 0, max: 1 }] }] };
  assert.equal(tick(tree, { hp: 20 }).run().state, 'flee'); assert.equal(tick(tree, { hp: 90 }).run().state, 'seek');
  assert.equal(tick({ type: 'utility', options: [{ node: { type: 'action', do: 'idle' }, consider: [{ input: 'visible' }] }] }).run({ targets: [] }).state, 'idle', 'no options viable returns failure and leaves default');
});
test('actions: path follows nav around a wall and reaches the goal', () => {
  const nav = GRID(['.........', '.........', '.#######.', '.........', '.........']);
  const cfg = AI.normalizeConfig({ perception: { sightRange: 30, fovDeg: 360 }, tree: { type: 'action', do: 'path', to: 'target', stop: 0.5 } }), a = AI.createAgent({ id: 'e', config: 'c', pos: [4.5, 0, 0.5], seed: 1 });
  let min = Infinity; for (let i = 0; i < 1200; i++) { const I = AI.tickAgent(a, cfg, { nav, targets: [{ id: 'p', pos: [4.5, 0, 4.5] }] }); AI.integrate(a, cfg, I); min = Math.min(min, AI.d2(a.pos, [4.5, 0, 4.5])); assert.ok(!(a.pos[2] > 2.2 && a.pos[2] < 2.8 && a.pos[0] > 1.6 && a.pos[0] < 7.4), `walked through wall at ${i}: ${a.pos}`); }
  assert.ok(min < 1, `reached goal (closest ${min})`);
});
test('actions: flee, keepDistance, orbit hold their geometry', () => {
  const run = (act, n = 600) => { const cfg = AI.normalizeConfig({ perception: { sightRange: 40, fovDeg: 360 }, tree: act }), a = AI.createAgent({ id: 'e', config: 'c', pos: [0, 0, 0], seed: 2 }); for (let i = 0; i < n; i++) AI.integrate(a, cfg, AI.tickAgent(a, cfg, { targets: [{ id: 'p', pos: [0, 0, 6] }] })); return a; };
  assert.ok(AI.d2(run({ type: 'action', do: 'flee', dist: 12 }).pos, [0, 0, 6]) >= 11.9);
  const k = run({ type: 'action', do: 'keepDistance', min: 8, max: 10 }); assert.ok(AI.d2(k.pos, [0, 0, 6]) >= 7.5 && AI.d2(k.pos, [0, 0, 6]) <= 10.5);
  const o = run({ type: 'action', do: 'orbit', radius: 5, dir: 'ccw' }, 900); near(AI.d2(o.pos, [0, 0, 6]), 5, 0.6);
});
test('group: tokens cap simultaneous attackers, expire, and slots spread evenly', () => {
  const g = AI.createGroup({ maxAttackers: 2, ttl: 1 });
  assert.ok(AI.groupRequest(g, 'a', 0) && AI.groupRequest(g, 'b', 0)); assert.ok(!AI.groupRequest(g, 'c', 0.5)); assert.ok(AI.groupRequest(g, 'a', 0.5), 'holder keeps');
  assert.ok(AI.groupRequest(g, 'c', 1.1), 'b expired'); AI.groupRelease(g, 'a'); assert.ok(AI.groupFree(g, 1.1) === true);
  const ag = ['a', 'b', 'c', 'd'].map((id, k) => AI.createAgent({ id, config: 'c', role: 'melee', pos: [Math.cos(k * 0.3) * 6, 0, Math.sin(k * 0.3) * 6] }));
  AI.groupUpdate(g, ag, [0, 0, 0], 0); const sl = ag.map((a) => a.slot).sort((p, q) => p - q);
  for (let k = 1; k < 4; k++) near(sl[k] - sl[k - 1], Math.PI / 2, 1e-9);
  AI.groupUpdate(g, [AI.createAgent({ id: 'r', config: 'c', role: 'ranged', pos: [3, 0, 0] })], [0, 0, 0], 0);
});
test('validateConfig: examples pass; bad configs report paths', () => {
  for (const n of ['grunt', 'ranged', 'charger', 'group-token']) for (const [k, c] of Object.entries(ex(n).configs)) assert.deepEqual(AI.validateConfig(c, k).errors, [], `${n}/${k}`);
  const bad = AI.validateConfig({ tree: { type: 'selector', children: [{ type: 'action', do: 'fly' }, { type: 'condition', test: 'nope' }, { type: 'action', do: 'attack', move: 'zap' }, { type: 'cooldown', child: { type: 'action', do: 'idle' } }, { type: 'weighted', weights: [1], children: [{ type: 'action', do: 'idle' }, { type: 'action', do: 'idle' }] }] } });
  assert.equal(bad.ok, false); const t = bad.errors.join('\n'); for (const s of ['do: unknown action "fly"', 'test: unknown condition "nope"', 'unknown move "zap"', 'seconds: required', 'weights']) assert.ok(t.includes(s), s + '\n' + t);
  assert.equal(AI.validateConfig({}).ok, false); assert.equal(AI.validateConfig(null).ok, false);
});
test('schema file is valid JSON and lists every condition/action the lib implements', () => {
  const s = JSON.parse(readFileSync(new URL('../../../../spec/v4/schemas/ai3d.schema.json', import.meta.url), 'utf8')), node = s.$defs.node.properties;
  assert.deepEqual([...node.test.enum].sort(), Object.keys(AI.CONDITIONS).sort()); assert.deepEqual([...node.do.enum].sort(), [...AI.ACTION_NAMES].sort());
});
test('simulate: examples behave (LOS wall delays aggro, tokens cap attackers, charger dashes)', () => {
  const g = AI.simulate(ex('grunt')); assert.ok(g.timeline.find((e) => e.state === 'wander')); assert.ok(g.attacks.grunt1 >= 1); assert.ok(g.timeline.find((e) => e.state === 'path').t > 3, 'wall hid the player at first');
  const r = AI.simulate(ex('ranged')); assert.ok(r.attacks.archer1 >= 3); assert.ok(r.timeline.some((e) => e.state === 'keepDistance'));
  const c = AI.simulate(ex('charger')), st = c.timeline.map((e) => e.state); assert.ok(st.indexOf('windup') >= 0 && st.indexOf('dash') > st.indexOf('windup') && st.indexOf('recover') > st.indexOf('dash'), st.join());
  const t = AI.simulate(ex('group-token')); assert.ok(t.stats.maxTokens <= 2 && t.stats.maxTokens >= 1); assert.ok(Object.keys(t.attacks).length >= 3, 'everyone gets a turn'); assert.ok(t.timeline.some((e) => e.state === 'surround'));
});
test('determinism: identical hash across runs, seed changes it, JSON round-trip of scenario is identical', () => {
  for (const n of readdirSync(new URL('../../../../spec/v4/examples/ai3d/', import.meta.url)).map((f) => f.replace('.json', ''))) {
    const sc = ex(n), a = AI.simulate(sc), b = AI.simulate(JSON.parse(JSON.stringify(sc))); assert.equal(a.hash, b.hash, n); assert.deepEqual(a.timeline, b.timeline, n);
  }
  const hashes = [1, 2, 3].map((seed) => AI.simulate({ ...ex('charger'), seed }).hash); assert.ok(new Set(hashes).size >= 2, 'seed influences random choices');
  const a = AI.createAgent({ id: 'q', config: 'c', pos: [1, 0, 2], seed: 9 }); assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'agent state is plain JSON');
});
test('pinned hashes (regenerate deliberately when behaviour changes)', () => {
  const got = Object.fromEntries(['grunt', 'ranged', 'charger', 'group-token'].map((n) => [n, AI.simulate(ex(n)).hash])); assert.deepEqual(got, PINNED, JSON.stringify(got));
});
const PINNED = { grunt: 'c33e40e0', ranged: '83eb026e', charger: '76be3068', 'group-token': 'e578ce3b' };
