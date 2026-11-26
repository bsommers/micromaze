// Animated glTF/GLB support: parse skeletons, skins and animation clips; evaluate poses; skin vertices; play/crossfade clips;
// merge clips from several .glb files that share a rig. Browser-safe (no node imports), renderer-agnostic: the output is joint
// matrices (for GPU skinning) or skinned positions (CPU skinning, for canvas/software/raytrace/collision).
// Conventions: glTF = metres, Y up, right-handed. Matrices are column-major Float32Array(16), like glTF.
// Not supported (reported in model.warnings, never silently dropped): Draco / meshopt compressed meshes (error), morph targets,
// non-triangle primitives, external .bin/.png URIs in .gltf (use .glb).

const TA = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const COMPRESSED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization'];
const dec = new TextDecoder();

export class UnsupportedError extends Error { constructor(m) { super(m); this.code = 'UNSUPPORTED'; } }

// ---------------- container ----------------
export function splitGLB(data) {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (u.length < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (missing glTF magic)');
  if (dv.getUint32(4, true) !== 2) throw new Error('only GLB version 2 is supported');
  let off = 12, json = null, bin = null;
  while (off + 8 <= u.length) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), body = u.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(dec.decode(body)); else if (type === 0x004e4942 && !bin) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4) * 0; // chunk lengths are already 4-aligned in valid files
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin: bin || new Uint8Array(0) };
}
export function joinGLB(json, bin) {
  const j = new TextEncoder().encode(JSON.stringify(json)), jp = (4 - (j.length % 4)) % 4, bp = (4 - (bin.length % 4)) % 4;
  const jl = j.length + jp, bl = bin.length + bp, total = 12 + 8 + jl + (bin.length ? 8 + bl : 0), out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); out.set(j, 20); out.fill(0x20, 20 + j.length, 20 + jl);
  if (bin.length) { const o = 20 + jl; dv.setUint32(o, bl, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8); }
  return out;
}

// ---------------- accessors ----------------
export function readAccessor(json, bin, idx) {
  const a = json.accessors?.[idx]; if (!a) throw new Error(`accessor ${idx} missing`);
  const T = TA[a.componentType], n = NC[a.type], count = a.count; if (!T || !n) throw new Error(`accessor ${idx}: bad type`);
  const out = new (a.normalized ? Float32Array : T)(count * n);
  if (a.bufferView !== undefined) {
    const bv = json.bufferViews[a.bufferView], base = (bv.byteOffset || 0) + (a.byteOffset || 0), es = T.BYTES_PER_ELEMENT * n, stride = bv.byteStride || es;
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let i = 0; i < count; i++) for (let k = 0; k < n; k++) {
      const v = dv[get](base + i * stride + k * T.BYTES_PER_ELEMENT, true);
      out[i * n + k] = a.normalized ? Math.max(v / NORM[a.componentType], -1) : v;
    }
  }
  if (a.sparse) {
    const sp = a.sparse, ib = json.bufferViews[sp.indices.bufferView], vb = json.bufferViews[sp.values.bufferView];
    const IT = TA[sp.indices.componentType], idv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < sp.count; i++) {
      const at = (ib.byteOffset || 0) + (sp.indices.byteOffset || 0) + i * IT.BYTES_PER_ELEMENT;
      const target = IT === Uint8Array ? idv.getUint8(at) : IT === Uint16Array ? idv.getUint16(at, true) : idv.getUint32(at, true);
      for (let k = 0; k < n; k++) out[target * n + k] = idv.getFloat32((vb.byteOffset || 0) + (sp.values.byteOffset || 0) + (i * n + k) * 4, true);
    }
  }
  return out;
}

