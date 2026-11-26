// Mesh generation + processing for 3D printing, Blender and engines. Dependency-free, deterministic, browser-safe.
// Mesh = { positions:number[] (x,y,z flat), indices:number[] (3 per triangle, CCW seen from outside),
//          normals?:number[], uvs?:number[] (2/vertex), colors?:number[] (r,g,b 0..1 per vertex),
//          materials?:[{name,color:[r,g,b,a]}], faceMaterial?:number[] (one index per triangle) }.
// Convention: Z up, right-handed, units = millimetres. Primitives are watertight when closed; revolve primitives with
// uvs duplicate the seam column, so manifold checks (validate) compare vertices by POSITION. weld() closes index topology.
// No boolean ops (union/difference): out of scope. addPlinth() places touching/overlapping shells that slicers union.
const TAU = Math.PI * 2, EPS = 1e-9;
const v3 = (n) => (Array.isArray(n) ? n : [n, n, n]);

export function createMesh(positions = [], indices = [], extra = {}) { return { positions, indices, ...extra }; }
export const vertexCount = (m) => m.positions.length / 3;
export const triangleCount = (m) => m.indices.length / 3;
export function cloneMesh(m) {
  const c = { positions: m.positions.slice(), indices: m.indices.slice() };
  for (const k of ['normals', 'uvs', 'colors', 'faceMaterial']) if (m[k]) c[k] = m[k].slice();
  if (m.materials) c.materials = m.materials.map((x) => ({ name: x.name, color: x.color.slice() }));
  return c;
}
export function colorFrom(c, name = 'material') {
  if (typeof c === 'string') { const h = c.replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16); return { name, color: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1] }; }
  if (Array.isArray(c)) return { name, color: [c[0], c[1], c[2], c[3] ?? 1] };
  return { name: c.name || name, color: colorFrom(c.color).color };
}
export function setMaterial(m, material) {
  const mat = colorFrom(material);
  return { ...cloneMesh(m), materials: [mat], faceMaterial: new Array(m.indices.length / 3).fill(0) };
}

