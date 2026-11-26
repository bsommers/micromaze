// ai3d: data-driven enemy AI. Pure, deterministic, zero deps, Y-up, metres, fixed step. Spec: spec/v4/ai3d.md.
// All state is plain JSON; randomness comes from a seeded rng stored in the agent (no Math.random / Date). Steering works on the XZ plane.
// Output is an INTENT {moveDir, speed, wantAttack, lookAt, state, target, tell}; locomotion/combat modules consume it (not imported here).
import { raycast, buildAABBs } from './bvh.js';

export const VERSION = 1;
export const DT = 1 / 60;
const EPS = 1e-9, SQ2 = Math.SQRT2;
const sqrt = Math.sqrt;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const d2 = (a, b) => { const x = a[0] - b[0], z = a[2] - b[2]; return sqrt(x * x + z * z); };
export const dir2 = (a, b) => { const x = b[0] - a[0], z = b[2] - a[2], l = sqrt(x * x + z * z); return l < EPS ? [0, 0, 0] : [x / l, 0, z / l]; };
const len2 = (v) => sqrt(v[0] * v[0] + v[2] * v[2]);
const unit2 = (v) => { const l = len2(v); return l < EPS ? [0, 0, 0] : [v[0] / l, 0, v[2] / l]; };
const rnd = (v, k = 1e4) => Math.round(v * k) / k;