// ---------------- parse ----------------
export function parseAnimGLB(data) {
  const { json, bin } = splitGLB(data), warnings = [];
  const req = (json.extensionsRequired || []).filter((e) => COMPRESSED.includes(e) && e !== 'KHR_mesh_quantization');
  const uses = (json.extensionsUsed || []).filter((e) => e === 'KHR_draco_mesh_compression' || e === 'EXT_meshopt_compression');
  if (req.length || uses.length) throw new UnsupportedError(`compressed geometry (${[...new Set([...req, ...uses])].join(', ')}) is not supported. Re-export without Draco/meshopt compression (Meshy: untick compression; or decode with \`npx @gltf-transform/cli copy in.glb out.glb\`).`);
  for (const b of json.buffers || []) if (b.uri && !b.uri.startsWith('data:')) throw new UnsupportedError('external .bin buffers are not supported; use a self-contained .glb');
  const nodes = (json.nodes || []).map((n, i) => {
    const o = { index: i, name: n.name || `node${i}`, children: n.children || [], mesh: n.mesh, skin: n.skin, t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1] };
    if (n.matrix) Object.assign(o, decompose(n.matrix));
    return o;
  });
  const parent = new Array(nodes.length).fill(-1); nodes.forEach((n) => n.children.forEach((c) => { parent[c] = n.index; }));
  const scene = json.scenes?.[json.scene ?? 0]; const roots = scene?.nodes ?? nodes.filter((n) => parent[n.index] < 0).map((n) => n.index);
  const meshes = (json.meshes || []).map((m, mi) => ({
    name: m.name || `mesh${mi}`,
    primitives: (m.primitives || []).flatMap((p, pi) => {
      const mode = p.mode ?? 4; if (mode !== 4) { warnings.push(`mesh ${mi} primitive ${pi}: mode ${mode} (not triangles) skipped`); return []; }
      if (p.targets?.length) warnings.push(`mesh ${mi} primitive ${pi}: ${p.targets.length} morph targets ignored`);
      const A = p.attributes, pos = readAccessor(json, bin, A.POSITION), nv = pos.length / 3;
      const idx = p.indices !== undefined ? Uint32Array.from(readAccessor(json, bin, p.indices)) : Uint32Array.from({ length: nv }, (_, i) => i);
      return [{ positions: pos, normals: A.NORMAL !== undefined ? readAccessor(json, bin, A.NORMAL) : null, uvs: A.TEXCOORD_0 !== undefined ? readAccessor(json, bin, A.TEXCOORD_0) : null,
        indices: idx, joints: A.JOINTS_0 !== undefined ? Uint16Array.from(readAccessor(json, bin, A.JOINTS_0)) : null, weights: A.WEIGHTS_0 !== undefined ? readAccessor(json, bin, A.WEIGHTS_0) : null, material: p.material }];
    }),
  }));
  const skins = (json.skins || []).map((s, si) => ({ name: s.name || `skin${si}`, joints: s.joints, skeleton: s.skeleton,
    inverseBind: s.inverseBindMatrices !== undefined ? readAccessor(json, bin, s.inverseBindMatrices) : identities(s.joints.length) }));
  const animations = (json.animations || []).map((a, ai) => {
    const channels = [];
    for (const c of a.channels) {
      const s = a.samplers[c.sampler], path = c.target.path, node = c.target.node;
      if (node === undefined) continue;
      if (path === 'weights') { warnings.push(`animation "${a.name || ai}": morph-weight channel ignored`); continue; }
      channels.push({ node, path, interp: s.interpolation || 'LINEAR', times: readAccessor(json, bin, s.input), values: readAccessor(json, bin, s.output) });
    }
    const duration = channels.reduce((m, c) => Math.max(m, c.times.length ? c.times[c.times.length - 1] : 0), 0);
    return { name: a.name || `clip${ai}`, duration, channels };
  });
  const materials = (json.materials || []).map((m, i) => ({ name: m.name || `material${i}`, baseColor: m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1], baseColorTexture: m.pbrMetallicRoughness?.baseColorTexture?.index }));
  const images = (json.images || []).map((im) => im.bufferView !== undefined ? (() => { const bv = json.bufferViews[im.bufferView]; return { mime: im.mimeType, bytes: bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) }; })() : { mime: im.mimeType, uri: im.uri });
  const textures = (json.textures || []).map((t) => ({ image: t.source }));
  const model = { nodes, parent, roots, meshes, skins, animations, materials, textures, images, warnings, asset: json.asset || {} };
  if (!skins.length && animations.length) warnings.push('animations present but no skin: only node (rigid) animation can be played');
  return model;
}