// ---------- primitives ----------
export function box({ size = 1, center = true } = {}) {
  const [x, y, z] = v3(size), o = center ? [-x / 2, -y / 2, -z / 2] : [0, 0, 0], p = [];
  for (let i = 0; i < 8; i++) p.push(o[0] + (i & 1 ? x : 0), o[1] + (i & 2 ? y : 0), o[2] + (i & 4 ? z : 0));
  const q = (a, b, c, d) => [a, b, c, a, c, d];
  const idx = [...q(0, 2, 3, 1), ...q(4, 5, 7, 6), ...q(0, 1, 5, 4), ...q(2, 6, 7, 3), ...q(0, 4, 6, 2), ...q(1, 3, 7, 5)];
  return createMesh(p, idx);
}
export const plane = ({ size = 1, segments = 1 } = {}) => grid({ size, segments });
export function grid({ size = 1, segments = 1, uvs = true } = {}) {
  const [sx, sy] = Array.isArray(size) ? size : [size, size], [nx, ny] = Array.isArray(segments) ? segments : [segments, segments];
  const p = [], t = [], idx = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { p.push((i / nx - .5) * sx, (j / ny - .5) * sy, 0); t.push(i / nx, j / ny); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1; idx.push(a, b, c, a, c, d); }
  return createMesh(p, idx, uvs ? { uvs: t } : {});
}
// Surface of revolution about Z. profile = [[r,z],...] ordered counter-clockwise in the (r,z) half plane (bottom, outer side, top)
// so normals point outwards. Points with r~0 collapse to the axis. closed:true joins last->first (torus).
export function lathe(profile, { segments = 32, closed = false, uvs = true, startAngle = 0 } = {}) {
  const n = profile.length, cols = segments + 1, p = [], t = [], idx = [];
  const axis = profile.map(([r]) => Math.abs(r) < 1e-12);
  for (let i = 0; i < n; i++) for (let j = 0; j < cols; j++) {
    const a = startAngle + (j % segments) / segments * TAU, r = axis[i] ? 0 : profile[i][0];
    p.push(r * Math.cos(a), r * Math.sin(a), profile[i][1]); t.push(j / segments, i / Math.max(1, n - 1));
  }
  const rows = closed ? n : n - 1;
  for (let i = 0; i < rows; i++) {
    const i2 = (i + 1) % n;
    if (axis[i] && axis[i2]) continue;
    for (let j = 0; j < segments; j++) {
      const A = i * cols + j, D = i * cols + j + 1, B = i2 * cols + j, C = i2 * cols + j + 1;
      if (axis[i]) idx.push(A, C, B); else if (axis[i2]) idx.push(A, D, B); else idx.push(A, D, C, A, C, B);
    }
  }
  const m = createMesh(p, idx, uvs ? { uvs: t } : {});
  return uvs ? m : weld(m, 1e-9);
}
export function sphere({ radius = 1, segments = 32, rings = 16, uvs = true } = {}) {
  const prof = [];
  for (let i = 0; i <= rings; i++) { const a = -Math.PI / 2 + Math.PI * i / rings; prof.push([radius * Math.cos(a), radius * Math.sin(a)]); }
  return lathe(prof, { segments, uvs });
}
export function icosphere({ radius = 1, subdivisions = 2 } = {}) {
  const t = (1 + Math.sqrt(5)) / 2;
  let p = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  const nrm = (a) => { for (let i = 0; i < a.length; i += 3) { const l = Math.hypot(a[i], a[i + 1], a[i + 2]); a[i] /= l; a[i + 1] /= l; a[i + 2] /= l; } };
  nrm(p);
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => { const k = a < b ? a * 1e6 + b : b * 1e6 + a; if (cache.has(k)) return cache.get(k); const i = p.length / 3; p.push((p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, (p[a * 3 + 2] + p[b * 3 + 2]) / 2); const l = Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); for (let q = 0; q < 3; q++) p[i * 3 + q] /= l; cache.set(k, i); return i; };
    for (let i = 0; i < f.length; i += 3) { const a = f[i], b = f[i + 1], c = f[i + 2], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca); }
    f = nf;
  }
  return createMesh(p.map((x) => x * radius), f);
}
export function cylinder({ radius = 1, radiusTop, height = 1, segments = 32, center = true, caps = true, uvs = true } = {}) {
  const rt = radiusTop ?? radius, z0 = center ? -height / 2 : 0, z1 = z0 + height;
  const prof = caps ? [[0, z0], [radius, z0], [rt, z1], [0, z1]] : [[radius, z0], [rt, z1]];
  return lathe(prof, { segments, uvs });
}
export const cone = ({ radius = 1, height = 1, segments = 32, center = true, uvs = true } = {}) => cylinder({ radius, radiusTop: 0, height, segments, center, uvs });
export function capsule({ radius = 1, height = 1, segments = 32, rings = 8, uvs = true } = {}) { // height = cylinder part, total = height + 2r
  const prof = [];
  for (let i = 0; i <= rings; i++) { const a = -Math.PI / 2 + Math.PI / 2 * i / rings; prof.push([radius * Math.cos(a), -height / 2 + radius * Math.sin(a)]); }
  for (let i = 0; i <= rings; i++) { const a = Math.PI / 2 * i / rings; prof.push([radius * Math.cos(a), height / 2 + radius * Math.sin(a)]); }
  return lathe(prof, { segments, uvs });
}
export function torus({ radius = 1, tube = .25, segments = 32, tubeSegments = 16, uvs = true } = {}) {
  const prof = [];
  for (let i = 0; i < tubeSegments; i++) { const a = TAU * i / tubeSegments; prof.push([radius + tube * Math.cos(a), tube * Math.sin(a)]); }
  return lathe(prof, { segments, closed: true, uvs });
}