// ---------- seeded rng (mulberry32); state lives in obj.rng (uint32) ----------
export function rngNext(o) {
  o.rng = (o.rng + 0x6D2B79F5) >>> 0; let t = o.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const hashStr = (s) => { let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };

// ---------- steering: each returns {dir:[x,0,z] unit or zero, speed:0..1}; combine() blends ----------
export const seek = (pos, target) => ({ dir: dir2(pos, target), speed: 1 });
export function arrive(pos, target, slow = 2, stop = 0.2) {
  const d = d2(pos, target); if (d <= stop) return { dir: [0, 0, 0], speed: 0 };
  return { dir: dir2(pos, target), speed: slow > stop && d < slow ? (d - stop) / (slow - stop) : 1 };
}
export const flee = (pos, threat) => { const d = dir2(pos, threat); return { dir: [0 - d[0], 0, 0 - d[2]], speed: 1 }; };
export function separation(pos, others, radius = 1.2) {
  let x = 0, z = 0;
  for (const o of others) { const d = d2(pos, o); if (d >= radius) continue; const away = d < EPS ? [1, 0, 0] : dir2(o, pos), w = 1 - d / radius; x += away[0] * w; z += away[2] * w; }
  const l = sqrt(x * x + z * z); return l < EPS ? { dir: [0, 0, 0], speed: 0 } : { dir: [x / l, 0, z / l], speed: Math.min(1, l) };
}
// sign +1 = counter-clockwise about +Y (yaw-positive), -1 = clockwise. Holds `radius` from the target while circling.
export function orbit(pos, target, radius, sign = 1) {
  const d = d2(pos, target), r = d < EPS ? [1, 0, 0] : dir2(target, pos), tan = [r[2] * sign, 0, -r[0] * sign], k = clamp((radius - d) / Math.max(radius, EPS), -1, 1);
  const v = [tan[0] + r[0] * k * 2, 0, tan[2] + r[2] * k * 2]; return { dir: unit2(v), speed: 1 };
}
export function keepDistance(pos, target, min, max) {
  const d = d2(pos, target);
  if (d < min) { const f = flee(pos, target); f.speed = clamp((min - d) / Math.max(min * 0.5, EPS), 0.3, 1); return f; }
  if (d > max) return { dir: dir2(pos, target), speed: clamp((d - max) / Math.max(max * 0.5, EPS), 0.3, 1) };
  return { dir: [0, 0, 0], speed: 0 };
}
export function combine(parts, cap = 1) {
  let x = 0, z = 0, top = 0;
  for (const p of parts) { const w = (p.weight ?? 1) * p.speed; x += p.dir[0] * w; z += p.dir[2] * w; if (p.speed > top) top = p.speed; }
  const l = sqrt(x * x + z * z); if (l < EPS) return { dir: [0, 0, 0], speed: 0 };
  return { dir: [x / l, 0, z / l], speed: Math.min(l, Math.max(cap, top)) };
}

// ---------- nav providers ----------
// NavProvider interface (recast-navigation or any navmesh plugs in by implementing it):
//   findPath(from:[x,y,z], to:[x,y,z], opts?) -> [[x,y,z],...] waypoints EXCLUDING `from`, ending at the (snapped) goal; null if unreachable.
//   optional isClear(from,to) -> bool: straight walk is unobstructed (lets agents skip path following).
class Heap { // binary min-heap on [f,h,idx]; ties broken by h then idx so results never depend on insertion luck
  constructor() { this.a = []; }
  less(p, q) { return p[0] < q[0] || (p[0] === q[0] && (p[1] < q[1] || (p[1] === q[1] && p[2] < q[2]))); }
  push(e) { const a = this.a; let i = a.length; a.push(e); while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}
// Walkable-cell grid on the XZ plane. blocked: flat array row-major (index = z*width + x), 1 = blocked.
export function createGridNav({ origin = [0, 0], cellSize = 1, width, height, blocked, y = 0 }) {
  const cells = Uint8Array.from(blocked || new Array(width * height).fill(0)), N = width * height;
  const cx = (x) => Math.floor((x - origin[0]) / cellSize), cz = (z) => Math.floor((z - origin[1]) / cellSize);
  const inb = (i, j) => i >= 0 && j >= 0 && i < width && j < height, free = (i, j) => inb(i, j) && cells[j * width + i] === 0;
  const center = (i, j) => [origin[0] + (i + 0.5) * cellSize, y, origin[1] + (j + 0.5) * cellSize];
  const walkable = (p) => free(cx(p[0]), cz(p[2]));
  function nearest(i, j, maxR = 8) { // closest walkable cell: ring search, ties by (j,i) order
    if (free(i, j)) return [i, j];
    for (let r = 1; r <= maxR; r++) { let best = null, bd = Infinity; for (let b = j - r; b <= j + r; b++) for (let a = i - r; a <= i + r; a++) { if (Math.max(Math.abs(a - i), Math.abs(b - j)) !== r || !free(a, b)) continue; const d = (a - i) * (a - i) + (b - j) * (b - j); if (d < bd) { bd = d; best = [a, b]; } } if (best) return best; }
    return null;
  }
  function isClear(a, b) {
    const d = d2(a, b), steps = Math.max(1, Math.ceil(d / (cellSize * 0.5)));
    for (let s = 0; s <= steps; s++) { const t = s / steps, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t; if (!free(cx(x), cz(z))) return false; }
    return true;
  }
  function findPath(from, to, opts = {}) {
    const s = nearest(cx(from[0]), cz(from[2]), opts.snap ?? 4), g = nearest(cx(to[0]), cz(to[2]), opts.snap ?? 4); if (!s || !g) return null;
    const si = s[1] * width + s[0], gi = g[1] * width + g[0], gc = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const hf = (i) => { const dx = Math.abs((i % width) - g[0]), dz = Math.abs(((i / width) | 0) - g[1]); return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz); };
    const heap = new Heap(); gc[si] = 0; heap.push([hf(si), hf(si), si]); let exp = 0; const cap = opts.maxNodes ?? N;
    while (heap.size && exp++ < cap) {
      const [, , cur] = heap.pop(); if (closed[cur]) continue; closed[cur] = 1; if (cur === gi) break;
      const ci = cur % width, cj = (cur / width) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = ci + di, nj = cj + dj; if (!free(ni, nj)) continue;
        if (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj))) continue; // no corner cutting
        const n = nj * width + ni, c = gc[cur] + (di && dj ? SQ2 : 1); if (c < gc[n]) { gc[n] = c; par[n] = cur; heap.push([c + hf(n), hf(n), n]); }
      }
    }
    if (gc[gi] === Infinity) return null;
    const cellsPath = []; for (let k = gi; k !== -1; k = par[k]) cellsPath.push(center(k % width, (k / width) | 0)); cellsPath.reverse();
    // string-pull: from each anchor jump to the farthest cell centre still in a clear straight line
    const pts = [], anchor = [from[0], y, from[2]]; let cur = anchor, k = 0;
    while (k < cellsPath.length) { let far = k; for (let m = cellsPath.length - 1; m > k; m--) if (isClear(cur, cellsPath[m])) { far = m; break; } pts.push(cellsPath[far]); cur = cellsPath[far]; k = far + 1; }
    if (pts.length && walkable(to) && isClear(pts[pts.length - 1], [to[0], y, to[2]])) pts[pts.length - 1] = [to[0], y, to[2]];
    return pts.length ? pts : [[to[0], y, to[2]]];
  }
  return { kind: 'grid', findPath, isClear, walkable, toJSON: () => ({ kind: 'grid', origin, cellSize, width, height, y, blocked: Array.from(cells) }) };
}
// Rasterise world boxes ({min,max}) into a grid. A cell blocks when its (inflated) XZ footprint overlaps a box whose Y span overlaps yRange.
export function gridFromBoxes(boxes, { origin = [0, 0], cellSize = 1, width, height, inflate = 0, yRange = [0.25, 2], y = 0 } = {}) {
  const blocked = new Array(width * height).fill(0);
  for (const b of boxes) {
    if (b.max[1] < yRange[0] || b.min[1] > yRange[1]) continue;
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const x0 = origin[0] + i * cellSize - inflate, x1 = x0 + cellSize + 2 * inflate, z0 = origin[1] + j * cellSize - inflate, z1 = z0 + cellSize + 2 * inflate;
      if (x1 > b.min[0] && x0 < b.max[0] && z1 > b.min[2] && z0 < b.max[2]) blocked[j * width + i] = 1;
    }
  }
  return createGridNav({ origin, cellSize, width, height, blocked, y });
}
// Waypoint graph: nodes [{id,pos}], edges [[idA,idB]] (undirected). Start/goal snap to the nearest node (ties: lower index).
export function createWaypointNav({ nodes, edges }) {
  const idx = new Map(nodes.map((n, i) => [n.id, i])), adj = nodes.map(() => []);
  for (const [a, b] of edges) { const i = idx.get(a), j = idx.get(b); if (i === undefined || j === undefined) throw new Error(`edge ${a}-${b} references unknown node`); const c = d2(nodes[i].pos, nodes[j].pos); adj[i].push([j, c]); adj[j].push([i, c]); }
  for (const l of adj) l.sort((p, q) => p[0] - q[0]);
  const near = (p) => { let b = -1, bd = Infinity; nodes.forEach((n, i) => { const d = d2(n.pos, p); if (d < bd) { bd = d; b = i; } }); return b; };
  function findPath(from, to) {
    if (!nodes.length) return null; const s = near(from), g = near(to), cost = new Float64Array(nodes.length).fill(Infinity), par = new Int32Array(nodes.length).fill(-1), closed = new Uint8Array(nodes.length);
    const hf = (i) => d2(nodes[i].pos, nodes[g].pos), heap = new Heap(); cost[s] = 0; heap.push([hf(s), hf(s), s]);
    while (heap.size) { const [, , c] = heap.pop(); if (closed[c]) continue; closed[c] = 1; if (c === g) break; for (const [n, w] of adj[c]) if (cost[c] + w < cost[n]) { cost[n] = cost[c] + w; par[n] = c; heap.push([cost[n] + hf(n), hf(n), n]); } }
    if (cost[g] === Infinity) return null; const out = []; for (let k = g; k !== -1; k = par[k]) out.push([...nodes[k].pos]); out.reverse();
    if (out.length && d2(out[0], from) < 0.3) out.shift(); out.push([to[0], to[1], to[2]]); return out;
  }
  return { kind: 'waypoints', findPath, toJSON: () => ({ kind: 'waypoints', nodes, edges }) };
}
export const navFromJSON = (j) => (j.kind === 'grid' ? createGridNav(j) : createWaypointNav(j));

