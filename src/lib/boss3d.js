// boss3d: data-driven multi-phase, multi-part 3D boss. Pure, deterministic, zero deps, Y-up, metres, fixed step dt=1/60.
// State is plain JSON; randomness comes from a seeded mulberry32 stored in state.rng (no Date, no Math.random).
// Engine-agnostic: the host feeds {target, hits, commands, flags} each frame and receives {events, force, playerDamage}.
// Danger zones live on the XZ plane (zone.maxY lets a jump clear them). Spec: spec/v4/boss3d.md.
export const DT = 1 / 60;
export const FPS = 60;
const TAU = Math.PI * 2;
const F = (s) => Math.max(0, Math.round(s * FPS));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const rad = (d) => (d * Math.PI) / 180;
const hyp = (a, b) => Math.hypot(a, b);
const NOJUMP = 1e9; // zone.maxY meaning 'jumping does not help' (JSON-safe, unlike Infinity)
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function rngNext(st) { // mulberry32 over state.rng (uint32)
  st.rng = (st.rng + 0x6d2b79f5) >>> 0; let t = st.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function hashJSON(v) { // FNV-1a 32 over canonical JSON string
  const s = JSON.stringify(v); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- zones
export const ZONE_SHAPES = ['circle', 'cone', 'line', 'ring', 'sweep'];
// Resolve a zone spec to world space. at:'target' (circle/ring) centres on the target; others originate at the owner and aim at the target.
export function resolveZone(spec, owner, target, aim) {
  const dir = [Math.cos(aim), Math.sin(aim)], off = spec.offset || [0, 0];
  const base = spec.at === 'target' && (spec.shape === 'circle' || spec.shape === 'ring') ? [target[0], target[2]] : [owner[0], owner[2]];
  const o = [base[0] + dir[0] * off[1] - dir[1] * off[0], base[1] + dir[1] * off[1] + dir[0] * off[0]];
  return { shape: spec.shape, o: [r4(o[0]), r4(o[1])], aim: r4(aim), r: spec.r ?? spec.length ?? spec.rOuter ?? 0, angle: rad(spec.angle ?? 360), length: spec.length ?? 0, width: spec.width ?? 0,
    rInner: spec.rInner ?? 0, rOuter: spec.rOuter ?? spec.r ?? 0, arc: [rad(spec.arc?.[0] ?? -90), rad(spec.arc?.[1] ?? 90)], maxY: spec.maxY ?? NOJUMP };
}
export const sweepAngle = (z, t) => z.aim + z.arc[0] + (z.arc[1] - z.arc[0]) * t;
// Point test. For sweep, [t0,t1] is the swept interval (default 0..1 = the whole covered sector).
export function zoneContains(z, p, pad = 0, t0 = 0, t1 = 1) {
  if (p[1] > z.maxY) return false;
  const dx = p[0] - z.o[0], dz = p[2] - z.o[1], d = hyp(dx, dz);
  switch (z.shape) {
    case 'circle': return d <= z.r + pad;
    case 'ring': return d >= z.rInner - pad && d <= z.rOuter + pad;
    case 'cone': return d <= z.r + pad && (d < 1e-6 || Math.abs(wrap(Math.atan2(dz, dx) - z.aim)) <= z.angle / 2 + Math.atan2(pad, Math.max(d, pad)));
    case 'line': { const c = Math.cos(z.aim), s = Math.sin(z.aim), lx = dx * c + dz * s, ly = -dx * s + dz * c; return lx >= -pad && lx <= z.length + pad && Math.abs(ly) <= z.width / 2 + pad; }
    case 'sweep': {
      if (d > z.r + pad) return false;
      const a = sweepAngle(z, t0), b = sweepAngle(z, t1), mid = (a + b) / 2, span = Math.abs(b - a) / 2, half = Math.atan2(z.width / 2 + pad, Math.max(d, 0.01));
      return Math.abs(wrap(Math.atan2(dz, dx) - mid)) <= span + half || span + half >= Math.PI;
    }
    default: return false;
  }
}

// ---------------------------------------------------------------- state
const partList = (def) => def.parts || [];
const ownerPos = (def, id) => { const b = def.pos || [0, 0, 0], o = id === 'body' ? (def.core?.pos || [0, 0, 0]) : (partList(def).find((p) => p.id === id)?.pos || [0, 0, 0]); return [b[0] + o[0], b[1] + o[1], b[2] + o[2]]; };
export const coreHp = (def) => def.core?.hp ?? def.hp ?? 1;

export function createBoss(def, seed = 1) {
  const parts = {}; for (const p of partList(def)) parts[p.id] = { hp: p.hp, alive: true, stunUntil: 0, regrowAt: -1, stagger: 0, severed: false, deaths: 0 };
  return { v: 1, id: def.id, rng: (seed >>> 0) || 1, frame: 0, phaseIdx: 0, phaseId: def.phases[0].id, phaseFrame: 0, hp: coreHp(def), parts, flags: {}, attacks: [], nextId: 1,
    cd: {}, nextStartF: F(def.phases[0].openingDelay ?? 1), invulnUntil: 0, stunAllUntil: 0, defeated: false, enraged: false, enrage: { speed: 1, damage: 1, windup: 1 },
    partEnrage: 1, hazards: {}, firedAdds: {}, firedHazards: {}, partsDown: 0, log: [], logDropped: 0, stats: { damageDealt: 0, maxThreats: 0 } };
}

const emit = (s, evs, type, data = {}) => { const e = { f: s.frame, type, ...data }; evs.push(e); if (s.log.length < 60000) s.log.push(e); else s.logDropped++; return e; };
const speed = (s) => s.enrage.speed * s.partEnrage;
const phaseOf = (def, s) => def.phases[s.phaseIdx];
const exposedStage = (s, owner) => { const a = s.attacks.find((x) => x.owner === owner && x.stage !== 'done'); return a ? a.stage : 'idle'; };
export function partStunned(s, id) { return s.frame < s.stunAllUntil || s.frame < (s.parts[id]?.stunUntil || 0); }
export function weakOpen(def, s, partId) {
  const p = partList(def).find((x) => x.id === partId); if (!p?.weakPoint || !s.parts[partId].alive) return false;
  const open = p.weakPoint.open ?? ['recovery', 'stun']; if (open === 'always') return true;
  return (open.includes('stun') && partStunned(s, partId)) || open.includes(exposedStage(s, partId));
}
export function coreExposed(def, s) {
  const e = def.core?.exposedWhen ?? 'always'; if (e === 'always') return true;
  if (e.partsDownAtLeast !== undefined && s.partsDown >= e.partsDownAtLeast) return true;
  if (e.phase && s.phaseId === e.phase) return true; if (e.phaseIndexAtLeast !== undefined && s.phaseIdx >= e.phaseIndexAtLeast) return true;
  if (e.stunned && s.frame < s.stunAllUntil) return true; if (e.flag && s.flags[e.flag]) return true;
  return false;
}
export const hpFrac = (def, s) => s.hp / coreHp(def);
export function totalHpFrac(def, s) { let m = coreHp(def), c = Math.max(0, s.hp); for (const p of partList(def)) { m += p.hp; c += Math.max(0, s.parts[p.id].hp); } return c / m; }

// ---------------------------------------------------------------- damage in
function killPart(def, s, evs, p, why) {
  const ps = s.parts[p.id]; ps.alive = false; ps.hp = 0; ps.deaths++; s.partsDown++;
  s.attacks.forEach((a) => { if (a.owner === p.id && a.stage !== 'done') { a.stage = 'done'; emit(s, evs, 'cancel', { attack: a.attack, owner: p.id, id: a.id }); } });
  emit(s, evs, 'partDown', { part: p.id, why });
  if (p.regrow && !(why === 'sever' && p.regrow.noRegrowOnSever)) ps.regrowAt = s.frame + F(p.regrow.time);
  const d = p.onDeath; if (!d) return;
  if (d.coreDamageFrac) { s.hp = Math.max(0, s.hp - d.coreDamageFrac * coreHp(def)); emit(s, evs, 'coreDamaged', { by: p.id, hp: r4(s.hp) }); }
  if (d.stagger) { s.stunAllUntil = Math.max(s.stunAllUntil, s.frame + F(d.stagger)); emit(s, evs, 'stagger', { scope: 'all', seconds: d.stagger, cause: p.id }); }
  if (d.enrageSpeed) { s.partEnrage *= d.enrageSpeed; emit(s, evs, 'enrage', { cause: p.id, speed: r4(speed(s)) }); }
  if (d.clearAttacks) s.attacks.forEach((a) => { if (a.stage !== 'done' && !a.hazard) { a.stage = 'done'; emit(s, evs, 'cancel', { attack: a.attack, owner: a.owner, id: a.id }); } });
  if (d.spawn) spawnAdds(def, s, evs, d.spawn, p.id);
  if (d.hazard) startHazard(def, s, evs, d.hazard);
  if (d.setFlag) s.flags[d.setFlag] = true;
}
function stunPart(def, s, evs, id, seconds, cause) {
  const ps = s.parts[id]; if (!ps?.alive) return; ps.stunUntil = Math.max(ps.stunUntil, s.frame + F(seconds));
  s.attacks.forEach((a) => { if (a.owner === id && a.stage !== 'done') { a.stage = 'done'; emit(s, evs, 'cancel', { attack: a.attack, owner: id, id: a.id }); } });
  emit(s, evs, 'stun', { part: id, seconds, cause });
}
function applyHit(def, s, evs, h) {
  if (s.defeated) return;
  if (s.frame < s.invulnUntil) { emit(s, evs, 'blocked', { part: h.part || 'core', reason: 'invuln' }); return; }
  const dmg = Math.max(0, h.damage || 0), id = h.part && h.part !== 'core' && h.part !== 'body' ? h.part : null;
  if (!id) {
    if (!coreExposed(def, s)) { emit(s, evs, 'blocked', { part: 'core', reason: 'covered' }); return; }
    const mult = (s.frame < s.stunAllUntil ? def.core?.stunMult ?? 1.5 : 1) * (1 - (def.core?.armor || 0));
    const d = dmg * mult; s.hp -= d; s.stats.damageDealt += d; emit(s, evs, 'hit', { part: 'core', dmg: r4(d), hp: r4(Math.max(0, s.hp)) });
    if (s.hp <= 0) { s.hp = 0; s.defeated = true; s.attacks.forEach((a) => { a.stage = 'done'; }); emit(s, evs, 'defeated', {}); }
    return;
  }
  const p = partList(def).find((x) => x.id === id), ps = s.parts[id]; if (!p || !ps.alive) { emit(s, evs, 'blocked', { part: id, reason: 'down' }); return; }
  const open = weakOpen(def, s, id); let mult = 1 - (p.armor || 0);
  if (h.weak && open) mult = p.weakPoint.multiplier ?? 2; else if (partStunned(s, id)) mult *= p.stunMult ?? 1.25;
  const d = dmg * mult; ps.hp -= d; s.stats.damageDealt += d;
  emit(s, evs, 'hit', { part: id, dmg: r4(d), weak: !!(h.weak && open), hp: r4(Math.max(0, ps.hp)) });
  if (p.coreShare) { s.hp -= d * p.coreShare; if (s.hp <= 0 && coreExposed(def, s)) { s.hp = 0; s.defeated = true; emit(s, evs, 'defeated', {}); return; } s.hp = Math.max(1e-6, s.hp); }
  if (p.stagger) { ps.stagger += d; if (ps.stagger >= p.stagger.threshold && ps.alive && ps.hp > 0) { ps.stagger = 0; stunPart(def, s, evs, id, p.stagger.duration, 'stagger'); } }
  if (ps.hp <= 0) killPart(def, s, evs, p, 'damage');
}
function applyCommand(def, s, evs, c) {
  const p = partList(def).find((x) => x.id === c.part);
  if (c.type === 'sever' && p && s.parts[p.id].alive) { s.parts[p.id].severed = true; killPart(def, s, evs, p, 'sever'); }
  else if (c.type === 'stun' && p) stunPart(def, s, evs, p.id, c.seconds ?? 3, c.cause || 'command');
  else if (c.type === 'flag') { s.flags[c.name] = c.value !== false; emit(s, evs, 'flag', { name: c.name, value: c.value !== false }); }
  else if (c.type === 'stunAll') { s.stunAllUntil = Math.max(s.stunAllUntil, s.frame + F(c.seconds ?? 3)); emit(s, evs, 'stagger', { scope: 'all', seconds: c.seconds ?? 3, cause: 'command' }); }
}

// ---------------------------------------------------------------- adds, hazards
function spawnAdds(def, s, evs, a, cause) {
  const c = a.center || def.pos || [0, 0, 0], n = a.count || 1, r = a.radius ?? (def.arena?.radius ?? 10) * 0.7, off = rngNext(s) * TAU, pos = [];
  for (let i = 0; i < n; i++) { const ang = off + (i * TAU) / n; pos.push([r4(c[0] + Math.cos(ang) * r), r4(c[1] || 0), r4(c[2] + Math.sin(ang) * r)]); }
  emit(s, evs, 'spawn', { kind: a.kind, count: n, positions: pos, cause });
}
function startHazard(def, s, evs, id) {
  const h = (def.hazards || []).find((x) => x.id === id); if (!h || s.hazards[id]) return;
  s.hazards[id] = { startF: s.frame, endF: h.duration ? s.frame + F(h.duration) : -1, level: h.fromY ?? 0, nextSpawn: s.frame + F(h.windup ?? 0), pulseSeen: -1, phase: s.phaseId };
  emit(s, evs, 'hazardStart', { hazard: id, kind: h.kind, warning: h.warning || null, rampSeconds: h.ramp ?? h.windup ?? 0 });
}
const hazardActive = (s, id) => s.hazards[id] && !s.hazards[id].ended;
export function vortexForce(h, hs, f, pos, resisting = false) {
  const c = h.center || [0, 0, 0], dx = c[0] - pos[0], dz = c[2] - pos[2], d = hyp(dx, dz);
  if (d >= h.radius || d < 1e-6) return [0, 0, 0];
  let amp = Math.min(1, (f - hs.startF) / Math.max(1, F(h.ramp ?? 0)));
  if (h.pulse) { const t = (f - hs.startF) / FPS, ph = t % h.pulse.period; amp *= ph < h.pulse.active ? 1 : (h.pulse.idle ?? 0.25); }
  const k = h.strength * amp * Math.pow(1 - d / h.radius, h.falloff ?? 1) * (resisting ? h.resistFactor ?? 0.3 : 1), ux = dx / d, uz = dz / d, sw = h.swirl || 0;
  return [r4(k * (ux - sw * uz)), 0, r4(k * (uz + sw * ux))];
}
function stepHazards(def, s, evs, target) {
  const out = { force: [0, 0, 0], damage: 0 };
  for (const h of def.hazards || []) {
    if (!s.hazards[h.id] && !s.firedHazards[h.id] && !h.manual) {
      const inPhase = !h.phase || h.phase === s.phaseId, rel = h.phase ? s.phaseFrame : s.frame;
      if (inPhase && rel >= F(h.start ?? 0)) { s.firedHazards[h.id] = true; startHazard(def, s, evs, h.id); }
    }
    const hs = s.hazards[h.id]; if (!hs || hs.ended) continue;
    if ((h.phase && h.endsWithPhase !== false && h.phase !== s.phaseId) || (hs.endF >= 0 && s.frame >= hs.endF)) { hs.ended = true; emit(s, evs, 'hazardEnd', { hazard: h.id }); continue; }
    const age = s.frame - hs.startF, p = target.pos;
    if (h.kind === 'flood') {
      const t = Math.min(1, age / Math.max(1, F(h.rise ?? 10))); hs.level = r4(h.fromY + (h.toY - h.fromY) * t);
      if (p[1] < hs.level) out.damage += (h.dps ?? 10) * DT;
    } else if (h.kind === 'vortex') {
      const f = vortexForce(h, hs, s.frame, p, !!target.resisting); out.force = [out.force[0] + f[0], 0, out.force[2] + f[2]];
      if (h.pulse) { const per = F(h.pulse.period), k = Math.floor(age / per); if ((age % per) === Math.max(0, per - F(h.pulse.telegraph ?? 1)) && hs.pulseSeen !== k) { hs.pulseSeen = k; emit(s, evs, 'hazardPulse', { hazard: h.id, inSeconds: h.pulse.telegraph ?? 1, warning: h.warning || null }); } }
      const c = h.center || [0, 0, 0]; if (h.coreRadius && hyp(p[0] - c[0], p[2] - c[2]) < h.coreRadius) out.damage += (h.coreDps ?? 20) * DT;
    } else if (h.kind === 'debris' && s.frame >= hs.nextSpawn) {
      hs.nextSpawn = s.frame + F(h.interval ?? 2) ;
      const a = h.area || { center: def.pos || [0, 0, 0], radius: def.arena?.radius ?? 10 };
      for (let i = 0; i < (h.count ?? 1); i++) {
        let x, z; if (rngNext(s) < (h.aimAtTarget ?? 0)) { x = p[0]; z = p[2]; } else { const ang = rngNext(s) * TAU, rr = Math.sqrt(rngNext(s)) * a.radius; x = a.center[0] + Math.cos(ang) * rr; z = a.center[2] + Math.sin(ang) * rr; }
        const z0 = { shape: 'circle', o: [r4(x), r4(z)], aim: 0, r: h.r ?? 2, angle: TAU, length: 0, width: 0, rInner: 0, rOuter: h.r ?? 2, arc: [0, 0], maxY: NOJUMP };
        launch(def, s, evs, { id: `${h.id}`, owner: `hazard:${h.id}`, windupF: F(h.telegraph ?? 1.2), activeF: 3, recoveryF: 0, zone: z0, damage: h.damage ?? 15, hazard: true, warning: h.warning });
      }
    } else if (h.kind === 'gas' && !hs.gas && age >= F(h.windup ?? 1.5)) {
      hs.gas = true; const c = h.center || [0, 0, 0];
      launch(def, s, evs, { id: h.id, owner: `hazard:${h.id}`, windupF: 0, activeF: hs.endF >= 0 ? hs.endF - s.frame : 60 * 600, recoveryF: 0, hazard: true, dps: h.dps ?? 8, growTo: h.growTo ?? h.radius, grow: F(h.grow ?? 5),
        zone: { shape: 'circle', o: [c[0], c[2]], aim: 0, r: h.radius, angle: TAU, length: 0, width: 0, rInner: 0, rOuter: h.radius, arc: [0, 0], maxY: h.maxY ?? NOJUMP }, r0: h.radius, warning: h.warning });
    }
  }
  return out;
}

// ---------------------------------------------------------------- attacks
function launch(def, s, evs, a) {
  const inst = { id: s.nextId++, attack: a.id, owner: a.owner, f0: s.frame, stage: a.windupF > 0 ? 'windup' : 'active', t: 0, windupF: a.windupF, activeF: a.activeF, recoveryF: a.recoveryF, zone: a.zone, damage: a.damage ?? 0, dps: a.dps ?? 0,
    hazard: !!a.hazard, rehitF: a.rehitF ?? 0, lastHit: -1e9, hit: false, lockF: a.lockF ?? 0, tracking: a.tracking || null, warning: a.warning || null, phase: s.phaseId };
  if (a.growTo !== undefined) Object.assign(inst, { growTo: a.growTo, grow: a.grow, r0: a.r0 });
  s.attacks.push(inst);
  emit(s, evs, 'telegraph', { id: inst.id, attack: a.id, owner: a.owner, windup: r4(a.windupF / FPS), active: r4(a.activeF / FPS), zone: inst.zone, warning: inst.warning, hazard: inst.hazard });
  return inst;
}
const ownerAlive = (s, id) => id === 'body' || !!s.parts[id]?.alive;
function condOk(def, s, a, owner, target) {
  const c = a.requires || {}, op = ownerPos(def, owner), d = hyp(target.pos[0] - op[0], target.pos[2] - op[2]);
  if (a.minDist !== undefined && d < a.minDist) return false; if (a.maxDist !== undefined && d > a.maxDist) return false;
  for (const id of c.partsAlive || []) if (!s.parts[id]?.alive) return false; for (const id of c.partsDead || []) if (s.parts[id]?.alive) return false;
  if (c.hpBelow !== undefined && hpFrac(def, s) > c.hpBelow) return false; if (c.hpAbove !== undefined && hpFrac(def, s) < c.hpAbove) return false;
  if (c.enraged !== undefined && !!c.enraged !== s.enraged) return false; if (c.flag && !s.flags[c.flag]) return false;
  return true;
}
function startAttack(def, s, evs, ph, a, target) {
  const owner = a.part || 'body', op = ownerPos(def, owner), aim = Math.atan2(target.pos[2] - op[2], target.pos[0] - op[0]);
  const sp = speed(s), zone = resolveZone(a.zone, op, target.pos, aim), lockF = F((a.zone.lockFrac ?? 0) * (a.windup ?? 1) * s.enrage.windup);
  launch(def, s, evs, { id: a.id, owner, windupF: F((a.windup ?? 1) * s.enrage.windup), activeF: Math.max(1, F((a.active ?? 0.2) / sp)), recoveryF: F((a.recovery ?? 1) / sp), zone,
    damage: (a.damage ?? 10) * s.enrage.damage, dps: (a.dps ?? 0) * s.enrage.damage, rehitF: F(a.rehit ?? 0), lockF, tracking: lockF > 0 ? { spec: a.zone, owner: op } : null, warning: a.warning });
  s.cd[`${ph.id}/${a.id}`] = s.frame + F((a.cooldown ?? 3) / sp);
}
function pickAttack(def, s, ph, target) {
  const conc = s.attacks.filter((a) => a.stage !== 'done' && !a.hazard).length; if (conc >= (ph.maxConcurrent ?? 1)) return null;
  const el = [];
  for (const a of ph.attacks || []) {
    const owner = a.part || 'body'; if (!ownerAlive(s, owner) || partStunned(s, owner)) continue;
    if (s.attacks.some((x) => x.owner === owner && x.stage !== 'done')) continue;
    if ((s.cd[`${ph.id}/${a.id}`] ?? 0) > s.frame || !condOk(def, s, a, owner, target)) continue; el.push(a);
  }
  if (!el.length) return null;
  let tot = 0; for (const a of el) tot += a.weight ?? 1; let r = rngNext(s) * tot;
  for (const a of el) { r -= a.weight ?? 1; if (r < 0) return a; } return el[el.length - 1];
}
function stepAttacks(def, s, evs, target) {
  let damage = 0; const p = target.pos;
  for (const a of s.attacks) {
    if (a.stage === 'done') continue;
    a.t++;
    if (a.tracking && a.stage === 'windup') {
      if (a.t <= a.lockF) { const op = a.tracking.owner; a.zone = resolveZone(a.tracking.spec, op, p, Math.atan2(p[2] - op[2], p[0] - op[0])); } else { a.tracking = null; emit(s, evs, 'lock', { id: a.id, attack: a.attack }); }
    }
    if (a.stage === 'windup' && a.t >= a.windupF) { a.stage = 'active'; a.t = 0; emit(s, evs, 'active', { id: a.id, attack: a.attack, owner: a.owner }); }
    else if (a.stage === 'active') {
      if (a.growTo !== undefined && a.grow) { const k = Math.min(1, a.t / a.grow); a.zone.r = a.zone.rOuter = r4(a.r0 + (a.growTo - a.r0) * k); }
      const inv = target.invulnerable, t0 = (a.t - 1) / a.activeF, t1 = Math.min(1, a.t / a.activeF);
      if (!inv && zoneContains(a.zone, p, target.radius ?? 0.4, t0, t1)) {
        if (a.dps) { const d = a.dps * DT; damage += d; if (s.frame % 30 === 0) emit(s, evs, 'damage', { amount: r4(d * 30), source: a.attack, owner: a.owner, kind: a.hazard ? 'hazard' : 'attack' }); }
        else if ((!a.hit || (a.rehitF && s.frame - a.lastHit >= a.rehitF))) { a.hit = true; a.lastHit = s.frame; damage += a.damage; emit(s, evs, 'damage', { amount: r4(a.damage), source: a.attack, owner: a.owner, kind: a.hazard ? 'hazard' : 'attack' }); }
      }
      if (a.t >= a.activeF) { a.stage = a.recoveryF > 0 ? 'recovery' : 'done'; a.t = 0; emit(s, evs, a.stage === 'done' ? 'attackEnd' : 'recovery', { id: a.id, attack: a.attack, owner: a.owner, hit: a.hit }); }
    } else if (a.stage === 'recovery' && a.t >= a.recoveryF) { a.stage = 'done'; emit(s, evs, 'attackEnd', { id: a.id, attack: a.attack, owner: a.owner, hit: a.hit }); }
  }
  if (s.attacks.length > 64 || s.frame % 120 === 0) s.attacks = s.attacks.filter((a) => a.stage !== 'done');
  return damage;
}

// ---------------------------------------------------------------- phases
function phaseReady(def, s, ph) {
  const e = ph.enter; if (!e) return false;
  if (e.hpBelow !== undefined && hpFrac(def, s) <= e.hpBelow) return true;
  if (e.totalHpBelow !== undefined && totalHpFrac(def, s) <= e.totalHpBelow) return true;
  if (e.time !== undefined && s.frame >= F(e.time)) return true;
  if (e.partsDown !== undefined && s.partsDown >= e.partsDown) return true;
  if (e.phaseSeconds !== undefined && s.phaseFrame >= F(e.phaseSeconds)) return true;
  if (e.flag && s.flags[e.flag]) return true; return false;
}
function enterPhase(def, s, evs, idx) {
  const ph = def.phases[idx]; s.phaseIdx = idx; s.phaseId = ph.id; s.phaseFrame = 0; s.firedAdds = {};
  emit(s, evs, 'phase', { phase: ph.id, index: idx, music: ph.music || null, camera: ph.camera || null });
  const t = ph.transition || {};
  if (t.invuln) s.invulnUntil = s.frame + F(t.invuln);
  if (t.heal) { s.hp = Math.min(coreHp(def), s.hp + t.heal * coreHp(def)); emit(s, evs, 'heal', { frac: t.heal }); }
  if (t.clearAttacks !== false) s.attacks.forEach((a) => { if (!a.hazard && a.stage !== 'done') { a.stage = 'done'; emit(s, evs, 'cancel', { attack: a.attack, owner: a.owner, id: a.id }); } });
  for (const id of ph.reviveParts || []) { const ps = s.parts[id], p = partList(def).find((x) => x.id === id); if (ps && !ps.alive && p) { ps.alive = true; ps.hp = p.hp; ps.regrowAt = -1; s.partsDown = Math.max(0, s.partsDown - 1); emit(s, evs, 'regrow', { part: id, why: 'phase' }); } }
  s.cd = {}; s.nextStartF = s.frame + F(t.invuln || 0) + F(ph.openingDelay ?? 1);
}
function checkEnrage(def, s, evs) {
  const e = def.enrage; if (!e || s.enraged) return;
  if ((e.afterSeconds !== undefined && s.frame >= F(e.afterSeconds)) || (e.hpBelow !== undefined && hpFrac(def, s) <= e.hpBelow) || (e.phase && s.phaseId === e.phase)) {
    s.enraged = true; s.enrage = { speed: e.speedMult ?? 1.2, damage: e.damageMult ?? 1.2, windup: e.windupMult ?? 1 }; emit(s, evs, 'enrage', { cause: 'rule', speed: s.enrage.speed, damage: s.enrage.damage });
  }
}

// One fixed step. input = { target:{pos:[x,y,z], invulnerable?, resisting?, radius?}, hits?:[{part,damage,weak}], commands?, flags? }
export function step(s, def, input) {
  const evs = [], target = input.target; s.frame++; s.phaseFrame++;
  if (s.defeated) return { events: evs, force: [0, 0, 0], playerDamage: 0, done: true };
  if (input.flags) for (const [k, v] of Object.entries(input.flags)) s.flags[k] = !!v;
  for (const c of input.commands || []) applyCommand(def, s, evs, c);
  for (const h of input.hits || []) applyHit(def, s, evs, h);
  if (s.defeated) return { events: evs, force: [0, 0, 0], playerDamage: 0, done: true };
  for (const p of partList(def)) { // regrow timers pause while sealed
    const ps = s.parts[p.id]; if (ps.alive || ps.regrowAt < 0) continue;
    if (p.regrow?.blockedBy && s.flags[p.regrow.blockedBy]) { ps.regrowAt++; continue; }
    if (s.frame >= ps.regrowAt) { ps.alive = true; ps.hp = p.hp * (p.regrow.hpFrac ?? 1); ps.regrowAt = -1; ps.severed = false; s.partsDown--; emit(s, evs, 'regrow', { part: p.id, why: 'timer' }); }
  }
  for (const p of partList(def)) if (p.stagger && s.parts[p.id].stagger > 0) s.parts[p.id].stagger = Math.max(0, s.parts[p.id].stagger - (p.stagger.decayPerSec ?? 0) * DT);
  checkEnrage(def, s, evs);
  const nxt = def.phases[s.phaseIdx + 1]; if (nxt && phaseReady(def, s, nxt)) enterPhase(def, s, evs, s.phaseIdx + 1);
  const ph = phaseOf(def, s);
  for (const [i, a] of (ph.adds || []).entries()) if (!s.firedAdds[i] && s.phaseFrame >= F(a.at ?? 0)) { s.firedAdds[i] = true; spawnAdds(def, s, evs, a, 'schedule'); }
  const hz = stepHazards(def, s, evs, target);
  if (s.frame >= s.nextStartF && s.frame >= s.invulnUntil && !s.attacks.some((a) => a.stage === 'active' && !a.hazard && ph.exclusive)) {
    const a = pickAttack(def, s, ph, target);
    if (a) { startAttack(def, s, evs, ph, a, target); const g = Array.isArray(ph.gap) ? ph.gap[0] + rngNext(s) * (ph.gap[1] - ph.gap[0]) : ph.gap ?? 1.5; s.nextStartF = s.frame + F(g / speed(s)); }
  }
  let damage = stepAttacks(def, s, evs, target);
  if (hz.damage) { damage += hz.damage; if (s.frame % 30 === 0) emit(s, evs, 'damage', { amount: r4(hz.damage * 30), source: 'hazard', owner: 'hazard', kind: 'hazard' }); }
  const live = s.attacks.filter((a) => a.stage === 'windup' || a.stage === 'active').length; // ambient forces (vortex, flood) are reported, not counted
  if (live > s.stats.maxThreats) s.stats.maxThreats = live;
  return { events: evs, force: hz.force, playerDamage: r4(damage), done: s.defeated };
}

// ---------------------------------------------------------------- validation (structure)
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const ZREQ = { circle: ['r'], cone: ['r', 'angle'], line: ['length', 'width'], ring: ['rInner', 'rOuter'], sweep: ['r', 'width', 'arc'] };
export const HAZARD_KINDS = ['flood', 'vortex', 'debris', 'gas'];
export function validateBoss(def) {
  const errors = [], warnings = [], E = (path, code, message) => errors.push({ path, code, message }), W = (path, code, message) => warnings.push({ path, code, message });
  if (!def || typeof def !== 'object') return { ok: false, errors: [{ path: '$', code: 'BAD_TYPE', message: 'boss must be an object' }], warnings, stats: {} };
  if (typeof def.id !== 'string' || !def.id) E('id', 'REQUIRED', 'id must be a non-empty string');
  if (!(def.arena && def.arena.radius > 0)) E('arena.radius', 'REQUIRED', 'arena.radius must be > 0');
  if (!(coreHp(def) > 0)) E('core.hp', 'BAD_VALUE', 'core hp must be > 0'); if (def.pos && !isVec3(def.pos)) E('pos', 'BAD_VECTOR', 'pos must be [x,y,z]');
  const pids = new Set();
  partList(def).forEach((p, i) => {
    const w = `parts[${i}]`;
    if (!p.id || ['core', 'body'].includes(p.id) || pids.has(p.id)) E(`${w}.id`, 'BAD_ID', `part id missing, reserved or duplicated (${p.id})`); pids.add(p.id);
    if (!(p.hp > 0)) E(`${w}.hp`, 'BAD_VALUE', 'hp must be > 0'); if (!isVec3(p.pos)) E(`${w}.pos`, 'BAD_VECTOR', 'pos must be [x,y,z] offset from boss');
    if (p.weakPoint && !(p.weakPoint.multiplier > 1)) W(`${w}.weakPoint.multiplier`, 'WEAK_NO_BONUS', 'weak point multiplier should be > 1');
    if (p.regrow && !(p.regrow.time > 0)) E(`${w}.regrow.time`, 'BAD_VALUE', 'regrow.time must be > 0');
    if (p.stagger && !(p.stagger.threshold > 0 && p.stagger.duration > 0)) E(`${w}.stagger`, 'BAD_VALUE', 'stagger needs threshold and duration > 0');
    if (p.onDeath?.hazard && !(def.hazards || []).some((h) => h.id === p.onDeath.hazard)) E(`${w}.onDeath.hazard`, 'UNKNOWN_REF', `unknown hazard ${p.onDeath.hazard}`);
  });
  const e = def.core?.exposedWhen; if (e && e !== 'always') {
    if (e.partsDownAtLeast > pids.size) E('core.exposedWhen.partsDownAtLeast', 'UNREACHABLE', 'more parts must fall than exist; core can never be exposed');
    if (e.phase && !(def.phases || []).some((p) => p.id === e.phase)) E('core.exposedWhen.phase', 'UNKNOWN_REF', `unknown phase ${e.phase}`);
  }
  if (!Array.isArray(def.phases) || !def.phases.length) E('phases', 'REQUIRED', 'at least one phase is required');
  const seenPh = new Set(); let lastHp = 1.01;
  (def.phases || []).forEach((ph, i) => {
    const w = `phases[${i}]`; if (!ph.id || seenPh.has(ph.id)) E(`${w}.id`, 'BAD_ID', `phase id missing or duplicated (${ph.id})`); seenPh.add(ph.id);
    if (i > 0) {
      const en = ph.enter, keys = en ? Object.keys(en) : [];
      if (!keys.length) E(`${w}.enter`, 'REQUIRED', 'every phase after the first needs an enter condition');
      for (const k of keys) if (!['hpBelow', 'totalHpBelow', 'time', 'partsDown', 'phaseSeconds', 'flag'].includes(k)) E(`${w}.enter.${k}`, 'UNKNOWN_KEY', `unknown enter condition ${k}`);
      if (en?.hpBelow !== undefined) { if (!(en.hpBelow > 0 && en.hpBelow < 1)) E(`${w}.enter.hpBelow`, 'BAD_VALUE', 'hpBelow must be in (0,1)'); else { if (en.hpBelow >= lastHp) W(`${w}.enter.hpBelow`, 'PHASE_ORDER', 'hpBelow should decrease phase over phase'); lastHp = en.hpBelow; } }
      if (en?.partsDown > pids.size) E(`${w}.enter.partsDown`, 'UNREACHABLE', 'partsDown exceeds part count');
    }
    if (!ph.attacks?.length) E(`${w}.attacks`, 'EMPTY', 'phase needs an attack pool'); const aid = new Set();
    (ph.attacks || []).forEach((a, j) => {
      const aw = `${w}.attacks[${j}]`;
      if (!a.id || aid.has(a.id)) E(`${aw}.id`, 'BAD_ID', `attack id missing or duplicated (${a.id})`); aid.add(a.id);
      if (a.part && a.part !== 'body' && !pids.has(a.part)) E(`${aw}.part`, 'UNKNOWN_REF', `unknown part ${a.part}`);
      if (!(num(a.weight, 1) > 0)) E(`${aw}.weight`, 'BAD_VALUE', 'weight must be > 0'); if (!(num(a.windup, 1) > 0)) E(`${aw}.windup`, 'BAD_VALUE', 'windup must be > 0 (every attack is telegraphed)');
      if (!(num(a.active, 0.2) > 0)) E(`${aw}.active`, 'BAD_VALUE', 'active must be > 0'); if (num(a.recovery, 1) < 0 || num(a.cooldown, 3) < 0) E(`${aw}.recovery`, 'BAD_VALUE', 'recovery/cooldown must be >= 0');
      if (!(a.damage > 0 || a.dps > 0)) W(`${aw}.damage`, 'NO_DAMAGE', 'attack deals no damage');
      const z = a.zone; if (!z || !ZONE_SHAPES.includes(z.shape)) E(`${aw}.zone.shape`, 'BAD_SHAPE', `zone.shape must be one of ${ZONE_SHAPES.join(', ')}`);
      else { for (const k of ZREQ[z.shape]) if (z[k] === undefined) E(`${aw}.zone.${k}`, 'REQUIRED', `${z.shape} zone needs ${k}`); if (z.shape === 'ring' && !(z.rOuter > z.rInner)) E(`${aw}.zone.rOuter`, 'BAD_VALUE', 'rOuter must exceed rInner'); }
      if (!a.warning || typeof a.warning !== 'object' || !(a.warning.vfx || a.warning.sfx || a.warning.decal)) W(`${aw}.warning`, 'NO_WARNING', 'attack has no warning data (vfx/sfx/decal) for the player');
    });
    (ph.adds || []).forEach((a, j) => { if (!a.kind) E(`${w}.adds[${j}].kind`, 'REQUIRED', 'add needs kind'); });
  });
  const hid = new Set();
  (def.hazards || []).forEach((h, i) => {
    const w = `hazards[${i}]`; if (!h.id || hid.has(h.id)) E(`${w}.id`, 'BAD_ID', `hazard id missing or duplicated (${h.id})`); hid.add(h.id);
    if (!HAZARD_KINDS.includes(h.kind)) { E(`${w}.kind`, 'BAD_KIND', `kind must be one of ${HAZARD_KINDS.join(', ')}`); return; }
    if (h.phase && !seenPh.has(h.phase)) E(`${w}.phase`, 'UNKNOWN_REF', `unknown phase ${h.phase}`);
    const need = { flood: ['fromY', 'toY'], vortex: ['radius', 'strength'], debris: ['count'], gas: ['radius'] }[h.kind]; for (const k of need) if (h[k] === undefined) E(`${w}.${k}`, 'REQUIRED', `${h.kind} hazard needs ${k}`);
    if (h.kind === 'vortex' && h.pulse && !(h.pulse.period > h.pulse.active)) E(`${w}.pulse`, 'BAD_VALUE', 'pulse.period must exceed pulse.active');
  });
  if (def.enrage && !(def.enrage.speedMult > 0 || def.enrage.speedMult === undefined)) E('enrage.speedMult', 'BAD_VALUE', 'speedMult must be > 0');
  return { ok: !errors.length, errors, warnings, stats: { phases: (def.phases || []).length, parts: pids.size, attacks: (def.phases || []).reduce((n, p) => n + (p.attacks?.length || 0), 0), hazards: (def.hazards || []).length } };
}

// ---------------------------------------------------------------- bot + simulation
export const DEFAULT_PROFILE = { hp: 100, moveSpeed: 6.5, reactionMs: 300, dodgeDistance: 4, iframeMs: 300, dodgeCooldownMs: 900, dodgeSkill: 0.92, attackDamage: 10, attackIntervalMs: 600, range: 3, weakAwareness: 0.8, radius: 0.4, healItems: 0 };
export const ORACLE_PROFILE = { ...DEFAULT_PROFILE, reactionMs: 350, dodgeSkill: 1, weakAwareness: 1, hp: 100 };
const DIRS = Array.from({ length: 16 }, (_, i) => [Math.cos((i * TAU) / 16), Math.sin((i * TAU) / 16)]);
const mkBot = (def, prof, seed) => ({ pos: [0, 0, (def.arena?.radius ?? 10) * 0.75], hp: prof.hp, dashReady: 0, iframeUntil: 0, atkReady: 0, ignore: {}, rng: (seed ^ 0x9e3779b9) >>> 0 || 7, platform: null, force: [0, 0, 0], goal: null });

function threats(def, s, f, reactF, bot) { // zones the bot already perceives (age >= reaction), skipping ones it fumbles
  const out = [];
  for (const a of s.attacks) {
    if (a.stage !== 'windup' && a.stage !== 'active') continue;
    if (f - a.f0 < reactF + (a.tracking ? Math.max(0, a.lockF - (f - a.f0)) : 0)) continue;
    if (bot.ignore[a.id] === undefined) bot.ignore[a.id] = rngNext(bot) < bot.skill ? 0 : 1;
    if (bot.ignore[a.id]) continue; out.push(a);
  }
  return out;
}
const inDanger = (zs, p, pad) => zs.some((a) => zoneContains(a.zone, p, pad));
const inArena = (def, p, m) => hyp(p[0] - (def.pos?.[0] || 0), p[2] - (def.pos?.[2] || 0)) <= (def.arena?.radius ?? 10) - m;

export function botDecide(def, s, bot, prof, hitsOut) {
  const f = s.frame, reactF = F(prof.reactionMs / 1000), pad = prof.radius + 0.25, ms = prof.moveSpeed * DT, p = bot.pos;
  const zs = threats(def, s, f, reactF, bot); let escapeTo = null;
  const fl = (def.hazards || []).find((h) => h.kind === 'flood' && hazardActive(s, h.id));
  if (fl && def.arena?.platforms?.length) { // flooding: climb to the nearest platform that stays above the water
    const lvl = s.hazards[fl.id].level;
    if (p[1] < lvl + 0.4 || bot.platform) {
      let best = null; for (const pl of def.arena.platforms) if (pl.y >= fl.toY && (!best || hyp(pl.center[0] - p[0], pl.center[2] - p[2]) < hyp(best.center[0] - p[0], best.center[2] - p[2]))) best = pl;
      if (best) { escapeTo = [best.center[0], 0, best.center[2]]; if (hyp(p[0] - best.center[0], p[2] - best.center[2]) <= best.radius) { bot.platform = best; p[1] = best.y; } }
    }
  } else if (bot.platform) { bot.platform = null; p[1] = 0; }
  if (zs.length && inDanger(zs, p, pad)) {
    let best = null, bd = 1e9; // nearest candidate outside every perceived zone
    for (const d of [1, 2, 3, 4.5, 6, 8, 10]) { for (const v of DIRS) { const c = [p[0] + v[0] * d, p[1], p[2] + v[1] * d]; if (!inArena(def, c, 0.5) || inDanger(zs, c, pad + 0.2)) continue; if (d < bd) { bd = d; best = c; } } if (best) break; }
    let tta = 1e9; for (const a of zs) { const left = a.stage === 'windup' ? a.windupF - a.t : 0; tta = Math.min(tta, left); }
    if (best) {
      const walkable = bd <= tta * ms + 0.01, dashOk = f >= bot.dashReady;
      if (!walkable && dashOk && (bd <= prof.dodgeDistance || tta <= F(prof.iframeMs / 2000))) {
        const ux = (best[0] - p[0]) / bd, uz = (best[2] - p[2]) / bd, dd = Math.min(prof.dodgeDistance, bd + 0.3); p[0] += ux * dd; p[2] += uz * dd; bot.iframeUntil = f + F(prof.iframeMs / 1000); bot.dashReady = f + F(prof.dodgeCooldownMs / 1000);
      } else escapeTo = best;
    } else if (f >= bot.dashReady && tta <= F(prof.iframeMs / 2000)) { bot.iframeUntil = f + F(prof.iframeMs / 1000); bot.dashReady = f + F(prof.dodgeCooldownMs / 1000); }
  }
  if (escapeTo) { const dx = escapeTo[0] - p[0], dz = escapeTo[2] - p[2], d = hyp(dx, dz) || 1, m = Math.min(ms, d); p[0] += (dx / d) * m; p[2] += (dz / d) * m; return; }
  // pick a target part: exposed weak points first (if the bot notices), then nearest living target
  let tgt = null, td = 1e9, weak = false;
  const cands = partList(def).filter((x) => s.parts[x.id].alive).map((x) => ({ id: x.id, pos: ownerPos(def, x.id), w: weakOpen(def, s, x.id), r: x.radius ?? 1 }));
  if (coreExposed(def, s)) cands.push({ id: 'core', pos: ownerPos(def, 'body'), w: false, r: def.core?.radius ?? 1.5 });
  const aware = rngNext(bot) < prof.weakAwareness;
  for (const c of cands) { const d = hyp(c.pos[0] - p[0], c.pos[2] - p[2]) - (aware && c.w ? 1000 : 0); if (d < td) { td = d; tgt = c; weak = aware && c.w; } }
  if (!tgt) { const mid = ownerPos(def, 'body'); tgt = { id: 'core', pos: mid, w: false, r: 1.5, hold: true }; }
  const dx = tgt.pos[0] - p[0], dz = tgt.pos[2] - p[2], d = hyp(dx, dz), reach = prof.range + tgt.r;
  if (d > reach * 0.85) { const m = Math.min(ms, d - reach * 0.8), np = [p[0] + (dx / d) * m, p[1], p[2] + (dz / d) * m]; if (!(inDanger(zs, np, pad + 0.1)) && inArena(def, np, 0.3)) { p[0] = np[0]; p[2] = np[2]; } }
  if (d <= reach && f >= bot.atkReady && !tgt.hold && (tgt.id !== 'core' || coreExposed(def, s))) { bot.atkReady = f + F(prof.attackIntervalMs / 1000); hitsOut.push({ part: tgt.id, damage: prof.attackDamage, weak }); }
}

// Run one fight. Returns a compact deterministic result; opts.log=true includes the event log.
export function runFight(def, { seed = 1, profile = {}, maxSeconds = 300, log = false } = {}) {
  const prof = { ...DEFAULT_PROFILE, ...profile }, s = createBoss(def, seed), bot = mkBot(def, prof, seed); bot.skill = prof.dodgeSkill;
  const phaseStart = { [s.phaseId]: 0 }, phaseTimes = {}, launches = {}, hits = {}; let damageTaken = 0, lost = false, dmgByKind = { attack: 0, hazard: 0 }, cause = null, force = [0, 0, 0], simMax = 0;
  const maxF = F(maxSeconds); let prevPhase = s.phaseId;
  while (s.frame < maxF && !s.defeated) {
    { const fm = hyp(force[0], force[2]); if (fm > 1e-9) { const cnt = Math.min(fm * DT, prof.moveSpeed * DT * 0.6), k = 1 - cnt / (fm * DT); bot.pos[0] += force[0] * DT * k; bot.pos[2] += force[2] * DT * k; } } // bot leans against the pull
    const hitsOut = []; botDecide(def, s, bot, prof, hitsOut);
    const r = step(s, def, { target: { pos: bot.pos, invulnerable: s.frame < bot.iframeUntil, radius: prof.radius, resisting: false }, hits: hitsOut });
    force = r.force;
    for (const e of r.events) {
      if (e.type === 'telegraph' && !e.hazard) launches[e.attack] = (launches[e.attack] || 0) + 1;
      if (e.type === 'phase') { phaseTimes[prevPhase] = r4((s.frame - phaseStart[prevPhase]) / FPS); phaseStart[e.phase] = s.frame; prevPhase = e.phase; }
      if (e.type === 'damage') { dmgByKind[e.kind] += e.amount; if (e.kind === 'attack') hits[e.source] = (hits[e.source] || 0) + 1; }
    }
    if (r.playerDamage > 0) { bot.hp -= r.playerDamage; damageTaken += r.playerDamage; cause = s.attacks.find((a) => a.stage === 'active')?.attack || 'hazard'; }
    if (bot.hp <= 0) { lost = true; break; }
  }
  phaseTimes[prevPhase] = r4((s.frame - phaseStart[prevPhase]) / FPS); simMax = s.stats.maxThreats;
  const res = { seed, won: s.defeated, died: lost, timeSeconds: r4(s.frame / FPS), damageTaken: r4(damageTaken), damageByKind: { attack: r4(dmgByKind.attack), hazard: r4(dmgByKind.hazard) }, hpLeft: r4(Math.max(0, bot.hp)), phaseTimes, launches, hits, maxThreats: simMax, finalPhase: s.phaseId, killedBy: lost ? cause : null, logHash: hashJSON(s.log), events: s.log.length };
  if (log) res.log = s.log; return res;
}
const pct = (arr, q) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return r4(a[Math.min(a.length - 1, Math.floor(q * a.length))]); };
const mean = (a) => (a.length ? r4(a.reduce((x, y) => x + y, 0) / a.length) : null);
export function simulate(def, { runs = 20, seed = 1, profile = {}, maxSeconds = 300 } = {}) {
  const results = []; for (let i = 0; i < runs; i++) results.push(runFight(def, { seed: seed + i * 7919, profile, maxSeconds }));
  const wins = results.filter((r) => r.won), phases = {}; for (const r of results) for (const [k, v] of Object.entries(r.phaseTimes)) (phases[k] ||= []).push(v);
  const launches = {}, hits = {}; for (const r of results) { for (const [k, v] of Object.entries(r.launches)) launches[k] = (launches[k] || 0) + v; for (const [k, v] of Object.entries(r.hits)) hits[k] = (hits[k] || 0) + v; }
  const deaths = {}; for (const r of results) if (r.killedBy) deaths[r.killedBy] = (deaths[r.killedBy] || 0) + 1;
  return { runs, winRate: r4(wins.length / runs), deathRate: r4(results.filter((r) => r.died).length / runs), timeoutRate: r4(results.filter((r) => !r.won && !r.died).length / runs),
    timeToKill: { mean: mean(wins.map((r) => r.timeSeconds)), median: pct(wins.map((r) => r.timeSeconds), 0.5), p90: pct(wins.map((r) => r.timeSeconds), 0.9) },
    damageTaken: { mean: mean(results.map((r) => r.damageTaken)), p90: pct(results.map((r) => r.damageTaken), 0.9), max: r4(Math.max(...results.map((r) => r.damageTaken))) },
    phaseSeconds: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, mean(v)])), attackLaunches: launches, attackHits: hits, killedBy: deaths, maxThreats: Math.max(...results.map((r) => r.maxThreats)),
    hash: hashJSON(results.map((r) => [r.seed, r.won, r.timeSeconds, r.damageTaken, r.logHash])) , results: results.map(({ seed: sd, won, died, timeSeconds, damageTaken: dt, logHash }) => ({ seed: sd, won, died, timeSeconds, damageTaken: dt, logHash })) };
}

