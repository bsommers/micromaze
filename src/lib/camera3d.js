// camera3d.js - third-person camera rig. Pure, deterministic, zero deps. Y-up, metres, radians (fov in degrees).
// Fixed step dt is passed in; all state is plain JSON (arrays/numbers); no Date, no Math.random (shake noise is a seeded hash of state.time).
// Spec: spec/v4/camera3d.md. Config schema: spec/v4/schemas/camera3d.schema.json.
// Convention: yaw=0 puts the camera at +Z of the pivot looking toward -Z; camera offset dir = (sin yaw cos pitch, sin pitch, cos yaw cos pitch); right = (cos yaw, 0, -sin yaw).
import { sweepSphere } from './collision3d.js';

export const DEFAULT_CONFIG = {
  version: 1,
  follow: { distance: 4.5, minDistance: 0.6, height: 1.6, shoulder: 0, pitch: 0.25, minPitch: -0.45, maxPitch: 1.2, positionLag: 0.08, rotationLag: 0.05, probeRadius: 0.25, collisionRecoverLag: 0.25 },
  lockOn: { maxRange: 18, maxAngle: 1.2, rotationLag: 0.12, blendLag: 0.15, framing: 0.5, framingDistancePerMetre: 0.15, maxExtraDistance: 3, pitch: 0.3, angleWeight: 1, distanceWeight: 0.05 },
  aim: { distance: 2.2, shoulder: 0.6, offset: [0.2, 0.0], fov: 55, blendLag: 0.08 },
  fov: { base: 70, kickDecay: 0.18, max: 110 },
  shake: { maxYaw: 0.05, maxPitch: 0.05, maxRoll: 0.04, maxOffset: 0.15, frequency: 18, decay: 1.2, power: 2, seed: 1 },
};

const merge = (d, o) => {
  if (Array.isArray(d)) return Array.isArray(o) ? [...o] : [...d];
  if (d && typeof d === 'object') { const r = {}; for (const k of Object.keys(d)) r[k] = merge(d[k], o && o[k] !== undefined ? o[k] : undefined); if (o) for (const k of Object.keys(o)) if (!(k in d)) r[k] = o[k]; return r; }
  return o !== undefined ? o : d;
};
// Fill defaults under any partial config (deep, plain JSON out).
export const createConfig = (overrides = {}) => merge(DEFAULT_CONFIG, overrides);

// Semantic checks beyond the schema; returns string[] (empty = ok).
export function checkConfig(cfg) {
  const e = [], f = cfg.follow, l = cfg.lockOn, a = cfg.aim, v = cfg.fov, s = cfg.shake;
  if (f.minPitch >= f.maxPitch) e.push('follow.minPitch must be < follow.maxPitch');
  if (f.pitch < f.minPitch || f.pitch > f.maxPitch) e.push('follow.pitch must lie within [minPitch, maxPitch]');
  if (f.minDistance > f.distance) e.push('follow.minDistance must be <= follow.distance');
  if (a.distance < f.minDistance) e.push('aim.distance must be >= follow.minDistance');
  if (f.probeRadius * 2 > f.distance) e.push('follow.probeRadius too large for follow.distance');
  if (v.base > v.max || a.fov > v.max) e.push('fov.max must be >= fov.base and aim.fov');
  if (l.framing < 0 || l.framing > 1) e.push('lockOn.framing must be in [0,1]');
  if (s.power < 1) e.push('shake.power must be >= 1');
  return e;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
// Frame-rate-aware exponential smoothing factor for a time constant (lag seconds; 0 = instant).
const kOf = (lag, dt) => (lag > 0 ? 1 - Math.exp(-dt / lag) : 1);

// ---- seeded smooth noise (value noise on an integer hash) ----
function hash(seed, ch, i) {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(ch + 1, 0x85ebca6b) ^ Math.imul(i | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}
export function noise1(seed, ch, x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(seed, ch, i), hash(seed, ch, i + 1), u);
}

// ---- helpers ----
// Axis-aligned box -> 12 triangles (flat array, 108 numbers), so tests/examples can build worlds without a mesh.
export function boxToTris(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]], out = [];
  for (const [a, b, cc, d] of q) out.push(...c[a], ...c[b], ...c[cc], ...c[a], ...c[cc], ...c[d]);
  return out;
}