// ---------- line of sight ----------
// world.los(from,to) wins; else world.bvh (bvh.js, AABB or triangle) ray from -> to; else clear.
export function lineOfSight(world, from, to) {
  if (world.los) return !!world.los(from, to);
  if (!world.bvh) return true;
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], l = sqrt(dx * dx + dy * dy + dz * dz); if (l < EPS) return true;
  return raycast(world.bvh, from, [dx / l, dy / l, dz / l], { tmax: l - 1e-4 }) === null;
}
export const bvhFromBoxes = (boxes) => buildAABBs(boxes.flatMap((b) => [...b.min, ...b.max]));

// ---------- config ----------
const DEF = {
  stats: { moveSpeed: 3.5, turnRate: 8, radius: 0.4, eyeHeight: 1.6 },
  perception: { sightRange: 15, fovDeg: 110, awareness: 1.5, hearRadius: 8, memorySec: 6, targetEyeHeight: 1.4 },
  threat: { sightGain: 1, hearGain: 0.5, damageGain: 1, decay: 0.1, switchRatio: 1.25 },
  steering: { separation: { radius: 1.2, weight: 0.8 } },
};
export function normalizeConfig(c) {
  const m = (k) => ({ ...DEF[k], ...(c[k] || {}) });
  const steering = { ...DEF.steering, ...(c.steering || {}) }; if (steering.separation) steering.separation = { ...DEF.steering.separation, ...steering.separation };
  return { ...c, role: c.role || 'melee', stats: m('stats'), perception: m('perception'), threat: m('threat'), steering, moves: c.moves || {}, tree: c.tree };
}
export function createAgent({ id, config, role, pos, facing = [0, 0, 1], seed = 1, hp = 100, maxHp }) {
  return { id, config, role: role || null, pos: [...pos], facing: unit2(facing), hp, maxHp: maxHp ?? hp, spawn: [...pos], rng: (seed >>> 0) || 1, time: 0, perc: { known: {}, heardPos: null, heardT: -1e9 }, threat: {}, target: null, cd: {}, mem: {}, slot: null, state: 'idle' };
}

// ---------- perception & threat ----------
export function perceive(a, cfg, world, dt) {
  const P = cfg.perception, T = cfg.threat, now = a.time, eye = [a.pos[0], a.pos[1] + cfg.stats.eyeHeight, a.pos[2]], cosH = Math.cos((P.fovDeg * Math.PI) / 360);
  const targets = [...(world.targets || [])].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  for (const t of targets) {
    const d = d2(a.pos, t.pos), kn = a.perc.known[t.id] || (a.perc.known[t.id] = { pos: [...t.pos], t: -1e9, seen: false, how: null });
    let seen = false;
    if (d <= P.sightRange) { const dr = dir2(a.pos, t.pos), dot = a.facing[0] * dr[0] + a.facing[2] * dr[2]; if ((d <= P.awareness || dot >= cosH) && lineOfSight(world, eye, [t.pos[0], t.pos[1] + P.targetEyeHeight, t.pos[2]])) seen = true; }
    const heard = !seen && d <= P.hearRadius * (t.noise ?? 0);
    kn.seen = seen;
    if (seen || heard) { kn.pos = [...t.pos]; kn.t = now; kn.how = seen ? 'sight' : 'sound'; if (heard) { a.perc.heardPos = [...t.pos]; a.perc.heardT = now; } }
    if (seen) a.threat[t.id] = (a.threat[t.id] || 0) + T.sightGain * dt * (1 - 0.5 * (d / P.sightRange));
    else if (heard) a.threat[t.id] = (a.threat[t.id] || 0) + T.hearGain * dt;
  }
  for (const s of world.sounds || []) { // one-shot noises this tick
    const d = d2(a.pos, s.pos); if (d > P.hearRadius * (s.loudness ?? 1)) continue;
    a.perc.heardPos = [...s.pos]; a.perc.heardT = now;
    if (s.source) { const kn = a.perc.known[s.source] || (a.perc.known[s.source] = { pos: [...s.pos], t: -1e9, seen: false, how: null }); if (!kn.seen) { kn.pos = [...s.pos]; kn.t = now; kn.how = 'sound'; } a.threat[s.source] = (a.threat[s.source] || 0) + T.hearGain * (s.loudness ?? 1) * 0.5; }
  }
  for (const e of world.events || []) if (e.type === 'damage' && e.target === a.id) addThreat(a, cfg, e.source, e.amount * T.damageGain, world);
  for (const id of Object.keys(a.perc.known)) if (now - a.perc.known[id].t > P.memorySec && !a.perc.known[id].seen) delete a.perc.known[id];
  const ids = Object.keys(a.threat).sort();
  for (const id of ids) { a.threat[id] = Math.max(0, a.threat[id] * (1 - T.decay * dt)); if (a.threat[id] < 1e-6 || !(id in a.perc.known)) { if (!(id in a.perc.known)) delete a.threat[id]; } }
  // target selection: highest threat among known, with hysteresis; ties -> lowest id
  let best = null, bv = 0; for (const id of Object.keys(a.threat).sort()) if (id in a.perc.known && a.threat[id] > bv) { bv = a.threat[id]; best = id; }
  if (a.target && a.target in a.perc.known && best !== a.target && (a.threat[a.target] || 0) * T.switchRatio >= bv) best = a.target;
  a.target = best;
}
export function addThreat(a, cfg, id, amount, world) {
  a.threat[id] = (a.threat[id] || 0) + amount;
  const t = (world?.targets || []).find((x) => x.id === id), kn = a.perc.known[id];
  if (!kn && t) a.perc.known[id] = { pos: [...t.pos], t: a.time, seen: false, how: 'damage' }; else if (kn && !kn.seen) { kn.t = a.time; if (t) kn.pos = [...t.pos]; kn.how = 'damage'; }
}

