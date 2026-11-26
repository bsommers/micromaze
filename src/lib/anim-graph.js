// anim-graph.js - data-driven animation state machine on top of AnimPlayer / gltf-anim.js.
// Pure, deterministic, zero deps. Y-up, metres, fixed step (default 1/60) passed in. All runtime state is plain JSON (snapshot()).
// Two layers of API:
//   AnimGraph        engine-agnostic runtime: parameters, states, blend spaces, transitions, layers, root motion deltas, events.
//                    Needs only clip durations (+ optional root sampler), so a Godot AnimationTree port can mirror it from the JSON graph.
//   AnimGraphPlayer  glue to a parsed glTF model: builds clip info, evaluates layered/masked/additive poses, locks root motion in place.
// Spec: spec/v4/anim-graph.md  Schema: spec/v4/schemas/anim-graph.schema.json
import { AnimPlayer, poseAt, blendPoses, worldMatrices, sampleChannel as poseSample } from './gltf-anim.js';

export const FIXED_DT = 1 / 60;
const EPS = 1e-9;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// ---- quaternion helpers ([x,y,z,w]) ----
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [r[0], r[1], r[2]]; };
const qyaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const qnormalize = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map((v) => v / l); };
function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const bb = d < 0 ? b.map((v) => -v) : b; d = Math.abs(d);
  if (d > 0.9995) return qnormalize(a.map((v, i) => v + t * (bb[i] - v)));
  const th = Math.acos(clamp(d, -1, 1)), s = Math.sin(th), w0 = Math.sin((1 - t) * th) / s, w1 = Math.sin(t * th) / s;
  return a.map((v, i) => w0 * v + w1 * bb[i]);
}
/** Heading change (radians about +Y) of a rotation: angle of its +Z axis projected on XZ. */
export const yawOf = (q) => { const f = qrot(q, [0, 0, 1]); return Math.atan2(f[0], f[2]); };

// ---- graph helpers ----
const layerList = (g) => g.layers || [];
const stateKind = (s) => (s.blend ? 'blend' : s.clip !== undefined ? 'clip' : 'empty');
/** Weights of a blend-space state at the param value: [{clip, w}] (1 or 2 entries, ascending by `at`). */
export function blendWeights(state, params) {
  const pts = [...state.blend.points].sort((a, b) => a.at - b.at), x = Number(params[state.blend.param] ?? 0);
  if (x <= pts[0].at || pts.length === 1) return [{ clip: pts[0].clip, w: 1 }];
  const last = pts[pts.length - 1]; if (x >= last.at) return [{ clip: last.clip, w: 1 }];
  let i = 0; while (pts[i + 1].at < x) i++;
  const a = pts[i], b = pts[i + 1], u = (x - a.at) / (b.at - a.at || 1);
  return u <= 0 ? [{ clip: a.clip, w: 1 }] : u >= 1 ? [{ clip: b.clip, w: 1 }] : [{ clip: a.clip, w: 1 - u }, { clip: b.clip, w: u }];
}
const normEv = (e, dur) => ({ name: e.name, at: e.at !== undefined ? e.at : dur > 0 ? e.time / dur : 0, data: e.data });

/**
 * Check a graph. Returns {errors: string[], warnings: string[]}. `ctx.clips` (clip names) and `ctx.bones` (node names) enable existence checks.
 * Structural shape is checked by the JSON schema; this covers references and semantics.
 */
