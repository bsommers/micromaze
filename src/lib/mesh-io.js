// Mesh file I/O: OBJ(+MTL), STL (binary/ascii), PLY, glTF/GLB, 3MF. Dependency-free, deterministic, browser-safe
// (TextEncoder/DataView/Uint8Array only). The library mesh is mm, Z up (see mesh.js). Options on every writer/reader:
//   units: 'mm'|'m' (file unit; default per format below)   up: 'Z'|'Y' (file up axis; default per format below)
// Defaults: obj/stl/ply/3mf = mm + Z up; gltf/glb = m + Y up (spec). 3MF reads its own unit attribute.
// Readers that need to inflate (3MF from other tools, glb never) accept options.inflate(rawDeflateBytes)->bytes
// (e.g. node:zlib inflateRawSync); STORE-only zips (our own output) need none.
import { weld, bounds, cloneMesh } from './mesh.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const UNIT = { mm: 1, m: 0.001, cm: 0.1, in: 1 / 25.4, ft: 1 / 304.8, um: 1000 }; // file units per mm
const f32 = Math.fround;

export const FORMATS = {
  obj: { ext: 'obj', mime: 'model/obj', units: 'mm', up: 'Z', colors: 'materials via .mtl (Kd/d), per-face', binary: false },
  stl: { ext: 'stl', mime: 'model/stl', units: 'mm', up: 'Z', colors: 'none', binary: true },
  'stl-ascii': { ext: 'stl', mime: 'model/stl', units: 'mm', up: 'Z', colors: 'none', binary: false },
  ply: { ext: 'ply', mime: 'application/x-ply', units: 'mm', up: 'Z', colors: 'per-vertex rgb, per-face rgb', binary: true },
  glb: { ext: 'glb', mime: 'model/gltf-binary', units: 'm', up: 'Y', colors: 'PBR baseColor materials, vertex colours', binary: true },
  gltf: { ext: 'gltf', mime: 'model/gltf+json', units: 'm', up: 'Y', colors: 'PBR baseColor materials, vertex colours', binary: false },
  '3mf': { ext: '3mf', mime: 'model/3mf', units: 'mm', up: 'Z', colors: 'base materials (displaycolor), per-triangle', binary: true },
};
const num = (v) => { const s = (+v.toPrecision(9)).toString(); return s === '-0' ? '0' : s; };

