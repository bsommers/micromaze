// limb3d: deterministic procedural limbs (hydra necks, tentacles). Pure, zero deps, Y-up, metres, fixed step dt=1/60.
// A limb is a chain of N segments solved with FABRIK (or one-pass follow-the-leader) under exact length and joint-angle limits.
// The head/tip seeks a target, idles with seeded sway, runs data-driven telegraphed motions (strike/sweep/slam), exports one
// capsule per segment for hitboxes, can be severed (stump) and regrown, and emits bone poses (position + quaternion).
// State is plain JSON. Spec: spec/v4/limb3d.md. GDScript mirror: templates/godot-action3d/scripts/limb/limb_core.gd.
export const DT = 1 / 60;
export const FPS = 60;
const TAU = Math.PI * 2;
const F = (s) => Math.max(0, Math.round(s * FPS));
const r4 = (v) => Math.round(v * 1e4) / 1e4 + 0; // + 0 turns -0 into 0
const rad = (d) => (d * Math.PI) / 180;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
export const MOTION_KINDS = ['strike', 'sweep', 'slam'];
export const SOLVERS = ['fabrik', 'follow'];

export function rngNext(st) { // mulberry32 over state.rng (uint32)
  st.rng = (st.rng + 0x6d2b79f5) >>> 0; let t = st.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function hashJSON(v) { // FNV-1a 32 over canonical JSON
  const s = JSON.stringify(v); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- vec / quat
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a, fb) => { const l = len(a); return l < 1e-9 ? fb : [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const r43 = (a) => [r4(a[0]), r4(a[1]), r4(a[2])];
export function ease(name, u) {
  u = clamp(u, 0, 1);
  if (name === 'easeIn') return u * u * u;
  if (name === 'easeOut') { const v = 1 - u; return 1 - v * v * v; }
  if (name === 'easeInOut') return u * u * (3 - 2 * u);
  return u;
}
function perp(a) { const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]; return norm(cross(a, t), [0, 0, 1]); }
function rotBetween(a, b) {
  const c = dot(a, b);
  if (c < -0.999999) { const p = perp(a); return [p[0], p[1], p[2], 0]; }
  const x = cross(a, b), q = [x[0], x[1], x[2], 1 + c], l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];

// ---------------------------------------------------------------- config
export function segLengths(cfg) {
  const n = cfg.segments;
  if (Array.isArray(cfg.segmentLengths)) return cfg.segmentLengths.slice(0, n);
  const L = num(cfg.segmentLength, 1), taper = num(cfg.lengthTaper, 1); // lengthTaper: tip length / base length
  return Array.from({ length: n }, (_, i) => L * (n > 1 ? 1 + (taper - 1) * (i / (n - 1)) : 1));
}
export function segRadius(cfg, i) {
  const n = cfg.segments, r = cfg.radius;
  if (typeof r === 'number') return r;
  const b = num(r?.base, 0.3), t = num(r?.tip, b);
  return b + (t - b) * (n > 1 ? i / (n - 1) : 0);
}
const rootPos = (cfg) => cfg.root?.pos || [0, 0, 0];
const rootDir = (cfg) => norm(cfg.root?.dir || [0, 1, 0], [0, 1, 0]);
const totalReach = (cfg, count) => segLengths(cfg).slice(0, count).reduce((a, b) => a + b, 0);

export function validateLimb(cfg) {
  const errors = [], warnings = [], e = (path, code, message) => errors.push({ path, code, message }), w = (path, code, message) => warnings.push({ path, code, message });
  const isV3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { e('', 'BAD_TYPE', 'limb config must be an object'); return { ok: false, errors, warnings }; }
  if (!Number.isInteger(cfg.segments) || cfg.segments < 1 || cfg.segments > 64) e('segments', 'BAD_SEGMENTS', 'segments must be an integer 1..64');
  if (cfg.segmentLengths !== undefined) {
    if (!Array.isArray(cfg.segmentLengths) || cfg.segmentLengths.length !== cfg.segments || !cfg.segmentLengths.every((x) => typeof x === 'number' && x > 0)) e('segmentLengths', 'BAD_LENGTHS', 'segmentLengths must be positive numbers, one per segment');
  } else if (!(num(cfg.segmentLength, 0) > 0)) e('segmentLength', 'BAD_LENGTH', 'segmentLength must be > 0 (or give segmentLengths)');
  if (cfg.lengthTaper !== undefined && !(typeof cfg.lengthTaper === 'number' && cfg.lengthTaper > 0)) e('lengthTaper', 'BAD_TAPER', 'lengthTaper must be > 0');
  if (cfg.radius === undefined) e('radius', 'MISSING', 'radius (number or {base,tip}) is required');
  else if (typeof cfg.radius === 'number') { if (!(cfg.radius > 0)) e('radius', 'BAD_RADIUS', 'radius must be > 0'); }
  else if (!(cfg.radius && cfg.radius.base > 0 && (cfg.radius.tip === undefined || cfg.radius.tip > 0))) e('radius', 'BAD_RADIUS', 'radius {base,tip} must be > 0');
  if (cfg.root) { if (cfg.root.pos !== undefined && !isV3(cfg.root.pos)) e('root.pos', 'BAD_VEC', 'root.pos must be [x,y,z]'); if (cfg.root.dir !== undefined && (!isV3(cfg.root.dir) || len(cfg.root.dir) < 1e-6)) e('root.dir', 'BAD_VEC', 'root.dir must be a non-zero [x,y,z]'); }
  if (cfg.solver !== undefined && !SOLVERS.includes(cfg.solver)) e('solver', 'BAD_SOLVER', `solver must be one of ${SOLVERS.join(', ')}`);
  if (cfg.iterations !== undefined && !(Number.isInteger(cfg.iterations) && cfg.iterations >= 1 && cfg.iterations <= 32)) e('iterations', 'BAD_ITER', 'iterations must be an integer 1..32');
  for (const k of ['maxBend', 'maxBase']) if (cfg[k] !== undefined && !(typeof cfg[k] === 'number' && cfg[k] > 0 && cfg[k] <= 170)) e(k, 'BAD_ANGLE', `${k} must be in (0,170] degrees`);
  if (cfg.seek) { if (!(num(cfg.seek.speed, 1) > 0)) e('seek.speed', 'BAD_SPEED', 'seek.speed must be > 0'); if (cfg.seek.range !== undefined && !(cfg.seek.range > 0)) e('seek.range', 'BAD_RANGE', 'seek.range must be > 0'); }
  if (cfg.sway) { for (const k of ['amp', 'freq']) if (cfg.sway[k] !== undefined && !(typeof cfg.sway[k] === 'number' && cfg.sway[k] >= 0)) e(`sway.${k}`, 'BAD_SWAY', `sway.${k} must be >= 0`); if (num(cfg.sway.amp, 0) > 0.5) w('sway.amp', 'BIG_SWAY', 'sway.amp > 0.5 of limb length is violent'); }
  if (cfg.sever) { const mk = num(cfg.sever.minKeep, 1); if (!(Number.isInteger(mk) && mk >= 1 && mk <= Math.max(1, (cfg.segments || 1) - 1))) e('sever.minKeep', 'BAD_MINKEEP', 'sever.minKeep must be an integer in 1..segments-1'); }
  if (cfg.regrow) for (const k of ['delay', 'interval']) if (cfg.regrow[k] !== undefined && !(typeof cfg.regrow[k] === 'number' && cfg.regrow[k] >= 0)) e(`regrow.${k}`, 'BAD_REGROW', `regrow.${k} must be >= 0`);
  const motions = cfg.motions || {};
  for (const [id, m] of Object.entries(motions)) {
    const p = `motions.${id}`;
    if (!m || typeof m !== 'object') { e(p, 'BAD_TYPE', 'motion must be an object'); continue; }
    if (!MOTION_KINDS.includes(m.kind)) e(`${p}.kind`, 'BAD_KIND', `kind must be one of ${MOTION_KINDS.join(', ')}`);
    for (const k of ['windup', 'strike', 'recover']) if (!(typeof m[k] === 'number' && m[k] > 0)) e(`${p}.${k}`, 'BAD_TIME', `${k} must be a duration > 0 seconds`);
    for (const [k, c] of Object.entries(m.curves || {})) if (!['windup', 'strike', 'recover'].includes(k) || !EASINGS.includes(c)) e(`${p}.curves.${k}`, 'BAD_CURVE', `curves keys windup|strike|recover with easing ${EASINGS.join('|')}`);
    if (m.kind === 'sweep') {
      if (!(Array.isArray(m.arc) && m.arc.length === 2 && m.arc.every((x) => typeof x === 'number') && m.arc[0] !== m.arc[1])) e(`${p}.arc`, 'BAD_ARC', 'sweep needs arc [startDeg, endDeg] (different)');
      if (m.radius !== undefined && !(m.radius > 0)) e(`${p}.radius`, 'BAD_RADIUS', 'radius must be > 0');
    }
    if (typeof m.windup === 'number' && m.windup < 0.25) w(`${p}.windup`, 'SHORT_TELEGRAPH', 'windup < 0.25s is hard to read');
    if (m.damage !== undefined && !(typeof m.damage === 'number' && m.damage >= 0)) e(`${p}.damage`, 'BAD_DAMAGE', 'damage must be >= 0');
  }
  if (cfg.segments >= 1 && num(cfg.maxBend, 35) * (cfg.segments) < 90) w('maxBend', 'STIFF', 'total bend (maxBend*segments) < 90 deg: limb cannot curl');
  return { ok: errors.length === 0, errors, warnings, stats: { segments: cfg.segments, motions: Object.keys(motions).length, reach: errors.length ? 0 : r4(totalReach(cfg, cfg.segments)) } };
}

// ---------------------------------------------------------------- state
export function createLimb(cfg, seed = 1) {
  const st = { f: 0, rng: (seed >>> 0) || 1, count: cfg.segments, joints: [], goal: [0, 0, 0], motion: null, regrow: null, phase: [0, 0, 0] };
  st.phase = [rngNext(st) * TAU, rngNext(st) * TAU, rngNext(st) * TAU];
  const ls = segLengths(cfg), d = rootDir(cfg);
  let p = rootPos(cfg); st.joints.push(p);
  for (let i = 0; i < cfg.segments; i++) { p = add(p, mul(d, ls[i])); st.joints.push(p); }
  st.goal = restGoal(cfg, st);
  return st;
}
function restGoal(cfg, st) { return add(rootPos(cfg), mul(rootDir(cfg), totalReach(cfg, st.count) * num(cfg.restFrac, 0.9))); }
function swayOffset(cfg, st) {
  const s = cfg.sway; if (!s || !(num(s.amp, 0) > 0)) return [0, 0, 0];
  const a = s.amp * totalReach(cfg, st.count), w = TAU * num(s.freq, 0.3) * (st.f / FPS);
  return [a * Math.sin(w + st.phase[0]), 0.5 * a * Math.sin(w * 0.7 + st.phase[1]), a * Math.cos(w * 1.3 + st.phase[2])];
}
function idleGoal(cfg, st, target) {
  const root = rootPos(cfg), R = totalReach(cfg, st.count);
  let g = restGoal(cfg, st);
  if (cfg.seek && target) {
    const v = sub(target, root), dist = len(v);
    if (dist <= num(cfg.seek.range, R * 1.5)) { const d = norm(v, rootDir(cfg)); g = add(root, mul(d, Math.min(dist, R * 0.9))); g[1] += num(cfg.seek.height, 0); }
  }
  return add(g, swayOffset(cfg, st));
}
function clampReach(cfg, st, g) {
  const root = rootPos(cfg), v = sub(g, root), l = len(v), R = totalReach(cfg, st.count) * 0.999;
  return l > R ? add(root, mul(v, R / l)) : g;
}
function clampAngle(d, ref, maxRad) {
  const c = clamp(dot(d, ref), -1, 1);
  if (Math.acos(c) <= maxRad) return d;
  let pv = sub(d, mul(ref, c)); const pl = len(pv);
  pv = pl < 1e-9 ? perp(ref) : mul(pv, 1 / pl);
  return add(mul(ref, Math.cos(maxRad)), mul(pv, Math.sin(maxRad)));
}
// FABRIK with joint-angle limits applied in the forward (root->tip) pass, which also restores exact lengths.
export function solve(cfg, st, goal) {
  const n = st.count, ls = segLengths(cfg), root = rootPos(cfg), rd = rootDir(cfg), p = st.joints.slice(0, n + 1).map((v) => v.slice());
  const iters = cfg.solver === 'follow' ? 1 : num(cfg.iterations, 8), mb = rad(num(cfg.maxBend, 35)), m0 = rad(num(cfg.maxBase, 60));
  for (let it = 0; it < iters; it++) {
    p[n] = goal;
    for (let i = n - 1; i >= 0; i--) { // backward (tip -> root); joint limit applied against the segment already placed above it
      let d = norm(sub(p[i], p[i + 1]), rd);
      if (i < n - 1) d = clampAngle(d, norm(sub(p[i + 1], p[i + 2]), rd), mb);
      p[i] = add(p[i + 1], mul(d, ls[i]));
    }
    p[0] = root; let prev = rd;
    for (let i = 0; i < n; i++) { const d = clampAngle(norm(sub(p[i + 1], p[i]), prev), prev, i === 0 ? m0 : mb); p[i + 1] = add(p[i], mul(d, ls[i])); prev = d; }
  }
  st.joints = p;
}

// ---------------------------------------------------------------- motions
function motionPhase(m, f) { // f = frames since command
  const w = F(m.windup), s = F(m.strike), r = F(m.recover);
  if (f < w) return { name: 'windup', u: w ? f / w : 1 };
  if (f < w + s) return { name: 'strike', u: s ? (f - w) / s : 1 };
  if (f < w + s + r) return { name: 'recover', u: r ? (f - w - s) / r : 1 };
  return { name: 'done', u: 1 };
}
function startMotion(cfg, st, id, target, events) {
  const m = cfg.motions?.[id];
  if (!m) { events.push({ type: 'commandRejected', f: st.f, motion: id, reason: 'unknown' }); return; }
  if (st.motion || st.count < cfg.segments) { events.push({ type: 'commandRejected', f: st.f, motion: id, reason: st.motion ? 'busy' : 'severed' }); return; }
  const root = rootPos(cfg), R = totalReach(cfg, st.count), lock = target || add(root, mul(rootDir(cfg), R * 0.9));
  const v = sub(lock, root), aim = Math.atan2(v[2], v[0]), tip = st.joints[st.count].slice();
  const dist = Math.min(len(v), R * 0.95), hd = Math.hypot(v[0], v[2]);
  const dir = hd < 1e-6 ? [1, 0] : [v[0] / hd, v[2] / hd];
  const ret = num(m.retract, 0.5) * R, lift = num(m.lift, R * 0.5);
  let B, C;
  if (m.kind === 'sweep') {
    const rr = num(m.radius, dist), h = num(m.height, root[1] + 0.5), a0 = aim + rad(m.arc[0]);
    B = [root[0] + rr * Math.cos(a0), h, root[2] + rr * Math.sin(a0)]; C = [lock[0], h, lock[2]];
  } else if (m.kind === 'slam') {
    B = [lock[0], lock[1] + num(m.height, R * 0.8), lock[2]]; C = [lock[0], lock[1], lock[2]];
  } else {
    B = [root[0] - dir[0] * ret, root[1] + lift, root[2] - dir[1] * ret]; C = lock.slice();
  }
  st.motion = { id, f: 0, phase: 'windup', from: tip, B, C, aim, root, lock };
  events.push({ type: 'telegraph', f: st.f, motion: id, kind: m.kind, windup: m.windup, aim: r4(aim), at: r43(lock), warning: m.warning ?? null });
}
function motionGoal(cfg, st, events, idle) {
  const mo = st.motion, m = cfg.motions[mo.id], ph = motionPhase(m, mo.f), cv = m.curves || {};
  if (ph.name !== mo.phase && ph.name !== 'done') { mo.phase = ph.name; events.push({ type: ph.name, f: st.f, motion: mo.id }); }
  if (ph.name === 'done') { events.push({ type: 'done', f: st.f, motion: mo.id }); st.motion = null; return { goal: idle, damaging: false }; }
  let g;
  if (ph.name === 'windup') g = lerp3(mo.from, mo.B, ease(cv.windup || 'easeInOut', ph.u));
  else if (ph.name === 'strike') {
    const e = ease(cv.strike || 'easeIn', ph.u);
    if (m.kind === 'sweep') { const a = mo.aim + rad(m.arc[0] + (m.arc[1] - m.arc[0]) * e), rr = Math.hypot(mo.B[0] - mo.root[0], mo.B[2] - mo.root[2]); g = [mo.root[0] + rr * Math.cos(a), mo.B[1], mo.root[2] + rr * Math.sin(a)]; }
    else g = lerp3(mo.B, mo.C, e);
  } else {
    let from = mo.C;
    if (m.kind === 'sweep') { const a = mo.aim + rad(m.arc[1]), rr = Math.hypot(mo.B[0] - mo.root[0], mo.B[2] - mo.root[2]); from = [mo.root[0] + rr * Math.cos(a), mo.B[1], mo.root[2] + rr * Math.sin(a)]; }
    g = lerp3(from, idle, ease(cv.recover || 'easeInOut', ph.u));
  }
  mo.f++;
  return { goal: g, damaging: ph.name === 'strike', damage: num(m.damage, 0), hitSegments: num(m.hitSegments, 2), motion: mo.id };
}

// ---------------------------------------------------------------- sever / regrow
export function severLimb(cfg, st, keep) { // keep = number of segments that remain (the stump)
  const mk = num(cfg.sever?.minKeep, 1);
  if (cfg.sever?.allowed === false) return null;
  keep = Math.max(mk, Math.floor(keep));
  if (keep >= st.count) return null;
  const lost = capsuleList(cfg, st, 0).filter((c) => c.seg >= keep).map((c) => ({ ...c, damaging: false }));
  st.count = keep; st.joints = st.joints.slice(0, keep + 1);
  if (cfg.regrow) st.regrow = { delay: F(num(cfg.regrow.delay, 5)), acc: 0 };
  const cancelled = !!st.motion; st.motion = null;
  return { type: 'sever', f: st.f, keep, lost: lost.length, lostCapsules: lost, cancelledMotion: cancelled };
}
function regrowStep(cfg, st, events) {
  const rg = st.regrow; if (!rg || st.count >= cfg.segments) return;
  if (rg.delay > 0) { rg.delay--; return; }
  rg.acc++;
  if (rg.acc >= F(num(cfg.regrow.interval, 1))) {
    rg.acc = 0; const i = st.count, ls = segLengths(cfg), p = st.joints, d = norm(sub(p[i], p[i - 1]), rootDir(cfg));
    p.push(add(p[i], mul(d, ls[i]))); st.count++;
    events.push({ type: 'regrow', f: st.f, segments: st.count });
    if (st.count >= cfg.segments) { st.regrow = null; events.push({ type: 'regrown', f: st.f }); }
  }
}
export function segmentAt(cfg, st, point, pad = 0) { // nearest live segment whose capsule contains point (else -1)
  let best = -1, bd = Infinity;
  for (let i = 0; i < st.count; i++) { const d = distSegPoint(st.joints[i], st.joints[i + 1], point); if (d <= segRadius(cfg, i) + pad && d < bd) { bd = d; best = i; } }
  return best;
}
function distSegPoint(a, b, p) { const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12), 0, 1); return len(sub(p, add(a, mul(ab, t)))); }

