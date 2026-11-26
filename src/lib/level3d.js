// level3d: JSON level format -> collision triangle soup + BVH + multi-layer walkable-grid nav (ai3d NavProvider), with validation and
// reachability analysis. Pure, deterministic, zero deps beyond bvh.js/collision3d.js. Y-up, metres. Spec: spec/v4/level3d.md.
import * as BVH from './bvh.js';
import { aabbTriangleOverlap } from './collision3d.js';

export const VERSION = 1;
export const PIECE_TYPES = ['box', 'ramp', 'heightmap', 'glb'];
export const SPAWN_KINDS = ['player', 'enemy', 'boss', 'pickup', 'npc', 'prop'];
export const HAZARD_KINDS = ['flood', 'vortex', 'debris', 'gas', 'lava', 'spikes', 'void', 'water'];
export const SHAPES = ['box', 'sphere', 'cylinder'];
export const DEFAULT_BODY = { radius: 0.4, height: 1.8, stepHeight: 0.35, slopeLimitDeg: 50 };
export const DEFAULT_CELL = 0.5;
const RAD = Math.PI / 180, SQ2 = Math.SQRT2;

// ---------- small helpers ----------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n = 3) => Array.isArray(v) && v.length === n && v.every(isNum);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r3 = (v) => Math.round(v * 1e3) / 1e3;
export function hashBytes(u8) { // two FNV-1a 32-bit lanes -> 16 hex chars
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < u8.length; i++) { a ^= u8[i]; a = Math.imul(a, 16777619); b ^= u8[i]; b = Math.imul(b, 0x85ebca6b); b ^= b >>> 13; }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
const enc = new TextEncoder();
export const hashString = (s) => hashBytes(enc.encode(s));
const f32bytes = (arr) => new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
export function canonical(v) { // key-sorted JSON so hashes do not depend on property order
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function bodyOf(level, opts = {}) {
  const src = opts.locomotion?.body || opts.locomotion || level.locomotion?.body || level.locomotion || {};
  return { ...DEFAULT_BODY, ...Object.fromEntries(Object.entries(src).filter(([k, v]) => k in DEFAULT_BODY && isNum(v))) };
}

// ---------- geometry ----------
const BOX_QUADS = [[1, 3, 7, 5], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [0, 2, 3, 1]];
function placer(pos, yaw = 0) { // rotate about +Y by yaw degrees (Godot convention), then translate
  const c = Math.cos(yaw * RAD), s = Math.sin(yaw * RAD);
  return (x, y, z) => [pos[0] + c * x + s * z, pos[1] + y, pos[2] - s * x + c * z];
}
function boxTris(pos, size, yaw) {
  const P = placer(pos, yaw), h = size.map((v) => v / 2), out = [];
  const V = []; for (let k = 0; k < 8; k++) V.push(P((k & 1 ? 1 : -1) * h[0], (k & 2 ? 1 : -1) * h[1], (k & 4 ? 1 : -1) * h[2]));
  for (const [a, b, c, d] of BOX_QUADS) out.push([V[a], V[b], V[c]], [V[a], V[c], V[d]]);
  return out;
}
function rampTris(pos, size, yaw) { // climbs toward local +Z: low edge at -Z (y = -h/2), high back wall at +Z
  const P = placer(pos, yaw), [w, h, l] = size.map((v) => v / 2);
  const A = P(-w, -h, -l), B = P(w, -h, -l), C = P(-w, -h, l), D = P(w, -h, l), E = P(-w, h, l), F = P(w, h, l);
  const q = (a, b, c, d) => [[a, b, c], [a, c, d]];
  return [...q(B, A, E, F), ...q(C, D, F, E), ...q(A, B, D, C), [A, C, E], [B, F, D]];
}
function heightmapTris(pos, cs, rows) {
  const out = [], V = (i, j) => [pos[0] + i * cs, pos[1] + rows[j][i], pos[2] + j * cs];
  for (let j = 0; j + 1 < rows.length; j++) for (let i = 0; i + 1 < rows[0].length; i++) {
    const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1); out.push([a, d, c], [a, c, b]);
  }
  return out;
}
export function pieceTriangles(p) {
  const yaw = p.yaw || 0;
  if (p.type === 'box') return boxTris(p.pos, p.size, yaw);
  if (p.type === 'ramp') return rampTris(p.pos, p.size, yaw);
  if (p.type === 'heightmap') return heightmapTris(p.pos, p.cellSize, p.heights);
  if (p.type === 'glb') { const off = p.proxy.offset || [0, 0, 0], P = placer(p.pos, yaw), o = P(...off); return boxTris(o, p.proxy.size, yaw); }
  return [];
}
const triNormal = (T, o) => {
  const ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2], vx = T[o + 6] - T[o], vy = T[o + 7] - T[o + 1], vz = T[o + 8] - T[o + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
};