// axis + unit conversion between library space (mm, Z up) and file space.
function toFile(m, o, def) {
  const u = UNIT[o.units || def.units], up = o.up || def.up;
  if (u === 1 && up === 'Z') return m;
  const c = cloneMesh(m), p = c.positions;
  for (let i = 0; i < p.length; i += 3) { const x = p[i] * u, y = p[i + 1] * u, z = p[i + 2] * u; if (up === 'Y') { p[i] = x; p[i + 1] = z; p[i + 2] = -y; } else { p[i] = x; p[i + 1] = y; p[i + 2] = z; } }
  if (up === 'Y' && c.normals) { const n = c.normals; for (let i = 0; i < n.length; i += 3) { const y = n[i + 1]; n[i + 1] = n[i + 2]; n[i + 2] = -y; } }
  return c;
}
function fromFile(m, o, def) {
  const u = UNIT[o.units || def.units], up = o.up || def.up;
  if (u === 1 && up === 'Z') return m;
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) { const x = p[i] / u, y = p[i + 1] / u, z = p[i + 2] / u; if (up === 'Y') { p[i] = x; p[i + 1] = -z; p[i + 2] = y; } else { p[i] = x; p[i + 1] = y; p[i + 2] = z; } }
  if (up === 'Y' && m.normals) { const n = m.normals; for (let i = 0; i < n.length; i += 3) { const z = n[i + 2]; n[i + 2] = n[i + 1]; n[i + 1] = -z; } }
  return m;
}
const faceNormal = (p, a, b, c) => {
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
};
const hex = (c) => '#' + [0, 1, 2, 3].map((i) => Math.round(Math.max(0, Math.min(1, c[i] ?? 1)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const safe = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_') || 'm';
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// ---------------- OBJ / MTL ----------------
// returns {obj, mtl|null}; mtl is only produced when the mesh has materials. options: name, mtlName.
export function writeOBJ(mesh, o = {}) {
  const m = toFile(mesh, o, FORMATS.obj), name = o.name || 'mesh', mtlName = o.mtlName || `${safe(name)}.mtl`, L = [`# game-factory mesh.js`, `o ${safe(name)}`];
  const hasMat = !!(m.materials && m.faceMaterial);
  if (hasMat) L.push(`mtllib ${mtlName}`);
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) L.push(`v ${num(p[i])} ${num(p[i + 1])} ${num(p[i + 2])}`);
  if (m.uvs) for (let i = 0; i < m.uvs.length; i += 2) L.push(`vt ${num(m.uvs[i])} ${num(m.uvs[i + 1])}`);
  if (m.normals) for (let i = 0; i < m.normals.length; i += 3) L.push(`vn ${num(m.normals[i])} ${num(m.normals[i + 1])} ${num(m.normals[i + 2])}`);
  const ref = (v) => { v++; return m.uvs && m.normals ? `${v}/${v}/${v}` : m.uvs ? `${v}/${v}` : m.normals ? `${v}//${v}` : `${v}`; };
  let cur = -2;
  for (let t = 0; t < m.indices.length; t += 3) {
    if (hasMat && m.faceMaterial[t / 3] !== cur) { cur = m.faceMaterial[t / 3]; L.push(`usemtl ${safe(m.materials[cur].name)}`); }
    L.push(`f ${ref(m.indices[t])} ${ref(m.indices[t + 1])} ${ref(m.indices[t + 2])}`);
  }
  let mtl = null;
  if (hasMat) {
    mtl = ['# game-factory mesh.js'];
    const seen = new Set();
    for (const mt of m.materials) { const n = safe(mt.name); if (seen.has(n)) continue; seen.add(n); mtl.push(`newmtl ${n}`, `Kd ${num(mt.color[0])} ${num(mt.color[1])} ${num(mt.color[2])}`, `Ka 0 0 0`, `Ks 0 0 0`, `d ${num(mt.color[3] ?? 1)}`, 'illum 1'); }
    mtl = mtl.join('\n') + '\n';
  }
  return { obj: L.join('\n') + '\n', mtl, mtlName };
}
// text of .obj, optional options.mtl text. Polygons are fan-triangulated; vertices are split per unique v/vt/vn combination
// only when uvs/normals are present (so positions stay shared otherwise).
export function parseOBJ(text, o = {}) {
  const V = [], VT = [], VN = [], pos = [], uv = [], nr = [], idx = [], fm = [], mats = [], matIdx = new Map(), key = new Map();
  const mtlColors = new Map();
  if (o.mtl) { let cur = null; for (const raw of String(o.mtl).split('\n')) { const t = raw.trim().split(/\s+/); if (t[0] === 'newmtl') { cur = t.slice(1).join(' '); mtlColors.set(cur, [.8, .8, .8, 1]); } else if (cur && t[0] === 'Kd') mtlColors.get(cur).splice(0, 3, +t[1], +t[2], +t[3]); else if (cur && t[0] === 'd') mtlColors.get(cur)[3] = +t[1]; } }
  let curMat = -1, anyUV = false, anyN = false;
  const pick = (s, len) => { const i = parseInt(s, 10); return i < 0 ? len + i : i - 1; };
  const lines = String(text).split('\n');
  for (const raw of lines) { const t = raw.trim().split(/\s+/); if (t[0] === 'f') for (const s of t.slice(1)) { const [, b, c] = s.split('/'); if (b) anyUV = true; if (c) anyN = true; } }
  for (const raw of lines) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === 'v') V.push([+t[1], +t[2], +t[3]]); else if (t[0] === 'vt') VT.push([+t[1], +t[2]]); else if (t[0] === 'vn') VN.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'usemtl') { const n = t.slice(1).join(' '); if (!matIdx.has(n)) { matIdx.set(n, mats.length); mats.push({ name: n, color: (mtlColors.get(n) || [.8, .8, .8, 1]).slice() }); } curMat = matIdx.get(n); }
    else if (t[0] === 'f' && t.length >= 4) {
      const c = t.slice(1).map((s) => {
        const [a, b, d] = s.split('/'), vi = pick(a, V.length), ti = b ? pick(b, VT.length) : -1, ni = d ? pick(d, VN.length) : -1;
        if (!V[vi]) throw new Error('OBJ face references a missing vertex');
        const k = anyUV || anyN ? `${vi}/${ti}/${ni}` : `${vi}`;
        if (!key.has(k)) { key.set(k, pos.length / 3); pos.push(...V[vi]); if (anyUV) uv.push(...(VT[ti] || [0, 0])); if (anyN) nr.push(...(VN[ni] || [0, 0, 1])); }
        return key.get(k);
      });
      for (let k = 1; k + 1 < c.length; k++) { idx.push(c[0], c[k], c[k + 1]); fm.push(curMat); }
    }
  }
  const m = { positions: pos, indices: idx };
  if (anyUV) m.uvs = uv; if (anyN) m.normals = nr;
  if (mats.length) { m.materials = mats; m.faceMaterial = fm.map((x) => (x < 0 ? 0 : x)); }
  return fromFile(m, o, FORMATS.obj);
}