const identities = (n) => { const a = new Float32Array(16 * n); for (let i = 0; i < n; i++) { a[i * 16] = a[i * 16 + 5] = a[i * 16 + 10] = a[i * 16 + 15] = 1; } return a; };

// ---------------- math ----------------
export const mat4 = {
  identity: () => identities(1),
  mul(a, b, o = new Float32Array(16)) { const r = new Float32Array(16); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k]; r[c * 4 + rr] = s; } o.set(r); return o; },
  fromTRS(t, q, s, o = new Float32Array(16)) {
    const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    o[0] = (1 - (yy + zz)) * s[0]; o[1] = (xy + wz) * s[0]; o[2] = (xz - wy) * s[0]; o[3] = 0;
    o[4] = (xy - wz) * s[1]; o[5] = (1 - (xx + zz)) * s[1]; o[6] = (yz + wx) * s[1]; o[7] = 0;
    o[8] = (xz + wy) * s[2]; o[9] = (yz - wx) * s[2]; o[10] = (1 - (xx + yy)) * s[2]; o[11] = 0;
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1; return o;
  },
  invert(m) {
    const a = m, o = new Float32Array(16), b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!d) return identities(1); d = 1 / d;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d; return o;
  },
  point(m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; },
};
function decompose(m) {
  const t = [m[12], m[13], m[14]], sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz], tr = r[0] + r[4] + r[8]; let q;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; q = [(r[5] - r[7]) / S, (r[6] - r[2]) / S, (r[1] - r[3]) / S, S / 4]; }
  else if (r[0] > r[4] && r[0] > r[8]) { const S = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2; q = [S / 4, (r[1] + r[3]) / S, (r[6] + r[2]) / S, (r[5] - r[7]) / S]; }
  else if (r[4] > r[8]) { const S = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2; q = [(r[1] + r[3]) / S, S / 4, (r[5] + r[7]) / S, (r[6] - r[2]) / S]; }
  else { const S = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2; q = [(r[6] + r[2]) / S, (r[5] + r[7]) / S, S / 4, (r[1] - r[3]) / S]; }
  return { t, r: q, s: [sx, sy, sz] };
}
const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1; if (d < 0) { d = -d; s = -1; }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + t * (s * b[i] - v)));
  const th = Math.acos(d), sn = Math.sin(th), wa = Math.sin((1 - t) * th) / sn, wb = Math.sin(t * th) / sn * s;
  return a.map((v, i) => v * wa + b[i] * wb);
}

// ---------------- sampling ----------------
const compsOf = (path) => (path === 'rotation' ? 4 : 3);
export function sampleChannel(ch, time) {
  const { times, values, interp } = ch, n = compsOf(ch.path), cs = interp === 'CUBICSPLINE';
  const last = times.length - 1, get = (k) => { const o = cs ? (k * 3 + 1) * n : k * n; return Array.from(values.subarray(o, o + n)); };
  if (last < 0) return null;
  if (time <= times[0]) return get(0);
  if (time >= times[last]) return get(last);
  let lo = 0, hi = last; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
  const t0 = times[lo], t1 = times[hi], dt = t1 - t0, u = dt > 0 ? (time - t0) / dt : 0;
  if (interp === 'STEP') return get(lo);
  if (cs) {
    const p0 = get(lo), p1 = get(hi), m0 = Array.from(values.subarray((lo * 3 + 2) * n, (lo * 3 + 3) * n)), m1 = Array.from(values.subarray((hi * 3) * n, (hi * 3 + 1) * n));
    const u2 = u * u, u3 = u2 * u, r = p0.map((_, i) => (2 * u3 - 3 * u2 + 1) * p0[i] + (u3 - 2 * u2 + u) * dt * m0[i] + (-2 * u3 + 3 * u2) * p1[i] + (u3 - u2) * dt * m1[i]);
    return ch.path === 'rotation' ? qnorm(r) : r;
  }
  const a = get(lo), b = get(hi);
  return ch.path === 'rotation' ? slerp(a, b, u) : a.map((v, i) => v + u * (b[i] - v));
}

