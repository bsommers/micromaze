import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as V from '../../src/lib/vfx3d.js';
import * as B from '../../src/lib/boss3d.js';

const ex = (n) => JSON.parse(readFileSync(new URL(`../../../../spec/v4/examples/vfx3d/${n}.json`, import.meta.url), 'utf8'));
const NAMES = ['whirlpool', 'flood-water', 'toxic-sludge', 'fire', 'steam-vent', 'hit-spark'];
const clone = (o) => JSON.parse(JSON.stringify(o));

test('all examples validate', () => { for (const n of NAMES) { const r = V.validateEffect(ex(n)); assert.equal(r.ok, true, `${n}: ${JSON.stringify(r.errors)}`); } });
test('validate rejects bad definitions with paths', () => {
  const codes = (d) => V.validateEffect(d).errors.map((e) => `${e.code}@${e.path}`);
  assert.ok(codes(null).includes('BAD_TYPE@$'));
  assert.ok(codes({ id: 'x', kind: 'lava' }).includes('BAD_KIND@$.kind'));
  assert.ok(codes({ id: 'x', kind: 'whirlpool' }).some((c) => c.startsWith('REQUIRED@$.field')));
  const w = ex('whirlpool'); w.field.radius = -1; w.field.pulse = { period: 2, active: 3 }; assert.ok(codes(w).includes('BAD_VALUE@$.field.radius') && codes(w).includes('BAD_VALUE@$.field.pulse'));
  const f = ex('flood-water'); f.water.waves = []; assert.ok(codes(f).includes('BAD_VALUE@$.water.waves'));
  f.water.waves = Array(5).fill({ dir: [1, 0], wavelength: 5, amplitude: 0.1 }); assert.ok(codes(f).includes('BAD_VALUE@$.water.waves'));
  const e = ex('fire'); e.emitters[0].rate = 100000; assert.ok(codes(e).includes('TOO_MANY@$.emitters[0]'));
  e.emitters[0].rate = 10; e.emitters[0].color = [{ t: 0.8, c: '#fff' }, { t: 0.2, c: 'nope' }]; assert.ok(codes(e).includes('BAD_VALUE@$.emitters[0].color[1].t') && codes(e).includes('BAD_VALUE@$.emitters[0].color[1].c'));
  const wv = ex('flood-water'); wv.water.waves[0].amplitude = 2; assert.ok(V.validateEffect(wv).warnings.some((x) => x.code === 'STEEP_WAVE'));
});
test('vortex field equals boss3d.vortexForce for the same data (shared physics)', () => {
  const w = ex('whirlpool'), boss = JSON.parse(readFileSync(new URL('../../../../spec/v4/examples/boss3d/vortex.json', import.meta.url), 'utf8')), h = boss.hazards.find((x) => x.kind === 'vortex');
  for (const k of ['center', 'radius', 'strength', 'falloff', 'swirl', 'ramp', 'coreRadius', 'coreDps', 'resistFactor', 'pulse']) assert.deepEqual(w.field[k], h[k], k);
  for (const resisting of [false, true]) for (const t of [0.5, 2, 3.5, 5, 9, 12.7, 14.5, 30]) for (const p of [[5, 0, 2], [-3, 0, 7], [0.1, 0, 0.1], [16, 0, 1], [20, 0, 0], [0, 1, -9]]) {
    const hs = { startF: 60 }, a = V.fieldForce(w.field, p, t, { resisting }), b = B.vortexForce(h, hs, 60 + Math.round(t * 60), p, resisting);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 2e-3, `t=${t} p=${p} r=${resisting}: ${a} vs ${b}`);
  }
});
test('field: falloff, swirl, flow area, dps, pulse', () => {
  const f = ex('whirlpool').field, at = (d, t = 20) => V.fieldForce({ ...f, pulse: undefined, ramp: 0 }, [d, 0, 0], t);
  const near = at(4), far = at(12); assert.ok(Math.hypot(...near) > Math.hypot(...far) > 0 || Math.hypot(...near) > Math.hypot(...far));
  assert.deepEqual(at(17), [0, 0, 0]); assert.ok(near[0] < 0, 'pulls inward (toward -x from +x)'); assert.ok(near[2] !== 0, 'swirl gives tangential component');
  assert.equal(V.fieldDps(f, [1, 0, 0]), 12); assert.equal(V.fieldDps(f, [5, 0, 0]), 0);
  assert.ok(Math.hypot(...V.fieldForce(f, [5, 0, 0], 6)) < Math.hypot(...V.fieldForce(f, [5, 0, 0], 3.5)), 'idle pulse window is weaker than active');
  const st = ex('steam-vent').field; assert.deepEqual(V.fieldForce(st, [0.5, 2, 0], 1), [0, 6, 0]); assert.deepEqual(V.fieldForce(st, [3, 2, 0], 1), [0, 0, 0]); assert.deepEqual(V.fieldForce(st, [0, 7, 0], 1), [0, 0, 0]);
  assert.ok(V.fieldForce(st, [0, 1, 0], 4)[1] < 1, 'steam idle phase'); assert.equal(V.fieldDps(ex('fire').field, [0.3, 1, 0]), 8); assert.equal(V.fieldDps(ex('fire').field, [3, 1, 0]), 0);
  assert.deepEqual(V.fieldForce({ kind: 'none' }, [0, 0, 0]), [0, 0, 0]); assert.deepEqual(V.fieldForce(undefined, [0, 0, 0]), [0, 0, 0]);
});
test('water: deterministic, bounded by amplitude, inverse displacement is consistent, rise is linear', () => {
  const w = ex('flood-water').water, amp = w.waves.reduce((s, x) => s + x.amplitude, 0);
  for (const t of [0, 1.3, 9]) for (const [x, z] of [[0, 0], [3.5, -2], [-12, 7]]) {
    const h = V.waterHeight(w, x, z, t), lvl = V.waterLevel(w, t); assert.equal(h, V.waterHeight(w, x, z, t)); assert.ok(Math.abs(h - lvl) <= amp + 1e-9);
    const hs = Math.abs(h - lvl), g = (() => { let x0 = x, z0 = z; for (let i = 0; i < 6; i++) { const d = V.gerstner(w, x0, z0, t); x0 = x - d[0]; z0 = z - d[2]; } const d = V.gerstner(w, x0, z0, t); return [x0 + d[0], z0 + d[2], d[1]]; })();
    assert.ok(Math.abs(g[0] - x) < 1e-3 && Math.abs(g[1] - z) < 1e-3, 'horizontal inverse'); assert.ok(Math.abs(g[2] + lvl - h) < 1e-3 || hs >= 0);
  }
  assert.notEqual(V.waterHeight(w, 1, 1, 0), V.waterHeight(w, 1, 1, 0.7)); assert.equal(V.waterLevel(w, 0), 0); assert.equal(V.waterLevel(w, 7), 0.6); assert.equal(V.waterLevel(w, 99), 1.2);
  const n = V.waterNormal(w, 2, 3, 1); assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-2 && n[1] > 0.5);
  assert.equal(V.waterHeight({ level: 2, waves: [] }, 5, 5, 3), 2);
  const mean = (() => { let s = 0, c = 0; for (let x = -30; x < 30; x += 1.7) for (let z = -30; z < 30; z += 1.9) { s += V.waterHeight(w, x, z, 2) - V.waterLevel(w, 2); c++; } return s / c; })(); assert.ok(Math.abs(mean) < 0.05, `mean ${mean}`);
});
test('surfaceHeight: funnel dips under the vortex, shares profile, flat outside', () => {
  const d = ex('whirlpool'); const flat = { ...d, field: { ...d.field, ramp: 0, pulse: undefined } };
  const c = V.surfaceHeight(flat, 0, 0, 3), edge = V.surfaceHeight(flat, 16.9, 0, 3), out = V.surfaceHeight(flat, 25, 0, 3);
  assert.ok(c < edge && c < -2 && Math.abs(edge - V.waterHeight(d.water, 16.9, 0, 3)) < 0.05 && Math.abs(out - V.waterHeight(d.water, 25, 0, 3)) < 1e-4);
  assert.equal(V.funnelDepth(d.visual, d.field, 0), d.visual.depth); assert.equal(V.funnelDepth(d.visual, d.field, 17), 0);
  assert.ok(Math.abs(V.funnelDepth(d.visual, d.field, 6) - 2.6 * (1 - 6 / 17) ** 2) < 1e-12);
});
test('particles: seeded determinism, bounds, burst, lifetime', () => {
  const f = ex('fire').emitters[0], a = V.emitterParticles(f, 5, 3), b = V.emitterParticles(f, 5, 3), c = V.emitterParticles(f, 6, 3);
  assert.deepEqual(a, b); assert.notDeepEqual(a, c); assert.ok(a.length > 30 && a.length <= f.maxParticles);
  for (const p of a) { assert.ok(p.age >= 0 && p.age <= f.lifetime[1] && p.u >= 0 && p.u <= 1); assert.ok(p.size <= 0.5 + 1e-9 && p.size >= 0.05 - 1e-9); assert.equal(p.color.length, 4); }
  assert.ok(V.emitterParticles(f, 5, 0).length <= 1); // nothing before spawns begin
  const em = { rate: 10, lifetime: 1, speed: 0, gravity: [0, 0, 0], maxParticles: 1000 }; assert.equal(V.emitterParticles(em, 1, 5).length, 10); // steady state = rate*life
  const s = ex('hit-spark').emitters[0]; assert.equal(V.emitterParticles(s, 21, 0.1).length, 0); assert.ok(V.emitterParticles(s, 21, 0.3).length === 60);
  const later = V.emitterParticles(s, 21, 1.3); assert.ok(later.length >= 1 && later.every((q) => q.id >= 1e6 + 1000), 'second burst (repeat 0.9s) only'); assert.equal(V.emitterParticles(s, 21, 0.2 + 0.5 - 0.01).length, 60);
  const g = { rate: 1, lifetime: 10, speed: 0, gravity: [0, -10, 0], drag: 0, maxParticles: 5 }, p = V.emitterParticles(g, 1, 2.5).at(-1); assert.ok(Math.abs(p.pos[1] - -0.5 * 10 * 0.25) < 1e-3); // 0.5*g*age^2, age .5
  const dr = V.emitterParticles({ rate: 1, lifetime: 20, speed: [4, 4], spread: 0, drag: 0.5, maxParticles: 3 }, 1, 2.5).at(-1); assert.ok(Math.abs(dr.pos[1] - (4 * (1 - Math.exp(-0.25)) / 0.5)) < 1e-3);
  const cone = { rate: 200, lifetime: 1, speed: 1, spread: 20, shape: { type: 'point' } }; for (const q of V.emitterParticles(cone, 2, 3)) { const l = Math.hypot(...q.vel); assert.ok(Math.abs(l - 1) < 1e-3 && q.vel[1] / l >= Math.cos(0.35) - 1e-3); }
});
test('colorAt interpolates stops; parseColor', () => {
  assert.deepEqual(V.parseColor('#fff'), [1, 1, 1]); assert.equal(V.parseColor('zz'), null); assert.deepEqual(V.parseColor([0.1, 0.2, 0.3]), [0.1, 0.2, 0.3]);
  const s = [{ t: 0, c: '#000000', a: 0 }, { t: 1, c: '#ffffff', a: 1 }]; assert.deepEqual(V.colorAt(s, 0.5), [0.5, 0.5, 0.5, 0.5]); assert.deepEqual(V.colorAt(s, 2), [1, 1, 1, 1]);
});
test('purity: no Math.random/Date in the lib; hash stable', () => {
  const src = readFileSync(new URL('../../src/lib/vfx3d.js', import.meta.url), 'utf8'); assert.ok(!/Math\.random|Date\.now|new Date/.test(src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')));
  assert.equal(V.hashJSON(V.emitterParticles(ex('fire').emitters[0], 5, 3)), V.hashJSON(V.emitterParticles(clone(ex('fire').emitters[0]), 5, 3)));
});