// ---------------- STL ----------------
// Uint8Array. Binary: 80-byte header + u32 count + 50 bytes/triangle (float32 normal+3 vertices + u16 attr).
export function writeSTL(mesh, o = {}) {
  const m = toFile(mesh, o, FORMATS.stl), p = m.positions, I = m.indices, T = I.length / 3, name = safe(o.name || 'mesh');
  if (o.ascii) {
    const L = [`solid ${name}`];
    for (let t = 0; t < T; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3, n = faceNormal(p, a, b, c);
      L.push(`  facet normal ${num(n[0])} ${num(n[1])} ${num(n[2])}`, '    outer loop');
      for (const q of [a, b, c]) L.push(`      vertex ${num(f32(p[q]))} ${num(f32(p[q + 1]))} ${num(f32(p[q + 2]))}`);
      L.push('    endloop', '  endfacet');
    }
    L.push(`endsolid ${name}`);
    return enc.encode(L.join('\n') + '\n');
  }
  const out = new Uint8Array(84 + 50 * T), dv = new DataView(out.buffer);
  out.set(enc.encode(`binary STL game-factory ${name}`.slice(0, 80)), 0); // header must not start with "solid"
  dv.setUint32(80, T, true);
  let off = 84;
  for (let t = 0; t < T; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3, n = faceNormal(p, a, b, c);
    for (const x of n) { dv.setFloat32(off, x, true); off += 4; }
    for (const q of [a, b, c]) for (let k = 0; k < 3; k++) { dv.setFloat32(off, p[q + k], true); off += 4; }
    off += 2;
  }
  return out;
}
// Accepts Uint8Array/ArrayBuffer/string; auto-detects ascii vs binary (size check beats the "solid" header, which some
// binary exporters also write). Triangle soup is welded by exact float32 position unless options.weld === false.
export function parseSTL(data, o = {}) {
  const u8 = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const pos = [], idx = [];
  const bin = u8.length >= 84 && u8.length === 84 + 50 * new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(80, true);
  if (bin) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), T = dv.getUint32(80, true);
    for (let t = 0; t < T; t++) { const off = 84 + t * 50 + 12; for (let v = 0; v < 3; v++) { for (let k = 0; k < 3; k++) pos.push(dv.getFloat32(off + v * 12 + k * 4, true)); idx.push(pos.length / 3 - 1); } }
  } else {
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, s = dec.decode(u8); let r;
    if (!/facet/.test(s)) throw new Error('not an STL file');
    while ((r = re.exec(s))) { pos.push(+r[1], +r[2], +r[3]); idx.push(pos.length / 3 - 1); }
    if (idx.length % 3) throw new Error('ascii STL has a partial facet');
  }
  let m = { positions: pos, indices: idx };
  if (o.weld !== false) m = weld(m, o.eps ?? 1e-7);
  return fromFile(m, o, FORMATS.stl);
}