// ---------- groups: attack tokens + surround slots ----------
export function createGroup({ id = 'group', maxAttackers = 2, ttl = 2 } = {}) { return { id, maxAttackers, ttl, tokens: {}, rotate: 0, slotBase: 0 }; }
export function groupExpire(g, time) { for (const k of Object.keys(g.tokens)) if (g.tokens[k] <= time) delete g.tokens[k]; }
export const groupHolds = (g, id, time) => (g.tokens[id] ?? -1) > time;
export const groupFree = (g, time) => Object.keys(g.tokens).filter((k) => g.tokens[k] > time).length < g.maxAttackers;
export function groupRequest(g, id, time, ttl) { groupExpire(g, time); if (groupHolds(g, id, time)) return true; if (!groupFree(g, time)) return false; g.tokens[id] = time + (ttl ?? g.ttl); return true; }
export const groupRelease = (g, id) => { delete g.tokens[id]; };
// Assign each melee agent an evenly spaced angle slot around the target, choosing the rotation of slots that minimises total angular travel.
export function groupUpdate(g, agents, targetPos, time, dt = DT) {
  groupExpire(g, time); g.slotBase += g.rotate * dt;
  const melee = agents.filter((a) => a.role === 'melee').sort((p, q) => (p.id < q.id ? -1 : 1)), n = melee.length;
  for (const a of agents) if (a.role !== 'melee') a.slot = null;
  if (!n || !targetPos) { for (const a of melee) a.slot = null; return; }
  const TAU = Math.PI * 2, ang = melee.map((a) => Math.atan2(a.pos[2] - targetPos[2], a.pos[0] - targetPos[0])), ord = melee.map((_, i) => i).sort((p, q) => ang[p] - ang[q] || p - q);
  const base = ang[0] + g.slotBase, slot = (k) => base + (TAU * k) / n, dist = (x, y) => { let d = Math.abs(x - y) % TAU; return d > Math.PI ? TAU - d : d; };
  let bestR = 0, bestC = Infinity;
  for (let r = 0; r < n; r++) { let c = 0; ord.forEach((ai, k) => { c += dist(ang[ai], slot((k + r) % n)); }); if (c < bestC - 1e-12) { bestC = c; bestR = r; } }
  ord.forEach((ai, k) => { melee[ai].slot = slot((k + bestR) % n); });
}

// ---------- behaviour tree ----------
const S = 'success', F = 'failure', R = 'running';
function mk(a, cfg, world, dt) {
  const kn = a.target ? a.perc.known[a.target] : null, tw = a.target ? (world.targets || []).find((t) => t.id === a.target) : null;
  const tgt = kn ? { id: a.target, pos: kn.seen && tw ? tw.pos : kn.pos, visible: kn.seen, how: kn.how, age: a.time - kn.t } : null; if (tgt) tgt.dist = d2(a.pos, tgt.pos);
  return { a, cfg, world, dt, time: a.time, group: world.group || null, target: tgt, touched: new Set(), steer: [], intent: { moveDir: [0, 0, 0], speed: 0, wantAttack: null, lookAt: null, state: 'idle', target: tgt ? tgt.id : null, tell: null } };
}
const pointFor = (ctx, to) => (to === 'lastKnown' ? (ctx.a.target ? ctx.a.perc.known[ctx.a.target]?.pos : null) : to === 'spawn' ? ctx.a.spawn : to === 'heard' ? ctx.a.perc.heardPos : ctx.target ? ctx.target.pos : null);
const move = (ctx, st, label) => { ctx.steer.push({ ...st, weight: 1 }); ctx.intent.state = label; };
const moveReady = (ctx, id) => (ctx.a.cd['move:' + id] ?? -1) <= ctx.time;
function inRange(m, d) { const r = m.range || {}; return d >= (r.min ?? 0) && d <= (r.max ?? 2); }

