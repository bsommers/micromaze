import { WEAPONS, TUNING } from '../core/defs.js';
import { isSolidAt } from '../levels/level.js';
import { resolveCircle } from './player.js';

export function tryFireScanner(g, input) {
  const p = g.player;
  const w = g.weapons.scanner ?? WEAPONS.scanner;
  if (!p || p.st.downT > 0) return;
  if (!input.fire) return;
  if (p.st.cd > 0) return;
  p.st.cd = w.cooldown;
  const ax = p.st.aimX, ay = p.st.aimY;
  const a = Math.atan2(ay, ax);
  const e = g.spawn('projectile', {
    x: p.x + Math.cos(a) * 8,
    y: p.y + Math.sin(a) * 8,
    vx: Math.cos(a) * w.speed,
    vy: Math.sin(a) * w.speed,
    r: 3,
    hp: 1, maxHp: 1,
    team: 'store',
    face: a, pose: 'fly', frame: 0,
    ttl: w.range / w.speed,
    st: { weapon: 'scanner', owner: p.id, dmg: w.damage, pierce: w.pierce, traveled: 0 },
  });
  g.stats.shots++;
  g.emit('shot', { weapon: 'scanner', x: e.x, y: e.y, a });
  g.emit('sfx', { name: w.sfx, x: e.x, y: e.y });
}

export function tryThrowBawlz(g, input) {
  const p = g.player;
  const w = g.weapons.bawlz ?? WEAPONS.bawlz;
  if (!p || p.st.downT > 0) return;
  if (!input.throwPressed) return;
  if (p.st.throwCd > 0) return;
  if ((g.ammo.bawlz ?? 0) <= 0) return;
  p.st.throwCd = w.cooldown;
  g.ammo.bawlz--;
  const ax = p.st.aimX, ay = p.st.aimY;
  const a = Math.atan2(ay, ax);
  g.spawn('grenade', {
    x: p.x, y: p.y,
    vx: Math.cos(a) * w.speed,
    vy: Math.sin(a) * w.speed,
    r: 4,
    hp: 1, maxHp: 1,
    team: 'store',
    face: a, pose: 'lob', frame: 0,
    ttl: null,
    st: { fuse: w.fuse, z: 0, vz: 90, bounced: 0, dmg: w.damage, splashR: w.splashR },
  });
  g.stats.thrown++;
  g.emit('throw', { x: p.x, y: p.y });
  g.emit('sfx', { name: w.sfx, x: p.x, y: p.y });
}

export function updateProjectiles(g, dt) {
  const w = g.weapons.scanner ?? WEAPONS.scanner;
  for (const e of g.ents) {
    if (e.dead || e.kind !== 'projectile') continue;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.st.traveled = (e.st.traveled ?? 0) + Math.hypot(e.vx, e.vy) * dt;
    if (e.ttl != null) { e.ttl -= dt; if (e.ttl <= 0) { e.dead = true; continue; } }
    if (e.st.traveled > w.range) { e.dead = true; continue; }
    if (isSolidAt(g.level, e.x, e.y)) { e.dead = true; continue; }
    for (const t of g.ents) {
      if (t.dead || t.team !== 'vermin') continue;
      const dx = t.x - e.x, dy = t.y - e.y;
      if (dx * dx + dy * dy <= (t.r + e.r) ** 2) {
        g.damage(t, e.st.dmg, e);
        g.stats.hits++;
        e.st.pierce = (e.st.pierce ?? 0) - 1;
        if (e.st.pierce < 0) { e.dead = true; break; }
      }
    }
  }
}

export function explodeGrenade(g, e) {
  const R = e.st.splashR ?? WEAPONS.bawlz.splashR;
  const dmg = e.st.dmg ?? WEAPONS.bawlz.damage;
  e.dead = true;
  g.emit('explode', { x: e.x, y: e.y, r: R });
  g.emit('sfx', { name: 'explode', x: e.x, y: e.y });
  g.fx('explode', e.x, e.y, { r: R });
  for (const t of g.ents) {
    if (t.dead || t.team !== 'vermin') continue; // never registers/player
    const dx = t.x - e.x, dy = t.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > R) continue; // inclusive edge: d <= R hits; d > R misses
    const falloff = 1 - d / R;
    const amt = Math.max(0.25, falloff) * dmg;
    g.damage(t, amt, e);
    const L = d || 1;
    t.vx += (dx / L) * WEAPONS.bawlz.knockback;
    t.vy += (dy / L) * WEAPONS.bawlz.knockback;
  }
}

export function updateGrenades(g, dt) {
  for (const e of g.ents) {
    if (e.dead || e.kind !== 'grenade') continue;
    e.st.fuse -= dt;
    e.st.vz -= 220 * dt;
    e.st.z += e.st.vz * dt;
    if (e.st.z < 0) {
      e.st.z = 0;
      if ((e.st.bounced ?? 0) < TUNING.grenadeBounce) {
        e.st.bounced = (e.st.bounced ?? 0) + 1;
        e.st.vz *= -0.4;
        e.vx *= 0.6; e.vy *= 0.6;
      } else {
        e.vx *= 0.85; e.vy *= 0.85;
      }
    }
    const nx = e.x + e.vx * dt;
    const ny = e.y + e.vy * dt;
    const pos = resolveCircle(g.level, e, nx, ny);
    if (pos.x === e.x && pos.y === e.y) {
      // bounce off wall
      if (isSolidAt(g.level, nx, e.y)) e.vx *= -0.5;
      if (isSolidAt(g.level, e.x, ny)) e.vy *= -0.5;
    } else { e.x = pos.x; e.y = pos.y; }
    e.frame = (e.frame + dt * 10) % 2;
    if (e.st.fuse <= 0) explodeGrenade(g, e);
  }
}

export function updatePickups(g, dt) {
  const p = g.player;
  if (!p || p.st.downT > 0) return;
  for (const e of g.ents) {
    if (e.dead || e.kind !== 'pickup') continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    if (dx * dx + dy * dy > (e.r + p.r) ** 2) continue;
    e.dead = true;
    if (e.st.give === 'bawlz') g.ammo.bawlz = Math.min(99, (g.ammo.bawlz ?? 0) + (e.st.n ?? 1));
    if (e.st.give === 'hp') p.hp = Math.min(p.maxHp, p.hp + (e.st.n ?? 1));
    g.emit('pickup', { give: e.st.give, n: e.st.n });
    g.emit('sfx', { name: 'pickup', x: e.x, y: e.y });
  }
}
