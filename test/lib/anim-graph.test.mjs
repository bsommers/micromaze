import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as A from '../../src/lib/gltf-anim.js';
import * as G from '../../src/lib/anim-graph.js';
import { buildRigGLB } from '../../../../test/helpers/anim-glb.mjs';

const close = (a, b, m, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${m}: ${a} vs ${b}`);
const DT = 1 / 60;
const loco = () => ({
  version: 1, parameters: { speed: { type: 'float' }, attack: { type: 'trigger' }, grounded: { type: 'bool', default: true } },
  layers: [{ name: 'base', entry: 'idle',
    states: { idle: { clip: 'Idle' }, walk: { clip: 'Walk' }, strike: { clip: 'Strike', loop: false, events: [{ name: 'hit_start', at: 0.25 }, { name: 'hit_end', time: 0.3 }] } },
    transitions: [
      { from: 'idle', to: 'walk', conditions: [{ param: 'speed', op: '>', value: 0.1 }], duration: 0.1 },
      { from: 'walk', to: 'idle', conditions: [{ param: 'speed', op: '<=', value: 0.1 }], duration: 0.1 },
      { from: '*', to: 'strike', conditions: [{ param: 'attack' }, { param: 'grounded', value: true }] },
      { from: 'strike', to: 'idle', exitTime: 1, duration: 0.1 }] }],
});
const CL = { Idle: { duration: 1 }, Walk: { duration: 1 }, Strike: { duration: 0.5 } };
const run = (g, n, per = () => {}) => { const evs = [], trs = []; for (let f = 0; f < n; f++) { per(g, f); const r = g.step(DT); evs.push(...r.events.map((e) => ({ f, ...e }))); trs.push(...r.transitions.map((t) => ({ f, ...t }))); } return { evs, trs }; };

test('transitions: parameter condition, crossfade, trigger consumed, exit time', () => {
  const g = new G.AnimGraph(loco(), CL);
  run(g, 10); assert.equal(g.state(), 'idle');
  g.setParam('speed', 1); const a = run(g, 1); assert.deepEqual(a.trs.map((t) => t.to), ['walk']); assert.ok(g.weightOf() < 1);
  run(g, 10); assert.equal(g.weightOf(), 1);
  g.setTrigger('attack'); const b = run(g, 1); assert.equal(g.state(), 'strike'); assert.equal(g.params.attack, false);
  const c = run(g, 40); assert.equal(c.trs[0]?.to, 'idle'); assert.equal(c.trs[0].from, 'strike');
});
test('transitions are blocked while crossfading unless interrupt', () => {
  const gr = loco(); const g = new G.AnimGraph(gr, CL); g.setParam('speed', 1); g.step(DT); g.setParam('speed', 0); const r = g.step(DT);
  assert.equal(r.transitions.length, 0); assert.equal(g.state(), 'walk');
});
test('events: normalised and seconds positions fire exactly once, deterministic', () => {
  const trial = () => { const g = new G.AnimGraph(loco(), CL); g.setTrigger('attack'); return run(g, 40); };
  const a = trial(), b = trial(); assert.deepEqual(a, b);
  assert.deepEqual(a.evs.map((e) => e.name), ['hit_start', 'hit_end']);
  assert.equal(a.evs[0].t, 0.25); close(a.evs[1].t, 0.6, 'time 0.3s of 0.5s clip');
});
test('events: loop wrap emits once per cycle, including at 0 on entry', () => {
  const g = { version: 1, parameters: {}, layers: [{ name: 'b', entry: 's', states: { s: { clip: 'Idle', events: [{ name: 'step', at: 0 }, { name: 'mid', at: 0.5 }] } }, transitions: [] }] };
  const r = run(new G.AnimGraph(g, CL), 125); const n = (x) => r.evs.filter((e) => e.name === x).length;
  assert.equal(n('step'), 3); assert.equal(n('mid'), 2); // 2.08 s: step at 0,1,2; mid at 0.5,1.5
});
test('snapshot/restore reproduces the same future', () => {
  const g = new G.AnimGraph(loco(), CL); g.setParam('speed', 1); run(g, 30); const snap = g.snapshot(); const x = run(g, 60);
  const h = new G.AnimGraph(loco(), CL).restore(JSON.parse(JSON.stringify(snap))); assert.deepEqual(run(h, 60), x);
});
test('blend space weights and sync', () => {
  const s = { blend: { param: 'v', points: [{ at: 0, clip: 'I' }, { at: 2, clip: 'W' }, { at: 4, clip: 'R' }] } };
  assert.deepEqual(G.blendWeights(s, { v: -1 }), [{ clip: 'I', w: 1 }]);
  const w = G.blendWeights(s, { v: 3 }); assert.deepEqual(w.map((x) => x.clip), ['W', 'R']); close(w[1].w, 0.5, 'mid');
  assert.deepEqual(G.blendWeights(s, { v: 9 }), [{ clip: 'R', w: 1 }]);
  const g = { version: 1, parameters: { v: { type: 'float' } }, layers: [{ name: 'b', entry: 'l', states: { l: s.blend ? { ...s, events: [{ name: 'foot', at: 0.5 }] } : s }, transitions: [] }] };
  const rt = new G.AnimGraph(g, { I: { duration: 2 }, W: { duration: 1 }, R: { duration: 0.5 } }); rt.setParam('v', 3);
  const r = run(rt, 60); // duration = 0.5*1 + 0.5*0.5 = 0.75 s
  assert.equal(r.evs.length, 1 + 0 * 1); close(r.evs[0].f * DT, 0.375, 'foot at 0.5 of 0.75s', DT);
});
test('root motion: delta per step sums to clip travel and wraps across loops (Slide: 2 m in 2 s)', () => {
  const m = A.parseAnimGLB(buildRigGLB({ clips: ['Slide', 'Wave', 'Idle'] }));
  const graph = { version: 1, parameters: {}, rootMotion: { mode: 'extract', bone: 'Hips' }, layers: [{ name: 'b', entry: 's', states: { s: { clip: 'Slide' } }, transitions: [] }] };
  const p = new G.AnimGraphPlayer(m, graph); let sum = 0; for (let f = 0; f < 240; f++) sum += p.update(DT).rootMotion.x;
  close(sum, 4, 'two loops = 4 m', 1e-4);
  const pose = p.pose(); close(pose[1].t[0], 0, 'pose locked in place');
  const free = new G.AnimGraphPlayer(m, { ...graph, rootMotion: { mode: 'none' } }); for (let f = 0; f < 60; f++) free.update(DT);
  assert.equal(free.update(DT).rootMotion.x, 0); close(free.pose()[1].t[0], 1.0167, 'unlocked pose moves', 1e-3);
});
test('layers: masked override only drives the masked subtree; additive adds delta', () => {
  const m = A.parseAnimGLB(buildRigGLB({ clips: ['Slide', 'Wave', 'Idle'] }));
  const graph = { version: 1, parameters: {}, layers: [
    { name: 'base', entry: 's', states: { s: { clip: 'Slide' } }, transitions: [] },
    { name: 'arm', entry: 'w', mask: { bones: ['arm'] }, states: { w: { clip: 'Wave', loop: false } }, transitions: [] }] };
  const p = new G.AnimGraphPlayer(m, graph); for (let f = 0; f < 60; f++) p.update(DT);
  const pose = p.pose(); close(pose[1].t[0], 1.0, 'hips follow base', 1e-3); close(Math.abs(pose[2].r[2]), Math.sin(Math.PI / 4 * 1.0) , 'arm rotated by Wave (90deg at 1s)', 1e-3);
  const mask = G.resolveMask(m, { bones: ['Hips'], exclude: ['Arm'] }); assert.deepEqual([...mask], [0, 1, 0, 0]);
  const add = { ...graph, layers: [graph.layers[0], { name: 'add', entry: 'w', blend: 'additive', weight: 0.5, mask: { bones: ['Arm'] }, states: { w: { clip: 'Wave', loop: false } }, transitions: [] }] };
  const q = new G.AnimGraphPlayer(m, add); for (let f = 0; f < 60; f++) q.update(DT); assert.ok(Math.abs(q.pose()[2].r[2]) > 0.2 && Math.abs(q.pose()[2].r[2]) < 0.7);
  assert.ok(q.skinned().length === 1);
});
test('empty state fades a masked layer in and out', () => {
  const m = A.parseAnimGLB(buildRigGLB({ clips: ['Wave', 'Slide'] }));
  const graph = { version: 1, parameters: { go: { type: 'trigger' } }, layers: [{ name: 'base', entry: 's', states: { s: { clip: 'Slide' } }, transitions: [] },
    { name: 'u', entry: 'none', mask: { bones: ['Arm'] }, states: { none: { empty: true }, w: { clip: 'Wave', loop: false } }, transitions: [{ from: 'none', to: 'w', conditions: [{ param: 'go' }], duration: 0.5 }] }] };
  const p = new G.AnimGraphPlayer(m, graph); p.update(DT); close(p.pose()[2].r[2], 0, 'arm at bind before trigger'); p.setTrigger('go'); for (let f = 0; f < 15; f++) p.update(DT);
  assert.ok(Math.abs(p.pose()[2].r[2]) > 0.05, 'arm partially driven mid-fade');
});
test('validateGraph: references, params, masks, blend', () => {
  const m = A.parseAnimGLB(buildRigGLB({ clips: ['Slide', 'Wave'] }));
  const ctx = { clips: m.animations.map((a) => a.name), bones: m.nodes.map((n) => n.name) };
  const bad = { version: 1, parameters: { s: { type: 'float' }, b: { type: 'bool' } }, rootMotion: { bone: 'Nope' }, layers: [{ name: 'x', entry: 'zz', mask: { bones: ['Ghost'] },
    states: { a: { clip: 'Missing' }, b: { blend: { param: 'b', points: [{ at: 0, clip: 'Slide' }] } }, c: { clip: 'Slide' } },
    transitions: [{ from: 'a', to: 'q' }, { from: 'a', to: 'b', conditions: [{ param: 'nope' }, { param: 's', value: 1 }] }] }] };
  const r = G.validateGraph(bad, ctx), txt = r.errors.join('\n');
  for (const k of ['entry "zz"', 'clip "Missing"', 'mask bone "Ghost"', 'blend.param "b"', 'to "q"', 'param "nope"', 'needs op', 'rootMotion.bone']) assert.ok(txt.includes(k), k + '\n' + txt);
  assert.ok(r.warnings.some((w) => /unreachable/.test(w)));
  const good = JSON.parse(readFileSync(new URL('../../../../spec/v4/examples/anim-graph/humanoid.json', import.meta.url), 'utf8'));
  assert.deepEqual(G.validateGraph(good, {}).errors, []);
});
const REAL = '/home/bill/src/fun/colbdysseus/assets/meshy';
const reals = existsSync(REAL) ? readdirSync(REAL).filter((f) => f.endsWith('.glb') && /Parkway/.test(f)) : [];
test('real Meshy rig (Rigify names, Walking/Running/Boxing_Practice): graph runs, masks resolve, root travels', { skip: reals.length ? false : 'no Meshy GLBs present' }, () => {
  const m = A.parseAnimGLB(new Uint8Array(readFileSync(join(REAL, reals[0]))));
  const graph = JSON.parse(readFileSync(new URL('../../../../spec/v4/examples/anim-graph/meshy-parkway-pete.json', import.meta.url), 'utf8'));
  const ctx = { clips: m.animations.map((a) => a.name), bones: m.nodes.map((n) => n.name) };
  assert.deepEqual(G.validateGraph(graph, ctx).errors, []);
  const p = new G.AnimGraphPlayer(m, graph); assert.equal(m.nodes[p.rootNode].name, 'spine');
  const mask = p.masks[1]; assert.ok(mask[m.nodes.findIndex((n) => n.name === 'hand.L')] === 1); assert.ok(mask[m.nodes.findIndex((n) => n.name === 'thigh.L')] === 0);
  p.setParam('speed', 3.5); let dz = 0, d = 0; for (let f = 0; f < 120; f++) { const r = p.update(DT); d += Math.hypot(r.rootMotion.x, r.rootMotion.z); dz += r.rootMotion.z; }
  assert.ok(Number.isFinite(d)); p.setTrigger('punch'); const ev = []; for (let f = 0; f < 60; f++) ev.push(...p.update(DT).events.map((e) => e.name));
  assert.deepEqual(ev, ['hit_start', 'hit_end']); p.pose().forEach((x) => assert.ok(x.t.every(Number.isFinite) && x.r.every(Number.isFinite)));
});