export const CONDITIONS = {
  always: () => true, never: () => false,
  hasTarget: (c) => !!c.target, canSee: (c) => !!c.target?.visible, remembers: (c) => !!c.target && !c.target.visible,
  heard: (c, n) => c.time - c.a.perc.heardT <= (n.within ?? 1),
  inRange: (c, n) => !!c.target && c.target.dist >= (n.min ?? 0) && c.target.dist <= (n.max ?? Infinity),
  healthBelow: (c, n) => c.a.hp / c.a.maxHp < n.pct,
  outsideLeash: (c, n) => d2(c.a.pos, c.a.spawn) > (n.radius ?? c.cfg.leash?.radius ?? 30),
  nearSpawn: (c, n) => d2(c.a.pos, c.a.spawn) <= (n.radius ?? 1),
  hasToken: (c) => !!c.group && groupHolds(c.group, c.a.id, c.time),
  tokenAvailable: (c) => !!c.group && (groupHolds(c.group, c.a.id, c.time) || groupFree(c.group, c.time)),
  moveReady: (c, n) => moveReady(c, n.move),
  roll: (c, n) => rngNext(c.a) < n.p,
  timeSinceSeen: (c, n) => { const kn = c.a.target ? c.a.perc.known[c.a.target] : null, t = kn ? c.time - kn.t : Infinity; return (n.gt === undefined || t > n.gt) && (n.lt === undefined || t < n.lt); },
  hasSlot: (c) => c.a.slot !== null,
  role: (c, n) => c.a.role === n.is,
};
const INPUTS = {
  dist: (c) => (c.target ? c.target.dist : 1e9), healthPct: (c) => c.a.hp / c.a.maxHp, visible: (c) => (c.target?.visible ? 1 : 0),
  hasToken: (c) => (c.group && groupHolds(c.group, c.a.id, c.time) ? 1 : 0), tokenFree: (c) => (c.group && groupFree(c.group, c.time) ? 1 : 0),
  timeSinceSeen: (c) => (c.target ? c.target.age : 1e9), threat: (c) => (c.a.target ? c.a.threat[c.a.target] || 0 : 0), hasTarget: (c) => (c.target ? 1 : 0),
};
export const ACTION_NAMES = ['idle', 'wander', 'seek', 'arrive', 'path', 'flee', 'keepDistance', 'orbit', 'surround', 'face', 'attack', 'charge', 'dropAggro'];
const ACTIONS = {
  idle: (c) => { c.intent.state = 'idle'; return S; },
  wander: (c, n, mem) => {
    const r = n.radius ?? 4; if (!mem.goal || c.time >= mem.until) { mem.goal = [c.a.spawn[0] + (rngNext(c.a) * 2 - 1) * r, c.a.spawn[1], c.a.spawn[2] + (rngNext(c.a) * 2 - 1) * r]; mem.until = c.time + (n.interval ?? 3); }
    if (d2(c.a.pos, mem.goal) < 0.3) { c.intent.state = 'wander'; return S; }
    move(c, { ...arrive(c.a.pos, mem.goal, 1.5, 0.2), speed: 1 * (n.speed ?? 0.4) * (arrive(c.a.pos, mem.goal, 1.5, 0.2).speed) }, 'wander'); return R;
  },
  seek: (c, n, mem) => goTo(c, n, mem, false, 0),
  arrive: (c, n, mem) => goTo(c, n, mem, false, n.slow ?? 2),
  path: (c, n, mem) => goTo(c, n, mem, true, n.slow ?? 1),
  flee: (c, n) => { const p = pointFor(c, n.from || 'target'); if (!p) return F; if (d2(c.a.pos, p) >= (n.dist ?? 8)) return S; const f = flee(c.a.pos, p); move(c, { ...f, speed: n.speed ?? 1 }, 'flee'); return R; },
  keepDistance: (c, n) => {
    const p = pointFor(c, n.to || 'target'); if (!p) return F; const st = keepDistance(c.a.pos, p, n.min ?? 6, n.max ?? 10);
    c.intent.lookAt = [...p]; if (st.speed === 0) { c.intent.state = 'hold'; return S; } move(c, { ...st, speed: st.speed * (n.speed ?? 1) }, 'keepDistance'); return R;
  },
  orbit: (c, n, mem) => {
    const p = pointFor(c, n.to || 'target'); if (!p) return F; if (mem.sign === undefined) { mem.sign = n.dir === 'cw' ? -1 : n.dir === 'ccw' ? 1 : (rngNext(c.a) < 0.5 ? -1 : 1); mem.t0 = c.time; }
    if (n.duration !== undefined && c.time - mem.t0 >= n.duration) return S;
    const o = orbit(c.a.pos, p, n.radius ?? 4, mem.sign); move(c, { ...o, speed: n.speed ?? 0.6 }, 'orbit'); c.intent.lookAt = [...p]; return R;
  },
  surround: (c, n) => {
    if (!c.target || c.a.slot === null) return F; const r = n.radius ?? 2.5, tp = c.target.pos, goal = [tp[0] + Math.cos(c.a.slot) * r, tp[1], tp[2] + Math.sin(c.a.slot) * r];
    c.intent.lookAt = [...tp]; if (d2(c.a.pos, goal) < 0.4) { c.intent.state = 'surround'; return S; }
    move(c, { ...arrive(c.a.pos, goal, 2, 0.3), speed: (n.speed ?? 0.8) * arrive(c.a.pos, goal, 2, 0.3).speed }, 'surround'); return R;
  },
  face: (c, n) => { const p = pointFor(c, n.to || 'target'); if (!p) return F; c.intent.lookAt = [...p]; return S; },
  attack: (c, n) => {
    const m = c.cfg.moves[n.move]; if (!m || !c.target) return F; if (!inRange(m, c.target.dist) || !moveReady(c, n.move)) return F;
    if ((m.needsLos ?? false) && !c.target.visible) return F;
    if ((m.tokens ?? 0) > 0 && c.group) { if (!groupRequest(c.group, c.a.id, c.time, m.duration ?? 0.5)) return F; c.group.tokens[c.a.id] = c.time + (m.duration ?? 0.5); }
    c.a.cd['move:' + n.move] = c.time + (m.cooldown ?? 1); c.intent.wantAttack = n.move; c.intent.lookAt = [...c.target.pos]; c.intent.state = 'attack'; return S;
  },
  charge: (c, n, mem) => {
    if (!c.target) return F; const wind = n.windup ?? 0.8, tp = c.target.pos;
    if (!mem.phase) { mem.phase = 'windup'; mem.t0 = c.time; }
    if (mem.phase === 'windup') { c.intent.lookAt = [...tp]; c.intent.state = 'windup'; c.intent.tell = n.tell || 'charge'; if (c.time - mem.t0 >= wind) { mem.phase = 'dash'; mem.dir = dir2(c.a.pos, tp); mem.from = [...c.a.pos]; } return R; }
    if (mem.phase === 'dash') {
      const traveled = d2(c.a.pos, mem.from), hit = c.target.dist <= (n.hitDist ?? 1.2);
      if (traveled >= (n.maxDist ?? 12) || hit) { if (hit && n.hitMove) c.intent.wantAttack = n.hitMove; mem.phase = 'recover'; mem.t0 = c.time; return R; }
      c.steer.push({ dir: mem.dir, speed: n.speed ?? 3, weight: 1 }); c.intent.state = 'dash'; c.intent.lookAt = [c.a.pos[0] + mem.dir[0], c.a.pos[1], c.a.pos[2] + mem.dir[2]]; return R;
    }
    c.intent.state = 'recover'; if (c.time - mem.t0 >= (n.recover ?? 0.6)) return S; return R;
  },
  dropAggro: (c) => { c.a.threat = {}; c.a.perc.known = {}; c.a.target = null; c.target = null; c.intent.target = null; c.intent.state = 'reset'; return S; },
};
function goTo(c, n, mem, nav, slow) {
  const p = pointFor(c, n.to || 'target'); if (!p) return F; const stop = n.stop ?? 0.2, d = d2(c.a.pos, p), label = nav ? 'path' : 'seek';
  if (d <= stop) { c.intent.state = label; return S; }
  let aim = p;
  const prov = c.world.nav;
  if (nav && prov && !(prov.isClear && prov.isClear(c.a.pos, p))) {
    const gk = `${rnd(p[0], 1)},${rnd(p[2], 1)}`;
    if (!mem.pts || mem.gk !== gk || c.time - mem.t0 >= (n.repath ?? 0.5)) { mem.pts = prov.findPath(c.a.pos, p) || null; mem.gk = gk; mem.t0 = c.time; mem.i = 0; }
    if (!mem.pts) return F;
    while (mem.i < mem.pts.length - 1 && d2(c.a.pos, mem.pts[mem.i]) < (n.reach ?? 0.4)) mem.i++;
    aim = mem.pts[mem.i];
  }
  const st = aim === p ? arrive(c.a.pos, aim, slow, stop) : seek(c.a.pos, aim);
  move(c, { ...st, speed: st.speed * (n.speed ?? 1) }, label); if (!c.intent.lookAt && (n.face ?? true)) c.intent.lookAt = [...aim]; return R;
}