// ---------- validation (structure) ----------
const idList = (arr) => (Array.isArray(arr) ? arr.map((x) => x && x.id) : []);
function dupCheck(errors, arr, name) { const seen = new Set(); (arr || []).forEach((x, k) => { if (!x || typeof x.id !== 'string' || !x.id) errors.push(`${name}[${k}].id: required non-empty string`); else if (seen.has(x.id)) errors.push(`${name}[${k}].id: duplicate "${x.id}"`); else seen.add(x.id); }); }
function shapeCheck(errors, x, path) {
  if (!SHAPES.includes(x.shape)) { errors.push(`${path}.shape: must be one of ${SHAPES.join(', ')}`); return; }
  if (!isVec(x.pos)) errors.push(`${path}.pos: needs [x,y,z]`);
  if (x.shape === 'box' && !(isVec(x.size) && x.size.every((v) => v > 0))) errors.push(`${path}.size: box needs positive [x,y,z]`);
  if (x.shape !== 'box' && !(x.radius > 0)) errors.push(`${path}.radius: must be > 0`);
  if (x.shape === 'cylinder' && !(x.height > 0)) errors.push(`${path}.height: cylinder needs height > 0`);
}
export function validateStructure(level, opts = {}) {
  const errors = [], warnings = [], L = level;
  if (!L || typeof L !== 'object' || Array.isArray(L)) return { errors: ['level: must be an object'], warnings };
  if (L.version !== VERSION) errors.push(`version: must be ${VERSION}`);
  if (typeof L.id !== 'string' || !L.id) errors.push('id: required string');
  const b = L.bounds;
  if (!b || !isVec(b.min) || !isVec(b.max) || b.max.some((v, k) => v <= b.min[k])) errors.push('bounds: needs {min:[x,y,z], max:[x,y,z]} with max > min on every axis');
  const body = bodyOf(L, opts);
  if (body.stepHeight >= body.height) errors.push('locomotion: stepHeight must be < height');
  const cs = L.nav?.cellSize ?? DEFAULT_CELL;
  if (!(cs >= 0.1 && cs <= 4)) errors.push('nav.cellSize: must be in [0.1, 4]');
  else if (b && isVec(b.min) && isVec(b.max)) { const cells = Math.ceil((b.max[0] - b.min[0]) / cs) * Math.ceil((b.max[2] - b.min[2]) / cs); if (cells > (opts.maxCells ?? 1.5e6)) errors.push(`nav: ${cells} cells exceeds the cap; raise nav.cellSize or shrink bounds`); if (cs > 2 * body.radius + 0.001) warnings.push(`nav.cellSize ${cs} > 2*radius: thin walls between cell centres may be crossed`); }
  const pieces = L.pieces; if (!Array.isArray(pieces) || !pieces.length) errors.push('pieces: needs at least one piece'); else {
    dupCheck(errors, pieces, 'pieces');
    pieces.forEach((p, k) => {
      const at = `pieces[${k}]`; if (!p || typeof p !== 'object') { errors.push(`${at}: must be an object`); return; }
      if (!PIECE_TYPES.includes(p.type)) { errors.push(`${at}.type: must be one of ${PIECE_TYPES.join(', ')}`); return; }
      if (!isVec(p.pos)) errors.push(`${at}.pos: needs [x,y,z]`);
      if (p.yaw !== undefined && !isNum(p.yaw)) errors.push(`${at}.yaw: must be a number (degrees)`);
      if (p.type === 'box' || p.type === 'ramp') { if (!(isVec(p.size) && p.size.every((v) => v > 0))) errors.push(`${at}.size: needs positive [x,y,z]`); }
      if (p.type === 'heightmap') {
        if (!(p.cellSize > 0)) errors.push(`${at}.cellSize: must be > 0`);
        if (!Array.isArray(p.heights) || p.heights.length < 2 || !p.heights.every((r) => Array.isArray(r) && r.length === p.heights[0].length && r.length >= 2 && r.every(isNum))) errors.push(`${at}.heights: needs >= 2 equal-length rows (z) of >= 2 numbers (x)`);
      }
      if (p.type === 'glb') {
        if (typeof p.asset !== 'string' || !/\.glb$/i.test(p.asset)) errors.push(`${at}.asset: must be a .glb path`);
        if (!(isVec(p.proxy?.size) && p.proxy.size.every((v) => v > 0))) errors.push(`${at}.proxy.size: glb pieces need a collision proxy box {size:[x,y,z], offset?:[x,y,z]}`);
        else if (p.proxy.offset !== undefined && !isVec(p.proxy.offset)) errors.push(`${at}.proxy.offset: needs [x,y,z]`);
        if (opts.refs?.assets && !opts.refs.assets.includes(p.asset)) errors.push(`${at}.asset: "${p.asset}" does not resolve`);
      }
    });
  }
  dupCheck(errors, L.spawns, 'spawns'); dupCheck(errors, L.triggers, 'triggers'); dupCheck(errors, L.hazards, 'hazards'); dupCheck(errors, L.checkpoints, 'checkpoints');
  (L.spawns || []).forEach((s, k) => {
    if (!SPAWN_KINDS.includes(s?.kind)) errors.push(`spawns[${k}].kind: must be one of ${SPAWN_KINDS.join(', ')}`); if (!isVec(s?.pos)) errors.push(`spawns[${k}].pos: needs [x,y,z]`);
    if (s?.kind === 'enemy' && opts.refs?.ai && s.config && !opts.refs.ai.includes(s.config)) errors.push(`spawns[${k}].config: unknown ai3d config "${s.config}"`);
    if (s?.kind === 'boss' && opts.refs?.boss && s.boss && !opts.refs.boss.includes(s.boss)) errors.push(`spawns[${k}].boss: unknown boss3d definition "${s.boss}"`);
  });
  if (!(L.spawns || []).some((s) => s?.kind === 'player')) errors.push('spawns: needs at least one kind "player" spawn');
  const hz = new Set(idList(L.hazards)), sp = new Set(idList(L.spawns)), cp = new Set(idList(L.checkpoints));
  (L.triggers || []).forEach((t, k) => {
    shapeCheck(errors, t || {}, `triggers[${k}]`); if (typeof t?.event !== 'string' || !t.event) errors.push(`triggers[${k}].event: required string`);
    for (const id of t?.activates || []) if (!hz.has(id) && !sp.has(id)) errors.push(`triggers[${k}].activates: "${id}" is not a hazard or spawn id`);
  });
  (L.hazards || []).forEach((h, k) => {
    shapeCheck(errors, h || {}, `hazards[${k}]`); if (!HAZARD_KINDS.includes(h?.kind)) errors.push(`hazards[${k}].kind: must be one of ${HAZARD_KINDS.join(', ')}`);
    if (h?.dps !== undefined && !(h.dps >= 0)) errors.push(`hazards[${k}].dps: must be >= 0`);
    if (h?.ref !== undefined && typeof h.ref !== 'string') errors.push(`hazards[${k}].ref: must be a string (boss3d hazard id or vfx id)`);
    else if (h?.ref && opts.refs?.hazards && !opts.refs.hazards.includes(h.ref)) errors.push(`hazards[${k}].ref: unknown hazard/vfx id "${h.ref}"`);
    if (h?.startActive === false && !(L.triggers || []).some((t) => (t.activates || []).includes(h.id)) && !L.arena?.hazards?.includes(h.id)) warnings.push(`hazards[${k}]: startActive=false but nothing activates "${h.id}"`);
  });
  (L.checkpoints || []).forEach((c, k) => { if (!isVec(c?.pos)) errors.push(`checkpoints[${k}].pos: needs [x,y,z]`); if (!(c?.radius > 0)) errors.push(`checkpoints[${k}].radius: must be > 0`); if (c?.respawn !== undefined && !sp.has(c.respawn)) errors.push(`checkpoints[${k}].respawn: "${c.respawn}" is not a spawn id`); });
  const a = L.arena;
  if (a !== undefined) {
    if (a.shape === 'circle') { if (!(isVec(a.center, 2) && a.radius > 0)) errors.push('arena: circle needs center [x,z] and radius > 0'); }
    else if (a.shape === 'box') { if (!(isVec(a.min, 2) && isVec(a.max, 2) && a.max[0] > a.min[0] && a.max[1] > a.min[1])) errors.push('arena: box needs min [x,z] and max [x,z] with max > min'); }
    else errors.push('arena.shape: must be "circle" or "box"');
    if (a.boss !== undefined && !sp.has(a.boss)) errors.push(`arena.boss: "${a.boss}" is not a spawn id`);
    for (const id of a.hazards || []) if (!hz.has(id)) errors.push(`arena.hazards: "${id}" is not a hazard id`);
    for (const [k, g] of (a.gates || []).entries()) if (!(isVec(g?.pos) && g.radius > 0)) errors.push(`arena.gates[${k}]: needs pos [x,y,z] and radius > 0`);
    if (a.seed !== undefined && !isVec(a.seed)) errors.push('arena.seed: needs [x,y,z]');
    if (a.closed !== false && !a.boss && !(a.seed || a.center)) warnings.push('arena: no boss/seed to start the closure check from');
  }
  for (const [k, l] of (L.nav?.links || []).entries()) if (!(isVec(l?.from) && isVec(l?.to))) errors.push(`nav.links[${k}]: needs from and to [x,y,z]`);
  for (const [k, bl] of (L.nav?.blockers || []).entries()) if (!(isVec(bl?.min) && isVec(bl?.max))) errors.push(`nav.blockers[${k}]: needs min and max [x,y,z]`);
  return { errors, warnings };
}