export function validateGraph(graph, ctx = {}) {
  const errors = [], warnings = [], err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const params = graph.parameters || {}, clipSet = ctx.clips ? new Set(ctx.clips) : null, bones = ctx.bones ? new Set(ctx.bones.map(norm)) : null;
  const usedClips = new Set();
  const useClip = (c, where) => { usedClips.add(c); if (clipSet && !clipSet.has(c)) err(`${where}: clip "${c}" not found in model (have: ${[...clipSet].join(', ') || 'none'})`); };
  if (!layerList(graph).length) err('graph needs at least one layer');
  const lnames = new Set();
  layerList(graph).forEach((L, li) => {
    const lw = `layers[${li}] "${L.name}"`;
    if (lnames.has(L.name)) err(`${lw}: duplicate layer name`); lnames.add(L.name);
    const states = L.states || {};
    if (!states[L.entry]) err(`${lw}: entry "${L.entry}" is not a state`);
    if (li === 0 && L.blend === 'additive') warn(`${lw}: the base layer is additive; there is nothing underneath to add to`);
    if (L.weightParam && !params[L.weightParam]) err(`${lw}: weightParam "${L.weightParam}" is not a parameter`);
    if (L.mask) for (const b of [...(L.mask.bones || []), ...(L.mask.exclude || [])]) if (bones && !bones.has(norm(b))) err(`${lw}: mask bone "${b}" not found in the skeleton`);
    if (L.mask && !(L.mask.bones || []).length) err(`${lw}: mask.bones is empty (an empty mask affects nothing)`);
    const reach = new Set([L.entry]);
    for (const [sn, s] of Object.entries(states)) {
      const sw = `${lw}.${sn}`, kinds = [s.clip !== undefined, !!s.blend, !!s.empty].filter(Boolean).length;
      if (kinds !== 1) err(`${sw}: exactly one of clip / blend / empty is required`);
      if (s.clip !== undefined) useClip(s.clip, sw);
      if (s.blend) {
        const p = params[s.blend.param];
        if (!p) err(`${sw}: blend.param "${s.blend.param}" is not a parameter`); else if (p.type !== 'float') err(`${sw}: blend.param "${s.blend.param}" must be a float parameter`);
        const ats = s.blend.points.map((x) => x.at); if (new Set(ats).size !== ats.length) err(`${sw}: duplicate blend point positions`);
        s.blend.points.forEach((x, k) => useClip(x.clip, `${sw}.blend.points[${k}]`));
        if ((s.events || []).some((e) => e.time !== undefined)) warn(`${sw}: blend-space events should use normalised "at" (clip lengths differ)`);
      }
      if (s.speedParam && !params[s.speedParam]) err(`${sw}: speedParam "${s.speedParam}" is not a parameter`);
      for (const e of s.events || []) { if ((e.at === undefined) === (e.time === undefined)) err(`${sw}: event "${e.name}" needs exactly one of at / time`); if (e.at !== undefined && (e.at < 0 || e.at > 1)) err(`${sw}: event "${e.name}" at must be within 0..1`); }
    }
    for (const [ci, c] of Object.entries(graph.clips || {})) if (clipSet && !clipSet.has(ci)) warn(`clips.${ci}: not found in model`);
    (L.transitions || []).forEach((t, ti) => {
      const tw = `${lw}.transitions[${ti}]`;
      if (t.from !== '*' && !states[t.from]) err(`${tw}: from "${t.from}" is not a state`);
      if (!states[t.to]) err(`${tw}: to "${t.to}" is not a state`);
      if (t.from === '*' || t.from === L.entry || reach.has(t.from)) reach.add(t.to);
      for (const c of t.conditions || []) {
        const p = params[c.param]; if (!p) { err(`${tw}: condition param "${c.param}" is not a parameter`); continue; }
        if (p.type === 'float' && (c.op === undefined || typeof c.value !== 'number')) err(`${tw}: float condition on "${c.param}" needs op and a numeric value`);
        if ((p.type === 'bool' || p.type === 'trigger') && c.op !== undefined && !['==', '!='].includes(c.op)) err(`${tw}: ${p.type} condition on "${c.param}" only supports == and !=`);
      }
      if (!(t.conditions || []).length && t.exitTime === undefined) warn(`${tw}: no conditions and no exitTime; fires immediately`);
      if (t.exitTime !== undefined && states[t.from]?.loop !== false && states[t.from]?.clip !== undefined && t.exitTime >= 1) warn(`${tw}: exitTime >= 1 on a looping state never fires`);
    });
    // second pass for reachability (order independent)
    let grew = true; while (grew) { grew = false; for (const t of L.transitions || []) if ((t.from === '*' || reach.has(t.from)) && states[t.to] && !reach.has(t.to)) { reach.add(t.to); grew = true; } }
    for (const sn of Object.keys(states)) if (!reach.has(sn)) warn(`${lw}: state "${sn}" is unreachable`);
  });
  const rm = graph.rootMotion; if (rm?.bone && bones && !bones.has(norm(rm.bone))) err(`rootMotion.bone "${rm.bone}" not found in the skeleton`);
  return { errors, warnings, clips: [...usedClips].sort() };
}

/** Plain-JSON default parameter values of a graph. */
export const defaultParams = (graph) => { const p = {}; for (const [k, d] of Object.entries(graph.parameters || {})) p[k] = d.default !== undefined ? d.default : d.type === 'bool' || d.type === 'trigger' ? false : 0; return p; };