// ---------- 2D triangulation (ear clipping with hole bridging) for extrude ----------
const area2 = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const segX = (a, b, c, d) => { const d1 = cross2(a, b, c), d2 = cross2(a, b, d), d3 = cross2(c, d, a), d4 = cross2(c, d, b); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0; };
export function triangulate(outer, holes = []) { // returns {points, triangles} ; points = outer then holes' points (flat list of [x,y])
  const pts = [], rings = [];
  const addRing = (r, ccw) => { const ids = r.map((q) => { pts.push(q); return pts.length - 1; }); if ((area2(r) > 0) !== ccw) ids.reverse(); rings.push(ids); return ids; };
  let loop = addRing(outer, true);
  const hs = holes.map((h) => addRing(h, false).slice());
  const edgesOf = (l) => l.map((id, i) => [id, l[(i + 1) % l.length]]);
  hs.sort((a, b) => Math.max(...b.map((i) => pts[i][0])) - Math.max(...a.map((i) => pts[i][0])));
  for (const h of hs) {
    let hi = 0; for (let i = 1; i < h.length; i++) if (pts[h[i]][0] > pts[h[hi]][0]) hi = i;
    const hp = pts[h[hi]], allEdges = [...edgesOf(loop), ...hs.filter((x) => x !== h).flatMap(edgesOf), ...edgesOf(h)];
    const cand = loop.map((id, k) => [Math.hypot(pts[id][0] - hp[0], pts[id][1] - hp[1]), k]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let best = -1;
    for (const [, k] of cand) { const q = pts[loop[k]]; if (!allEdges.some(([a, b]) => a !== loop[k] && b !== loop[k] && segX(hp, q, pts[a], pts[b]))) { best = k; break; } }
    if (best < 0) best = cand[0][1];
    const hr = []; for (let i = 0; i <= h.length; i++) hr.push(h[(hi + i) % h.length]);
    loop = [...loop.slice(0, best + 1), ...hr, loop[best], ...loop.slice(best + 1)];
  }
  const tris = [], L = loop.slice();
  const inTri = (a, b, c, p) => cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
  let guard = L.length * L.length + 10;
  while (L.length > 3 && guard-- > 0) {
    let cut = -1;
    for (let k = 0; k < L.length && cut < 0; k++) {
      const ia = L[(k + L.length - 1) % L.length], ib = L[k], ic = L[(k + 1) % L.length], a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross2(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const id of L) { const q = pts[id]; if (id === ia || id === ib || id === ic || (q[0] === a[0] && q[1] === a[1]) || (q[0] === b[0] && q[1] === b[1]) || (q[0] === c[0] && q[1] === c[1])) continue; if (inTri(a, b, c, q)) { ear = false; break; } }
      if (ear) cut = k;
    }
    if (cut < 0) cut = L.findIndex((_, k) => cross2(pts[L[(k + L.length - 1) % L.length]], pts[L[k]], pts[L[(k + 1) % L.length]]) > 0);
    if (cut < 0) break;
    tris.push(L[(cut + L.length - 1) % L.length], L[cut], L[(cut + 1) % L.length]); L.splice(cut, 1);
  }
  if (L.length === 3) tris.push(L[0], L[1], L[2]);
  return { points: pts, triangles: tris, rings };
}
// Extrude a 2D polygon [[x,y],...] (+ optional holes) along +Z by depth (base at z=0).
export function extrude(polygon, depth = 1, holes = []) {
  const { points, triangles, rings } = triangulate(polygon, holes), n = points.length, p = [], idx = [];
  for (const q of points) p.push(q[0], q[1], 0);
  for (const q of points) p.push(q[0], q[1], depth);
  for (let i = 0; i < triangles.length; i += 3) { idx.push(triangles[i], triangles[i + 2], triangles[i + 1]); idx.push(n + triangles[i], n + triangles[i + 1], n + triangles[i + 2]); }
  for (const r of rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; idx.push(a, b, n + b, a, n + b, n + a); }
  return createMesh(p, idx);
}
// Height field -> closed solid. heights: flat array (w*h) or array of rows. Top surface from heights, flat bottom at z=base (default 0).
export function heightmap(heights, { width, depth, cellSize = 1, zScale = 1, base = 0 } = {}) {
  const rows = Array.isArray(heights[0]) ? heights : null;
  const h = rows ? rows.length : depth, w = rows ? rows[0].length : width;
  if (!w || !h) throw new Error('heightmap needs width and depth (or an array of rows)');
  const H = (i, j) => (rows ? rows[j][i] : heights[j * w + i]) * zScale;
  const p = [], idx = [], top = (i, j) => j * w + i, bot = (i, j) => w * h + j * w + i;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p.push(i * cellSize, j * cellSize, H(i, j));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p.push(i * cellSize, j * cellSize, base);
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const a = top(i, j), b = top(i + 1, j), c = top(i + 1, j + 1), d = top(i, j + 1); idx.push(a, b, c, a, c, d);
    const e = bot(i, j), f = bot(i + 1, j), g = bot(i + 1, j + 1), k = bot(i, j + 1); idx.push(e, g, f, e, k, g);
  }
  for (let i = 0; i + 1 < w; i++) { // south (j=0) and north (j=h-1) skirts
    idx.push(top(i, 0), bot(i, 0), bot(i + 1, 0), top(i, 0), bot(i + 1, 0), top(i + 1, 0));
    idx.push(top(i + 1, h - 1), bot(i + 1, h - 1), bot(i, h - 1), top(i + 1, h - 1), bot(i, h - 1), top(i, h - 1));
  }
  for (let j = 0; j + 1 < h; j++) { // west (i=0) and east (i=w-1) skirts
    idx.push(top(0, j + 1), bot(0, j + 1), bot(0, j), top(0, j + 1), bot(0, j), top(0, j));
    idx.push(top(w - 1, j), bot(w - 1, j), bot(w - 1, j + 1), top(w - 1, j), bot(w - 1, j + 1), top(w - 1, j + 1));
  }
  return createMesh(p, idx);
}