function run(node, path, c) {
  c.touched.add(path);
  switch (node.type) {
    case 'selector': case 'sequence': {
      const sel = node.type === 'selector', stop = sel ? F : S, mem = node.memory ? (c.a.mem[path] || (c.a.mem[path] = {})) : null; // memory: resume at the running child, skipping earlier checks
      for (let i = mem?.idx ?? 0; i < node.children.length; i++) { const r = run(node.children[i], `${path}.${i}`, c); if (r === R && mem) mem.idx = i; if (r !== stop) { if (mem && r !== R) delete mem.idx; return r; } }
      if (mem) delete mem.idx; return stop;
    }
    case 'invert': { const r = run(node.child, `${path}.0`, c); return r === S ? F : r === F ? S : R; }
    case 'succeeder': { const r = run(node.child, `${path}.0`, c); return r === R ? R : S; }
    case 'condition': { const f = CONDITIONS[node.test]; const v = !!f(c, node); return (node.not ? !v : v) ? S : F; }
    case 'cooldown': {
      const key = 'cd:' + (node.id || path); if ((c.a.cd[key] ?? -1) > c.time) return F;
      const r = run(node.child, `${path}.0`, c); if (r === S || (node.on === 'done' && r === F)) c.a.cd[key] = c.time + node.seconds; return r;
    }
    case 'weighted': {
      const mem = c.a.mem[path] || (c.a.mem[path] = {}); const w = node.children.map((ch, i) => Math.max(0, node.weights ? node.weights[i] ?? 0 : ch.weight ?? 1));
      if (mem.idx === undefined || (c.time >= (mem.until ?? 0) && !mem.running)) { const tot = w.reduce((s, x) => s + x, 0); if (tot <= 0) return F; let r = rngNext(c.a) * tot, k = 0; for (; k < w.length - 1; k++) { if (r < w[k]) break; r -= w[k]; } mem.idx = k; mem.until = c.time + (node.hold ?? 0); }
      const res = run(node.children[mem.idx], `${path}.${mem.idx}`, c); mem.running = res === R; if (res !== R && c.time >= mem.until) delete mem.idx; return res;
    }
    case 'utility': {
      const mem = c.a.mem[path] || (c.a.mem[path] = {}); let best = -1, bs = 0;
      node.options.forEach((o, i) => {
        let s = o.weight ?? 1; for (const k of o.consider || []) { const x = INPUTS[k.input](c), lo = k.min ?? 0, hi = k.max ?? 1; let v = clamp((x - lo) / (hi - lo || 1), 0, 1); if (k.invert) v = 1 - v; if (k.power) v = Math.pow(v, k.power); s *= v; }
        if (mem.idx === i) s *= node.stickiness ?? 1.2; if (s > bs + 1e-12) { bs = s; best = i; }
      });
      if (best < 0) { delete mem.idx; return F; } mem.idx = best; return run(node.options[best].node, `${path}.${best}`, c);
    }
    case 'action': { const mem = c.a.mem[path] || (c.a.mem[path] = {}); const r = ACTIONS[node.do](c, node, mem); if (r !== R) delete c.a.mem[path]; return r; }
    default: throw new Error(`unknown node type "${node.type}" at ${path}`);
  }
}
// One AI step. Mutates `a` (clock, perception, threat, cooldowns, rng) and returns the intent. Caller moves the agent and updates a.pos/a.facing/a.hp.
export function tickAgent(a, cfgIn, world, dt = DT) {
  const cfg = cfgIn.stats && cfgIn.perception && cfgIn.threat ? cfgIn : normalizeConfig(cfgIn);
  a.time += dt; perceive(a, cfg, world, dt);
  const c = mk(a, cfg, world, dt); c.time = a.time;
  if (cfg.tree) run(cfg.tree, 'r', c);
  for (const k of Object.keys(a.mem)) if (!c.touched.has(k)) delete a.mem[k];
  const parts = [...c.steer], sep = cfg.steering.separation;
  if (sep && world.agents) { const near = world.agents.filter((o) => o.id !== a.id).map((o) => o.pos), s = separation(a.pos, near, sep.radius); if (s.speed > 0) parts.push({ ...s, weight: sep.weight }); }
  const m = combine(parts, 1), I = c.intent; I.moveDir = m.dir; I.speed = rnd(m.speed, 1e6); a.state = I.state;
  if (!I.lookAt && c.target) I.lookAt = [...c.target.pos];
  return I;
}
// Tick many agents in id order (deterministic token grabbing), with group slots refreshed first. world.group optional; configs: {name: config}.
export function tickAll(agents, configs, world, dt = DT) {
  const sorted = [...agents].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0)), out = {};
  for (const a of sorted) a.role = a.role || normalizeConfig(configs[a.config]).role;
  const w = { ...world, agents: sorted };
  if (world.group) { const tp = (world.targets || [])[0]; groupUpdate(world.group, sorted, tp ? tp.pos : null, sorted.length ? sorted[0].time + dt : 0, dt); }
  for (const a of sorted) out[a.id] = tickAgent(a, configs[a.config], w, dt);
  return out;
}
// Kinematic stand-in for locomotion (used by simulate/tests): moves along moveDir at speed*stats.moveSpeed, turns facing toward lookAt.
export function integrate(a, cfg, I, dt = DT) {
  const n = cfg.stats ? cfg : normalizeConfig(cfg), v = I.speed * n.stats.moveSpeed * dt; a.pos[0] += I.moveDir[0] * v; a.pos[2] += I.moveDir[2] * v;
  const want = I.lookAt ? dir2(a.pos, I.lookAt) : I.speed > 0 ? I.moveDir : null;
  if (want && (want[0] || want[2])) { const k = Math.min(1, n.stats.turnRate * dt); a.facing = unit2([a.facing[0] + (want[0] - a.facing[0]) * k, 0, a.facing[2] + (want[2] - a.facing[2]) * k]); if (!a.facing[0] && !a.facing[2]) a.facing = want; }
}