/**
 * Engine-agnostic runtime. `clips` = {name: {duration, root?: (t) => {p:[x,y,z], q:[x,y,z,w]}}} (root = model-space root-bone sample, used for root motion).
 * step(dt) -> {events:[{name,layer,state,t,data?}], transitions:[{layer,from,to}], rootMotion:{x,y,z,yaw}, time}.
 * Order inside a step: transitions are evaluated first (one per layer, in declared order, using parameters as set before the step),
 * then time advances (events fire for the current state over (prev, cur] phase, loops wrap), then root motion is measured over the same interval.
 * A crossfade advances the outgoing state too, but only the incoming/current state emits events; transitions are blocked while fading unless `interrupt: true`.
 */
export class AnimGraph {
  constructor(graph, clips, opts = {}) {
    this.graph = graph; this.clips = clips; this.dt = opts.dt || FIXED_DT; this.params = defaultParams(graph); this.time = 0; this.frame = 0;
    this.layers = layerList(graph).map((def) => ({ def, cur: this._enter(def.entry), prev: null, fade: 0, fadeLen: 0 }));
    for (const [k, d] of Object.entries(opts.params || {})) this.params[k] = d;
  }
  _enter(state, p = 0) { return { state, p, fresh: true }; }
  setParam(name, v) { const d = this.graph.parameters?.[name]; if (!d) throw new Error(`unknown parameter "${name}"`); this.params[name] = d.type === 'bool' || d.type === 'trigger' ? !!v : Number(v); return this; }
  setTrigger(name) { return this.setParam(name, true); }
  resetTrigger(name) { this.params[name] = false; return this; }
  state(layer = 0) { return this.layers[layer].cur.state; }
  _def(L, name) { return L.def.states[name]; }
  _dur(s, params) {
    if (s.empty) return 0; if (s.clip !== undefined) return this.clips[s.clip]?.duration ?? 0;
    return blendWeights(s, params).reduce((a, x) => a + x.w * (this.clips[x.clip]?.duration ?? 0), 0);
  }
  _speed(s) { return (s.speed ?? 1) * (s.speedParam ? Number(this.params[s.speedParam] ?? 0) : 1); }
  /** Normalised phase 0..1 of a layer's current state (loops wrap, one-shots clamp at 1). */
  phase(layer = 0) { const L = this.layers[layer], s = this._def(L, L.cur.state); return s.loop === false ? Math.min(L.cur.p, 1) : L.cur.p - Math.floor(L.cur.p); }
  /** Current crossfade blend weight of the layer's current state (1 when not fading). */
  weightOf(layer = 0) { const L = this.layers[layer]; return L.prev && L.fadeLen > 0 ? clamp(L.fade / L.fadeLen, 0, 1) : 1; }
  layerWeight(layer = 0) { const d = this.layers[layer].def; return d.weightParam ? Number(this.params[d.weightParam] ?? 0) : d.weight ?? 1; }