// ---------- bake: collision soup + BVH ----------
export function collisionSoup(level) {
  const flat = [], ranges = []; let n = 0;
  for (const p of level.pieces) {
    if (p.collide === false) continue; const tris = pieceTriangles(p), start = n;
    for (const t of tris) { for (const v of t) flat.push(Math.fround(r6(v[0])), Math.fround(r6(v[1])), Math.fround(r6(v[2]))); n++; }
    ranges.push({ id: p.id, start, count: tris.length });
  }
  return { tris: Float32Array.from(flat), ranges, count: n };
}

// ---------- navigation: multi-layer walkable grid ----------
class Heap {
  constructor() { this.a = []; }
  less(p, q) { return p[0] < q[0] || (p[0] === q[0] && (p[1] < q[1] || (p[1] === q[1] && p[2] < q[2]))); }
  push(e) { const a = this.a; let i = a.length; a.push(e); while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
// data: {kind:'level-nav', version, origin:[x,z], cellSize, width, height, body, nodes:{i:[],j:[],y:[]}, edges:[[a,b,cost?]...]} (a<b, undirected)
export function createLevelNav(data) {
  const { origin, cellSize: cs, width: W, height: H } = data, N = data.nodes.y.length, ni = data.nodes.i, nj = data.nodes.j, ny = data.nodes.y;
  const byCell = new Map(), adj = Array.from({ length: N }, () => []), eset = new Set();
  for (let n = 0; n < N; n++) { const k = nj[n] * W + ni[n]; (byCell.get(k) || byCell.set(k, []).get(k)).push(n); }
  const pos = (n) => [origin[0] + (ni[n] + 0.5) * cs, ny[n], origin[1] + (nj[n] + 0.5) * cs];
  const add = (a, b) => { if (a === b || eset.has(a * N + b)) return; eset.add(a * N + b); eset.add(b * N + a); adj[a].push(b); adj[b].push(a); };
  for (const [a, b] of data.edges) add(a, b);
  for (const l of adj) l.sort((p, q) => p - q);
  const cx = (x) => Math.floor((x - origin[0]) / cs), cz = (z) => Math.floor((z - origin[1]) / cs);
  const cellNodes = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? [] : byCell.get(j * W + i) || []);
  function nearest(p, snap = 4, maxDy = Infinity) { // ring search; within a ring prefer smallest 3D distance, ties lowest id
    const ci = cx(p[0]), cj = cz(p[2]);
    for (let r = 0; r <= snap; r++) {
      let best = -1, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) { if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; for (const n of cellNodes(i, j)) { const q = pos(n), dy = Math.abs(q[1] - p[1]); if (dy > maxDy) continue; const d = (q[0] - p[0]) ** 2 + (q[2] - p[2]) ** 2 + 4 * dy * dy; if (d < bd) { bd = d; best = n; } } }
      if (best >= 0) return best;
    }
    return -1;
  }
  function isClear(a, b) {
    let cur = nearest(a, 0, 1.0); if (cur < 0) return false;
    const dx = b[0] - a[0], dz = b[2] - a[2], d = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(d / (cs * 0.5)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, x = a[0] + dx * t, z = a[2] + dz * t, y = a[1] + (b[1] - a[1]) * t, ci = cx(x), cj = cz(z); let best = -1, bd = Infinity;
      for (const n of cellNodes(ci, cj)) if (n === cur || eset.has(cur * N + n)) { const dy = Math.abs(ny[n] - y); if (dy < bd) { bd = dy; best = n; } }
      if (best < 0) return false; cur = best;
    }
    return true;
  }
  function findPath(from, to, opts = {}) {
    const s = nearest(from, opts.snap ?? 4), g = nearest(to, opts.snap ?? 4); if (s < 0 || g < 0) return null;
    const gc = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N), G = pos(g);
    const hf = (n) => { const p = pos(n); return Math.hypot(p[0] - G[0], p[1] - G[1], p[2] - G[2]); };
    const heap = new Heap(); gc[s] = 0; heap.push([hf(s), hf(s), s]); let exp = 0; const cap = opts.maxNodes ?? N;
    while (heap.size && exp++ < cap) {
      const [, , cur] = heap.pop(); if (closed[cur]) continue; closed[cur] = 1; if (cur === g) break; const P = pos(cur);
      for (const n of adj[cur]) { const Q = pos(n), c = gc[cur] + Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]); if (c < gc[n]) { gc[n] = c; par[n] = cur; heap.push([c + hf(n), hf(n), n]); } }
    }
    if (gc[g] === Infinity) return null;
    const chain = []; for (let k = g; k !== -1; k = par[k]) chain.push(pos(k)); chain.reverse();
    const pts = []; let cur = [from[0], pos(s)[1], from[2]], k = 0;
    while (k < chain.length) { let far = k; for (let m = chain.length - 1; m > k; m--) if (isClear(cur, chain[m])) { far = m; break; } pts.push(chain[far]); cur = chain[far]; k = far + 1; }
    if (cx(to[0]) === ni[g] && cz(to[2]) === nj[g] && pts.length) pts[pts.length - 1] = [to[0], ny[g], to[2]];
    return pts.length ? pts : [[to[0], ny[g], to[2]]];
  }
  function flood(starts) { // reachable node mask from node ids
    const seen = new Uint8Array(N), q = []; for (const s of starts) if (s >= 0 && !seen[s]) { seen[s] = 1; q.push(s); }
    for (let h = 0; h < q.length; h++) for (const n of adj[q[h]]) if (!seen[n]) { seen[n] = 1; q.push(n); }
    return seen;
  }
  const walkable = (p) => nearest(p, 0, 1.0) >= 0;
  return { kind: 'level-nav', findPath, isClear, walkable, nearest, flood, pos, adj, nodeCount: N, cellSize: cs, data, toJSON: () => data };
}
export const navFromJSON = (j) => createLevelNav(j);

