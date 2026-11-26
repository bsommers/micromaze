// vfx3d: data-driven river/sewage/whirlpool/fire effects. Pure, deterministic, zero deps, Y-up, metres, seconds.
// One JSON definition feeds BOTH gameplay (force fields, water height) and visuals (shaders, particles).
// No Date, no Math.random: particles use a seeded mulberry32 per particle. Spec: spec/v4/vfx3d.md.
const TAU = Math.PI * 2;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const KINDS = ['whirlpool', 'water', 'sludge', 'fire', 'steam', 'spark'];
export const FIELD_KINDS = ['none', 'vortex', 'flow'];
export const MAX_WAVES = 4; // the GDShader exposes four wave slots
export const MAX_PARTICLES = 5000;
export const SHAPES = ['point', 'sphere', 'box', 'disc', 'cone'];

export function rng(seed) { // mulberry32 closure
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashJSON(v) { const s = JSON.stringify(v); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
export function parseColor(c) { // '#rgb' | '#rrggbb' | [r,g,b(,a)] 0..1 -> [r,g,b]
  if (Array.isArray(c)) return [num(c[0], 0), num(c[1], 0), num(c[2], 0)];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c)); if (!m) return null;
  let h = m[1]; if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [0, 2, 4].map((i) => r4(parseInt(h.slice(i, i + 2), 16) / 255));
}

// ---------------------------------------------------------------- force fields (gameplay AND visuals read these)
// Vortex: SAME formula as boss3d.vortexForce: inward k*(1-d/R)^falloff with tangential swirl; ramp and pulse scale the amplitude.
export function fieldAmp(field, t) {
  let amp = Math.min(1, Math.max(0, t) / Math.max(1 / 60, num(field.ramp, 0)));
  if (field.ramp === undefined || field.ramp === 0) amp = 1;
  if (field.pulse) { const ph = ((t % field.pulse.period) + field.pulse.period) % field.pulse.period; amp *= ph < field.pulse.active ? 1 : num(field.pulse.idle, 0.25); }
  return amp;
}
export function inArea(area, p) {
  if (!area) return true;
  const c = area.center || [0, 0, 0];
  if (area.shape === 'box') { const h = area.size || [1, 1, 1]; return Math.abs(p[0] - c[0]) <= h[0] / 2 && Math.abs(p[1] - c[1]) <= h[1] / 2 && Math.abs(p[2] - c[2]) <= h[2] / 2; }
  const d = Math.hypot(p[0] - c[0], p[2] - c[2]); // cylinder: radius on XZ, height up from center.y (omitted = unbounded)
  if (d > num(area.radius, 1)) return false;
  return area.height === undefined || (p[1] >= c[1] && p[1] <= c[1] + area.height);
}
export function fieldForce(field, pos, t = 0, opts = {}) {
  if (!field || field.kind === 'none') return [0, 0, 0];
  if (field.kind === 'flow') { if (!inArea(field.area, pos)) return [0, 0, 0]; const a = fieldAmp(field, t), f = field.flow || [0, 0, 0]; return [r4(f[0] * a), r4(f[1] * a), r4(f[2] * a)]; }
  const c = field.center || [0, 0, 0], dx = c[0] - pos[0], dz = c[2] - pos[2], d = Math.hypot(dx, dz);
  if (d >= field.radius || d < 1e-6) return [0, 0, 0];
  const k = field.strength * fieldAmp(field, t) * Math.pow(1 - d / field.radius, num(field.falloff, 1)) * (opts.resisting ? num(field.resistFactor, 0.3) : 1), ux = dx / d, uz = dz / d, sw = num(field.swirl, 0);
  return [r4(k * (ux - sw * uz)), 0, r4(k * (uz + sw * ux))];
}
export function fieldDps(field, pos) { // damage per second at pos (vortex core, or flow/none area with dps)
  if (!field) return 0;
  if (field.kind === 'vortex') return Math.hypot(pos[0] - (field.center || [0, 0, 0])[0], pos[2] - (field.center || [0, 0, 0])[2]) < num(field.coreRadius, 0) ? num(field.coreDps, 0) : 0;
  return num(field.dps, 0) > 0 && inArea(field.area, pos) ? field.dps : 0;
}