// ---------------------------------------------------------------- outputs
export function capsuleList(cfg, st, hitSegments = 0, damage = 0, motion = null) {
  const out = [], n = st.count;
  for (let i = 0; i < n; i++) out.push({ id: `${cfg.id || 'limb'}:${i}`, seg: i, a: r43(st.joints[i]), b: r43(st.joints[i + 1]), r: r4(segRadius(cfg, i)),
    tip: i === n - 1, stump: n < cfg.segments && i === n - 1 ? true : false, damaging: hitSegments > 0 && i >= n - hitSegments, damage: hitSegments > 0 && i >= n - hitSegments ? damage : 0, motion });
  return out;
}
export function poseOf(cfg, st) {
  const n = st.count, ls = segLengths(cfg), bones = []; let q = null, prev = [0, 1, 0];
  for (let i = 0; i < n; i++) {
    const d = norm(sub(st.joints[i + 1], st.joints[i]), prev), r = rotBetween(prev, d);
    q = q ? qmul(r, q) : r; prev = d;
    bones.push({ i, pos: r43(st.joints[i]), q: [r4(q[0]), r4(q[1]), r4(q[2]), r4(q[3])], len: r4(ls[i]) });
  }
  return { bones, tip: r43(st.joints[n]), count: n };
}

// ---------------------------------------------------------------- step
// input: { target?: [x,y,z], command?: {motion, target?}, sever?: {keep} }
export function step(st, cfg, input = {}) {
  const events = [];
  if (input.sever) { const ev = severLimb(cfg, st, input.sever.keep); if (ev) events.push(ev); }
  if (input.command) startMotion(cfg, st, input.command.motion, input.command.target || input.target || null, events);
  const idle = idleGoal(cfg, st, input.target || null);
  let goal, hit = { damaging: false };
  if (st.motion) { hit = motionGoal(cfg, st, events, idle); goal = hit.goal; st.goal = goal; }
  else {
    const sp = num(cfg.seek?.speed, 4) * DT, v = sub(idle, st.goal), l = len(v);
    st.goal = l <= sp ? idle : add(st.goal, mul(v, sp / l)); goal = st.goal;
  }
  solve(cfg, st, clampReach(cfg, st, goal));
  regrowStep(cfg, st, events);
  const capsules = hit.damaging ? capsuleList(cfg, st, hit.hitSegments, hit.damage, hit.motion) : capsuleList(cfg, st);
  st.f++;
  return { events, capsules, pose: poseOf(cfg, st), tip: r43(st.joints[st.count]) };
}

