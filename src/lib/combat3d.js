// combat3d: deterministic frame-data combat (3D). Pure JS, zero deps, Y-up, metres, fixed step dt = 1/60.
// All state is plain JSON (a Godot port mirrors it from JSON). No Date / Math.random: chance rolls use a mulberry32
// state stored in world.rng (seed it via createWorld({seed})). Overlap tests come from ./collision3d.js.
// Spec: spec/v4/combat3d.md. Schema: spec/v4/schemas/combat3d.schema.json.
//
// Frames: a move's frame counter starts at 1 on the frame the move begins. Startup = frames 1..startup, active =
// startup+1..startup+active, recovery = the next `recovery` frames. total = startup+active+recovery.
// Facing: yaw about +Y; forward at yaw 0 is +Z, forward(yaw) = [sin yaw, 0, cos yaw]. Move-local vectors (knockback,
// motion, hitbox offsets without a bone) are rotated by the owner's yaw.
import { sphereSphere, sphereCapsule, capsuleCapsule, sphereOBB, obbOBB, obbFromQuat } from './collision3d.js';

export const DT = 1 / 60;
export const DAMAGE_TYPES = ['physical', 'fire', 'water', 'toxic'];
export const DEFAULT_STATUSES = {
  poison: { duration: 300, tickEvery: 30, damage: 2, damageType: 'toxic', maxStacks: 3, stackMode: 'stack' },
  burn: { duration: 180, tickEvery: 20, damage: 3, damageType: 'fire', maxStacks: 1, stackMode: 'refresh', extinguishedBy: ['water'] },
  slow: { duration: 240, speedMult: 0.5, maxStacks: 1, stackMode: 'refresh' },
};
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const jc = (o) => JSON.parse(JSON.stringify(o));

