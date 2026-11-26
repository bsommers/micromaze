import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../../src/lib/mesh.js';
import * as IO from '../../src/lib/mesh-io.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const PI = Math.PI;

test('primitive volumes match analytic formulas and are watertight', () => {
  const cases = [
    ['box', M.box({ size: [2, 3, 4] }), 24, 1e-12], ['sphere', M.sphere({ radius: 2, segments: 96, rings: 48 }), 4 / 3 * PI * 8, 2e-3],
    ['sphere no uv', M.sphere({ radius: 2, segments: 96, rings: 48, uvs: false }), 4 / 3 * PI * 8, 2e-3], ['icosphere', M.icosphere({ radius: 2, subdivisions: 4 }), 4 / 3 * PI * 8, 5e-3],
    ['cylinder', M.cylinder({ radius: 1.5, height: 4, segments: 256 }), PI * 2.25 * 4, 1e-3], ['cone', M.cone({ radius: 2, height: 3, segments: 256 }), PI * 4, 1e-3],
    ['frustum', M.cylinder({ radius: 2, radiusTop: 1, height: 3, segments: 256 }), PI * 3 / 3 * (4 + 2 + 1), 1e-3],
    ['capsule', M.capsule({ radius: 1, height: 2, segments: 128, rings: 32 }), PI * 2 + 4 / 3 * PI, 1e-3], ['torus', M.torus({ radius: 3, tube: 1, segments: 128, tubeSegments: 64 }), 2 * PI * PI * 3, 5e-3],
    ['extrude', M.extrude([[0, 0], [4, 0], [4, 4], [0, 4]], 2, [[[1, 1], [1, 3], [3, 3], [3, 1]]]), 24, 1e-12], ['extrude L', M.extrude([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], 1), 7, 1e-12],
    ['extrude cw input', M.extrude([[0, 0], [0, 2], [2, 2], [2, 0]], 3), 12, 1e-12],
    ['lathe', M.lathe([[0, 0], [2, 0], [2, 1], [0, 1]], { segments: 256 }), PI * 4, 1e-3],
  ];
  for (const [n, m, vol, tol] of cases) { const r = M.validate(m); assert.ok(r.watertight, `${n} watertight ${JSON.stringify([r.boundaryEdges, r.nonManifoldEdges, r.inconsistentEdges])}`); assert.equal(r.shells, 1, n); near(M.volume(m), vol, tol, n); assert.equal(r.inverted, false, n); }
});
test('multi-hole extrude and heightmap', () => {
  const e = M.extrude([[0, 0], [10, 0], [10, 10], [0, 10]], 2, [[[1, 1], [4, 1], [4, 4], [1, 4]], [[6, 6], [9, 6], [9, 9], [6, 9]], [[1, 6], [4, 6], [4, 9], [1, 9]]]);
  assert.ok(M.validate(e).watertight); near(M.volume(e), 146, 1e-12, 'holes');
  const h = M.heightmap([[1, 2, 1], [2, 3, 2], [1, 2, 1]], { cellSize: 1 }); assert.ok(M.validate(h).watertight); assert.ok(M.volume(h) > 0);
});
test('grid/plane is open, with uvs', () => { const g = M.grid({ size: [2, 4], segments: [2, 4] }); assert.equal(g.indices.length / 3, 16); assert.equal(g.uvs.length / 2, g.positions.length / 3); assert.equal(M.validate(g).watertight, false); near(M.surfaceArea(g), 8, 1e-12, 'area'); });
test('transform, mirror, merge, scaleToHeight, centerOnBed, fitToBed, plinth', () => {
  const b = M.box({ size: [2, 2, 2] }), t = M.transform(b, { translate: [5, 0, 0], rotate: [0, 0, 90], scale: [2, 1, 1] });
  near(M.volume(t), 16, 1e-12, 'scaled volume'); near(M.bounds(t).size[1], 4, 1e-9, 'rotated about z'); // x-scale 2 then rot 90 => y extent 4
  const mir = M.transform(b, { scale: [-1, 1, 1] }); assert.ok(M.volume(mir) > 0, 'mirror keeps outward winding');
  assert.ok(M.volume(M.flipNormals(b)) < 0);
  const mm = M.mirror(M.transform(b, { translate: [3, 0, 0] }), 'x', { keep: true }); assert.equal(M.validate(mm).shells, 2); near(M.volume(mm), 16, 1e-12, 'mirrored pair');
  const s = M.scaleToHeight(M.transform(b, { translate: [9, 9, 9] }), 10); assert.deepEqual(M.bounds(s).min.map((x) => +x.toFixed(9)), [-5, -5, 0]); near(M.bounds(s).size[2], 10, 1e-12, 'height');
  const f = M.fitToBed(M.box({ size: [400, 200, 100] }), { x: 200, y: 200, z: 200 }); near(M.bounds(f).size[0], 200, 1e-12, 'fit'); assert.equal(M.bounds(f).min[2], 0);
  assert.equal(M.bounds(M.fitToBed(b, { x: 200, y: 200, z: 200 })).size[0], 2, 'never enlarges by default');
  const p = M.addPlinth(M.centerOnBed(b), { height: 1, margin: 1 }); const r = M.validate(p); assert.equal(r.shells, 2); assert.ok(r.watertight); near(r.volume, 8 + 16, 1e-12, 'plinth');
});
test('weld closes seams and drops collapsed faces; recomputeNormals is unit length', () => {
  const s = M.sphere({ radius: 1, segments: 16, rings: 8 }), w = M.weld(s, 1e-6);
  assert.ok(w.positions.length < s.positions.length); assert.ok(M.validate(w).watertight); near(M.volume(w), M.volume(s), 1e-9, 'weld keeps volume');
  const n = M.recomputeNormals(s); for (let i = 0; i < n.normals.length; i += 3) near(Math.hypot(n.normals[i], n.normals[i + 1], n.normals[i + 2]), 1, 1e-9, 'unit'); near(n.normals[3 * (s.positions.length / 3 - 1) + 2], 1, 1e-9, 'north pole up');
});
test('validation catches planted defects', () => {
  const b = M.box({ size: 2 }), hole = { ...b, indices: b.indices.slice(3) };
  let r = M.validate(hole); assert.equal(r.watertight, false); assert.ok(r.boundaryEdges >= 3);
  assert.equal(M.validate(M.flipNormals(b)).inverted, true);
  const mixed = { ...b, indices: b.indices.slice() }; [mixed.indices[1], mixed.indices[2]] = [mixed.indices[2], mixed.indices[1]]; assert.equal(M.validate(mixed).watertight, false, 'one flipped face is inconsistent');
  const extra = { ...b, indices: [...b.indices, 0, 1, 5] }; assert.ok(M.validate(extra).nonManifoldEdges > 0 || M.validate(extra).boundaryEdges > 0);
  const degen = { positions: [...b.positions, 0, 0, 0], indices: [...b.indices, 0, 0, 1] }; assert.ok(M.validate(degen).degenerateFaces >= 1);
  assert.equal(M.validate(M.merge([b, M.transform(b, { translate: [5, 0, 0] })])).shells, 2);
  assert.equal(M.validate(M.orientShells(M.merge([b, M.flipNormals(M.transform(b, { translate: [5, 0, 0] }))]))).inverted, false);
  assert.equal(M.validate({ positions: [], indices: [] }).watertight, false);
});
test('estimateMinWall finds a thin slab and skips oversize input', () => {
  near(M.estimateMinWall(M.box({ size: [20, 20, 1.5] })).minWall, 1.5, 1e-6, 'slab');
  assert.equal(M.estimateMinWall(M.sphere({ radius: 5, segments: 64, rings: 32 }), { budget: 10 }).minWall, null);
});
test('materials survive merge and weld', () => {
  const a = M.setMaterial(M.box({ size: 1 }), { name: 'a', color: '#ff0000' }), b = M.setMaterial(M.transform(M.box({ size: 1 }), { translate: [3, 0, 0] }), '#00ff00'), m = M.merge([a, b]);
  assert.equal(m.materials.length, 2); assert.equal(m.faceMaterial.length, 24); assert.deepEqual(m.materials[0].color, [1, 0, 0, 1]); assert.equal(M.weld(m).faceMaterial.length, 24);
});
test('deterministic: same recipe gives identical bytes in every format', () => {
  const mk = () => M.merge([M.setMaterial(M.sphere({ radius: 3 }), '#336699'), M.transform(M.torus(), { translate: [0, 0, 5] })]);
  for (const f of ['obj', 'stl', 'stl-ascii', 'ply', 'glb', 'gltf', '3mf']) {
    const a = IO.writeMesh(mk(), f, { basename: 'x' }), b = IO.writeMesh(mk(), f, { basename: 'x' });
    assert.equal(a.length, b.length); a.forEach((x, i) => assert.deepEqual(Buffer.from(x.data), Buffer.from(b[i].data), f));
  }
});
test('sources use no Math.random or Date', () => { for (const f of ['mesh.js', 'mesh-io.js']) { const s = readFileSync(new URL(`../../src/lib/${f}`, import.meta.url), 'utf8'); assert.ok(!/Math\.random|Date\.now|new Date/.test(s), f); } });