// ---------------------------------------------------------------- scripted simulation
const at = (keys, f) => { // piecewise-linear keyframes [{f,pos}]
  if (!keys?.length) return null;
  if (f <= keys[0].f) return keys[0].pos;
  for (let i = 1; i < keys.length; i++) if (f <= keys[i].f) { const a = keys[i - 1], b = keys[i], t = (f - a.f) / Math.max(1, b.f - a.f); return lerp3(a.pos, b.pos, t); }
  return keys[keys.length - 1].pos;
};
// script: {steps, seed?, targets:[{f,pos}], commands:[{f,motion,target?}], severs:[{f,keep}], sample?:int}
export function simulate(cfg, script = {}) {
  const st = createLimb(cfg, script.seed ?? 1), steps = script.steps ?? 600, sample = script.sample ?? 30, ls = segLengths(cfg), root = rootPos(cfg), rd = rootDir(cfg);
  const cmds = new Map((script.commands || []).map((c) => [c.f, c])), sev = new Map((script.severs || []).map((c) => [c.f, c]));
  const traj = [], events = []; let maxErr = 0, maxBend = 0, maxBase = 0, capMin = Infinity, capMax = 0, capSum = 0, dmgFrames = 0, maxTipSpeed = 0, prevTip = null, finalPose = null;
  for (let f = 0; f < steps; f++) {
    const c = cmds.get(f), s = sev.get(f), out = step(st, cfg, { target: at(script.targets, f), command: c ? { motion: c.motion, target: c.target } : undefined, sever: s ? { keep: s.keep } : undefined });
    for (const e of out.events) { const { lostCapsules, ...rest } = e; events.push(rest); }
    for (let i = 0; i < st.count; i++) {
      maxErr = Math.max(maxErr, Math.abs(len(sub(st.joints[i + 1], st.joints[i])) - ls[i]));
      const d = norm(sub(st.joints[i + 1], st.joints[i]), rd), ref = i === 0 ? rd : norm(sub(st.joints[i], st.joints[i - 1]), rd);
      { const a = Math.acos(clamp(dot(d, ref), -1, 1)) * 180 / Math.PI; if (i === 0) maxBase = Math.max(maxBase, a); else maxBend = Math.max(maxBend, a); }
    }
    maxErr = Math.max(maxErr, len(sub(st.joints[0], root)));
    capMin = Math.min(capMin, out.capsules.length); capMax = Math.max(capMax, out.capsules.length); capSum += out.capsules.length;
    if (out.capsules.some((x) => x.damaging)) dmgFrames++;
    if (prevTip) maxTipSpeed = Math.max(maxTipSpeed, len(sub(out.tip, prevTip)) / DT); prevTip = out.tip;
    if (f % sample === 0) traj.push({ f, tip: out.tip, count: st.count });
    finalPose = out.pose;
  }
  const res = { steps, trajectory: traj, finalTip: finalPose.tip, finalCount: st.count, segmentLengthError: r4(maxErr), maxBendDeg: r4(maxBend), maxBaseDeg: r4(maxBase),
    capsules: { min: capMin, max: capMax, mean: r4(capSum / steps), damagingFrames: dmgFrames }, maxTipSpeed: r4(maxTipSpeed),
    eventCounts: events.reduce((o, e) => { o[e.type] = (o[e.type] || 0) + 1; return o; }, {}), events: events.slice(0, 200), finalPose };
  res.hash = hashJSON({ traj, events, finalPose });
  return res;
}