// ---------------- rng (mulberry32, state is one uint32 in world.rng) ----------------
export function rngNext(world) {
  world.rng = (world.rng + 0x6d2b79f5) >>> 0;
  let t = world.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------- small math ----------------
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => { const l = vlen(a); return l > 1e-12 ? vmul(a, 1 / l) : [0, 0, 0]; };
export const yawQuat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
export const rotYaw = (v, yaw) => { const s = Math.sin(yaw), c = Math.cos(yaw); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
export const forward = (yaw) => [Math.sin(yaw), 0, Math.cos(yaw)];
export function quatRot(q, v) { // q = [x,y,z,w]
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1, x = q[0] / n, y = q[1] / n, z = q[2] / n, w = q[3] / n;
  const t = vmul(vcross([x, y, z], v), 2);
  return vadd(vadd(v, vmul(t, w)), vcross([x, y, z], t));
}
const xf = (T, p) => vadd(T.pos, quatRot(T.quat, p));

// ---------------- shapes ----------------
// Local shape: {type:'sphere',r} | {type:'capsule',a,b,r} | {type:'box',h}; `offset` is local to the transform T = {pos, quat}.
export function worldShape(s, T, offset = [0, 0, 0]) {
  const o = offset || [0, 0, 0];
  if (s.type === 'sphere') return { type: 'sphere', c: xf(T, o), r: s.r };
  if (s.type === 'capsule') return { type: 'capsule', a: xf(T, vadd(o, s.a)), b: xf(T, vadd(o, s.b)), r: s.r };
  if (s.type === 'box') return { type: 'box', ...obbFromQuat(xf(T, o), s.h, T.quat) };
  throw new Error(`unknown shape type ${s.type}`);
}
export function shapeBounds(s) {
  if (s.type === 'sphere') return { min: s.c.map((v) => v - s.r), max: s.c.map((v) => v + s.r) };
  if (s.type === 'capsule') return { min: s.a.map((v, i) => Math.min(v, s.b[i]) - s.r), max: s.a.map((v, i) => Math.max(v, s.b[i]) + s.r) };
  const e = [0, 1, 2].map((i) => Math.abs(s.axes[0][i]) * s.h[0] + Math.abs(s.axes[1][i]) * s.h[1] + Math.abs(s.axes[2][i]) * s.h[2]);
  return { min: s.c.map((v, i) => v - e[i]), max: s.c.map((v, i) => v + e[i]) };
}
const capsuleSpheres = (cp) => { // deterministic sphere chain approximating a capsule (used for capsule vs box)
  const len = vlen(vsub(cp.b, cp.a)), n = Math.max(1, Math.ceil(len / Math.max(cp.r, 1e-3)));
  const out = []; for (let i = 0; i <= n; i++) out.push({ c: vadd(cp.a, vmul(vsub(cp.b, cp.a), i / n)), r: cp.r }); return out;
};
// Overlap depth (0 = no overlap) between two world shapes.
export function shapeOverlap(A, B) {
  if (A.type > B.type) [A, B] = [B, A]; // canonical order: box < capsule < sphere
  const d = (r) => (r ? r.depth : 0);
  switch (A.type + '/' + B.type) {
    case 'sphere/sphere': return d(sphereSphere(A, B));
    case 'capsule/sphere': return d(sphereCapsule(B, A));
    case 'capsule/capsule': return d(capsuleCapsule(A, B));
    case 'box/sphere': return d(sphereOBB(B, A));
    case 'box/box': return d(obbOBB(A, B));
    case 'box/capsule': return capsuleSpheres(B).reduce((m, s) => Math.max(m, d(sphereOBB(s, A))), 0);
    default: return 0;
  }
}

// ---------------- definitions: defaults + frame helpers ----------------
export const moveTotal = (m) => m.startup + m.active + m.recovery;
export const inWin = (w, f) => !!w && f >= w.from && f <= w.to;
const activeRange = (m) => ({ from: m.startup + 1, to: m.startup + m.active });
const DEFAULT_HURT = [{ id: 'body', shape: { type: 'capsule', a: [0, 0.4, 0], b: [0, 1.4, 0], r: 0.4 }, mult: 1 }];

// ---------------- fighters ----------------
export function createFighter(def, o = {}) {
  const d = jc(def);
  return {
    id: o.id ?? d.id, team: o.team ?? d.team ?? d.id,
    pos: o.pos ? [...o.pos] : [0, 0, 0], yaw: o.yaw ?? 0, kb: [0, 0, 0], frozen: false,
    hp: d.maxHp ?? 100, maxHp: d.maxHp ?? 100, poise: d.maxPoise ?? 50, maxPoise: d.maxPoise ?? 50, poiseRegen: 0,
    def: d, state: 'idle', stun: 0, hitstop: 0, move: null,
    blockFrames: 0, buffer: [], status: [], combo: 0, tempo: 0,
    dealt: 0, taken: 0, hits: 0,
  };
}
export function createWorld({ fighters = [], statuses = {}, seed = 1, groundY = null, friendlyFire = false, hostility = null, maxEvents = 20000, kbDecay = 0.85 } = {}) {
  const world = { frame: 0, rng: seed >>> 0, groundY, friendlyFire, hostility, maxEvents, kbDecay, statuses: { ...DEFAULT_STATUSES, ...jc(statuses) }, fighters: [], projectiles: [], events: [], eventsDropped: 0, nextProj: 1 };
  for (const f of fighters) world.fighters.push(f.def ? f : createFighter(f));
  return world;
}
export const fighterOf = (world, id) => world.fighters.find((f) => f.id === id);
const hostile = (world, a, b) => {
  if (a.id === b.id) return false;
  if (world.hostility) return !!world.hostility[a.team]?.includes(b.team);
  return a.team !== b.team;
};
function emit(world, type, data) {
  world.events.push({ f: world.frame, type, ...data });
  if (world.events.length > world.maxEvents) { world.events.shift(); world.eventsDropped++; }
}
export const speedMult = (world, f) => f.status.reduce((m, s) => m * (world.statuses[s.type]?.speedMult ?? 1), 1);

// ---------------- hit transforms ----------------
function rootT(f, poses) { const p = poses?.[f.id]; return { pos: p?.pos ?? f.pos, quat: yawQuat(p?.yaw ?? f.yaw) }; }
function boneT(f, bone, poses) {
  if (!bone) return rootT(f, poses);
  const b = poses?.[f.id]?.bones?.[bone];
  if (!b) return rootT(f, poses); // missing bone falls back to the root transform (deterministic)
  return { pos: b.pos, quat: b.quat ?? [0, 0, 0, 1] };
}
// Keyframed offset (move-frame based, linear, clamped). hb.keys = [{frame, offset}]
export function hitboxOffset(hb, frame) {
  const k = hb.keys; if (!k || !k.length) return hb.offset || [0, 0, 0];
  if (frame <= k[0].frame) return k[0].offset;
  for (let i = 1; i < k.length; i++) if (frame <= k[i].frame) { const t = (frame - k[i - 1].frame) / (k[i].frame - k[i - 1].frame || 1); return vadd(vmul(k[i - 1].offset, 1 - t), vmul(k[i].offset, t)); }
  return k[k.length - 1].offset;
}
export const hitboxWorld = (f, hb, frame, poses) => worldShape(hb.shape, boneT(f, hb.bone, poses), hitboxOffset(hb, frame));
export const hurtboxesWorld = (f, poses) => (f.def.hurtboxes?.length ? f.def.hurtboxes : DEFAULT_HURT).map((h, i) => ({ i, id: h.id, mult: h.mult ?? 1, weak: !!h.weak, shape: worldShape(h.shape, boneT(f, h.bone, poses), h.offset) }));

// ---------------- moves ----------------
function startMove(world, f, moveId, via) {
  const m = f.def.moves[moveId]; if (!m) return false;
  f.move = { id: moveId, frame: 0, hit: {}, connected: null, spawned: {} };
  f.state = 'move'; f.stun = 0; f.tempo = 0; f.blockFrames = 0;
  emit(world, 'move', { who: f.id, move: moveId, via: via || 'input' });
  return true;
}
const buffered = (world, f, action) => { const i = f.buffer.findIndex((b) => b.action === action); if (i < 0) return false; f.buffer.splice(i, 1); return true; };
const hasBuf = (f, action) => f.buffer.some((b) => b.action === action);

function applyDamage(world, f, amount, type) {
  const res = clamp(f.def.resist?.[type] ?? 0, -10, 1);
  const dmg = r6(Math.max(0, amount * (1 - res)));
  f.hp = r6(f.hp - dmg); f.taken = r6(f.taken + dmg);
  return dmg;
}
function die(world, f, by) {
  f.hp = Math.max(0, f.hp); f.state = 'dead'; f.move = null; f.stun = 0; f.status = []; f.kb = [0, 0, 0];
  emit(world, 'death', { who: f.id, by: by ?? null });
}
export function applyStatus(world, f, id, opts = {}) {
  const sd = world.statuses[id]; if (!sd || f.state === 'dead') return false;
  const dur = opts.duration ?? sd.duration ?? 60, cur = f.status.find((s) => s.type === id);
  if (cur) {
    if (sd.stackMode === 'ignore') return false;
    cur.left = Math.max(cur.left, dur);
    if (sd.stackMode === 'stack' && cur.stacks < (sd.maxStacks ?? 1)) cur.stacks++;
  } else f.status.push({ type: id, left: dur, stacks: 1, age: 0, src: opts.src ?? null });
  emit(world, 'status', { who: f.id, status: id, op: cur ? 'refresh' : 'apply', stacks: (cur || f.status[f.status.length - 1]).stacks });
  return true;
}
function tickStatus(world, f) {
  for (const s of [...f.status]) {
    const sd = world.statuses[s.type]; s.age++; s.left--;
    if (sd?.tickEvery && s.age % sd.tickEvery === 0 && f.state !== 'dead') {
      const dmg = applyDamage(world, f, (sd.damage ?? 0) * s.stacks, sd.damageType ?? 'physical');
      emit(world, 'dot', { who: f.id, status: s.type, damage: dmg, hp: f.hp });
      if (f.hp <= 0) { die(world, f, s.src); return; }
    }
    if (s.left <= 0) { f.status.splice(f.status.indexOf(s), 1); emit(world, 'status', { who: f.id, status: s.type, op: 'expire' }); }
  }
}
function extinguish(world, f, type) {
  for (const s of [...f.status]) if (world.statuses[s.type]?.extinguishedBy?.includes(type)) { f.status.splice(f.status.indexOf(s), 1); emit(world, 'status', { who: f.id, status: s.type, op: 'extinguish' }); }
}

// ---------------- the hit pipeline (moves and projectiles share it) ----------------
// h = {damage, damageType, hitstun, blockstun, knockback (world space), hitstop, poiseDamage, guardBreak, unblockable, status:[{id,chance,duration}], src, srcPos, key, moveId?}
function resolveHit(world, attacker, victim, part, h) {
  if (victim.state === 'dead') return null;
  const cr = attacker || (h.owner ? fighterOf(world, h.owner) : null);
  const base = { who: attacker ? attacker.id : h.owner ?? null, victim: victim.id, move: h.moveId ?? null, part: part.id ?? null };
  if (victim.move && inWin(victim.def.moves[victim.move.id].iframes, victim.move.frame)) {
    emit(world, 'evade', base); return { kind: 'evade' };
  }
  const bdef = victim.def.block, toSrc = vnorm(vsub([h.srcPos[0], 0, h.srcPos[2]], [victim.pos[0], 0, victim.pos[2]]));
  const facing = vlen(toSrc) < 1e-9 || vdot(forward(victim.yaw), toSrc) >= Math.cos(((bdef?.arc ?? 180) * Math.PI / 180) / 2) - 1e-12;
  const blocking = victim.state === 'block' && bdef && facing && !h.unblockable;
  const kb = h.knockback || [0, 0, 0];
  if (blocking) {
    if (victim.blockFrames <= (bdef.parryWindow ?? 0)) { // parry: attacker is staggered, defender takes nothing
      if (attacker && attacker.state !== 'dead') {
        attacker.move = null; attacker.state = 'stagger'; attacker.stun = bdef.parryStun ?? 45; attacker.hitstop = h.hitstop; attacker.kb = [0, 0, 0];
      }
      victim.hitstop = h.hitstop;
      emit(world, 'parry', base);
      return { kind: 'parry' };
    }
    const dmg = applyDamage(world, victim, h.damage * (bdef.chip ?? 0.1) * part.mult * (victim.def.chipMult ?? 1), h.damageType);
    victim.poise = r6(victim.poise - h.poiseDamage * (bdef.poiseMult ?? 0.5));
    victim.poiseRegen = 0;
    victim.hitstop = h.hitstop; if (attacker) attacker.hitstop = h.hitstop;
    victim.kb = vmul(kb, bdef.kbMult ?? 0.5); victim.stun = h.blockstun; // stays in the block state until the stun ends
    if (cr) cr.dealt = r6(cr.dealt + dmg);
    if (attacker && attacker.move) attacker.move.connected = 'block';
    emit(world, 'block', { ...base, damage: dmg, hp: victim.hp });
    if (victim.hp <= 0) { die(world, victim, base.who); return { kind: 'block', dead: true }; }
    if (victim.poise <= 0 || h.guardBreak) stagger(world, victim, base, true);
    return { kind: 'block' };
  }
  // clean hit
  const scale = victim.combo > 0 ? (victim.def.comboScaling?.[Math.min(victim.combo, victim.def.comboScaling.length) - 1] ?? 1) : 1;
  const dmg = applyDamage(world, victim, h.damage * part.mult * scale, h.damageType);
  if (cr) { cr.dealt = r6(cr.dealt + dmg); cr.hits++; }
  if (attacker && attacker.move) attacker.move.connected = 'hit';
  extinguish(world, victim, h.damageType);
  victim.poise = r6(victim.poise - h.poiseDamage * (part.weak ? 1.5 : 1)); victim.poiseRegen = 0;
  const am = victim.move && victim.def.moves[victim.move.id].armor, armored = !!am && inWin(am, victim.move.frame) && h.poiseDamage <= (am.threshold ?? Infinity) && !h.guardBreak;
  emit(world, 'hit', { ...base, damage: dmg, damageType: h.damageType, weak: part.weak, armored, hp: victim.hp, combo: victim.combo + 1 });
  victim.hitstop = h.hitstop; if (attacker) attacker.hitstop = h.hitstop;
  if (victim.hp <= 0) { die(world, victim, base.who); return { kind: 'hit', dead: true }; }
  for (const st of h.status || []) if ((st.chance ?? 1) >= 1 || rngNext(world) < st.chance) applyStatus(world, victim, st.id, { duration: st.duration, src: base.who });
  if (victim.hp <= 0) return { kind: 'hit' };
  if (victim.poise <= 0 && !armored) { stagger(world, victim, base, false); victim.kb = vmul(kb, 1); return { kind: 'hit', stagger: true }; }
  if (!armored) {
    victim.move = null; victim.state = 'hitstun'; victim.stun = h.hitstun; victim.kb = [...kb]; victim.combo++; victim.blockFrames = 0;
  }
  return { kind: 'hit', armored };
}
function stagger(world, v, base, guardBreak) {
  v.move = null; v.state = 'stagger'; v.stun = v.def.staggerFrames ?? 60; v.poise = v.maxPoise; v.combo++;
  emit(world, 'stagger', { ...base, guardBreak, frames: v.stun });
}

// ---------------- per-frame step ----------------
// inputs: { [fighterId]: { action?: 'light', block?: bool } }; `action` is a one-shot press (buffered). poses: optional { [fighterId]: {pos, yaw, bones:{name:{pos,quat}}} }.
// Mutates world; returns the events emitted this frame.
export function step(world, inputs = {}, poses = null) {
  world.frame++;
  const before = world.events.length + world.eventsDropped;
  // 1. inputs, buffers
  for (const f of world.fighters) {
    const inp = inputs[f.id] || {}, bf = f.def.bufferFrames ?? 6;
    if (inp.action) f.buffer.push({ action: inp.action, t: world.frame });
    f.buffer = f.buffer.filter((b) => world.frame - b.t <= bf);
    f.wantBlock = !!inp.block;
  }
  // 2. status ticks (not frozen by hit-stop)
  for (const f of world.fighters) if (f.state !== 'dead') tickStatus(world, f);
  // 3. state machine
  for (const f of world.fighters) {
    if (f.state === 'dead') continue;
    f.frozen = false;
    if (f.hitstop > 0) { f.hitstop--; f.frozen = true; continue; }
    // knockback integration
    if (vlen(f.kb) > 1e-4) { f.pos = vadd(f.pos, vmul(f.kb, DT)); f.kb = vmul(f.kb, world.kbDecay); if (world.groundY !== null) f.pos[1] = Math.max(world.groundY, f.pos[1]); } else f.kb = [0, 0, 0];
    if (f.state === 'hitstun' || f.state === 'stagger') {
      if (--f.stun <= 0) { f.state = 'idle'; f.combo = 0; }
    } else if (f.state === 'move') advanceMove(world, f);
    else if (f.state === 'block') { f.blockFrames++; if (f.stun > 0) f.stun--; }
    if ((f.state === 'idle' || f.state === 'block')) {
      if (f.state === 'idle' || f.stun === 0) {
        const act = firstStartable(f);
        if (act) { buffered(world, f, act.action); startMove(world, f, act.move, 'input'); advanceMoveFrame(world, f); }
        else if (f.wantBlock && f.def.block) { if (f.state !== 'block') { f.state = 'block'; f.blockFrames = 1; } }
        else if (f.state === 'block') { f.state = 'idle'; f.blockFrames = 0; }
      }
    }
    if (f.state !== 'hitstun' && f.state !== 'stagger') f.poiseRegen++;
    if (f.poiseRegen > (f.def.poiseRegenDelay ?? 120) && f.poise < f.maxPoise) f.poise = Math.min(f.maxPoise, f.poise + (f.def.poiseRegenRate ?? 0.25));
  }
  // 4. collect attacks (moves, then projectiles), then resolve in deterministic order
  const attacks = [];
  for (const f of world.fighters) if (f.state === 'move' && !f.frozen) collectMove(world, f, poses, attacks);
  for (const a of attacks) {
    resolveHit(world, a.attacker, a.victim, a.part, a.h);
  }
  stepProjectiles(world, poses);
  for (const f of world.fighters) f.wantBlock = false;
  const n = world.events.length + world.eventsDropped - before;
  return n > 0 ? world.events.slice(-n) : [];
}
function firstStartable(f) {
  const acts = f.def.actions || {};
  for (const b of f.buffer) if (acts[b.action] && f.def.moves[acts[b.action]]) return { action: b.action, move: acts[b.action] };
  return null;
}
function advanceMove(world, f) {
  const sm = speedMult(world, f);
  f.tempo += sm;
  if (f.tempo < 1 - 1e-9) return;
  f.tempo -= 1;
  advanceMoveFrame(world, f);
}
function advanceMoveFrame(world, f) {
  const mv = f.move, m = f.def.moves[mv.id];
  mv.frame++;
  if (mv.frame > moveTotal(m)) { emit(world, 'move-end', { who: f.id, move: mv.id }); f.move = null; f.state = 'idle'; return; }
  for (const mo of m.motion || []) if (inWin(mo, mv.frame)) f.pos = vadd(f.pos, vmul(rotYaw(mo.vel, f.yaw), DT * speedMult(world, f)));
  if (world.groundY !== null) f.pos[1] = Math.max(world.groundY, f.pos[1]);
  for (const s of m.spawns || []) if (s.frame === mv.frame) spawnProjectile(world, f, s.projectile, s.offset);
  // cancels
  for (const c of m.cancels || []) {
    if (!inWin(c, mv.frame) || !hasBuf(f, c.action)) continue;
    const ok = c.on === 'any' || (c.on ?? 'hit') === mv.connected || (c.on === 'contact' && mv.connected) || (c.on === 'whiff' && !mv.connected);
    if (!ok || !f.def.moves[c.into]) continue;
    buffered(world, f, c.action); emit(world, 'cancel', { who: f.id, from: mv.id, into: c.into });
    startMove(world, f, c.into, 'cancel'); advanceMoveFrame(world, f); return;
  }
}
function collectMove(world, f, poses, out) {
  const mv = f.move, m = f.def.moves[mv.id], fr = mv.frame, ar = activeRange(m);
  if (fr < ar.from || fr > ar.to) return;
  const T = rootT(f, poses);
  const h = {
    owner: f.id, moveId: mv.id, damage: m.damage ?? 0, damageType: m.damageType ?? 'physical', hitstun: m.hitstun ?? 0, blockstun: m.blockstun ?? 0,
    knockback: rotYaw(m.knockback || [0, 0, 0], poses?.[f.id]?.yaw ?? f.yaw), hitstop: m.hitstop ?? 0, poiseDamage: m.poiseDamage ?? 0,
    guardBreak: !!m.guardBreak, unblockable: !!m.unblockable, status: m.onHit || [], srcPos: T.pos,
  };
  for (let hi = 0; hi < (m.hitboxes || []).length; hi++) {
    const hb = m.hitboxes[hi], w = hb.from !== undefined ? { from: hb.from, to: hb.to ?? hb.from } : ar;
    if (!inWin(w, fr)) continue;
    const hs = hitboxWorld(f, hb, fr, poses), hbounds = shapeBounds(hs);
    for (const v of world.fighters) {
      if (v === f || v.state === 'dead' || !(hostile(world, f, v) || (world.friendlyFire && v.id !== f.id))) continue;
      const key = v.id;
      const last = mv.hit[key];
      if (last !== undefined && !(m.multihit && fr - last >= m.multihit.every)) continue;
      let best = null;
      for (const hu of hurtboxesWorld(v, poses)) {
        const hb2 = shapeBounds(hu.shape);
        if (hbounds.min.some((x, i) => x > hb2.max[i]) || hbounds.max.some((x, i) => x < hb2.min[i])) continue;
        const dep = shapeOverlap(hs, hu.shape);
        if (dep > 0 && (!best || dep > best.dep + 1e-12)) best = { hu, dep };
      }
      if (best) { out.push({ attacker: f, victim: v, part: best.hu, h, key, trade: true }); mv.hit[key] = fr; }
    }
  }
}

// ---------------- projectiles ----------------
// spec: {kind:'straight'|'arc'|'homing', pos | (offset local to owner), dir (local to owner yaw if from move spawn), speed, radius, life, gravity, pierce, turn, target, hit:{damage,...}}
export function spawnProjectile(world, owner, spec, offset) {
  const yaw = owner ? owner.yaw : 0;
  const dirL = vnorm(spec.dir || [0, 0, 1]), dir = owner ? rotYaw(dirL, yaw) : dirL;
  const pos = spec.pos ? [...spec.pos] : vadd(owner.pos, rotYaw(offset || spec.offset || [0, 1, 0.6], yaw));
  const h = spec.hit || {};
  const p = {
    id: world.nextProj++, kind: spec.kind || 'straight', owner: owner ? owner.id : spec.owner ?? null, team: owner ? owner.team : spec.team ?? null,
    pos, vel: vmul(dir, spec.speed ?? 10), radius: spec.radius ?? 0.2, life: spec.life ?? 120, gravity: spec.kind === 'arc' ? (spec.gravity ?? 20) : (spec.gravity ?? 0),
    pierce: spec.pierce ?? 0, turn: spec.turn ?? 0.05, target: spec.target ?? null, hitSet: [], age: 0,
    hit: { damage: h.damage ?? 0, damageType: h.damageType ?? 'physical', hitstun: h.hitstun ?? 0, blockstun: h.blockstun ?? 0, knockback: h.knockback || [0, 0, 0], hitstop: h.hitstop ?? 0, poiseDamage: h.poiseDamage ?? 0, guardBreak: !!h.guardBreak, unblockable: !!h.unblockable, status: h.status || [] },
  };
  world.projectiles.push(p);
  emit(world, 'projectile-spawn', { id: p.id, owner: p.owner, kind: p.kind });
  return p;
}
function rotateToward(cur, want, maxAng) {
  const c = clamp(vdot(cur, want), -1, 1), ang = Math.acos(c);
  if (ang <= maxAng) return want;
  let axis = vcross(cur, want); if (vlen(axis) < 1e-9) axis = [0, 1, 0]; axis = vnorm(axis);
  const co = Math.cos(maxAng), si = Math.sin(maxAng); // Rodrigues
  return vnorm(vadd(vadd(vmul(cur, co), vmul(vcross(axis, cur), si)), vmul(axis, vdot(axis, cur) * (1 - co))));
}
function stepProjectiles(world, poses) {
  const keep = [];
  for (const p of world.projectiles) {
    const owner = fighterOf(world, p.owner), me = owner || { id: p.owner, team: p.team, state: 'alive' };
    if (p.kind === 'homing') {
      let tgt = p.target ? fighterOf(world, p.target) : null;
      if (!tgt || tgt.state === 'dead') {
        tgt = null; let bd = Infinity;
        for (const f of world.fighters) if (f.state !== 'dead' && hostile(world, me, f)) { const d = vlen(vsub(f.pos, p.pos)); if (d < bd) { bd = d; tgt = f; } }
        p.target = tgt ? tgt.id : null;
      }
      if (tgt) { const sp = vlen(p.vel), want = vnorm(vsub(vadd(tgt.pos, [0, 1, 0]), p.pos)); if (sp > 0 && vlen(want) > 0) p.vel = vmul(rotateToward(vnorm(p.vel), want, p.turn), sp); }
    }
    p.vel[1] -= p.gravity * DT;
    const from = p.pos, to = vadd(from, vmul(p.vel, DT)), dist = vlen(vsub(to, from)), n = Math.max(1, Math.ceil(dist / Math.max(p.radius, 1e-3)));
    let dead = false;
    for (let s = 1; s <= n && !dead; s++) {
      const c = vadd(from, vmul(vsub(to, from), s / n)), sh = { type: 'sphere', c, r: p.radius };
      for (const v of world.fighters) {
        if (v.state === 'dead' || p.hitSet.includes(v.id) || v.id === p.owner || !hostile(world, me, v)) continue;
        let best = null;
        for (const hu of hurtboxesWorld(v, poses)) { const dep = shapeOverlap(sh, hu.shape); if (dep > 0 && (!best || dep > best.dep + 1e-12)) best = { hu, dep }; }
        if (!best) continue;
        p.hitSet.push(v.id);
        const kb = vlen(p.vel) > 0 ? rotYaw(p.hit.knockback, Math.atan2(p.vel[0], p.vel[2])) : p.hit.knockback;
        resolveHit(world, null, v, best.hu, { ...p.hit, owner: p.owner, knockback: kb, srcPos: c, moveId: 'projectile#' + p.id });
        if (p.pierce-- <= 0) { dead = true; break; }
      }
    }
    p.pos = to; p.age++; p.life--;
    if (!dead && p.life <= 0) { dead = true; emit(world, 'projectile-expire', { id: p.id, why: 'life' }); }
    else if (!dead && world.groundY !== null && p.pos[1] < world.groundY) { dead = true; emit(world, 'projectile-expire', { id: p.id, why: 'ground' }); }
    else if (dead) emit(world, 'projectile-expire', { id: p.id, why: 'hit' });
    if (!dead) keep.push(p);
  }
  world.projectiles = keep;
}

// ---------------- hashing ----------------
export function hashJSON(o) {
  const s = JSON.stringify(o); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export const hashEvents = (events) => hashJSON(events);
export const hashWorld = (world) => hashJSON({ f: world.frame, rng: world.rng, fighters: world.fighters.map((f) => ({ id: f.id, hp: f.hp, pos: f.pos.map(r6), state: f.state, move: f.move && { id: f.move.id, frame: f.move.frame }, poise: f.poise, status: f.status })), projectiles: world.projectiles, events: world.events });

// ---------------- validation (semantic; the JSON schema covers shape) ----------------
export function validateFighter(def, statusIds = Object.keys(DEFAULT_STATUSES)) {
  const errors = [], warnings = [], E = (p, m) => errors.push(`${p}: ${m}`), W = (p, m) => warnings.push(`${p}: ${m}`);
  const moves = def.moves || {}, ids = Object.keys(moves), acts = def.actions || {}, isInt = (v) => Number.isInteger(v);
  const sts = new Set([...statusIds, ...Object.keys(def.statuses || {})]);
  for (const [a, mid] of Object.entries(acts)) if (!moves[mid]) E(`actions.${a}`, `move "${mid}" does not exist`);
  const seen = new Set((def.hurtboxes || []).map((h) => h.id));
  if ((def.hurtboxes || []).length !== seen.size) E('hurtboxes', 'duplicate hurtbox ids');
  const reach = new Set(Object.values(acts));
  for (const [id, m] of Object.entries(moves)) {
    const p = `moves.${id}`;
    for (const k of ['startup', 'active', 'recovery']) if (!isInt(m[k]) || m[k] < (k === 'active' ? 1 : 0)) E(`${p}.${k}`, `must be an integer >= ${k === 'active' ? 1 : 0}`);
    if (!isInt(m.startup) || !isInt(m.active) || !isInt(m.recovery)) continue;
    const tot = moveTotal(m), ar = activeRange(m);
    if (m.damageType && !DAMAGE_TYPES.includes(m.damageType)) E(`${p}.damageType`, `unknown damage type ${m.damageType}`);
    const win = (w, name, within, lo = 1, hi = tot) => { if (!w) return; if (w.from > w.to) E(`${p}.${name}`, `from (${w.from}) after to (${w.to})`); else if (w.from < lo || w.to > hi) E(`${p}.${name}`, `window ${w.from}..${w.to} outside ${lo}..${hi}${within ? ' (' + within + ')' : ''}`); };
    win(m.iframes, 'iframes'); win(m.armor, 'armor');
    (m.motion || []).forEach((mo, i) => win(mo, `motion[${i}]`));
    (m.hitboxes || []).forEach((hb, i) => {
      if (hb.from !== undefined) win({ from: hb.from, to: hb.to ?? hb.from }, `hitboxes[${i}]`, 'active frames', ar.from, ar.to);
      let last = -Infinity; for (const k of hb.keys || []) { if (k.frame <= last) E(`${p}.hitboxes[${i}].keys`, 'frames must be strictly ascending'); last = k.frame; }
    });
    if ((m.damage ?? 0) > 0 && !(m.hitboxes || []).length && !(m.spawns || []).length) E(`${p}.hitboxes`, 'move deals damage but has no hitboxes or projectile spawns');
    if ((m.hitboxes || []).length && !(m.damage > 0) && !m.statusOnly) W(`${p}.damage`, 'has hitboxes but zero damage');
    for (const s of m.spawns || []) if (s.frame < 1 || s.frame > tot) E(`${p}.spawns`, `frame ${s.frame} outside 1..${tot}`);
    for (const [i, c] of (m.cancels || []).entries()) {
      if (!moves[c.into]) E(`${p}.cancels[${i}].into`, `move "${c.into}" does not exist`); else reach.add(c.into);
      win(c, `cancels[${i}]`);
      if (!c.action) E(`${p}.cancels[${i}].action`, 'required');
    }
    for (const s of m.onHit || []) if (!sts.has(s.id)) E(`${p}.onHit`, `unknown status "${s.id}"`);
    if (m.armor && m.armor.threshold !== undefined && m.armor.threshold < 0) E(`${p}.armor.threshold`, 'must be >= 0');
    if (m.hitstop > 10) W(`${p}.hitstop`, `hit-stop ${m.hitstop} frames is very long`);
  }
  for (const id of ids) if (!reach.has(id)) W(`moves.${id}`, 'not reachable from any action or cancel');
  if (def.block && def.block.parryWindow > 20) W('block.parryWindow', 'parry window over 20 frames is very generous');
  return { errors, warnings };
}

// ---------------- reports ----------------
export function frameDataTable(def) {
  const rows = [];
  for (const [id, m] of Object.entries(def.moves || {})) {
    const tot = moveTotal(m), tail = (m.active - 1) + m.recovery; // frames the attacker is committed after the first active frame
    rows.push({ move: id, startup: m.startup, active: m.active, recovery: m.recovery, total: tot, damage: m.damage ?? 0, damageType: m.damageType ?? 'physical', hitstun: m.hitstun ?? 0, blockstun: m.blockstun ?? 0,
      onHit: (m.hitstun ?? 0) - tail, onBlock: (m.blockstun ?? 0) - tail, hitstop: m.hitstop ?? 0, poiseDamage: m.poiseDamage ?? 0,
      armor: m.armor ? `${m.armor.from}-${m.armor.to}` : '', iframes: m.iframes ? `${m.iframes.from}-${m.iframes.to}` : '', cancels: (m.cancels || []).map((c) => `${c.action}>${c.into}@${c.from}-${c.to}${c.on ? ':' + c.on : ''}`).join(' ') });
  }
  return rows;
}
export function frameDataMarkdown(def) {
  const cols = ['move', 'startup', 'active', 'recovery', 'total', 'damage', 'damageType', 'hitstun', 'blockstun', 'onHit', 'onBlock', 'hitstop', 'poiseDamage', 'armor', 'iframes', 'cancels'];
  const rows = frameDataTable(def);
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((c) => r[c]).join(' | ')} |`)].join('\n');
}

// ---------------- scripted duel ----------------
// script: { A:[{at, action}|{from,to,block:true}], B:[...] }; keys are fighter ids. `at` is the 1-based world frame.
// Optional world settings: friendlyFire, hostility ({team:[teams]}), kbDecay; poses: static { A|B|id: {pos?, yaw?, bones?} } passed to every step; poseFrames: array of such maps, entry i-1 used on world frame i (last entry repeats, null = no poses; overrides poses).
export function simulateDuel(defA, defB, { script = {}, frames = 600, distance = 1.6, seed = 1, statuses = {}, friendlyFire = false, hostility = null, kbDecay, poses = null, poseFrames = null } = {}) {
  const a = createFighter(defA, { pos: [0, 0, -distance / 2], yaw: 0, team: defA.team ?? 'a' }), b = createFighter(defB, { pos: [0, 0, distance / 2], yaw: Math.PI, team: defB.team ?? 'b' });
  if (a.team === b.team) b.team += '-2';
  if (a.id === b.id) b.id += '-2';
  const world = createWorld({ fighters: [a, b], seed, statuses, groundY: 0, friendlyFire, hostility, ...(kbDecay !== undefined ? { kbDecay } : {}) });
  const idOf = { A: a.id, B: b.id, [a.id]: a.id, [b.id]: b.id };
  const byId = (m) => (m ? Object.fromEntries(Object.entries(m).filter(([k]) => idOf[k]).map(([k, v]) => [idOf[k], v])) : null);
  const posesById = byId(poses), frameById = poseFrames ? poseFrames.map(byId) : null;
  for (let i = 0; i < frames; i++) {
    const fr = world.frame + 1, inputs = {};
    for (const [who, list] of Object.entries(script)) {
      const id = idOf[who]; if (!id) continue;
      for (const s of list) {
        if (s.at === fr) (inputs[id] ||= {}).action = s.action;
        if (s.block && fr >= s.from && fr <= s.to) (inputs[id] ||= {}).block = true;
      }
    }
    step(world, inputs, frameById ? (frameById.length ? frameById[Math.min(fr - 1, frameById.length - 1)] : null) : posesById);
    if (world.fighters.some((f) => f.state === 'dead')) break;
  }
  const cnt = (t) => world.events.filter((e) => e.type === t).length;
  const totals = Object.fromEntries(world.fighters.map((f) => [f.id, { dealt: f.dealt, taken: f.taken, hp: f.hp, state: f.state, hits: f.hits }]));
  const alive = world.fighters.filter((f) => f.state !== 'dead');
  return { world, frames: world.frame, totals, winner: alive.length === 1 ? alive[0].id : null, counts: { hit: cnt('hit'), block: cnt('block'), parry: cnt('parry'), stagger: cnt('stagger'), death: cnt('death'), evade: cnt('evade') }, hash: hashEvents(world.events) };
}