// ---------- validation ----------
export function validateConfig(cfg, label = 'config') {
  const errors = [], warnings = [], err = (p, m) => errors.push(`${p}: ${m}`);
  if (!cfg || typeof cfg !== 'object') return { ok: false, errors: [`${label}: must be an object`], warnings };
  if (cfg.version !== undefined && cfg.version !== VERSION) err(`${label}.version`, `must be ${VERSION}`);
  if (cfg.role !== undefined && !['melee', 'ranged', 'charger', 'support'].includes(cfg.role)) err(`${label}.role`, 'must be melee|ranged|charger|support');
  const moves = cfg.moves || {}, num = (p, v, lo = 0) => { if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v >= lo)) err(p, `must be a number >= ${lo}`); };
  for (const [k, v] of Object.entries(cfg.stats || {})) num(`${label}.stats.${k}`, v, 0);
  for (const [k, v] of Object.entries(cfg.perception || {})) num(`${label}.perception.${k}`, v, 0);
  if (cfg.perception?.fovDeg > 360) err(`${label}.perception.fovDeg`, 'must be <= 360');
  for (const [id, m] of Object.entries(moves)) { num(`${label}.moves.${id}.cooldown`, m.cooldown); num(`${label}.moves.${id}.duration`, m.duration); num(`${label}.moves.${id}.tokens`, m.tokens); if (m.range && (m.range.min ?? 0) > (m.range.max ?? 2)) err(`${label}.moves.${id}.range`, 'min > max'); }
  if (!cfg.tree) err(`${label}.tree`, 'required');
  const seenIds = new Set();
  const walk = (n, p, depth) => {
    if (depth > 32) return err(p, 'tree deeper than 32');
    if (!n || typeof n !== 'object') return err(p, 'node must be an object');
    const kids = (k) => { if (!Array.isArray(n[k]) || !n[k].length) err(`${p}.${k}`, 'needs a non-empty array'); else n[k].forEach((c, i) => walk(c, `${p}.${k}[${i}]`, depth + 1)); };
    switch (n.type) {
      case 'selector': case 'sequence': kids('children'); if (n.memory !== undefined && typeof n.memory !== 'boolean') err(`${p}.memory`, 'must be boolean'); break;
      case 'invert': case 'succeeder': n.child ? walk(n.child, `${p}.child`, depth + 1) : err(`${p}.child`, 'required'); break;
      case 'cooldown': num(`${p}.seconds`, n.seconds); if (n.seconds === undefined) err(`${p}.seconds`, 'required'); if (n.id) { if (seenIds.has(n.id)) err(`${p}.id`, `duplicate cooldown id "${n.id}"`); seenIds.add(n.id); } n.child ? walk(n.child, `${p}.child`, depth + 1) : err(`${p}.child`, 'required'); break;
      case 'weighted': kids('children'); if (n.weights && (!Array.isArray(n.weights) || n.weights.length !== n.children?.length || n.weights.some((x) => !(x >= 0)))) err(`${p}.weights`, 'must match children length and be >= 0'); break;
      case 'utility':
        if (!Array.isArray(n.options) || !n.options.length) err(`${p}.options`, 'needs a non-empty array');
        else n.options.forEach((o, i) => { (o.consider || []).forEach((k, j) => { if (!INPUTS[k.input]) err(`${p}.options[${i}].consider[${j}].input`, `unknown input "${k.input}" (${Object.keys(INPUTS).join(', ')})`); if (k.min !== undefined && k.max !== undefined && k.min === k.max) err(`${p}.options[${i}].consider[${j}]`, 'min equals max'); }); o.node ? walk(o.node, `${p}.options[${i}].node`, depth + 1) : err(`${p}.options[${i}].node`, 'required'); });
        break;
      case 'condition': if (!CONDITIONS[n.test]) err(`${p}.test`, `unknown condition "${n.test}" (${Object.keys(CONDITIONS).join(', ')})`); if (['moveReady'].includes(n.test) && !moves[n.move]) err(`${p}.move`, `unknown move "${n.move}"`); break;
      case 'action':
        if (!ACTIONS[n.do]) err(`${p}.do`, `unknown action "${n.do}" (${ACTION_NAMES.join(', ')})`);
        if (n.do === 'attack' && !moves[n.move]) err(`${p}.move`, `unknown move "${n.move}"`);
        if (n.do === 'charge' && n.hitMove && !moves[n.hitMove]) err(`${p}.hitMove`, `unknown move "${n.hitMove}"`);
        for (const k of ['speed', 'radius', 'windup', 'recover', 'dist', 'min', 'max', 'stop']) num(`${p}.${k}`, n[k]);
        if (n.min !== undefined && n.max !== undefined && n.min > n.max) err(p, 'min > max');
        break;
      default: err(`${p}.type`, `unknown node type "${n.type}"`);
    }
  };
  if (cfg.tree) walk(cfg.tree, `${label}.tree`, 0);
  if (!cfg.perception) warnings.push(`${label}: no perception block; defaults apply (sight 15m, fov 110)`);
  return { ok: errors.length === 0, errors, warnings };
}