// ---------------- PLY ----------------
// binary_little_endian by default (options.ascii for text). Writes vertex colours (uchar) when mesh.colors, otherwise a per-face
// colour from materials. uv as s,t; normals as nx,ny,nz.
export function writePLY(mesh, o = {}) {
  const m = toFile(mesh, o, FORMATS.ply), p = m.positions, nV = p.length / 3, nF = m.indices.length / 3, ascii = !!o.ascii;
  const fcol = m.materials && m.faceMaterial, h = ['ply', ascii ? 'format ascii 1.0' : 'format binary_little_endian 1.0', 'comment game-factory mesh.js', `element vertex ${nV}`, 'property float x', 'property float y', 'property float z'];
  if (m.normals) h.push('property float nx', 'property float ny', 'property float nz');
  if (m.uvs) h.push('property float s', 'property float t');
  if (m.colors) h.push('property uchar red', 'property uchar green', 'property uchar blue');
  h.push(`element face ${nF}`, 'property list uchar int vertex_indices');
  if (fcol) h.push('property uchar red', 'property uchar green', 'property uchar blue', 'property uchar alpha');
  h.push('end_header');
  const b255 = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255), fc = (t) => { const c = m.materials[m.faceMaterial[t]].color; return [b255(c[0]), b255(c[1]), b255(c[2]), b255(c[3] ?? 1)]; };
  if (ascii) {
    const L = [...h];
    for (let v = 0; v < nV; v++) { const r = [num(p[v * 3]), num(p[v * 3 + 1]), num(p[v * 3 + 2])]; if (m.normals) r.push(num(m.normals[v * 3]), num(m.normals[v * 3 + 1]), num(m.normals[v * 3 + 2])); if (m.uvs) r.push(num(m.uvs[v * 2]), num(m.uvs[v * 2 + 1])); if (m.colors) r.push(b255(m.colors[v * 3]), b255(m.colors[v * 3 + 1]), b255(m.colors[v * 3 + 2])); L.push(r.join(' ')); }
    for (let t = 0; t < nF; t++) L.push(['3', m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2], ...(fcol ? fc(t) : [])].join(' '));
    return enc.encode(L.join('\n') + '\n');
  }
  const head = enc.encode(h.join('\n') + '\n'), vs = 12 + (m.normals ? 12 : 0) + (m.uvs ? 8 : 0) + (m.colors ? 3 : 0), fs = 13 + (fcol ? 4 : 0);
  const out = new Uint8Array(head.length + nV * vs + nF * fs), dv = new DataView(out.buffer); out.set(head, 0);
  let off = head.length;
  for (let v = 0; v < nV; v++) {
    for (let k = 0; k < 3; k++) { dv.setFloat32(off, p[v * 3 + k], true); off += 4; }
    if (m.normals) for (let k = 0; k < 3; k++) { dv.setFloat32(off, m.normals[v * 3 + k], true); off += 4; }
    if (m.uvs) for (let k = 0; k < 2; k++) { dv.setFloat32(off, m.uvs[v * 2 + k], true); off += 4; }
    if (m.colors) for (let k = 0; k < 3; k++) out[off++] = b255(m.colors[v * 3 + k]);
  }
  for (let t = 0; t < nF; t++) { out[off++] = 3; for (let k = 0; k < 3; k++) { dv.setInt32(off, m.indices[t * 3 + k], true); off += 4; } if (fcol) for (const x of fc(t)) out[off++] = x; }
  return out;
}
export function parsePLY(data, o = {}) {
  const u8 = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const hend = dec.decode(u8.subarray(0, Math.min(u8.length, 65536))).indexOf('end_header');
  if (hend < 0) throw new Error('not a PLY file');
  let bodyStart = hend + 'end_header'.length; while (u8[bodyStart] === 13) bodyStart++; if (u8[bodyStart] === 10) bodyStart++;
  const lines = dec.decode(u8.subarray(0, bodyStart)).split(/\r?\n/), els = []; let fmt = 'ascii';
  for (const l of lines) { const t = l.trim().split(/\s+/); if (t[0] === 'format') fmt = t[1]; else if (t[0] === 'element') els.push({ name: t[1], count: +t[2], props: [] }); else if (t[0] === 'property') els[els.length - 1].props.push(t[1] === 'list' ? { list: true, cnt: t[2], type: t[3], name: t[4] } : { type: t[1], name: t[2] }); }
  const SZ = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), le = fmt !== 'binary_big_endian';
  const rd = (t, off) => { switch (t) { case 'char': case 'int8': return dv.getInt8(off); case 'uchar': case 'uint8': return dv.getUint8(off); case 'short': case 'int16': return dv.getInt16(off, le); case 'ushort': case 'uint16': return dv.getUint16(off, le); case 'int': case 'int32': return dv.getInt32(off, le); case 'uint': case 'uint32': return dv.getUint32(off, le); case 'float': case 'float32': return dv.getFloat32(off, le); default: return dv.getFloat64(off, le); } };
  let toks = null, ti = 0, off = bodyStart;
  if (fmt === 'ascii') toks = dec.decode(u8.subarray(bodyStart)).split(/\s+/).filter(Boolean);
  const next = (t) => { if (toks) return +toks[ti++]; const v = rd(t, off); off += SZ[t]; return v; };
  const pos = [], nrm = [], uvs = [], col = [], idx = [], fcols = [];
  let hasN = false, hasT = false, hasC = false;
  for (const el of els) for (let i = 0; i < el.count; i++) {
    const row = {}; let list = null;
    for (const pr of el.props) { if (pr.list) { const n = next(pr.cnt), a = []; for (let k = 0; k < n; k++) a.push(next(pr.type)); if (/vertex_ind/.test(pr.name)) list = a; } else row[pr.name] = next(pr.type); }
    if (el.name === 'vertex') {
      pos.push(row.x, row.y, row.z);
      if ('nx' in row) { hasN = true; nrm.push(row.nx, row.ny, row.nz); }
      const s = row.s ?? row.u ?? row.texture_u; if (s !== undefined) { hasT = true; uvs.push(s, row.t ?? row.v ?? row.texture_v); }
      if ('red' in row) { hasC = true; const sc = el.props.find((q) => q.name === 'red').type.includes('float') ? 1 : 255; col.push(row.red / sc, row.green / sc, row.blue / sc); }
    } else if (el.name === 'face' && list) { for (let k = 1; k + 1 < list.length; k++) { idx.push(list[0], list[k], list[k + 1]); if ('red' in row) fcols.push([row.red / 255, row.green / 255, row.blue / 255, (row.alpha ?? 255) / 255]); } }
  }
  const m = { positions: pos, indices: idx };
  if (hasN) m.normals = nrm; if (hasT) m.uvs = uvs; if (hasC) m.colors = col;
  if (fcols.length === idx.length / 3 && fcols.length) { const map = new Map(); m.materials = []; m.faceMaterial = fcols.map((c) => { const k = c.join(','); if (!map.has(k)) { map.set(k, m.materials.length); m.materials.push({ name: `color${m.materials.length}`, color: c }); } return map.get(k); }); }
  return fromFile(m, o, FORMATS.ply);
}