// ---------- operations ----------
function rotMatrix(rx, ry, rz) { // intrinsic XYZ euler in degrees applied as Rz*Ry*Rx
  const [a, b, c] = [rx, ry, rz].map((d) => d * Math.PI / 180), [sa, ca, sb, cb, sc, cc] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(c), Math.cos(c)];
  return [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa, sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa, -sb, cb * sa, cb * ca];
}
// transform: scale (number|[x,y,z]) first, then rotate (degrees [x,y,z]), then translate. Mirroring (negative scale) flips winding.
export function transform(m, { translate = [0, 0, 0], rotate = [0, 0, 0], scale = 1 } = {}) {
  const s = v3(scale), R = rotMatrix(...rotate), c = cloneMesh(m), p = c.positions;
  for (let i = 0; i < p.length; i += 3) { const x = p[i] * s[0], y = p[i + 1] * s[1], z = p[i + 2] * s[2]; p[i] = R[0] * x + R[1] * y + R[2] * z + translate[0]; p[i + 1] = R[3] * x + R[4] * y + R[5] * z + translate[1]; p[i + 2] = R[6] * x + R[7] * y + R[8] * z + translate[2]; }
  if (c.normals) { const n = c.normals, is = s.map((q) => 1 / (q || 1)); for (let i = 0; i < n.length; i += 3) { const x = n[i] * is[0], y = n[i + 1] * is[1], z = n[i + 2] * is[2], l = Math.hypot(R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z) || 1; n[i] = (R[0] * x + R[1] * y + R[2] * z) / l; n[i + 1] = (R[3] * x + R[4] * y + R[5] * z) / l; n[i + 2] = (R[6] * x + R[7] * y + R[8] * z) / l; } }
  if (s[0] * s[1] * s[2] < 0) flipWinding(c);
  return c;
}
function flipWinding(c) { for (let i = 0; i < c.indices.length; i += 3) { const t = c.indices[i + 1]; c.indices[i + 1] = c.indices[i + 2]; c.indices[i + 2] = t; } }
export function flipNormals(m) { const c = cloneMesh(m); flipWinding(c); if (c.normals) c.normals = c.normals.map((x) => -x); return c; }
export function merge(meshes) {
  const out = { positions: [], indices: [] };
  const hasN = meshes.every((m) => m.normals), hasT = meshes.every((m) => m.uvs), hasC = meshes.every((m) => m.colors), hasM = meshes.some((m) => m.materials);
  if (hasN) out.normals = []; if (hasT) out.uvs = []; if (hasC) out.colors = []; if (hasM) { out.materials = []; out.faceMaterial = []; }
  const matIdx = new Map();
  for (const m of meshes) {
    const base = out.positions.length / 3;
    for (const x of m.positions) out.positions.push(x);
    for (const i of m.indices) out.indices.push(i + base);
    if (hasN) for (const x of m.normals) out.normals.push(x);
    if (hasT) for (const x of m.uvs) out.uvs.push(x);
    if (hasC) for (const x of m.colors) out.colors.push(x);
    if (hasM) {
      const map = (m.materials || []).map((mt) => { const k = mt.name + JSON.stringify(mt.color); if (!matIdx.has(k)) { matIdx.set(k, out.materials.length); out.materials.push({ name: mt.name, color: mt.color.slice() }); } return matIdx.get(k); });
      for (let f = 0; f < m.indices.length / 3; f++) out.faceMaterial.push(m.faceMaterial && map[m.faceMaterial[f]] !== undefined ? map[m.faceMaterial[f]] : -1);
    }
  }
  if (hasM && out.faceMaterial.includes(-1)) { const k = 'default[0.8,0.8,0.8,1]'; out.materials.push({ name: 'default', color: [.8, .8, .8, 1] }); const di = out.materials.length - 1; out.faceMaterial = out.faceMaterial.map((x) => (x < 0 ? di : x)); void k; }
  return out;
}
export function mirror(m, axis = 'x', { keep = false } = {}) {
  const i = 'xyz'.indexOf(axis), s = [1, 1, 1]; s[i] = -1;
  const mm = transform(m, { scale: s });
  return keep ? merge([m, mm]) : mm;
}
export function bounds(m) {
  const p = m.positions, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i + k] < min[k]) min[k] = p[i + k]; if (p[i + k] > max[k]) max[k] = p[i + k]; }
  if (!p.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
  return { min, max, size: max.map((x, k) => x - min[k]), center: max.map((x, k) => (x + min[k]) / 2) };
}
export function volume(m) { // signed; positive when triangles wind CCW outwards
  const p = m.positions, I = m.indices; let v = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]); }
  return v / 6;
}
export function surfaceArea(m) {
  const p = m.positions, I = m.indices; let s = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]; s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; }
  return s;
}
// Area-weighted smooth normals; vertices at the same position (uv seams) share one normal.
export function recomputeNormals(m) {
  const c = cloneMesh(m), p = c.positions, I = c.indices, acc = new Map(), keys = [];
  const q = 1e-6;
  for (let i = 0; i < p.length; i += 3) { const k = `${Math.round(p[i] / q)},${Math.round(p[i + 1] / q)},${Math.round(p[i + 2] / q)}`; keys.push(k); if (!acc.has(k)) acc.set(k, [0, 0, 0]); }
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, cc = I[t + 2] * 3, ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[cc] - p[a], vy = p[cc + 1] - p[a + 1], vz = p[cc + 2] - p[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [I[t], I[t + 1], I[t + 2]]) { const s = acc.get(keys[v]); s[0] += n[0]; s[1] += n[1]; s[2] += n[2]; }
  }
  c.normals = new Array(p.length);
  for (let v = 0; v < keys.length; v++) { const s = acc.get(keys[v]), l = Math.hypot(s[0], s[1], s[2]) || 1; c.normals[v * 3] = s[0] / l; c.normals[v * 3 + 1] = s[1] / l; c.normals[v * 3 + 2] = s[2] / l; }
  return c;
}
// Merge vertices closer than eps (grid quantisation, positions only). Drops triangles that collapse. Drops normals/uvs/colors
// of merged duplicates (first vertex wins), so run it on print meshes, not on uv-seamed render meshes.
export function weld(m, eps = 1e-6) {
  const p = m.positions, map = new Array(p.length / 3), seen = new Map(), np = [], keep = [];
  const hasN = !!m.normals, hasT = !!m.uvs, hasC = !!m.colors, nn = [], nt = [], nc = [];
  for (let i = 0; i < p.length / 3; i++) {
    const k = `${Math.round(p[i * 3] / eps)},${Math.round(p[i * 3 + 1] / eps)},${Math.round(p[i * 3 + 2] / eps)}`;
    let id = seen.get(k);
    if (id === undefined) { id = np.length / 3; seen.set(k, id); np.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); if (hasN) nn.push(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]); if (hasT) nt.push(m.uvs[i * 2], m.uvs[i * 2 + 1]); if (hasC) nc.push(m.colors[i * 3], m.colors[i * 3 + 1], m.colors[i * 3 + 2]); }
    map[i] = id;
  }
  const idx = [], fm = [];
  for (let t = 0; t < m.indices.length; t += 3) { const a = map[m.indices[t]], b = map[m.indices[t + 1]], c = map[m.indices[t + 2]]; if (a === b || b === c || a === c) continue; idx.push(a, b, c); if (m.faceMaterial) fm.push(m.faceMaterial[t / 3]); keep.push(t / 3); }
  const out = { positions: np, indices: idx };
  if (hasN) out.normals = nn; if (hasT) out.uvs = nt; if (hasC) out.colors = nc;
  if (m.materials) { out.materials = m.materials.map((x) => ({ name: x.name, color: x.color.slice() })); out.faceMaterial = fm; }
  return out;
}
export function removeDegenerate(m, minArea = 1e-12) {
  const p = m.positions, idx = [], fm = [];
  for (let t = 0; t < m.indices.length; t += 3) { const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3, ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]; if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 <= minArea) continue; idx.push(m.indices[t], m.indices[t + 1], m.indices[t + 2]); if (m.faceMaterial) fm.push(m.faceMaterial[t / 3]); }
  const c = cloneMesh(m); c.indices = idx; if (m.faceMaterial) c.faceMaterial = fm; return c;
}
export const dropToZ = (m, z = 0) => transform(m, { translate: [0, 0, z - bounds(m).min[2]] });
export function centerOnBed(m) { const b = bounds(m); return transform(m, { translate: [-b.center[0], -b.center[1], -b.min[2]] }); }
export function scaleToHeight(m, height) { const b = bounds(m); if (!(b.size[2] > 0)) throw new Error('mesh has zero height'); const s = height / b.size[2], c = transform(m, { scale: s }); return centerOnBed(c); }
// Uniformly scale to fit inside bed {x,y,z}; scales DOWN only unless allowUp. margin (mm) is kept free on every side.
export function fitToBed(m, bed, { margin = 0, allowUp = false } = {}) {
  const b = bounds(m), s = Math.min(...['x', 'y', 'z'].map((a, i) => (bed[a] === undefined ? Infinity : (bed[a] - 2 * margin) / (b.size[i] || EPS))));
  const f = allowUp ? s : Math.min(1, s);
  return centerOnBed(transform(m, { scale: f }));
}
// Slab below the model (model is moved up). shape 'box'|'cylinder'. overlap (mm) sinks the slab top into the model so a slicer unions them.
export function addPlinth(m, { height = 2, margin = 2, shape = 'box', overlap = 0, material } = {}) {
  const b = bounds(m), sx = b.size[0] + 2 * margin, sy = b.size[1] + 2 * margin;
  let slab = shape === 'cylinder' ? cylinder({ radius: Math.hypot(sx, sy) / 2, height: height + overlap, center: false, segments: 64, uvs: false }) : box({ size: [sx, sy, height + overlap], center: false });
  slab = transform(slab, { translate: shape === 'cylinder' ? [b.center[0], b.center[1], 0] : [b.min[0] - margin, b.min[1] - margin, 0] });
  if (material) slab = setMaterial(slab, material);
  const lifted = transform(m, { translate: [0, 0, height - b.min[2]] });
  return merge([slab, lifted]);
}