export function createCamera(config, init = {}) {
  const cfg = config || createConfig(), target = init.target || [0, 0, 0];
  const st = {
    version: 1, yaw: init.yaw ?? 0, pitch: init.pitch ?? cfg.follow.pitch,
    pivot: [target[0], target[1] + cfg.follow.height, target[2]],
    boomScale: 1, collided: false, lockBlend: 0, aimBlend: 0, fovKick: 0, trauma: 0, time: 0, seed: cfg.shake.seed,
    out: null,
  };
  st.out = { pos: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0], fov: cfg.fov.base, roll: 0, distance: cfg.follow.distance };
  stepCamera(st, cfg, { target }, null, 0);
  return st;
}

export const addTrauma = (st, amount) => { st.trauma = clamp(st.trauma + amount, 0, 1); return st; };
export const kickFov = (st, deg) => { st.fovKick += deg; return st; };

// Pick the best lock-on candidate. candidates: [{id, pos:[x,y,z]}]. facing = unit-ish horizontal direction the camera/player faces.
// score = angleWeight*|angle| + distanceWeight*dist (lower wins); out of range/angle or without line of sight is rejected. world optional.
export function pickLockTarget(origin, facing, candidates, cfg, world = null, exclude = null) {
  const L = cfg.lockOn, fa = Math.atan2(facing[0], facing[2]); let best = null;
  for (const c of candidates) {
    if (c.id === exclude) continue;
    const d = sub(c.pos, origin), dist = len(d); if (dist > L.maxRange || dist < 1e-6) continue;
    const ang = Math.abs(wrap(Math.atan2(d[0], d[2]) - fa)); if (ang > L.maxAngle) continue;
    if (world && sweepSphere(origin, 0.05, mul(d, 1 - 0.05 / dist), world)) continue;
    const score = L.angleWeight * ang + L.distanceWeight * dist;
    if (!best || score < best.score || (score === best.score && String(c.id) < String(best.id))) best = { id: c.id, pos: c.pos, score, distance: dist, angle: ang };
  }
  return best;
}
// Flick to the next target on the left (-1) or right (+1) of the current one, as seen from `origin`. Returns candidate or null.
export function switchLockTarget(origin, current, candidates, side, cfg, world = null) {
  const cur = Math.atan2(current.pos[0] - origin[0], current.pos[2] - origin[2]); let best = null;
  for (const c of candidates) {
    if (c.id === current.id) continue;
    const d = sub(c.pos, origin), dist = len(d); if (dist > cfg.lockOn.maxRange || dist < 1e-6) continue;
    const delta = wrap(Math.atan2(d[0], d[2]) - cur) * -side; // camera right = decreasing atan2(x,z) for yaw 0 view toward -Z; side>0 picks rightwards
    if (delta <= 1e-6) continue;
    if (world && sweepSphere(origin, 0.05, mul(d, 1 - 0.05 / dist), world)) continue;
    if (!best || delta < best.delta) best = { id: c.id, pos: c.pos, delta };
  }
  return best;
}