  _cond(c) {
    const d = this.graph.parameters[c.param], v = this.params[c.param], op = c.op || '==';
    if (d.type === 'bool' || d.type === 'trigger') { const want = c.value === undefined ? true : !!c.value; return op === '!=' ? !!v !== want : !!v === want; }
    const x = c.value;
    switch (op) { case '==': return v === x; case '!=': return v !== x; case '<': return v < x; case '<=': return v <= x; case '>': return v > x; case '>=': return v >= x; default: return false; }
  }
  _transition(L, out, li) {
    const from = L.cur.state, fading = !!L.prev;
    for (const t of L.def.transitions || []) {
      if (t.from !== '*' && t.from !== from) continue;
      if (t.to === from && !t.self) continue;
      if (fading && !t.interrupt) continue;
      if (t.exitTime !== undefined) { if (this.phase(li) < t.exitTime - EPS) continue; }
      if (!(t.conditions || []).every((c) => this._cond(c))) continue;
      for (const c of t.conditions || []) if (this.graph.parameters[c.param].type === 'trigger') this.params[c.param] = false;
      const dur = t.duration ?? 0;
      L.prev = dur > 0 ? { state: from, p: L.cur.p } : null; L.fade = 0; L.fadeLen = dur > 0 ? dur : 0;
      L.cur = this._enter(t.to, t.offset || 0);
      out.push({ layer: L.def.name, from, to: t.to }); return;
    }
  }
  _events(L, s, p0, p1, fresh, out) {
    const dur = this._dur(s, this.params), evs = [...(s.events || []), ...(s.clip !== undefined ? this.clips[s.clip]?.events || this.graph.clips?.[s.clip]?.events || [] : [])].map((e) => normEv(e, dur)), hits = [];
    const loop = s.loop !== false;
    for (let k = Math.floor(p0); k <= (loop ? Math.floor(p1) : 0); k++) evs.forEach((e, i) => { const pos = k + e.at; if ((fresh ? pos >= p0 : pos > p0) && pos <= p1) hits.push({ pos, i, e }); });
    hits.sort((a, b) => a.pos - b.pos || a.i - b.i);
    for (const h of hits) { const ev = { name: h.e.name, layer: L.def.name, state: L.cur.state, t: Math.round(h.pos * 1e9) / 1e9 }; if (h.e.data !== undefined) ev.data = h.e.data; out.push(ev); }
  }
  _mode(clip) { return this.graph.clips?.[clip]?.rootMotion ?? this.graph.rootMotion?.mode ?? 'none'; }
  /** Root delta of a state over normalised phase [p0,p1] (unwrapped; loops cross cycle boundaries). */
  _rootDelta(s, p0, p1, params) {
    const acc = { x: 0, y: 0, z: 0, yaw: 0 }; if (s.empty) return acc;
    const items = s.clip !== undefined ? [{ clip: s.clip, w: 1 }] : blendWeights(s, params), loop = s.loop !== false, axes = this.graph.rootMotion?.axes || 'xz', useYaw = !!this.graph.rootMotion?.yaw;
    for (const it of items) {
      const c = this.clips[it.clip]; if (!c?.root || this._mode(it.clip) !== 'extract' || !(c.duration > 0)) continue;
      const seg = (a, b) => { const r0 = c.root(a * c.duration), r1 = c.root(b * c.duration); return { x: r1.p[0] - r0.p[0], y: r1.p[1] - r0.p[1], z: r1.p[2] - r0.p[2], yaw: yawOf(qmul(r1.q, qconj(r0.q))) }; };
      let a = p0; const end = loop ? p1 : Math.min(p1, 1); if (!loop) a = Math.min(a, 1);
      while (a < end - 1e-12) { const c0 = loop ? Math.floor(a + 1e-12) : 0, nx = Math.min(end, loop ? c0 + 1 : 1), d = seg(a - c0, nx - c0); acc.x += it.w * d.x; acc.y += it.w * d.y; acc.z += it.w * d.z; acc.yaw += it.w * d.yaw; a = nx; }
    }
    if (axes === 'xz') acc.y = 0; if (!useYaw) acc.yaw = 0; return acc;
  }
  step(dt = this.dt) {
    const events = [], transitions = [], rm = { x: 0, y: 0, z: 0, yaw: 0 };
    this.layers.forEach((L, li) => {
      this._transition(L, transitions, li);
      const adv = (inst, s) => { const dur = this._dur(s, this.params), sp = this._speed(s), d = dur > EPS ? (dt * sp) / dur : s.loop === false ? 1 : 0, p0 = inst.p; let p1 = p0 + d; if (s.loop === false) p1 = Math.min(p1, 1); return { p0, p1 }; };
      const s = this._def(L, L.cur.state), { p0, p1 } = adv(L.cur, s);
      if (!s.empty) this._events(L, s, p0, p1, L.cur.fresh, events);
      if (li === (this.graph.rootMotion?.layer ?? 0)) {
        const wc = L.prev && L.fadeLen > 0 ? clamp((L.fade + dt) / L.fadeLen, 0, 1) : 1, dc = this._rootDelta(s, p0, p1, this.params);
        for (const k of Object.keys(rm)) rm[k] += wc * dc[k];
        if (L.prev && wc < 1) { const ps = this._def(L, L.prev.state), pa = adv(L.prev, ps), dp = this._rootDelta(ps, pa.p0, pa.p1, this.params); for (const k of Object.keys(rm)) rm[k] += (1 - wc) * dp[k]; }
      }
      L.cur.p = p1; L.cur.fresh = false;
      if (L.prev) { const ps = this._def(L, L.prev.state), pa = adv(L.prev, ps); L.prev.p = pa.p1; L.fade += dt; if (L.fade >= L.fadeLen - EPS) { L.prev = null; L.fade = 0; L.fadeLen = 0; } }
    });
    this.frame++; this.time = this.frame * this.dt;
    return { events, transitions, rootMotion: rm, time: this.time };
  }
  /** Plain-JSON runtime state (restore with restore()). */
  snapshot() { return JSON.parse(JSON.stringify({ frame: this.frame, params: this.params, layers: this.layers.map((L) => ({ cur: L.cur, prev: L.prev, fade: L.fade, fadeLen: L.fadeLen })) })); }
  restore(s) { this.frame = s.frame; this.time = s.frame * this.dt; this.params = { ...s.params }; s.layers.forEach((x, i) => Object.assign(this.layers[i], JSON.parse(JSON.stringify(x)))); return this; }
}