// ---------------- glTF 2.0 / GLB ----------------
function buildGltf(mesh, o) {
  const m = toFile(mesh, o, FORMATS.glb), p = m.positions, nV = p.length / 3, name = o.name || 'mesh';
  const chunks = [], views = [], accessors = []; let len = 0;
  const add = (bytes, target) => { const off = len; chunks.push(bytes); len += bytes.length; const pad = (4 - (len % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); len += pad; } views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) }); return views.length - 1; };
  const f32a = (arr) => { const b = new Uint8Array(arr.length * 4), dv = new DataView(b.buffer); for (let i = 0; i < arr.length; i++) dv.setFloat32(i * 4, arr[i], true); return b; };
  const u32a = (arr) => { const b = new Uint8Array(arr.length * 4), dv = new DataView(b.buffer); for (let i = 0; i < arr.length; i++) dv.setUint32(i * 4, arr[i], true); return b; };
  const acc = (view, type, count, extra = {}) => { accessors.push({ bufferView: view, componentType: 5126, count, type, ...extra }); return accessors.length - 1; };
  const bb = bounds({ positions: p });
  const attrs = { POSITION: acc(add(f32a(p), 34962), 'VEC3', nV, { min: bb.min.map(f32), max: bb.max.map(f32) }) };
  if (m.normals) attrs.NORMAL = acc(add(f32a(m.normals), 34962), 'VEC3', nV);
  if (m.uvs) attrs.TEXCOORD_0 = acc(add(f32a(m.uvs), 34962), 'VEC2', nV);
  if (m.colors) attrs.COLOR_0 = acc(add(f32a(m.colors), 34962), 'VEC3', nV);
  const groups = new Map(); // material index -> triangle index list (stable order)
  const T = m.indices.length / 3;
  for (let t = 0; t < T; t++) { const g = m.faceMaterial && m.materials ? m.faceMaterial[t] : -1; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]); }
  const prims = [];
  for (const g of [...groups.keys()].sort((a, b) => a - b)) {
    const ia = groups.get(g); const pr = { attributes: attrs, indices: acc(add(u32a(ia), 34963), 'SCALAR', ia.length, { componentType: 5125 }), mode: 4 };
    if (g >= 0) pr.material = g; prims.push(pr);
  }
  const g = { asset: { version: '2.0', generator: 'game-factory mesh-io.js' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }], meshes: [{ name, primitives: prims }], accessors, bufferViews: views, buffers: [{ byteLength: len }] };
  if (m.materials && m.faceMaterial) g.materials = m.materials.map((mt) => ({ name: mt.name, pbrMetallicRoughness: { baseColorFactor: [mt.color[0], mt.color[1], mt.color[2], mt.color[3] ?? 1].map(f32), metallicFactor: 0, roughnessFactor: 1 }, ...((mt.color[3] ?? 1) < 1 ? { alphaMode: 'BLEND' } : {}), doubleSided: false }));
  const bin = new Uint8Array(len); let off = 0; for (const c of chunks) { bin.set(c, off); off += c.length; }
  return { g, bin };
}
const b64 = (u8) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < u8.length; i += 3) { const n = (u8[i] << 16) | ((u8[i + 1] ?? 0) << 8) | (u8[i + 2] ?? 0); s += A[n >> 18 & 63] + A[n >> 12 & 63] + (i + 1 < u8.length ? A[n >> 6 & 63] : '=') + (i + 2 < u8.length ? A[n & 63] : '='); } return s; };
export function writeGLB(mesh, o = {}) {
  const { g, bin } = buildGltf(mesh, o);
  let json = enc.encode(JSON.stringify(g)); const jp = (4 - (json.length % 4)) % 4;
  if (jp) { const j = new Uint8Array(json.length + jp).fill(0x20); j.set(json); json = j; }
  const total = 12 + 8 + json.length + 8 + bin.length, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(json, 20);
  const o2 = 20 + json.length; dv.setUint32(o2, bin.length, true); dv.setUint32(o2 + 4, 0x004E4942, true); out.set(bin, o2 + 8);
  return out;
}
// {gltf: string (JSON), bin: Uint8Array|null, uri}. options.embed:true inlines the buffer as a data URI (single file, bin null).
export function writeGLTF(mesh, o = {}) {
  const { g, bin } = buildGltf(mesh, o), uri = o.binName || `${safe(o.name || 'mesh')}.bin`;
  g.buffers[0].uri = o.embed ? `data:application/octet-stream;base64,${b64(bin)}` : uri;
  return { gltf: JSON.stringify(g, null, 1) + '\n', bin: o.embed ? null : bin, uri: o.embed ? null : uri };
}
const COMP = { 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] }, NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
export function parseGLB(data, o = {}) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 20 || dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('unsupported GLB version');
  let off = 12, json = null, bin = null;
  while (off + 8 <= u8.length) { const cl = dv.getUint32(off, true), ct = dv.getUint32(off + 4, true), body = u8.subarray(off + 8, off + 8 + cl); if (ct === 0x4E4F534A) json = JSON.parse(dec.decode(body)); else if (ct === 0x004E4942 && !bin) bin = body; off += 8 + cl + ((4 - (cl % 4)) % 4); }
  if (!json) throw new Error('GLB has no JSON chunk');
  return parseGLTF(json, o.buffers || [bin], o);
}
// json: object or string; buffers: array of Uint8Array (index = buffer id). data: URIs are decoded; other URIs need options.buffers.
export function parseGLTF(json, buffers = [], o = {}) {
  const g = typeof json === 'string' ? JSON.parse(json) : json, bufs = (g.buffers || []).map((b, i) => {
    if (buffers[i]) return buffers[i];
    if (b.uri && b.uri.startsWith('data:')) { const s = atob(b.uri.slice(b.uri.indexOf(',') + 1)); const r = new Uint8Array(s.length); for (let k = 0; k < s.length; k++) r[k] = s.charCodeAt(k); return r; }
    throw new Error(`glTF buffer ${i} (${b.uri}) not supplied`);
  });
  const read = (ai) => {
    const a = g.accessors[ai], v = g.bufferViews[a.bufferView], [sz, fn] = COMP[a.componentType], nc = NCOMP[a.type], stride = v.byteStride || sz * nc, buf = bufs[v.buffer];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), base = (v.byteOffset || 0) + (a.byteOffset || 0), out = new Array(a.count * nc);
    const normDiv = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] || 1 : 1;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < nc; k++) out[i * nc + k] = dv[fn](base + i * stride + k * sz, true) / normDiv;
    return out;
  };
  const mats = [], matMap = new Map(), pos = [], idx = [], uv = [], nr = [], col = [], fm = [];
  let anyUV = false, anyN = false, anyC = false; const parts = [];
  const mul = (a, b) => { const r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k]; return r; };
  const local = (n) => { if (n.matrix) return n.matrix; const [x, y, z, w] = n.rotation || [0, 0, 0, 1], t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1]; return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0, 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0, 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1]; };
  const visit = (ni, parent) => { const n = g.nodes[ni], M = mul(parent, local(n)); if (n.mesh !== undefined) parts.push([n.mesh, M]); (n.children || []).forEach((c) => visit(c, M)); };
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (g.nodes) (g.scenes?.[g.scene ?? 0]?.nodes || g.nodes.map((_, i) => i)).forEach((n) => visit(n, I4)); else (g.meshes || []).forEach((_, i) => parts.push([i, I4]));
  for (const [mi, M] of parts) for (const pr of g.meshes[mi].primitives) {
    if ((pr.mode ?? 4) !== 4) continue;
    const P = read(pr.attributes.POSITION), base = pos.length / 3, N = pr.attributes.NORMAL !== undefined ? read(pr.attributes.NORMAL) : null, U = pr.attributes.TEXCOORD_0 !== undefined ? read(pr.attributes.TEXCOORD_0) : null, C = pr.attributes.COLOR_0 !== undefined ? read(pr.attributes.COLOR_0) : null;
    const cn = pr.attributes.COLOR_0 !== undefined ? NCOMP[g.accessors[pr.attributes.COLOR_0].type] : 3;
    for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; pos.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]); }
    if (N) anyN = true; if (U) anyUV = true; if (C) anyC = true;
    for (let i = 0; i < P.length / 3; i++) { nr.push(...(N ? [M[0] * N[i * 3] + M[4] * N[i * 3 + 1] + M[8] * N[i * 3 + 2], M[1] * N[i * 3] + M[5] * N[i * 3 + 1] + M[9] * N[i * 3 + 2], M[2] * N[i * 3] + M[6] * N[i * 3 + 1] + M[10] * N[i * 3 + 2]] : [0, 0, 1])); uv.push(...(U ? [U[i * 2], U[i * 2 + 1]] : [0, 0])); col.push(...(C ? [C[i * cn], C[i * cn + 1], C[i * cn + 2]] : [1, 1, 1])); }
    const ind = pr.indices !== undefined ? read(pr.indices) : P.map((_, i) => i).slice(0, P.length / 3);
    let mat = 0;
    if (pr.material !== undefined) { if (!matMap.has(pr.material)) { const gm = g.materials?.[pr.material] || {}, bc = gm.pbrMetallicRoughness?.baseColorFactor || [.8, .8, .8, 1]; matMap.set(pr.material, mats.length); mats.push({ name: gm.name || `material${pr.material}`, color: bc.slice() }); } mat = matMap.get(pr.material); } else { if (!matMap.has(-1)) { matMap.set(-1, mats.length); mats.push({ name: 'default', color: [.8, .8, .8, 1] }); } mat = matMap.get(-1); }
    for (let i = 0; i < ind.length; i += 3) { idx.push(ind[i] + base, ind[i + 1] + base, ind[i + 2] + base); fm.push(mat); }
  }
  const m = { positions: pos, indices: idx };
  if (anyN) m.normals = nr; if (anyUV) m.uvs = uv; if (anyC) m.colors = col;
  if (g.materials?.length) { m.materials = mats; m.faceMaterial = fm; }
  return fromFile(m, o, FORMATS.glb);
}