// Advance one fixed step. input: {target:[x,y,z] (player feet), yawDelta, pitchDelta (radians this step), lock:[x,y,z]|null (lock-on point), aim:boolean}
// world: flat triangle array | {tris,count,candidates} (bvh.asWorld) | null. Mutates and returns st; read st.out = {pos,target,up,fov,roll,distance}.
export function stepCamera(st, cfg, input, world, dt) {
  const F = cfg.follow, L = cfg.lockOn, A = cfg.aim, V = cfg.fov, S = cfg.shake;
  const tgt = input.target, lock = input.lock || null;
  // 1. smoothed pivot
  const base = [tgt[0], tgt[1] + F.height, tgt[2]];
  st.pivot = dt > 0 ? lerp3(st.pivot, base, kOf(F.positionLag, dt)) : base;
  // 2. lock-on blend and orientation
  st.lockBlend = lerp(st.lockBlend, lock ? 1 : 0, kOf(L.blendLag, dt || 1e9));
  if (lock) {
    const toP = sub(tgt, lock), wantYaw = Math.atan2(toP[0], toP[2]);
    st.yaw += wrap(wantYaw - st.yaw) * kOf(L.rotationLag, dt || 1e9);
    st.pitch += (L.pitch - st.pitch) * kOf(L.rotationLag, dt || 1e9);
  } else {
    st.yaw = wrap(st.yaw + (input.yawDelta || 0));
    st.pitch += input.pitchDelta || 0;
  }
  st.pitch = clamp(st.pitch, F.minPitch, F.maxPitch);
  // 3. aim blend
  st.aimBlend = lerp(st.aimBlend, input.aim ? 1 : 0, kOf(A.blendLag, dt || 1e9));
  const ab = st.aimBlend, lb = st.lockBlend;
  let dist = lerp(F.distance, A.distance, ab);
  if (lock) dist += clamp(len(sub(lock, tgt)) * L.framingDistancePerMetre, 0, L.maxExtraDistance) * lb;
  const shoulder = lerp(F.shoulder, A.shoulder, ab) + A.offset[0] * ab, yOff = A.offset[1] * ab;
  // 4. boom
  const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
  const dir = [sy * cp, sp, cy * cp], right = [cy, 0, -sy];
  const P = [st.pivot[0] + right[0] * shoulder, st.pivot[1] + yOff, st.pivot[2] + right[2] * shoulder];
  let want = 1, hitFlag = false;
  if (world) {
    const hit = sweepSphere(P, F.probeRadius, mul(dir, dist), world);
    if (hit) { want = clamp(hit.t, 0, 1); hitFlag = true; }
  }
  want = Math.max(want, Math.min(1, F.minDistance / dist));
  st.boomScale = Math.min(want, st.boomScale + (want - st.boomScale) * kOf(F.collisionRecoverLag, dt || 1e9)); // shrink instantly, recover smoothly: never clips
  if (st.boomScale > want) st.boomScale = want;
  st.collided = hitFlag && st.boomScale < 1 - 1e-6;
  const L2 = dist * st.boomScale, pos = add(P, mul(dir, L2));
  let look = P;
  if (lock) look = lerp3(P, lock, L.framing * lb);
  // 5. fov
  st.fovKick *= dt > 0 ? Math.exp(-dt / Math.max(V.kickDecay, 1e-6)) : 1;
  const fov = clamp(lerp(V.base, A.fov, ab) + st.fovKick, 1, V.max);
  // 6. shake (applied to the output only, never fed back into the rig)
  st.time += dt; st.trauma = Math.max(0, st.trauma - S.decay * dt);
  const sh = Math.pow(st.trauma, S.power), x = st.time * S.frequency, n = (c) => noise1(st.seed, c, x);
  let f = sub(look, pos); const fl = len(f) || 1; f = mul(f, 1 / fl);
  let o = { pos, target: look, up: [0, 1, 0], roll: 0 };
  if (sh > 0) {
    const yaw = Math.atan2(f[0], f[2]) + sh * S.maxYaw * n(0), pitch = clamp(Math.asin(clamp(f[1], -1, 1)) + sh * S.maxPitch * n(1), -1.5, 1.5);
    const f2 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const r2 = [Math.cos(yaw), 0, -Math.sin(yaw)], u2 = [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)];
    const roll = sh * S.maxRoll * n(2), off = [sh * S.maxOffset * n(3), sh * S.maxOffset * n(4), 0];
    const p2 = add(add(pos, mul(r2, off[0])), mul(u2, off[1]));
    o = { pos: p2, target: add(p2, mul(f2, fl)), up: add(mul(u2, Math.cos(roll)), mul(r2, Math.sin(roll))), roll };
  }
  st.out = { pos: o.pos, target: o.target, up: o.up, fov, roll: o.roll, distance: L2 };
  return st;
}

// Convenience: run a scripted path. frames: array of per-step inputs ({target,...}); returns per-frame outputs + summary.
export function simulate(cfg, frames, world, dt = 1 / 60, init = {}) {
  const st = createCamera(cfg, { target: frames[0].target, ...init }), out = [];
  let collisions = 0, first = -1, minDist = Infinity, maxDist = 0;
  frames.forEach((inp, i) => {
    if (inp.trauma) addTrauma(st, inp.trauma);
    if (inp.fovKick) kickFov(st, inp.fovKick);
    stepCamera(st, cfg, inp, world, dt);
    if (st.collided) { collisions++; if (first < 0) first = i; }
    minDist = Math.min(minDist, st.out.distance); maxDist = Math.max(maxDist, st.out.distance);
    out.push({ pos: [...st.out.pos], target: [...st.out.target], fov: st.out.fov, distance: st.out.distance, collided: st.collided });
  });
  return { frames: out, summary: { frames: frames.length, collisionFrames: collisions, firstCollisionFrame: first, minDistance: minDist, maxDistance: maxDist, final: out[out.length - 1] }, state: st };
}