export function bakeNav(level, bvh, tris, opts = {}) {
  const body = bodyOf(level, opts), cs = level.nav?.cellSize ?? DEFAULT_CELL, B = level.bounds;
  const origin = [B.min[0], B.min[2]], W = Math.ceil((B.max[0] - B.min[0]) / cs), H = Math.ceil((B.max[2] - B.min[2]) / cs);
  const cosS = Math.cos(body.slopeLimitDeg * RAD), tanS = Math.tan(body.slopeLimitDeg * RAD), walk = new Uint8Array(tris.length / 9);
  for (let t = 0; t < walk.length; t++) walk[t] = triNormal(tris, t * 9)[1] >= cosS - 1e-9 ? 1 : 0;
  const blockers = level.nav?.blockers || [], nodes = { i: [], j: [], y: [] }, eps = 1e-4;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = origin[0] + (i + 0.5) * cs, z = origin[1] + (j + 0.5) * cs, floors = [];
    for (const t of BVH.queryAABB(bvh, { min: [x - eps, B.min[1], z - eps], max: [x + eps, B.max[1], z + eps] })) {
      if (!walk[t]) continue; const o = t * 9, ax = tris[o], az = tris[o + 2], bx = tris[o + 3], bz = tris[o + 5], qx = tris[o + 6], qz = tris[o + 8];
      const den = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz); if (Math.abs(den) < 1e-12) continue;
      const u = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / den, v = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / den, w = 1 - u - v, e = 1e-7;
      if (u < -e || v < -e || w < -e) continue; floors.push(u * tris[o + 1] + v * tris[o + 4] + w * tris[o + 7]);
    }
    floors.sort((p, q) => p - q); const kept = []; for (const f of floors) if (!kept.length || f - kept[kept.length - 1] > 0.02) kept.push(f);
    for (const f of kept) {
      if (f < B.min[1] || f > B.max[1]) continue;
      if (blockers.some((b) => x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && f >= b.min[1] && f <= b.max[1])) continue;
      const box = { min: [x - body.radius, f + body.stepHeight + 0.01, z - body.radius], max: [x + body.radius, f + body.height, z + body.radius] };
      if (BVH.queryAABB(bvh, box).some((t) => !walk[t])) continue;
      nodes.i.push(i); nodes.j.push(j); nodes.y.push(r3(f));
    }
  }
  const N = nodes.y.length, cells = new Map(); for (let n = 0; n < N; n++) { const k = nodes.j[n] * W + nodes.i[n]; (cells.get(k) || cells.set(k, []).get(k)).push(n); }
  const ok = (a, b, dist) => { const dy = Math.abs(nodes.y[a] - nodes.y[b]); return dy <= body.stepHeight + 1e-9 || dy / dist <= tanS + 1e-9; };
  const E = new Set(), key = (a, b) => (a < b ? a * N + b : b * N + a), at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? [] : cells.get(j * W + i) || []);
  for (let n = 0; n < N; n++) for (const [di, dj] of [[1, 0], [0, 1]]) for (const m of at(nodes.i[n] + di, nodes.j[n] + dj)) if (ok(n, m, cs)) E.add(key(n, m));
  for (let n = 0; n < N; n++) for (const [di, dj] of [[1, 1], [-1, 1]]) for (const m of at(nodes.i[n] + di, nodes.j[n] + dj)) {
    if (!ok(n, m, cs * SQ2)) continue; // no corner cutting: both orthogonal routes must exist
    const c1 = at(nodes.i[n] + di, nodes.j[n]), c2 = at(nodes.i[n], nodes.j[n] + dj);
    if (c1.some((c) => E.has(key(n, c)) && E.has(key(c, m))) && c2.some((c) => E.has(key(n, c)) && E.has(key(c, m)))) E.add(key(n, m));
  }
  const edges = [...E].map((k) => [Math.floor(k / N), k % N]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const data = { kind: 'level-nav', version: 1, origin, cellSize: cs, width: W, height: H, body, nodes, edges };
  let nav = createLevelNav(data); const linkReport = [], extra = [];
  for (const [k, l] of (level.nav?.links || []).entries()) {
    const a = nav.nearest(l.from, 2, 1.0), b = nav.nearest(l.to, 2, 1.0);
    if (a < 0 || b < 0) { linkReport.push(`nav.links[${k}]: ${a < 0 ? 'from' : 'to'} does not snap to a walkable node`); continue; }
    extra.push([Math.min(a, b), Math.max(a, b)]);
  }
  if (extra.length) { data.edges = [...data.edges, ...extra].sort((p, q) => p[0] - q[0] || p[1] - q[1]).filter((e, k, A) => !k || e[0] !== A[k - 1][0] || e[1] !== A[k - 1][1]); nav = createLevelNav(data); }
  return { nav, data, linkProblems: linkReport };
}