// ---------------- ZIP (STORE writer, STORE+DEFLATE reader) + 3MF ----------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// files: [{name, data: Uint8Array|string}] in the given order. Fixed DOS timestamp 1980-01-01 so output is byte-reproducible.
export function zipStore(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), d = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(d);
    const lh = new Uint8Array(30 + nm.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, d.length, true); dv.setUint32(22, d.length, true); dv.setUint16(26, nm.length, true); dv.setUint16(28, 0, true); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, d.length, true); cv.setUint32(24, d.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, off, true); ch.set(nm, 46);
    parts.push(lh, d); central.push(ch); off += lh.length + d.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}
// -> Map name -> Uint8Array. Verifies CRC32 of every entry. Deflated entries (method 8) need options.inflate.
export function unzip(data, o = {}) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file (no end-of-central-directory)');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = new Map();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)), ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(ds, ds + csz);
    let d; if (method === 0) d = raw; else if (method === 8) { if (!o.inflate) throw new Error(`zip entry ${name} is deflated; pass options.inflate`); d = o.inflate(raw); } else throw new Error(`zip method ${method} unsupported`);
    if (crc32(d) !== crc) throw new Error(`zip CRC mismatch for ${name}`);
    out.set(name, d); p += 46 + nl + el + cl;
  }
  return out;
}
export const write3MF = (mesh, o = {}) => {
  const def = FORMATS['3mf'], unit = o.units === 'm' ? 'meter' : 'millimeter', m0 = toFile(mesh, { ...o, units: o.units || 'mm', up: 'Z' }, def), m = weld(m0, 1e-6), p = m.positions, name = o.name || 'mesh';
  const hasMat = !!(m.materials && m.faceMaterial);
  const x = ['<?xml version="1.0" encoding="UTF-8"?>', `<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`, `<metadata name="Title">${esc(name)}</metadata>`, '<metadata name="Application">game-factory mesh-io.js</metadata>', '<resources>'];
  if (hasMat) { x.push('<basematerials id="2">'); for (const mt of m.materials) x.push(`<base name="${esc(mt.name)}" displaycolor="${hex(mt.color)}"/>`); x.push('</basematerials>'); }
  x.push(`<object id="1" type="model"${hasMat ? ' pid="2" pindex="0"' : ''} name="${esc(name)}">`, '<mesh>', '<vertices>');
  for (let i = 0; i < p.length; i += 3) x.push(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>`);
  x.push('</vertices>', '<triangles>');
  for (let t = 0; t < m.indices.length; t += 3) x.push(`<triangle v1="${m.indices[t]}" v2="${m.indices[t + 1]}" v3="${m.indices[t + 2]}"${hasMat ? ` pid="2" p1="${m.faceMaterial[t / 3]}"` : ''}/>`);
  x.push('</triangles>', '</mesh>', '</object>', '</resources>', '<build>', '<item objectid="1"/>', '</build>', '</model>');
  const ct = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zipStore([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: '3D/3dmodel.model', data: x.join('\n') + '\n' }]);
};
export function parse3MF(data, o = {}) {
  const files = unzip(data, o); let path = '3D/3dmodel.model';
  const rels = files.get('_rels/.rels'); if (rels) { const r = /Target="([^"]+)"[^>]*Type="[^"]*3dmodel"/.exec(dec.decode(rels)) || /Type="[^"]*3dmodel"[^>]*Target="([^"]+)"/.exec(dec.decode(rels)); if (r) path = r[1].replace(/^\//, ''); }
  const xml = files.get(path); if (!xml) throw new Error(`3MF has no ${path}`);
  const s = dec.decode(xml), attr = (tag, k) => { const r = new RegExp(`\\b${k}="([^"]*)"`).exec(tag); return r ? r[1] : undefined; };
  const unit = attr(/<(?:\w+:)?model\b[^>]*>/.exec(s)?.[0] || '', 'unit') || 'millimeter', toMM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unit] ?? 1;
  const mats = []; const bm = new Map(); // `${pid}:${idx}` -> material index
  for (const r of s.matchAll(/<(?:\w+:)?basematerials\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?basematerials>/g)) { const pid = attr(r[1], 'id'); let i = 0; for (const b of r[2].matchAll(/<(?:\w+:)?base\b[^>]*>/g)) { const c = (attr(b[0], 'displaycolor') || '#CCCCCC').replace('#', ''), n = parseInt(c.slice(0, 6), 16); bm.set(`${pid}:${i++}`, mats.length); mats.push({ name: attr(b[0], 'name') || `m${mats.length}`, color: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, c.length >= 8 ? parseInt(c.slice(6, 8), 16) / 255 : 1] }); } }
  const objs = new Map();
  for (const r of s.matchAll(/<(?:\w+:)?object\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?object>)/g)) {
    const id = attr(r[1], 'id'), body = r[2] || '', pos = [], tri = [], fm = [], opid = attr(r[1], 'pid'), opi = attr(r[1], 'pindex');
    for (const v of body.matchAll(/<(?:\w+:)?vertex\b[^>]*>/g)) pos.push(+attr(v[0], 'x'), +attr(v[0], 'y'), +attr(v[0], 'z'));
    for (const t of body.matchAll(/<(?:\w+:)?triangle\b[^>]*>/g)) { tri.push(+attr(t[0], 'v1'), +attr(t[0], 'v2'), +attr(t[0], 'v3')); const pid = attr(t[0], 'pid') ?? opid, p1 = attr(t[0], 'p1') ?? opi; fm.push(pid !== undefined && p1 !== undefined && bm.has(`${pid}:${p1}`) ? bm.get(`${pid}:${p1}`) : -1); }
    const comps = [...body.matchAll(/<(?:\w+:)?component\b[^>]*>/g)].map((c) => ({ id: attr(c[0], 'objectid'), tr: attr(c[0], 'transform') }));
    objs.set(id, { pos, tri, fm, comps });
  }
  const parseT = (t) => (t ? t.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const apply = (pos, T) => { const out = pos.slice(); for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2]; out[i] = x * T[0] + y * T[3] + z * T[6] + T[9]; out[i + 1] = x * T[1] + y * T[4] + z * T[7] + T[10]; out[i + 2] = x * T[2] + y * T[5] + z * T[8] + T[11]; } return out; };
  const compose = (a, b) => { const r = new Array(12).fill(0); for (let c = 0; c < 3; c++) { for (let k = 0; k < 3; k++) r[k * 3 + c] = a[k * 3] * b[c] + a[k * 3 + 1] * b[3 + c] + a[k * 3 + 2] * b[6 + c]; r[9 + c] = a[9] * b[c] + a[10] * b[3 + c] + a[11] * b[6 + c] + b[9 + c]; } return r; };
  const pos = [], idx = [], fm = [];
  const emit = (id, T, depth = 0) => { const ob = objs.get(id); if (!ob || depth > 8) return; if (ob.pos.length) { const base = pos.length / 3; pos.push(...apply(ob.pos, T)); for (const i of ob.tri) idx.push(i + base); fm.push(...ob.fm); } for (const c of ob.comps) emit(c.id, compose(parseT(c.tr), T), depth + 1); };
  const items = [...s.matchAll(/<(?:\w+:)?item\b[^>]*>/g)];
  if (items.length) for (const it of items) emit(attr(it[0], 'objectid'), parseT(attr(it[0], 'transform'))); else for (const id of objs.keys()) emit(id, parseT(null));
  const m = { positions: pos.map((x) => x * toMM), indices: idx };
  if (mats.length && fm.length) { const used = new Map(); const nm = []; m.faceMaterial = fm.map((x) => { const k = x < 0 ? -1 : x; if (!used.has(k)) { used.set(k, nm.length); nm.push(k < 0 ? { name: 'default', color: [.8, .8, .8, 1] } : mats[k]); } return used.get(k); }); m.materials = nm; }
  return fromFile(m, { ...o, units: 'mm' }, FORMATS['3mf']); // already converted to mm above; only up-axis option applies
}