// ---------------------------------------------------------------- water: Gerstner waves (GPU Gems ch.1), deterministic by time
const waveParams = (w, n) => { const L = Math.max(1e-3, w.wavelength), k = TAU / L, c = w.speed ?? Math.sqrt(9.81 / k), dl = Math.hypot(w.dir[0], w.dir[1]) || 1;
  return { dx: w.dir[0] / dl, dz: w.dir[1] / dl, k, om: k * c, a: num(w.amplitude, 0), qa: num(w.steepness, 0) / (k * n), ph: num(w.phase, 0) }; };
export function waterLevel(water, t = 0) {
  const r = water.rise; if (!r) return num(water.level, 0);
  return r4(r.fromY + (r.toY - r.fromY) * Math.min(1, Math.max(0, t) / Math.max(1 / 60, r.seconds)));
}
// Gerstner displacement of the rest-grid point (x0,z0): [dx, dy, dz]. The shader displaces its mesh vertices with exactly this.
export function gerstner(water, x0, z0, t) {
  const ws = water.waves || [], n = Math.max(1, ws.length); let dx = 0, dy = 0, dz = 0;
  for (const w of ws) { const p = waveParams(w, n), th = p.k * (p.dx * x0 + p.dz * z0) - p.om * t + p.ph; dx += p.qa * p.dx * Math.cos(th); dz += p.qa * p.dz * Math.cos(th); dy += p.a * Math.sin(th); }
  return [dx, dy, dz];
}
// Surface height at world (x,z): invert the horizontal displacement by fixed-point iteration (4 passes), then y.
export function waterHeight(water, x, z, t = 0) {
  let x0 = x, z0 = z;
  for (let i = 0; i < 4; i++) { const g = gerstner(water, x0, z0, t); x0 = x - g[0]; z0 = z - g[2]; }
  return waterLevel(water, t) + gerstner(water, x0, z0, t)[1];
}
export function waterNormal(water, x, z, t = 0, e = 0.05) {
  const hx = waterHeight(water, x + e, z, t) - waterHeight(water, x - e, z, t), hz = waterHeight(water, x, z + e, t) - waterHeight(water, x, z - e, t), l = Math.hypot(2 * e, hx, hz) || 1;
  return [r4(-hx / l), r4(2 * e / l), r4(-hz / l)];
}
// Whirlpool funnel dip below the surface at radius r from the vortex center (the funnel mesh/shader use the same profile).
export function funnelDepth(vis, field, r) {
  if (!vis || !field || field.kind !== 'vortex' || r >= field.radius) return 0;
  return num(vis.depth, 0) * Math.pow(1 - r / field.radius, num(vis.funnelPower, 2));
}
export function surfaceHeight(def, x, z, t = 0) { // water + funnel: what a floating body sits on
  const base = def.water ? waterHeight(def.water, x, z, t) : 0, f = def.field;
  if (!def.visual || !f || f.kind !== 'vortex') return base;
  const c = f.center || [0, 0, 0]; return r4(base - funnelDepth(def.visual, f, Math.hypot(x - c[0], z - c[2])) * fieldAmp(f, t));
}
// Visual swirl angle (radians) at radius r and time t, shared with the whirlpool shader: arms spiral inward and rotate at swirlRate.
export function swirlAngle(vis, field, r, t) { const R = num(field.radius, 1); return num(vis.swirlRate, 1) * t + num(vis.twist, 3) * (1 - r / R) * Math.PI; }