// ---------------- model glue ----------------
/** Resolve a mask {bones, exclude, descendants} to a Uint8Array per node (1 = layer affects it). Names match case/punctuation-insensitively (spine.001 == spine_001). */
export function resolveMask(model, mask) {
  const out = new Uint8Array(model.nodes.length); if (!mask) { out.fill(1); return out; }
  const byName = new Map(); model.nodes.forEach((n, i) => { const k = norm(n.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); });
  const kids = model.nodes.map((n) => n.children || []);
  const mark = (names, v, desc) => { const walk = (i) => { out[i] = v; if (desc) kids[i].forEach(walk); }; for (const nm of names || []) for (const i of byName.get(norm(nm)) || []) walk(i); };
  mark(mask.bones, 1, mask.descendants !== false); mark(mask.exclude, 0, mask.excludeDescendants !== false); return out;
}
/** Skeleton root joint: first joint of skin 0 whose parent is not a joint (Rigify/Meshy: "spine"). Falls back to graph.rootMotion.bone. */
export function findRootNode(model, boneName) {
  if (boneName) { const i = model.nodes.findIndex((n) => norm(n.name) === norm(boneName)); if (i >= 0) return i; }
  const sk = model.skins[0]; if (!sk) return model.roots[0] ?? 0; const set = new Set(sk.joints); return sk.joints.find((j) => !set.has(model.parent[j])) ?? sk.joints[0];
}
function rootSampler(model, rootNode, clip, sample) {
  const n = model.nodes[rootNode]; let pq = [0, 0, 0, 1]; const chain = []; for (let p = model.parent[rootNode]; p !== undefined && p >= 0; p = model.parent[p]) chain.unshift(p);
  for (const p of chain) pq = qmul(pq, model.nodes[p].r);
  const tr = clip.channels.find((c) => c.node === rootNode && c.path === 'translation'), ro = clip.channels.find((c) => c.node === rootNode && c.path === 'rotation');
  const wm = worldMatrices(model, model.nodes.map((x) => ({ t: x.t.slice(), r: x.r.slice(), s: x.s.slice() }))), pw = chain.length ? wm[chain[chain.length - 1]] : null;
  const toWorld = (v) => (pw ? [pw[0] * v[0] + pw[4] * v[1] + pw[8] * v[2] + pw[12], pw[1] * v[0] + pw[5] * v[1] + pw[9] * v[2] + pw[13], pw[2] * v[0] + pw[6] * v[1] + pw[10] * v[2] + pw[14]] : v);
  return { pq, local: (t) => ({ t: tr ? sample(tr, t) : n.t.slice(), r: ro ? sample(ro, t) : n.r.slice() }),
    root: (t) => { const l = { t: tr ? sample(tr, t) : n.t.slice(), r: ro ? sample(ro, t) : n.r.slice() }; return { p: toWorld(l.t), q: qmul(pq, l.r) }; } };
}

/**
 * Drives an AnimGraph over a parsed glTF model (parseAnimGLB). Wraps an AnimPlayer so skinned()/jointMatrices()/world() keep working:
 *   const g = new AnimGraphPlayer(model, graph); g.setParam('speed', 3); const r = g.update(1/60); // r.rootMotion, r.events
 *   g.pose(); g.player.skinned();
 */