// ---------------- dispatch ----------------
export const detectFormat = (nameOrBytes) => {
  if (typeof nameOrBytes === 'string') { const e = nameOrBytes.toLowerCase().split('.').pop(); return ({ obj: 'obj', stl: 'stl', ply: 'ply', glb: 'glb', gltf: 'gltf', '3mf': '3mf' })[e] || null; }
  const u = nameOrBytes; if (u.length > 4) { const s = dec.decode(u.subarray(0, 4)); if (s === 'glTF') return 'glb'; if (s === 'ply\n' || s.startsWith('ply')) return 'ply'; if (u[0] === 0x50 && u[1] === 0x4B) return '3mf'; }
  return null;
};
// Write any format -> [{name, data: Uint8Array}] (obj may add .mtl, gltf may add .bin). basename without extension.
export function writeMesh(mesh, format, o = {}) {
  const base = o.basename || o.name || 'mesh', opt = { ...o, name: o.name || base };
  switch (format) {
    case 'obj': { const r = writeOBJ(mesh, { ...opt, mtlName: `${base}.mtl` }); return [{ name: `${base}.obj`, data: enc.encode(r.obj) }, ...(r.mtl ? [{ name: `${base}.mtl`, data: enc.encode(r.mtl) }] : [])]; }
    case 'stl': return [{ name: `${base}.stl`, data: writeSTL(mesh, opt) }];
    case 'stl-ascii': return [{ name: `${base}.stl`, data: writeSTL(mesh, { ...opt, ascii: true }) }];
    case 'ply': return [{ name: `${base}.ply`, data: writePLY(mesh, opt) }];
    case 'glb': return [{ name: `${base}.glb`, data: writeGLB(mesh, opt) }];
    case 'gltf': { const r = writeGLTF(mesh, { ...opt, binName: `${base}.bin` }); return [{ name: `${base}.gltf`, data: enc.encode(r.gltf) }, ...(r.bin ? [{ name: `${base}.bin`, data: r.bin }] : [])]; }
    case '3mf': return [{ name: `${base}.3mf`, data: write3MF(mesh, opt) }];
    default: throw new Error(`unknown format "${format}" (obj stl stl-ascii ply glb gltf 3mf)`);
  }
}
// data: Uint8Array|string. format optional (detected from bytes). extras: {mtl:string, buffers:[Uint8Array]} for obj/gltf.
export function readMesh(data, format, o = {}) {
  const u8 = typeof data === 'string' ? enc.encode(data) : data, f = format || detectFormat(u8) || (dec.decode(u8.subarray(0, 64)).includes('solid') ? 'stl' : null);
  switch (f) {
    case 'obj': return parseOBJ(typeof data === 'string' ? data : dec.decode(u8), o);
    case 'stl': case 'stl-ascii': return parseSTL(u8, o);
    case 'ply': return parsePLY(u8, o);
    case 'glb': return parseGLB(u8, o);
    case 'gltf': return parseGLTF(dec.decode(u8), o.buffers || [], o);
    case '3mf': return parse3MF(u8, o);
    default: throw new Error(`cannot detect format${format ? ` "${format}"` : ''}`);
  }
}