/** Local TRS per node at `time` of `clip` (null clip = bind pose). Returns {t:[],r:[],s:[]} arrays indexed by node. */
export function poseAt(model, clip, time, loop = true) {
  const pose = model.nodes.map((n) => ({ t: n.t.slice(), r: n.r.slice(), s: n.s.slice() }));
  if (!clip) return pose;
  let tt = time; if (clip.duration > 0) tt = loop ? ((time % clip.duration) + clip.duration) % clip.duration : Math.min(Math.max(time, 0), clip.duration);
  for (const c of clip.channels) { const v = sampleChannel(c, tt); if (v) pose[c.node][c.path === 'translation' ? 't' : c.path === 'rotation' ? 'r' : 's'] = v; }
  return pose;
}
export function blendPoses(a, b, w) { return a.map((p, i) => ({ t: p.t.map((v, k) => v + w * (b[i].t[k] - v)), r: slerp(p.r, b[i].r, w), s: p.s.map((v, k) => v + w * (b[i].s[k] - v)) })); }

export function worldMatrices(model, pose) {
  const W = new Array(model.nodes.length), done = new Array(model.nodes.length).fill(false);
  const walk = (i, pm) => { const m = mat4.fromTRS(pose[i].t, pose[i].r, pose[i].s); if (pm) mat4.mul(pm, m, m); W[i] = m; done[i] = true; model.nodes[i].children.forEach((c) => walk(c, m)); };
  model.roots.forEach((r) => walk(r, null));
  for (let i = 0; i < W.length; i++) if (!done[i]) walk(i, null);
  return W;
}
/** Joint matrices for skin `si`: jointWorld * inverseBind. Per the glTF spec the skinned mesh node's own transform is ignored,
 *  so skinned vertices come out directly in model (scene root) space. */
export function jointMatrices(model, si, world) {
  const sk = model.skins[si], out = new Float32Array(sk.joints.length * 16), tmp = new Float32Array(16);
  sk.joints.forEach((j, k) => { mat4.mul(world[j], sk.inverseBind.subarray(k * 16, k * 16 + 16), tmp); out.set(tmp, k * 16); });
  return out;
}
/** CPU skinning: bind-pose primitive + joint matrices -> Float32Array positions (and normals when asked). */
export function skinPrimitive(prim, jm, o = {}) {
  const nv = prim.positions.length / 3, pos = o.positions || new Float32Array(nv * 3), nor = prim.normals && o.normals !== false ? (o.normalsOut || new Float32Array(nv * 3)) : null;
  if (!prim.joints || !prim.weights) { pos.set(prim.positions); if (nor) nor.set(prim.normals); return { positions: pos, normals: nor }; }
  for (let v = 0; v < nv; v++) {
    const px = prim.positions[v * 3], py = prim.positions[v * 3 + 1], pz = prim.positions[v * 3 + 2]; let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0, ws = 0;
    for (let k = 0; k < 4; k++) {
      const w = prim.weights[v * 4 + k]; if (!w) continue; const m = prim.joints[v * 4 + k] * 16; ws += w;
      x += w * (jm[m] * px + jm[m + 4] * py + jm[m + 8] * pz + jm[m + 12]); y += w * (jm[m + 1] * px + jm[m + 5] * py + jm[m + 9] * pz + jm[m + 13]); z += w * (jm[m + 2] * px + jm[m + 6] * py + jm[m + 10] * pz + jm[m + 14]);
      if (nor) { const ax = prim.normals[v * 3], ay = prim.normals[v * 3 + 1], az = prim.normals[v * 3 + 2]; nx += w * (jm[m] * ax + jm[m + 4] * ay + jm[m + 8] * az); ny += w * (jm[m + 1] * ax + jm[m + 5] * ay + jm[m + 9] * az); nz += w * (jm[m + 2] * ax + jm[m + 6] * ay + jm[m + 10] * az); }
    }
    if (!ws) { x = px; y = py; z = pz; } else if (Math.abs(ws - 1) > 1e-6) { x /= ws; y /= ws; z /= ws; }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    if (nor) { const l = Math.hypot(nx, ny, nz) || 1; nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l; }
  }
  return { positions: pos, normals: nor };
}

/** Every skinned/static mesh instance in the model: [{node, mesh, skin}]. */
export const meshInstances = (model) => model.nodes.filter((n) => n.mesh !== undefined).map((n) => ({ node: n.index, mesh: n.mesh, skin: n.skin }));