// Skill tiers (additive): bot profiles used by balance(). Existing DEFAULT/ORACLE profiles and simulate() are unchanged.
export const SKILL_TIERS = {
  novice: { ...DEFAULT_PROFILE, reactionMs: 520, dodgeSkill: 0.68, weakAwareness: 0.35, attackIntervalMs: 800, dodgeCooldownMs: 1200 },
  average: { ...DEFAULT_PROFILE, reactionMs: 450, dodgeSkill: 0.72, weakAwareness: 0.6, attackIntervalMs: 700 },
  expert: { ...DEFAULT_PROFILE, reactionMs: 400, dodgeSkill: 0.8, weakAwareness: 0.85 },
  oracle: { ...ORACLE_PROFILE },
};
export const TIER_BANDS = { novice: [0.1, 0.35], average: [0.4, 0.65], expert: [0.7, 0.9], oracle: [0.85, 1] };
export function balance(def, { runs = 100, seed = 1, tiers = Object.keys(SKILL_TIERS), bands = {}, maxSeconds = 300, profiles = {} } = {}) {
  const out = {}; let pass = true;
  for (const t of tiers) {
    const prof = { ...SKILL_TIERS[t], ...(profiles[t] || {}) }, band = bands[t] || TIER_BANDS[t] || [0, 1];
    const rs = []; for (let i = 0; i < runs; i++) rs.push(runFight(def, { seed: seed + i * 7919, profile: prof, maxSeconds }));
    const wins = rs.filter((r) => r.won), deathsByPhase = {}; for (const r of rs) if (r.died) deathsByPhase[r.finalPhase] = (deathsByPhase[r.finalPhase] || 0) + 1;
    const winRate = r4(wins.length / runs), inBand = winRate >= band[0] && winRate <= band[1]; if (!inBand) pass = false;
    out[t] = { winRate, band, pass: inBand, timeToKill: { mean: mean(wins.map((r) => r.timeSeconds)), median: pct(wins.map((r) => r.timeSeconds), 0.5), p90: pct(wins.map((r) => r.timeSeconds), 0.9) },
      damageTaken: { mean: mean(rs.map((r) => r.damageTaken)), p90: pct(rs.map((r) => r.damageTaken), 0.9) }, deaths: rs.length - wins.length - rs.filter((r) => !r.won && !r.died).length, timeouts: rs.filter((r) => !r.won && !r.died).length, deathsByPhase,
      hash: hashJSON(rs.map((r) => [r.seed, r.won, r.timeSeconds, r.damageTaken, r.logHash])) };
  }
  return { runs, seed, pass, tiers: out };
}