// ---- I/O ----
const sample = () => M.merge([M.setMaterial(M.sphere({ radius: 5, segments: 24, rings: 12 }), { name: 'red', color: '#ff0000' }), M.setMaterial(M.transform(M.box({ size: 3 }), { translate: [10, 0, 0] }), { name: 'green', color: '#00ff00' })]);
function roundTrip(f, m) {
  const files = IO.writeMesh(m, f, { basename: 't' }), o = {};
  if (f === 'obj' && files[1]) o.mtl = new TextDecoder().decode(files[1].data);
  if (f === 'gltf' && files[1]) o.buffers = [files[1].data];
  return IO.readMesh(files[0].data, f === 'stl-ascii' ? 'stl' : f, o);
}
test('round trips preserve geometry (bounds, triangles, volume), colours where supported', () => {
  const m = sample(), v = M.volume(m), bs = M.bounds(m).size;
  for (const f of ['obj', 'stl', 'stl-ascii', 'ply', 'glb', 'gltf', '3mf']) {
    const r = roundTrip(f, m), w = M.weld(r, 1e-4);
    assert.equal(M.triangleCount(r), M.triangleCount(m), f); near(M.volume(w), v, 2e-6, f + ' volume'); M.bounds(r).size.forEach((s, i) => near(s, bs[i], 2e-6, f + ' bounds'));
    assert.ok(M.validate(r).watertight, f + ' watertight');
    if (!f.startsWith('stl')) { assert.equal(r.materials.length, 2, f + ' materials'); const names = r.materials.map((x) => x.color.map((c) => Math.round(c))).sort().join('|'); assert.equal(names, '0,1,0,1|1,0,0,1', f + ' colours'); }
  }
});
test('unit and axis options round trip (m, Y up)', () => {
  const m = M.box({ size: [10, 20, 30], center: false });
  for (const f of ['obj', 'stl', 'ply', 'glb', '3mf']) {
    const files = IO.writeMesh(m, f, { basename: 'u', units: 'm', up: 'Y' }); if (f === '3mf') continue; const back = IO.readMesh(files[0].data, f, { units: 'm', up: 'Y' });
    M.bounds(back).size.forEach((s, i) => near(s, [10, 20, 30][i], 1e-5, f)); }
  const y = IO.parseOBJ(IO.writeOBJ(m, { units: 'm', up: 'Y' }).obj, { units: 'mm', up: 'Z' }); // read raw, no conversion back
  assert.deepEqual(M.bounds(y).size.map((x) => +x.toFixed(6)), [0.01, 0.03, 0.02], 'Y-up metres: (x,y,z)->(x,z,-y)*0.001');
});
test('STL binary size, ascii/binary auto-detection, solid-header binary', () => {
  const m = M.box({ size: 2 }), bin = IO.writeSTL(m), asc = IO.writeSTL(m, { ascii: true });
  assert.equal(bin.length, 84 + 50 * 12); assert.ok(new TextDecoder().decode(asc).startsWith('solid')); assert.equal(M.triangleCount(IO.parseSTL(asc)), 12); assert.equal(M.triangleCount(IO.parseSTL(bin)), 12);
  const sneaky = bin.slice(); sneaky.set(new TextEncoder().encode('solid trap'), 0); assert.equal(M.triangleCount(IO.parseSTL(sneaky)), 12, 'size check beats solid header');
  assert.equal(IO.parseSTL(bin).positions.length / 3, 8, 'weld on read');
});
test('GLB structure: header, JSON+BIN chunks, 4-byte alignment, accessor bounds', () => {
  const m = M.recomputeNormals(sample()), g = IO.writeGLB(m), dv = new DataView(g.buffer);
  assert.equal(dv.getUint32(0, true), 0x46546C67); assert.equal(dv.getUint32(4, true), 2); assert.equal(dv.getUint32(8, true), g.length); assert.equal(g.length % 4, 0);
  const jl = dv.getUint32(12, true); assert.equal(dv.getUint32(16, true), 0x4E4F534A); assert.equal(jl % 4, 0);
  const json = JSON.parse(new TextDecoder().decode(g.subarray(20, 20 + jl))), bo = 20 + jl; assert.equal(dv.getUint32(bo + 4, true), 0x004E4942); assert.equal(dv.getUint32(bo, true), json.buffers[0].byteLength);
  assert.equal(json.asset.version, '2.0'); assert.equal(json.meshes[0].primitives.length, 2); assert.equal(json.materials.length, 2);
  for (const v of json.bufferViews) assert.equal(v.byteOffset % 4, 0);
  const pa = json.accessors[json.meshes[0].primitives[0].attributes.POSITION]; assert.equal(pa.type, 'VEC3'); assert.ok(pa.max[1] > pa.min[1]);
  assert.ok(json.meshes[0].primitives[0].attributes.NORMAL !== undefined);
  assert.ok(Math.abs(pa.max[1] - 0.005) < 1e-6 && Math.abs(pa.min[2] + 0.005) < 1e-6, 'Y-up metres: sphere radius 5mm');
  const emb = JSON.parse(IO.writeGLTF(m, { embed: true }).gltf); assert.ok(emb.buffers[0].uri.startsWith('data:application/octet-stream;base64,'));
  assert.equal(M.triangleCount(IO.parseGLTF(emb)), M.triangleCount(m));
});
test('3MF is a valid STORE zip: structure, CRC, unit, materials; reader rejects corruption', () => {
  const z = IO.write3MF(sample()), files = IO.unzip(z); assert.deepEqual([...files.keys()], ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
  const xml = new TextDecoder().decode(files.get('3D/3dmodel.model')); assert.match(xml, /unit="millimeter"/); assert.match(xml, /<basematerials id="2">/); assert.match(xml, /displaycolor="#FF0000FF"/);
  assert.equal(IO.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const bad = z.slice(); bad[bad.length >> 1] ^= 0xff; assert.throws(() => IO.parse3MF(bad));
  assert.equal(new DataView(z.buffer).getUint32(0, true), 0x04034b50);
});
test('parse3MF handles components + transforms + deflate via inflate', async () => {
  const { deflateRawSync, inflateRawSync } = await import('node:zlib');
  const model = `<?xml version="1.0"?><model unit="meter" xmlns="x"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="2" v2="0" v3="3"/></triangles></mesh></object><object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></components></object></resources><build><item objectid="2"/></build></model>`;
  // hand-build a deflated zip by patching a STORE zip: rebuild with method 8
  const raw = new TextEncoder().encode(model), comp = deflateRawSync(raw), crc = IO.crc32(raw), nm = new TextEncoder().encode('3D/3dmodel.model');
  const lh = new Uint8Array(30 + nm.length), l = new DataView(lh.buffer); l.setUint32(0, 0x04034b50, true); l.setUint16(8, 8, true); l.setUint32(14, crc, true); l.setUint32(18, comp.length, true); l.setUint32(22, raw.length, true); l.setUint16(26, nm.length, true); lh.set(nm, 30);
  const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer); c.setUint32(0, 0x02014b50, true); c.setUint16(10, 8, true); c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, 0, true); ch.set(nm, 46);
  const end = new Uint8Array(22), e = new DataView(end.buffer); e.setUint32(0, 0x06054b50, true); e.setUint16(8, 1, true); e.setUint16(10, 1, true); e.setUint32(12, ch.length, true); e.setUint32(16, lh.length + comp.length, true);
  const zip = new Uint8Array([...lh, ...comp, ...ch, ...end]);
  assert.throws(() => IO.parse3MF(zip), /inflate/);
  const m = IO.parse3MF(zip, { inflate: (b) => new Uint8Array(inflateRawSync(b)) });
  assert.equal(M.triangleCount(m), 4); assert.deepEqual(M.bounds(m).min, [2000, 0, 0]); near(M.volume(m), 1e9 / 6, 1e-9, 'meter -> mm, component transform');
});
test('PLY ascii + big-endian-free binary and vertex colours', () => {
  const m = { ...M.box({ size: 1 }), colors: Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? 1 : 0)) };
  for (const ascii of [false, true]) { const r = IO.parsePLY(IO.writePLY(m, { ascii })); assert.equal(r.colors.length, 24); assert.equal(r.colors[0], 1); assert.equal(M.triangleCount(r), 12); }
});
test('OBJ with uvs and normals keeps them; polygons triangulate; negative indices', () => {
  const m = M.recomputeNormals(M.sphere({ radius: 1, segments: 8, rings: 4 })), r = IO.parseOBJ(IO.writeOBJ(m).obj);
  assert.equal(r.uvs.length / 2, r.positions.length / 3); assert.equal(r.normals.length, r.positions.length);
  const q = IO.parseOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1\n'); assert.equal(M.triangleCount(q), 2);
  assert.throws(() => IO.parseOBJ('v 0 0 0\nf 1 2 3\n'));
});