/** Posed bounding box of the whole model at (clip, time). */
export function posedBounds(model, clip, time) {
  const pose = poseAt(model, clip, time, false), world = worldMatrices(model, pose), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const inst of meshInstances(model)) {
    const jm = inst.skin !== undefined ? jointMatrices(model, inst.skin, world) : null;
    for (const prim of model.meshes[inst.mesh].primitives) {
      const { positions } = jm ? skinPrimitive(prim, jm, { normals: false }) : { positions: prim.positions };
      for (let v = 0; v < positions.length; v += 3) {
        const q = jm ? [positions[v], positions[v + 1], positions[v + 2]] : mat4.point(world[inst.node], positions[v], positions[v + 1], positions[v + 2]);
        for (let k = 0; k < 3; k++) { if (q[k] < min[k]) min[k] = q[k]; if (q[k] > max[k]) max[k] = q[k]; }
      }
    }
  }
  return min[0] === Infinity ? null : { min, max, size: max.map((v, i) => v - min[i]) };
}

// ---------------- player ----------------
const GUESS = [['idle', /idle|stand|breath|rest/i], ['walk', /walk/i], ['run', /run|sprint|jog/i], ['jump', /jump|leap/i], ['fall', /fall|air/i], ['attack', /attack|slash|punch|hit|strike|shoot|cast/i], ['hurt', /hurt|damage|hit_?react|injur/i], ['die', /die|death|dead|defeat/i], ['dance', /danc/i], ['crouch', /crouch|sneak/i]];
/** Map clip names to game states (idle/walk/run/jump/fall/attack/hurt/die/...). Returns {state: clipName}. First match wins. */
export function guessStates(clipNames) { const m = {}; for (const [state, re] of GUESS) { const c = clipNames.find((n) => re.test(n) && !Object.values(m).includes(n)); if (c) m[state] = c; } return m; }

export class AnimPlayer {
  constructor(model, o = {}) {
    this.model = model; this.clips = new Map(model.animations.map((a) => [a.name, a])); this.states = o.states || guessStates([...this.clips.keys()]);
    this.cur = null; this.prev = null; this.fade = 0; this.fadeLen = 0; this.speed = 1; this.finished = false; this.time = 0; this._pose = null;
  }
  /** Start a clip by name. fade seconds crossfades from the current clip. Replaying the same looping clip is a no-op unless restart. */
  play(name, { loop = true, speed = 1, fade = 0.2, restart = false } = {}) {
    const clip = this.clips.get(name); if (!clip) throw new Error(`no clip "${name}" (have: ${[...this.clips.keys()].join(', ') || 'none'})`);
    if (this.cur && this.cur.clip === clip && !restart && this.cur.loop === loop) { this.speed = speed; return this; }
    this.prev = fade > 0 && this.cur ? { ...this.cur } : null; this.fade = 0; this.fadeLen = this.prev ? fade : 0;
    this.cur = { clip, t: 0, loop }; this.speed = speed; this.finished = false; this._pose = null; return this;
  }
  /** Play by game state ("walk") using the state map. Unmapped states fall back to `idle` if present, else are ignored. */
  setState(state, opts) { const n = this.states[state] ?? this.states.idle; if (n) this.play(n, { loop: !['jump', 'attack', 'hurt', 'die'].includes(state), ...opts }); return this; }
  update(dt) {
    if (!this.cur) return this;
    const adv = (s) => { s.t += dt * this.speed; };
    adv(this.cur); if (this.prev) adv(this.prev);
    if (!this.cur.loop && this.cur.t >= this.cur.clip.duration) { this.cur.t = this.cur.clip.duration; this.finished = true; }
    if (this.prev) { this.fade += dt; if (this.fade >= this.fadeLen) this.prev = null; }
    this.time = this.cur.t; this._pose = null; return this;
  }
  pose() {
    if (this._pose) return this._pose; if (!this.cur) return (this._pose = poseAt(this.model, null, 0));
    let p = poseAt(this.model, this.cur.clip, this.cur.t, this.cur.loop);
    if (this.prev) p = blendPoses(poseAt(this.model, this.prev.clip, this.prev.t, this.prev.loop), p, Math.min(1, this.fade / this.fadeLen));
    return (this._pose = p);
  }
  world() { return worldMatrices(this.model, this.pose()); }
  /** Joint matrices per skin index, for GPU skinning. */
  jointMatrices() { const w = this.world(); return this.model.skins.map((_, si) => jointMatrices(this.model, si, w)); }
  /** Skinned geometry for every mesh instance: [{node, mesh, world, primitives:[{positions, normals, indices, uvs, material}]}]; skinned positions are already in model space (world = identity), static ones need `world`. */
  skinned() {
    const w = this.world();
    return meshInstances(this.model).map((inst) => {
      const jm = inst.skin !== undefined ? jointMatrices(this.model, inst.skin, w) : null;
      return { node: inst.node, mesh: inst.mesh, world: jm ? mat4.identity() : w[inst.node], primitives: this.model.meshes[inst.mesh].primitives.map((p) => ({ ...skinPrimitive(p, jm || identities(1)), indices: p.indices, uvs: p.uvs, material: p.material })) };
    });
  }
}