// ---------------------------------------------------------------- fairness (static + simulated)
export const DEFAULT_FAIRNESS = { reactionMs: 350, moveSpeed: 6.5, margin: 0.3, maxThreats: 4, oracleRuns: 6, oracleDamageFrac: 0.35, attackHitRate: 0.5, dodge: { distance: 4, iframeMs: 300, cooldownMs: 900, jumpHeight: 1.0 } };
// Greatest distance anyone standing inside the zone must travel to leave it (numeric; grid and ray step scale with zone size).
export function escapeDistance(zoneSpec, ownerP = [0, 0, 0], targetP = [6, 0, 0]) {
  const aim = Math.atan2(targetP[2] - ownerP[2], targetP[0] - ownerP[0]), z = resolveZone({ ...zoneSpec, maxY: undefined }, ownerP, targetP, aim), R = (z.shape === 'line' ? Math.hypot(z.length, z.width) : z.rOuter || z.r) + 2;
  let worst = 0; const gs = Math.max(1, R / 15), rs = Math.max(0.25, R / 80);
  for (let x = z.o[0] - R; x <= z.o[0] + R; x += gs) for (let y = z.o[1] - R; y <= z.o[1] + R; y += gs) {
    const p = [x, 0, y]; if (!zoneContains(z, p, 0)) continue; let best = 1e9;
    for (let k = 0; k < 12; k++) { const a = (k * TAU) / 12; for (let d = rs; d <= 3 * R && d < best; d += rs) if (!zoneContains(z, [x + Math.cos(a) * d, 0, y + Math.sin(a) * d], 0)) { best = d; break; } }
    if (best < 1e9 && best > worst) worst = best;
  }
  return worst;
}
const subsets = (arr, k, cap = 300) => { const out = []; const rec = (i, cur) => { if (out.length >= cap) return; if (cur.length === k) { out.push(cur.slice()); return; } for (let j = i; j < arr.length; j++) { cur.push(arr[j]); rec(j + 1, cur); cur.pop(); } }; rec(0, []); return out; };