export function bake(level, opts = {}) {
  const st = validateStructure(level, opts); if (st.errors.length) throw Object.assign(new Error(`level has ${st.errors.length} structural problem(s): ${st.errors[0]}`), { code: 'BAD_INPUT', details: st.errors });
  const soup = collisionSoup(level), bvh = BVH.buildTriangles(soup.tris), bvhBuffer = BVH.serialize(bvh);
  const { nav, data, linkProblems } = bakeNav(level, bvh, soup.tris, opts);
  const navJson = JSON.stringify(data);
  const hash = hashBytes(enc.encode([hashBytes(f32bytes(soup.tris)), hashBytes(new Uint8Array(bvhBuffer)), hashString(navJson), hashString(canonical({ id: level.id, body: data.body, cs: data.cellSize }))].join('|')));
  return { id: level.id, tris: soup.tris, triCount: soup.count, ranges: soup.ranges, bvh, bvhBuffer, nav, navData: data, linkProblems, hash, stats: { pieces: level.pieces.length, triangles: soup.count, navNodes: nav.nodeCount, navEdges: data.edges.length, bvhBytes: bvhBuffer.byteLength, cells: data.width * data.height }, body: data.body };
}

// ---------- analysis: ground, reachability, arena closure ----------
export function groundAt(baked, x, y, z, maxDrop = 50) {
  const h = BVH.raycast(baked.bvh, [x, y, z], [0, -1, 0], { tmax: maxDrop }); return h ? y - h.t : null;
}
const inArena = (a, x, z, pad = 0) => (a.shape === 'circle' ? Math.hypot(x - a.center[0], z - a.center[1]) <= a.radius + pad : x >= a.min[0] - pad && x <= a.max[0] + pad && z >= a.min[1] - pad && z <= a.max[1] + pad);
export function analyze(level, baked, opts = {}) {
  const errors = [], warnings = [], nav = baked.nav, cs = baked.navData.cellSize, tol = level.nav?.groundTolerance ?? 0.5;
  for (const p of baked.linkProblems) warnings.push(p);
  const place = (e, path, label) => { // returns node id or -1; records ground problems
    if (e.flying) return -2;
    const g = groundAt(baked, e.pos[0], e.pos[1] + 0.3, e.pos[2]);
    if (g === null) { errors.push(`${path}: ${label} "${e.id}" has no ground below it (over a void)`); return -1; }
    if (e.pos[1] - g > tol) { errors.push(`${path}: ${label} "${e.id}" floats ${r3(e.pos[1] - g)} m above the ground (y=${e.pos[1]}, ground y=${r3(g)})`); return -1; }
    const n = nav.nearest([e.pos[0], g, e.pos[2]], 1, 0.6);
    if (n < 0) { errors.push(`${path}: ${label} "${e.id}" stands on ground with no walkable nav node (blocked, too steep or no headroom)`); return -1; }
    return n;
  };
  const players = [], spawnNode = new Map();
  (level.spawns || []).forEach((s, k) => { const n = place(s, `spawns[${k}]`, `${s.kind} spawn`); spawnNode.set(s.id, n); if (s.kind === 'player' && n >= 0) players.push(n); });
  const cpNode = new Map(); (level.checkpoints || []).forEach((c, k) => cpNode.set(c.id, place({ ...c, id: c.id }, `checkpoints[${k}]`, 'checkpoint')));
  const seen = nav.flood(players), unreachable = [], reached = [];
  const chk = (id, n, kind, path, soft) => { if (n === -2 || n < 0) return; if (seen[n]) reached.push(id); else { unreachable.push({ id, kind }); (soft ? warnings : errors).push(`${path}: ${kind} "${id}" is not reachable from any player spawn`); } };
  (level.spawns || []).forEach((s, k) => { if (s.kind !== 'player' && !s.allowUnreachable) chk(s.id, spawnNode.get(s.id), s.kind, `spawns[${k}]`, false); });
  (level.checkpoints || []).forEach((c, k) => { if (!c.allowUnreachable) chk(c.id, cpNode.get(c.id), 'checkpoint', `checkpoints[${k}]`, false); });
  (level.triggers || []).forEach((t, k) => { const g = t.shape === 'box' ? groundAt(baked, t.pos[0], t.pos[1] + 0.3, t.pos[2]) : groundAt(baked, t.pos[0], t.pos[1] + 0.3, t.pos[2]); if (g === null) return; const n = nav.nearest([t.pos[0], g, t.pos[2]], 1, 0.6); if (n >= 0 && !seen[n]) warnings.push(`triggers[${k}]: trigger "${t.id}" sits on an unreachable area`); });
  let reachableNodes = 0; for (let n = 0; n < seen.length; n++) reachableNodes += seen[n];
  const a = level.arena; let arena = null;
  if (a) {
    const B = level.bounds, ctr = a.shape === 'circle' ? a.center : [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2];
    const ext = a.shape === 'circle' ? [a.center[0] - a.radius, a.center[1] - a.radius, a.center[0] + a.radius, a.center[1] + a.radius] : [a.min[0], a.min[1], a.max[0], a.max[1]];
    if (ext[0] < B.min[0] || ext[1] < B.min[2] || ext[2] > B.max[0] || ext[3] > B.max[2]) errors.push('arena: bounds extend outside level.bounds');
    if (a.closed !== false) {
      const boss = (level.spawns || []).find((s) => s.id === a.boss), sp = a.seed || (boss && boss.pos) || [ctr[0], 0, ctr[1]];
      const g = groundAt(baked, sp[0], (a.seed ? sp[1] : Math.max(sp[1], 0)) + 0.3, sp[2]), start = g === null ? -1 : nav.nearest([sp[0], g, sp[2]], 3, 0.8);
      if (start < 0) errors.push('arena: closure check has no walkable start node (set arena.seed or place the boss on ground)');
      else {
        const gates = (a.gates || []).map((x) => ({ ...x })), seenA = new Uint8Array(nav.nodeCount), q = [start]; seenA[start] = 1; let leaks = 0, gateHits = new Set(), first = null;
        for (let h = 0; h < q.length; h++) {
          const P = nav.pos(q[h]), gi = gates.findIndex((gt) => Math.hypot(P[0] - gt.pos[0], P[2] - gt.pos[2]) <= gt.radius);
          if (!inArena(a, P[0], P[2], cs * 0.75)) { if (gi >= 0) { gateHits.add(gi); continue; } leaks++; first ||= P; continue; }
          if (gi >= 0) gateHits.add(gi);
          for (const n of nav.adj[q[h]]) if (!seenA[n]) { seenA[n] = 1; q.push(n); }
        }
        if (leaks) errors.push(`arena: bounds are not closed; ${leaks} walkable node(s) outside the arena are reachable from inside (first near [${first.map(r3).join(', ')}]); add walls or list the entrance in arena.gates`);
        const unused = gates.map((_, k) => k).filter((k) => !gateHits.has(k)); if (unused.length) warnings.push(`arena.gates: gate(s) ${unused.join(', ')} are not reachable from inside the arena`);
        arena = { closed: leaks === 0, insideNodes: q.length, leakingNodes: leaks, gatesReached: [...gateHits].sort() };
      }
    }
  }
  return { errors, warnings, reachability: { playerNodes: players.length, reachableNodes, totalNodes: nav.nodeCount, reached: reached.sort(), unreachable }, arena };
}

export function validate(level, opts = {}) {
  const st = validateStructure(level, opts); if (st.errors.length || opts.deep === false) return { errors: st.errors, warnings: st.warnings, report: null, baked: null };
  const baked = bake(level, opts), an = analyze(level, baked, opts);
  return { errors: [...st.errors, ...an.errors], warnings: [...st.warnings, ...an.warnings], report: { hash: baked.hash, stats: baked.stats, reachability: an.reachability, arena: an.arena }, baked };
}