// ---------------- merge animations from several files that share a rig ----------------
/** Append the animations of `others` to `base` (both .glb bytes), matching target nodes by NAME. Returns {glb, added, skipped, warnings}. */
export function mergeAnimGLB(baseData, others, o = {}) {
  const { json, bin } = splitGLB(baseData), baseModel = parseAnimGLB(baseData), byName = new Map(baseModel.nodes.map((n) => [n.name, n.index]));
  if ((json.buffers || []).length > 1) throw new UnsupportedError('base .glb must have a single embedded buffer');
  const chunks = [bin], parts = { len: bin.length + ((4 - (bin.length % 4)) % 4) }; if (parts.len > bin.length) chunks.push(new Uint8Array(parts.len - bin.length));
  json.bufferViews ||= []; json.accessors ||= []; json.animations ||= [];
  const taken = new Set(json.animations.map((a) => a.name)), added = [], skipped = [], warnings = [];
  const push = (arr, comps, type) => {
    const bytes = new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength)), off = parts.len;
    chunks.push(bytes); parts.len += bytes.length; const pad = (4 - (bytes.length % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); parts.len += pad; }
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length });
    const acc = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: arr.length / comps, type };
    if (type === 'SCALAR') { acc.min = [Math.min(...arr)]; acc.max = [Math.max(...arr)]; }
    json.accessors.push(acc); return json.accessors.length - 1;
  };
  for (const src of others) {
    const m = parseAnimGLB(src.data), prefix = src.prefix ?? o.prefix ?? '';
    for (const clip of m.animations) {
      if (src.clips && !src.clips.includes(clip.name)) continue;
      let name = (src.rename?.[clip.name]) ?? (prefix + clip.name); if (taken.has(name)) { if (o.onConflict === 'skip') { skipped.push({ clip: clip.name, from: src.name, reason: 'name exists' }); continue; } let k = 2; const b = name; while (taken.has(name)) name = `${b}_${k++}`; }
      const samplers = [], channels = []; let miss = 0;
      for (const c of clip.channels) {
        const target = byName.get(m.nodes[c.node].name); if (target === undefined) { miss++; continue; }
        const si = samplers.length; samplers.push({ input: push(c.times, 1, 'SCALAR'), output: push(c.values, compsOf(c.path), compsOf(c.path) === 4 ? 'VEC4' : 'VEC3'), interpolation: c.interp });
        channels.push({ sampler: si, target: { node: target, path: c.path } });
      }
      if (!channels.length) { skipped.push({ clip: clip.name, from: src.name, reason: 'no channel matched a node name in the base rig' }); continue; }
      if (miss) warnings.push(`"${name}" (${src.name}): ${miss} of ${clip.channels.length} channels target nodes missing from the base rig and were dropped`);
      json.animations.push({ name, samplers, channels }); taken.add(name); added.push({ name, from: src.name, duration: clip.duration, channels: channels.length });
    }
  }
  const total = new Uint8Array(parts.len); let at = 0; for (const c of chunks) { total.set(c, at); at += c.length; }
  json.buffers = [{ byteLength: total.length }]; return { glb: joinGLB(json, total), added, skipped, warnings };
}