// ---------- scripted simulation (headless) ----------
function targetAt(path, t) {
  if (!path.length) return [0, 0, 0]; if (t <= path[0].t) return [...path[0].pos];
  for (let i = 1; i < path.length; i++) if (t <= path[i].t) { const a = path[i - 1], b = path[i], k = (t - a.t) / (b.t - a.t || 1); return [a.pos[0] + (b.pos[0] - a.pos[0]) * k, a.pos[1] + (b.pos[1] - a.pos[1]) * k, a.pos[2] + (b.pos[2] - a.pos[2]) * k]; }
  return [...path[path.length - 1].pos];
}
// scenario: {configs, agents:[{id,config,pos,facing?,role?,hp?}], group?, world?:{walls,grid,waypoints}, target:{id,path:[{t,pos}],noise?}, sounds?, events?, duration, seed?, dt?}
export function simulate(sc) {
  const dt = sc.dt ?? DT, steps = Math.round(sc.duration / dt), seed = sc.seed ?? 1, configs = {};
  for (const [k, v] of Object.entries(sc.configs)) configs[k] = normalizeConfig(v);
  const walls = sc.world?.walls || [], world0 = {};
  if (walls.length) world0.bvh = bvhFromBoxes(walls);
  if (sc.world?.grid) world0.nav = gridFromBoxes(walls, sc.world.grid); else if (sc.world?.waypoints) world0.nav = createWaypointNav(sc.world.waypoints);
  if (sc.group) world0.group = createGroup(sc.group);
  const agents = sc.agents.map((s, i) => createAgent({ ...s, seed: s.seed ?? ((seed * 7919 + i * 104729) >>> 0) })), tl = [], last = {}, attacks = {};
  const tgt = sc.target, stat = { maxTokens: 0, maxSimultaneousAttacks: 0, ticks: steps }; let h = 2166136261;
  const mix = (s) => { for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } };
  for (let s = 0; s < steps; s++) {
    const t = rnd(s * dt, 1e9), world = { ...world0, time: t, targets: tgt ? [{ id: tgt.id, pos: targetAt(tgt.path, t), noise: tgt.noise ?? 0 }] : [] };
    world.sounds = (sc.sounds || []).filter((e) => e.t >= t - 1e-9 && e.t < t + dt - 1e-9); world.events = (sc.events || []).filter((e) => e.t >= t - 1e-9 && e.t < t + dt - 1e-9);
    const intents = tickAll(agents, configs, world, dt); let atk = 0;
    for (const a of [...agents].sort((p, q) => (p.id < q.id ? -1 : 1))) {
      const I = intents[a.id]; integrate(a, configs[a.config], I, dt);
      const key = `${I.state}|${I.wantAttack || ''}|${I.target || ''}`; if (I.wantAttack) { atk++; attacks[a.id] = (attacks[a.id] || 0) + 1; }
      if (last[a.id] !== key) { last[a.id] = key; tl.push({ t: rnd(t + dt, 1e6), agent: a.id, state: I.state, wantAttack: I.wantAttack, target: I.target, pos: a.pos.map((v) => rnd(v, 1e3)) }); }
      mix(`${a.id}|${I.state}|${I.wantAttack || ''}|${rnd(a.pos[0])}|${rnd(a.pos[2])}|`);
    }
    stat.maxSimultaneousAttacks = Math.max(stat.maxSimultaneousAttacks, atk);
    if (world0.group) stat.maxTokens = Math.max(stat.maxTokens, Object.keys(world0.group.tokens).filter((k) => world0.group.tokens[k] > t + dt).length);
  }
  return { duration: sc.duration, steps, hash: (h >>> 0).toString(16).padStart(8, '0'), timeline: tl, attacks, stats: stat, final: agents.map((a) => ({ id: a.id, pos: a.pos.map((v) => rnd(v, 1e3)), state: a.state, target: a.target })) };
}