export function fairness(def, opts = {}) {
  const o = { ...DEFAULT_FAIRNESS, ...opts, dodge: { ...DEFAULT_FAIRNESS.dodge, ...(opts.dodge || {}) } }, findings = [];
  const add = (severity, code, path, message, data) => findings.push({ severity, code, path, message, ...(data ? { data } : {}) });
  const v = validateBoss(def); if (!v.ok) { for (const e of v.errors) add('error', `STRUCT_${e.code}`, e.path, e.message); return { ok: false, pass: false, findings, stats: {}, simulated: null }; }
  const reactS = o.reactionMs / 1000, enr = def.enrage ? { windup: def.enrage.windupMult ?? 1, speed: def.enrage.speedMult ?? 1.2 } : { windup: 1, speed: 1 };
  const stats = { attacksChecked: 0, minTelegraphMs: Infinity, maxThreatsStatic: 0, escapeDistances: {} };
  const arenaR = def.arena.radius, c0 = def.pos || [0, 0, 0];
  const reach = (windup) => o.moveSpeed * Math.max(0, windup - reactS) + o.dodge.distance;
  for (const [pi, ph] of def.phases.entries()) {
    for (const [ai, a] of ph.attacks.entries()) {
      const path = `phases[${pi}].attacks[${ai}]`, windup = (a.windup ?? 1) * (def.enrage ? Math.min(1, enr.windup) : 1), active = (a.active ?? 0.2), z = a.zone, owner = ownerPos(def, a.part || 'body');
      stats.attacksChecked++; stats.minTelegraphMs = Math.min(stats.minTelegraphMs, windup * 1000);
      if (windup + 1e-9 < reactS) { add('error', 'TELEGRAPH_TOO_SHORT', path, `${a.id}: windup ${(windup * 1000).toFixed(0)} ms < human reaction floor ${o.reactionMs} ms${def.enrage && enr.windup < 1 ? ' (after enrage windupMult)' : ''}`, { windupMs: Math.round(windup * 1000) }); }
      if (!a.warning || !(a.warning.vfx || a.warning.sfx || a.warning.decal)) add('error', 'NO_WARNING_DATA', path, `${a.id}: no warning vfx/sfx/decal data, the player gets no cue`);
      const lockPenalty = (z.lockFrac ?? 0) * windup, avail = windup - lockPenalty;
      const esc = escapeDistance(z, owner, [owner[0] + 8, 0, owner[2]]); stats.escapeDistances[`${ph.id}/${a.id}`] = r4(esc);
      const sweepBonus = z.shape === 'sweep' ? active * 0.5 : 0, canWalk = reach(avail + sweepBonus) >= esc + o.margin, jumpable = z.maxY !== undefined && z.maxY <= o.dodge.jumpHeight;
      const ifr = o.dodge.iframeMs / 1000, oneShot = !(a.dps > 0) && !(a.rehit > 0) && active <= ifr + 1e-9, cdOk = (a.cooldown ?? 3) * 1000 >= o.dodge.cooldownMs || (ph.gap ?? 1.5) * 1000 >= o.dodge.cooldownMs;
      if (!(canWalk || jumpable || (oneShot && avail >= reactS && cdOk))) add('error', 'UNAVOIDABLE_ATTACK', path, `${a.id}: needs ${esc.toFixed(1)} m escape but only ${reach(avail + sweepBonus).toFixed(1)} m reachable (move ${o.moveSpeed} m/s + dash ${o.dodge.distance} m) and i-frames (${o.dodge.iframeMs} ms) do not cover active ${Math.round(active * 1000)} ms`, { escape: r4(esc), reachable: r4(reach(avail + sweepBonus)) });
      if (esc > arenaR * 1.2) add('warn', 'ZONE_LARGER_THAN_ARENA', path, `${a.id}: zone escape ${esc.toFixed(1)} m exceeds arena radius ${arenaR} m`);
    }
    // safe zone for each combination of simultaneous attacks (+ persistent hazards of this phase)
    const mc = Math.max(1, ph.maxConcurrent ?? 1), byOwner = new Map(); for (const a of ph.attacks) (byOwner.get(a.part || 'body') || byOwner.set(a.part || 'body', []).get(a.part || 'body')).push(a);
    const hz = (def.hazards || []).filter((h) => !h.phase || h.phase === ph.id);
    stats.maxThreatsStatic = Math.max(stats.maxThreatsStatic, Math.min(mc, byOwner.size) + hz.reduce((n, h) => n + (h.kind === 'debris' ? Math.ceil((h.telegraph ?? 1.2) / Math.max(0.1, h.interval ?? 2)) * (h.count ?? 1) : h.kind === 'gas' ? 1 : 0), 0));
    const owners = [...byOwner.keys()], samples = [[0, 0, 0]]; for (const k of [0.5, 0.9]) for (let i = 0; i < 8; i++) samples.push([c0[0] + Math.cos((i * TAU) / 8) * arenaR * k, 0, c0[2] + Math.sin((i * TAU) / 8) * arenaR * k]);
    const grid = []; for (let x = -arenaR; x <= arenaR; x += 1.5) for (let y = -arenaR; y <= arenaR; y += 1.5) if (hyp(x, y) <= arenaR - 0.5) grid.push([c0[0] + x, 0, c0[2] + y]);
    const gas = hz.filter((h) => h.kind === 'gas'), vort = hz.filter((h) => h.kind === 'vortex');
    for (let k = 1; k <= Math.min(mc, owners.length); k++) for (const ownerSet of subsets(owners, k, 60)) {
      const pools = ownerSet.map((id) => byOwner.get(id)); const picks = []; // one attack per owner, all index combos (capped)
      const rec = (i, cur) => { if (picks.length >= 120) return; if (i === pools.length) { picks.push(cur.slice()); return; } for (const a of pools[i]) { cur.push(a); rec(i + 1, cur); cur.pop(); } }; rec(0, []);
      for (const combo of picks) for (const tp of samples) {
        const zones = combo.map((a) => { const op = ownerPos(def, a.part || 'body'); return resolveZone(a.zone, op, tp, Math.atan2(tp[2] - op[2], tp[0] - op[0])); });
        for (const g of gas) zones.push(resolveZone({ shape: 'circle', r: g.growTo ?? g.radius }, [g.center?.[0] ?? 0, 0, g.center?.[2] ?? 0], tp, 0));
        const minWind = Math.min(...combo.map((a) => a.windup ?? 1)), budget = reach(minWind);
        const ok = grid.some((q) => !zones.some((z) => zoneContains(z, q, 0.6)) && !vort.some((h) => h.coreRadius && hyp(q[0] - (h.center?.[0] ?? 0), q[2] - (h.center?.[2] ?? 0)) < h.coreRadius + 0.5) && hyp(q[0] - tp[0], q[2] - tp[2]) <= budget + 6);
        if (!ok) { add('error', 'NO_SAFE_ZONE', `phases[${pi}]`, `no safe point in the arena for simultaneous ${combo.map((a) => a.id).join(' + ')}${gas.length ? ' with gas' : ''} (target at ${tp.map(r4).join(',')})`, { attacks: combo.map((a) => a.id) }); break; }
      }
      if (findings.some((f) => f.code === 'NO_SAFE_ZONE' && f.path === `phases[${pi}]`)) break;
    }
  }
  for (const [hi, h] of (def.hazards || []).entries()) {
    const path = `hazards[${hi}]`;
    if (h.kind === 'debris' && (h.telegraph ?? 1.2) < reactS) add('error', 'TELEGRAPH_TOO_SHORT', path, `${h.id}: debris telegraph ${(h.telegraph ?? 1.2) * 1000} ms < ${o.reactionMs} ms`);
    if (h.kind === 'gas' && (h.windup ?? 1.5) < reactS) add('error', 'TELEGRAPH_TOO_SHORT', path, `${h.id}: gas windup too short`);
    if (h.kind === 'vortex') {
      if (h.strength >= o.moveSpeed * 0.9 && !(h.resistFactor !== undefined && h.strength * h.resistFactor < o.moveSpeed * 0.9)) add('error', 'VORTEX_INESCAPABLE', path, `${h.id}: pull ${h.strength} m/s >= 90% of move speed ${o.moveSpeed} m/s and no resist mechanic`);
      if (h.pulse && (h.pulse.telegraph ?? 1) < reactS) add('error', 'TELEGRAPH_TOO_SHORT', path, `${h.id}: vortex pulse telegraph below reaction floor`);
      if (!(h.ramp > 0) && !h.pulse) add('warn', 'VORTEX_NO_RAMP', path, `${h.id}: vortex starts at full strength; add ramp`);
    }
    if (h.kind === 'flood' && !(def.arena.platforms || []).some((pl) => pl.y >= h.toY)) add('error', 'NO_HIGH_GROUND', path, `${h.id}: flood rises to y=${h.toY} but no arena platform reaches it`);
    if (h.kind === 'flood') { const rate = (h.toY - h.fromY) / Math.max(0.1, h.rise ?? 10); if (rate > 1.5) add('error', 'FLOOD_TOO_FAST', path, `${h.id}: flood rises ${rate.toFixed(2)} m/s`); }
  }
  if (stats.maxThreatsStatic > o.maxThreats) add('error', 'TOO_MANY_THREATS', 'phases', `up to ${stats.maxThreatsStatic} simultaneous threats exceeds limit ${o.maxThreats}`, { max: stats.maxThreatsStatic });
  if (stats.minTelegraphMs === Infinity) stats.minTelegraphMs = null;
  // simulated: an oracle (perfect dodger at the reaction floor) must not be hurt much
  let simulated = null;
  if (opts.simulate !== false && !findings.some((f) => f.severity === 'error' && f.code.startsWith('STRUCT_'))) {
    const prof = { ...ORACLE_PROFILE, reactionMs: o.reactionMs, moveSpeed: o.moveSpeed, dodgeDistance: o.dodge.distance, iframeMs: o.dodge.iframeMs, dodgeCooldownMs: o.dodge.cooldownMs, hp: 1000 };
    const sim = simulate(def, { runs: o.oracleRuns, seed: opts.seed ?? 1, profile: prof, maxSeconds: opts.maxSeconds ?? 240 });
    simulated = { runs: sim.runs, meanDamage: sim.damageTaken.mean, hitsByAttack: sim.attackHits, launches: sim.attackLaunches, maxThreats: sim.maxThreats, winRate: sim.winRate };
    if (sim.damageTaken.mean > o.oracleDamageFrac * 100) add('error', 'SIM_UNAVOIDABLE_DAMAGE', 'simulation', `perfect-reaction bot still takes ${sim.damageTaken.mean} damage per fight (limit ${o.oracleDamageFrac * 100})`, { mean: sim.damageTaken.mean });
    for (const [id, n] of Object.entries(sim.attackLaunches)) { const h = sim.attackHits[id] || 0; if (n >= 6 && h / n > o.attackHitRate) add('error', 'SIM_ATTACK_HITS_ORACLE', `attack ${id}`, `${id} hit the perfect bot ${h}/${n} times`, { hits: h, launches: n }); }
    if (sim.maxThreats > o.maxThreats) add('error', 'TOO_MANY_THREATS', 'simulation', `observed ${sim.maxThreats} simultaneous threats (limit ${o.maxThreats})`);
  }
  const errs = findings.filter((f) => f.severity === 'error');
  return { ok: true, pass: !errs.length, errorCount: errs.length, findings, stats, simulated, options: o };
}