export class AnimGraphPlayer {
  constructor(model, graph, opts = {}) {
    this.model = model; this.graph = graph; this.player = new AnimPlayer(model); this._pose = null;
    this.rootNode = findRootNode(model, graph.rootMotion?.bone);
    this.clipInfo = {}; this._roots = {};
    for (const c of model.animations) {
      const rs = rootSampler(model, this.rootNode, c, (ch, t) => { const tt = c.duration > 0 ? Math.min(Math.max(t, 0), c.duration) : 0; return poseSample(ch, tt); });
      this._roots[c.name] = rs; this.clipInfo[c.name] = { duration: c.duration, root: rs.root };
    }
    this.graphRuntime = new AnimGraph(graph, this.clipInfo, opts);
    this.masks = this.graphRuntime.layers.map((L) => resolveMask(model, L.def.mask));
    this._ref = {};
  }
  get runtime() { return this.graphRuntime; }
  setParam(n, v) { this.graphRuntime.setParam(n, v); return this; }
  setTrigger(n) { this.graphRuntime.setTrigger(n); return this; }
  update(dt = FIXED_DT) { this._pose = null; this.player._pose = null; const r = this.graphRuntime.step(dt); return r; }
  _clipPose(name, phase, loop) {
    const clip = this.player.clips.get(name), pose = poseAt(this.model, clip, clip.duration * phase, false), mode = this.graphRuntime._mode(name);
    if (mode === 'extract' || mode === 'inplace') this._lock(pose, clip, clip.duration * phase);
    return pose;
  }
  _lock(pose, clip, time) {
    const rs = this._roots[clip.name], a = rs.local(0), b = rs.local(time), pq = rs.pq, ax = this.graph.rootMotion?.axes || 'xz', n = pose[this.rootNode];
    const dw = qrot(pq, b.t.map((v, i) => v - a.t[i])); const rem = qrot(qconj(pq), [dw[0], ax === 'xz' ? 0 : dw[1], dw[2]]); n.t = b.t.map((v, i) => v - rem[i]);
    if (this.graph.rootMotion?.yaw) { const qw0 = qmul(pq, a.r), qw1 = qmul(pq, b.r), dy = yawOf(qmul(qw1, qconj(qw0))); n.r = qmul(qconj(pq), qmul(qyaw(-dy), qw1)); }
  }
  _statePose(L, st, p) {
    const s = L.def.states[st]; if (s.empty) return null;
    const phase = s.loop === false ? Math.min(p, 1) : p - Math.floor(p), loop = s.loop !== false, ph = loop ? phase : Math.min(p, 1);
    if (s.clip !== undefined) return this._clipPose(s.clip, ph, loop);
    const ws = blendWeights(s, this.graphRuntime.params), a = this._clipPose(ws[0].clip, ph, loop);
    return ws.length === 1 ? a : blendPoses(a, this._clipPose(ws[1].clip, ph, loop), ws[1].w);
  }
  _layerPose(li) {
    const L = this.graphRuntime.layers[li], cur = this._statePose(L, L.cur.state, L.cur.p), wc = this.graphRuntime.weightOf(li);
    if (!L.prev) return { pose: cur, w: cur ? 1 : 0 };
    const prev = this._statePose(L, L.prev.state, L.prev.p);
    if (cur && prev) return { pose: blendPoses(prev, cur, wc), w: 1 };
    if (cur) return { pose: cur, w: wc }; if (prev) return { pose: prev, w: 1 - wc }; return { pose: null, w: 0 };
  }
  /** Final local TRS per node: base layer, then masked override / additive layers on top. */
  pose() {
    if (this._pose) return this._pose;
    let out = poseAt(this.model, null, 0);
    this.graphRuntime.layers.forEach((L, li) => {
      const lp = this._layerPose(li), lw = this.graphRuntime.layerWeight(li) * lp.w; if (!lp.pose || lw <= 0) return;
      const mask = this.masks[li], additive = L.def.blend === 'additive';
      if (additive) {
        const s = L.def.states[L.cur.state], refClip = this.player.clips.get(s.clip ?? s.blend?.points[0].clip), ref = poseAt(this.model, refClip, 0, false);
        out = out.map((o, i) => { const w = lw * mask[i]; if (!w) return o; const l = lp.pose[i], f = ref[i];
          return { t: o.t.map((v, k) => v + w * (l.t[k] - f.t[k])), r: qmul(o.r, qslerp([0, 0, 0, 1], qmul(qconj(f.r), l.r), w)), s: o.s.map((v, k) => v + w * (l.s[k] - f.s[k])) }; });
      } else if (li === 0 && !L.def.mask) out = lw >= 1 ? lp.pose : blendPoses(out, lp.pose, lw);
      else out = out.map((o, i) => { const w = lw * mask[i]; if (!w) return o; const l = lp.pose[i]; return { t: o.t.map((v, k) => v + w * (l.t[k] - v)), r: qslerp(o.r, l.r, w), s: o.s.map((v, k) => v + w * (l.s[k] - v)) }; });
    });
    this.player._pose = out; return (this._pose = out);
  }
  world() { this.pose(); return this.player.world(); }
  jointMatrices() { this.pose(); return this.player.jointMatrices(); }
  skinned() { this.pose(); return this.player.skinned(); }
}