// ---------------------------------------------------------------- particles: closed-form, seeded, stateless in t
const lerp = (a, b, u) => a + (b - a) * u;
const range = (v, d) => (Array.isArray(v) ? [num(v[0], d), num(v[1], num(v[0], d))] : [num(v, d), num(v, d)]);
function unit(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function basis(d) { const a = Math.abs(d[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]; let u = [a[1] * d[2] - a[2] * d[1], a[2] * d[0] - a[0] * d[2], a[0] * d[1] - a[1] * d[0]]; u = unit(u); return [u, [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]]; }
export function colorAt(stops, u) { // stops [{t,c,a}] -> [r,g,b,a]
  const s = stops && stops.length ? stops : [{ t: 0, c: '#ffffff', a: 1 }];
  const col = (x) => [...(parseColor(x.c) || [1, 1, 1]), num(x.a, 1)];
  if (u <= s[0].t) return col(s[0]);
  for (let i = 1; i < s.length; i++) if (u <= s[i].t) { const a = col(s[i - 1]), b = col(s[i]), k = (u - s[i - 1].t) / Math.max(1e-9, s[i].t - s[i - 1].t); return a.map((x, j) => r4(lerp(x, b[j], k))); }
  return col(s[s.length - 1]);
}
function spawnOf(em, seed, i) { // everything about particle i; fixed draw order so results never depend on t
  const R = rng((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0), sh = em.shape || { type: 'point' };
  const life = range(em.lifetime, 1), L = lerp(life[0], life[1], R()), sp = range(em.speed, 1), S = lerp(sp[0], sp[1], R());
  let p = [0, 0, 0]; const u1 = R(), u2 = R(), u3 = R();
  if (sh.type === 'sphere') { const r = num(sh.radius, 0.5) * Math.cbrt(u1), z = 1 - 2 * u2, a = TAU * u3, q = Math.sqrt(Math.max(0, 1 - z * z)); p = [r * q * Math.cos(a), r * z, r * q * Math.sin(a)]; }
  else if (sh.type === 'box') { const s = sh.size || [1, 1, 1]; p = [(u1 - 0.5) * s[0], (u2 - 0.5) * s[1], (u3 - 0.5) * s[2]]; }
  else if (sh.type === 'disc') { const r = num(sh.radius, 0.5) * Math.sqrt(u1), a = TAU * u2; p = [r * Math.cos(a), 0, r * Math.sin(a)]; }
  else if (sh.type === 'cone') { const r = num(sh.radius, 0.2) * Math.sqrt(u1), a = TAU * u2; p = [r * Math.cos(a), 0, r * Math.sin(a)]; }
  const dir = unit(em.direction || [0, 1, 0]), sa = (num(em.spread, 0) * Math.PI) / 180, [bu, bv] = basis(dir);
  const ct = 1 - R() * (1 - Math.cos(sa)), st = Math.sqrt(Math.max(0, 1 - ct * ct)), az = TAU * R();
  const dd = [0, 1, 2].map((j) => dir[j] * ct + st * (Math.cos(az) * bu[j] + Math.sin(az) * bv[j]));
  return { life: L, p, v: [dd[0] * S, dd[1] * S, dd[2] * S] };
}
export function particleTimes(em, t) { // [index, spawn time] of every particle that can be alive at t
  const out = [], life = range(em.lifetime, 1)[1], end = num(em.duration, 0) > 0 ? em.duration : Infinity;
  if (em.rate > 0) { const dtp = 1 / em.rate; for (let i = Math.max(0, Math.ceil((t - life) / dtp)); i * dtp <= t && i * dtp < end; i++) out.push([i, i * dtp]); }
  if (em.burst) { // burst ids live above the stream ids; optional repeat period
    const cnt = em.burst.count || 0, bt = num(em.burst.time, 0), rep = num(em.burst.repeat, 0);
    for (let b = rep > 0 ? Math.max(0, Math.ceil((t - life - bt) / rep)) : 0; bt + b * rep <= t && (rep > 0 || b === 0) && bt + b * rep < end; b++) for (let k = 0; k < cnt; k++) out.push([1e6 + b * 1000 + k, bt + b * rep]);
  }
  return out;
}
// Live particles at time t: [{id, age, u (age/life), pos, vel, size, color:[r,g,b,a]}]; closed form with linear drag.
export function emitterParticles(em, seed, t, origin = [0, 0, 0]) {
  const g = em.gravity || [0, 0, 0], k = num(em.drag, 0), out = [], sz = em.size || { start: 0.2, end: 0.2 };
  const list = particleTimes(em, t).filter(([, ts]) => ts <= t); const cap = Math.min(MAX_PARTICLES, num(em.maxParticles, MAX_PARTICLES));
  for (const [i, ts] of list.slice(-cap)) {
    const sp = spawnOf(em, seed, i), age = t - ts; if (age < 0 || age >= sp.life) continue;
    let pos, vel;
    if (k > 1e-9) { const e = Math.exp(-k * age), f = (1 - e) / k; pos = [0, 1, 2].map((j) => sp.p[j] + (sp.v[j] - g[j] / k) * f + (g[j] / k) * age); vel = [0, 1, 2].map((j) => (sp.v[j] - g[j] / k) * e + g[j] / k); }
    else { pos = [0, 1, 2].map((j) => sp.p[j] + sp.v[j] * age + 0.5 * g[j] * age * age); vel = [0, 1, 2].map((j) => sp.v[j] + g[j] * age); }
    const u = age / sp.life;
    out.push({ id: i, age: r4(age), u: r4(u), pos: pos.map((v, j) => r4(v + origin[j])), vel: vel.map(r4), size: r4(lerp(num(sz.start, 0.2), num(sz.end, 0.2), u)), color: colorAt(em.color, u) });
  }
  return out;
}

// ---------------------------------------------------------------- validate
export function validateEffect(def) {
  const errors = [], warnings = [];
  const E = (path, code, message) => errors.push({ severity: 'error', path, code, message });
  const W = (path, code, message) => warnings.push({ severity: 'warn', path, code, message });
  const isV3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const posNum = (path, v, req = false) => { if (v === undefined) { if (req) E(path, 'REQUIRED', 'required'); return; } if (!isNum(v) || v < 0) E(path, 'BAD_VALUE', 'must be a number >= 0'); };
  if (!def || typeof def !== 'object' || Array.isArray(def)) { E('$', 'BAD_TYPE', 'effect must be an object'); return { ok: false, errors, warnings, stats: {} }; }
  if (typeof def.id !== 'string' || !def.id) E('$.id', 'REQUIRED', 'id (non-empty string) required');
  if (!KINDS.includes(def.kind)) E('$.kind', 'BAD_KIND', `kind must be one of ${KINDS.join(', ')}`);
  if (def.seed !== undefined && !Number.isInteger(def.seed)) E('$.seed', 'BAD_VALUE', 'seed must be an integer');
  const f = def.field;
  if (f !== undefined) {
    if (!f || !FIELD_KINDS.includes(f.kind)) E('$.field.kind', 'BAD_KIND', `field.kind must be one of ${FIELD_KINDS.join(', ')}`);
    else if (f.kind === 'vortex') {
      if (f.center !== undefined && !isV3(f.center)) E('$.field.center', 'BAD_VALUE', 'center must be [x,y,z]');
      if (!(isNum(f.radius) && f.radius > 0)) E('$.field.radius', 'BAD_VALUE', 'radius must be > 0');
      posNum('$.field.strength', f.strength, true); if (f.falloff !== undefined && !(isNum(f.falloff) && f.falloff > 0)) E('$.field.falloff', 'BAD_VALUE', 'falloff must be > 0');
      for (const k of ['ramp', 'coreRadius', 'coreDps']) posNum(`$.field.${k}`, f[k]);
      if (f.resistFactor !== undefined && !(isNum(f.resistFactor) && f.resistFactor >= 0 && f.resistFactor <= 1)) E('$.field.resistFactor', 'BAD_VALUE', 'resistFactor must be in 0..1');
      if (isNum(f.coreRadius) && isNum(f.radius) && f.coreRadius >= f.radius) E('$.field.coreRadius', 'BAD_VALUE', 'coreRadius must be < radius');
    } else if (f.kind === 'flow') { if (!isV3(f.flow)) E('$.field.flow', 'BAD_VALUE', 'flow must be [x,y,z] (m/s)'); posNum('$.field.dps', f.dps); }
    if (f && f.pulse) { const p = f.pulse; if (!(isNum(p.period) && isNum(p.active) && p.period > p.active && p.active >= 0)) E('$.field.pulse', 'BAD_VALUE', 'pulse.period must exceed pulse.active'); }
    if (f && f.area) { const a = f.area; if (a.shape === 'box' ? !isV3(a.size) : !(isNum(a.radius) && a.radius > 0)) E('$.field.area', 'BAD_VALUE', 'area needs radius (cylinder) or size [x,y,z] (box)'); }
  }
  const w = def.water;
  if (w !== undefined) {
    if (!Array.isArray(w.waves) || w.waves.length < 1 || w.waves.length > MAX_WAVES) E('$.water.waves', 'BAD_VALUE', `waves must have 1..${MAX_WAVES} entries`);
    else w.waves.forEach((v, i) => {
      const p = `$.water.waves[${i}]`;
      if (!Array.isArray(v.dir) || v.dir.length !== 2 || !v.dir.every(isNum) || Math.hypot(v.dir[0], v.dir[1]) < 1e-6) E(`${p}.dir`, 'BAD_VALUE', 'dir must be a non-zero [x,z]');
      if (!(isNum(v.wavelength) && v.wavelength > 0)) E(`${p}.wavelength`, 'BAD_VALUE', 'wavelength must be > 0');
      posNum(`${p}.amplitude`, v.amplitude, true);
      if (v.steepness !== undefined && !(isNum(v.steepness) && v.steepness >= 0 && v.steepness <= 1)) E(`${p}.steepness`, 'BAD_VALUE', 'steepness must be in 0..1');
      if (isNum(v.amplitude) && isNum(v.wavelength) && v.amplitude > v.wavelength / 7) W(`${p}.amplitude`, 'STEEP_WAVE', 'amplitude above wavelength/7 looks choppy and can clip');
    });
    if (w.size !== undefined && !(Array.isArray(w.size) && w.size.length === 2 && w.size.every((x) => isNum(x) && x > 0))) E('$.water.size', 'BAD_VALUE', 'size must be [width, depth] > 0');
    if (w.rise && !(isNum(w.rise.fromY) && isNum(w.rise.toY) && isNum(w.rise.seconds) && w.rise.seconds > 0)) E('$.water.rise', 'BAD_VALUE', 'rise needs fromY, toY, seconds > 0');
  }
  const v = def.visual;
  if (v !== undefined) {
    for (const k of ['color', 'deepColor', 'foamColor']) if (v[k] !== undefined && !parseColor(v[k])) E(`$.visual.${k}`, 'BAD_VALUE', 'color must be #rgb, #rrggbb or [r,g,b]');
    for (const k of ['swirlRate', 'twist', 'foam', 'depth', 'funnelPower', 'arms', 'opacity']) if (v[k] !== undefined && !isNum(v[k])) E(`$.visual.${k}`, 'BAD_VALUE', 'must be a number');
    if (isNum(v.foam) && (v.foam < 0 || v.foam > 1)) E('$.visual.foam', 'BAD_VALUE', 'foam must be in 0..1');
  }
  const ems = def.emitters;
  if (ems !== undefined) {
    if (!Array.isArray(ems)) E('$.emitters', 'BAD_TYPE', 'emitters must be an array');
    else ems.forEach((e, i) => {
      const p = `$.emitters[${i}]`;
      if (!(isNum(e.rate) && e.rate >= 0) && !e.burst) E(`${p}.rate`, 'REQUIRED', 'rate >= 0 or a burst is required');
      if (!(isNum(e.rate) || e.burst)) return;
      const lf = range(e.lifetime, NaN); if (!(lf[0] > 0 && lf[1] >= lf[0])) E(`${p}.lifetime`, 'BAD_VALUE', 'lifetime must be > 0 (number or [min,max])');
      const sp = range(e.speed, 0); if (!(sp[0] >= 0 && sp[1] >= sp[0])) E(`${p}.speed`, 'BAD_VALUE', 'speed must be >= 0 (number or [min,max])');
      if (e.shape && !SHAPES.includes(e.shape.type)) E(`${p}.shape.type`, 'BAD_KIND', `shape.type must be one of ${SHAPES.join(', ')}`);
      if (e.direction !== undefined && !(isV3(e.direction) && Math.hypot(...e.direction) > 1e-6)) E(`${p}.direction`, 'BAD_VALUE', 'direction must be a non-zero [x,y,z]');
      if (e.gravity !== undefined && !isV3(e.gravity)) E(`${p}.gravity`, 'BAD_VALUE', 'gravity must be [x,y,z]');
      if (e.spread !== undefined && !(isNum(e.spread) && e.spread >= 0 && e.spread <= 180)) E(`${p}.spread`, 'BAD_VALUE', 'spread is degrees in 0..180');
      if (e.blend !== undefined && !['add', 'mix'].includes(e.blend)) E(`${p}.blend`, 'BAD_VALUE', 'blend must be add or mix');
      if (e.maxParticles !== undefined && !(Number.isInteger(e.maxParticles) && e.maxParticles >= 1 && e.maxParticles <= MAX_PARTICLES)) E(`${p}.maxParticles`, 'BAD_VALUE', `maxParticles must be an integer in 1..${MAX_PARTICLES}`);
      if (e.burst && !(Number.isInteger(e.burst.count) && e.burst.count >= 1 && e.burst.count <= 999)) E(`${p}.burst.count`, 'BAD_VALUE', 'burst.count must be an integer in 1..999');
      const live = (isNum(e.rate) ? e.rate : 0) * lf[1] + (e.burst ? (e.burst.count || 0) : 0);
      if (live > MAX_PARTICLES) E(`${p}`, 'TOO_MANY', `rate*lifetime(+burst) = ${Math.round(live)} exceeds ${MAX_PARTICLES} live particles`);
      if (e.color) { let last = -1; e.color.forEach((s, j) => { if (!parseColor(s.c)) E(`${p}.color[${j}].c`, 'BAD_VALUE', 'bad color'); if (!(isNum(s.t) && s.t >= last && s.t <= 1)) E(`${p}.color[${j}].t`, 'BAD_VALUE', 'stop times must be ascending in 0..1'); last = s.t; }); }
    });
  }
  const need = { whirlpool: ['field', 'visual'], water: ['water'], sludge: ['water'], fire: ['emitters'], steam: ['emitters'], spark: ['emitters'] }[def.kind] || [];
  for (const k of need) if (def[k] === undefined) E(`$.${k}`, 'REQUIRED', `${def.kind} effect needs ${k}`);
  if (def.kind === 'whirlpool' && f && f.kind !== 'vortex') E('$.field.kind', 'BAD_KIND', 'whirlpool needs a vortex field');
  if (def.kind === 'whirlpool' && f && f.kind === 'vortex' && !(f.ramp > 0) && !f.pulse) W('$.field.ramp', 'NO_RAMP', 'vortex starts at full strength; add ramp (boss3d fairness warns too)');
  return { ok: errors.length === 0, errors, warnings, stats: { kind: def.kind, waves: w?.waves?.length ?? 0, emitters: ems?.length ?? 0, field: f?.kind ?? 'none' } };
}