// ---------- validation ----------
function components(m) { // union-find over welded vertex ids; returns shell id per triangle
  const n = m.positions.length / 3, par = Array.from({ length: n }, (_, i) => i), find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < m.indices.length; t += 3) { const a = find(m.indices[t]), b = find(m.indices[t + 1]), c = find(m.indices[t + 2]); par[b] = a; par[find(c)] = find(a); }
  const ids = new Map(), out = [];
  for (let t = 0; t < m.indices.length; t += 3) { const r = find(m.indices[t]); if (!ids.has(r)) ids.set(r, ids.size); out.push(ids.get(r)); }
  return { count: ids.size, face: out };
}
// Per-shell fix: flips any shell whose signed volume is negative so it faces outward.
export function orientShells(m, eps = 1e-6) {
  const w = weld(m, eps), { count, face } = components(w), vols = new Array(count).fill(0), p = w.positions;
  for (let t = 0; t < w.indices.length; t += 3) { const a = w.indices[t] * 3, b = w.indices[t + 1] * 3, c = w.indices[t + 2] * 3; vols[face[t / 3]] += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6; }
  for (let t = 0; t < w.indices.length; t += 3) if (vols[face[t / 3]] < 0) { const x = w.indices[t + 1]; w.indices[t + 1] = w.indices[t + 2]; w.indices[t + 2] = x; }
  return w;
}
// Report: watertight (every edge shared by exactly two triangles with opposite direction), manifold, orientation, shells,
// degenerate faces, signed volume (negative => inside-out), bounds. Vertices are compared by position (eps).
export function validate(m, { eps = 1e-6, bed } = {}) {
  const w = weld({ positions: m.positions, indices: m.indices }, eps), I = w.indices, p = w.positions;
  const dir = new Map(); let degenerate = 0;
  const raw = m.indices.length / 3;
  const welded = weld({ positions: m.positions, indices: m.indices }, eps); degenerate = raw - welded.indices.length / 3;
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; if (area(p, a, b, c) < 1e-12) degenerate++; for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u + ',' + v; dir.set(k, (dir.get(k) || 0) + 1); } }
  let boundary = 0, nonManifold = 0, inconsistent = 0;
  const done = new Set();
  for (const [k, cnt] of dir) {
    const [u, v] = k.split(',').map(Number), rk = v + ',' + u, rc = dir.get(rk) || 0, und = u < v ? k : rk;
    if (done.has(und)) continue; done.add(und);
    const total = cnt + rc;
    if (total === 1) boundary++; else if (total > 2) nonManifold++; else if (cnt === 2 || rc === 2) inconsistent++;
  }
  const vol = volume(w), shells = components(w).count, bb = bounds(m), tri = I.length / 3;
  const watertight = tri > 0 && boundary === 0 && nonManifold === 0 && inconsistent === 0;
  const rep = { triangles: raw, vertices: m.positions.length / 3, weldedVertices: p.length / 3, degenerateFaces: degenerate, boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent, shells, watertight, manifold: watertight, signedVolume: vol, volume: Math.abs(vol), inverted: watertight && vol < 0, surfaceArea: surfaceArea(w), bounds: bb, minBBox: Math.min(...bb.size) };
  if (bed) rep.fitsBed = ['x', 'y', 'z'].every((a, i) => bed[a] === undefined || bb.size[i] <= bed[a] + 1e-9);
  return rep;
}
function area(p, a, b, c) { a *= 3; b *= 3; c *= 3; const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]; return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; }

// Estimate minimum wall thickness by firing rays inward from evenly strided face centroids (brute force, budgeted).
// Returns {minWall, samples} or {minWall:null, skipped} when the budget (samples*triangles) would be exceeded. An estimate, not a proof.
export function estimateMinWall(m, { samples = 400, budget = 3e7 } = {}) {
  const w = weld(m, 1e-6), p = w.positions, I = w.indices, T = I.length / 3;
  if (!T) return { minWall: null, samples: 0, skipped: 'empty' };
  const n = Math.min(T, Math.max(8, Math.min(samples, Math.floor(budget / T))));
  if (n * T > budget * 1.01) return { minWall: null, samples: 0, skipped: 'too large' };
  let best = Infinity, used = 0;
  for (let s = 0; s < n; s++) {
    const t = Math.floor(s * T / n), a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz); if (l < 1e-12) continue; nx /= -l; ny /= -l; nz /= -l; // inward
    const ox = (p[a] + p[b] + p[c]) / 3, oy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, oz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    let hit = Infinity;
    for (let q = 0; q < T; q++) {
      if (q === t) continue;
      const A = I[q * 3] * 3, B = I[q * 3 + 1] * 3, C = I[q * 3 + 2] * 3, e1x = p[B] - p[A], e1y = p[B + 1] - p[A + 1], e1z = p[B + 2] - p[A + 2], e2x = p[C] - p[A], e2y = p[C + 1] - p[A + 1], e2z = p[C + 2] - p[A + 2];
      const hx = ny * e2z - nz * e2y, hy = nz * e2x - nx * e2z, hz = nx * e2y - ny * e2x, det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-14) continue;
      const f = 1 / det, sx = ox - p[A], sy = oy - p[A + 1], sz = oz - p[A + 2], u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = f * (nx * qx + ny * qy + nz * qz); if (v < 0 || u + v > 1) continue;
      const d = f * (e2x * qx + e2y * qy + e2z * qz); if (d > 1e-6 && d < hit) hit = d;
    }
    if (hit < Infinity) { used++; if (hit < best) best = hit; }
  }
  return { minWall: best === Infinity ? null : best, samples: used };
}
