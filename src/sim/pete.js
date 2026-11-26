import { TUNING } from '../core/defs.js';
import { resolveCircle } from './player.js';

export function updatePete(g, dt) {
  const e = g.pete;
  if (!e || e.dead) return;
  const hpFrac = e.hp / e.maxHp;
  const phase = hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;
  if (phase !== e.st.phase) {
    e.st.phase = phase;
    g.emit('pete_phase', { phase });
  }

  e.st.spawnT = (e.st.spawnT ?? 0) - dt;
  e.st.dashT = (e.st.dashT ?? 0) - dt;
  e.st.dashCd = (e.st.dashCd ?? 0) - dt;

  const p = g.player;
  // Steer with shared flow field (avoids getting stuck on aisle shelves)
  let dir = g._flow ? g._flow.step(e.x, e.y) : { x: 0, y: 0 };
  if (phase >= 2 && p && p.st.downT <= 0) {
    const dx = p.x - e.x, dy = p.y - e.y;
    const L = Math.hypot(dx, dy) || 1;
    dir = { x: dir.x * 0.35 + (dx / L) * 0.65, y: dir.y * 0.35 + (dy / L) * 0.65 };
  }
  const dl = Math.hypot(dir.x, dir.y) || 1;
  dir = { x: dir.x / dl, y: dir.y / dl };

  if (e.st.dashT > 0) {
    const pos = resolveCircle(g.level, e, e.x + e.vx * dt, e.y + e.vy * dt);
    e.x = pos.x; e.y = pos.y;
  } else {
    const sp = (e.st.speed ?? TUNING.peteSpeed) * (0.85 + phase * 0.15);
    const pos = resolveCircle(g.level, e, e.x + dir.x * sp * dt, e.y + dir.y * sp * dt);
    e.x = pos.x; e.y = pos.y;
    e.face = Math.atan2(dir.y, dir.x);
    if (e.st.dashCd <= 0 && p) {
      const L = Math.hypot(p.x - e.x, p.y - e.y);
      if (L < 120) {
        e.st.dashCd = TUNING.peteDashCd / phase;
        e.st.dashT = TUNING.peteDashDur;
        e.vx = dir.x * TUNING.peteDashSpeed;
        e.vy = dir.y * TUNING.peteDashSpeed;
      }
    }
  }

  // spawn micro-mice
  const every = TUNING.peteSpawnMiceEvery / phase;
  if (e.st.spawnT <= 0) {
    e.st.spawnT = every;
    if (g.ents.filter((x) => !x.dead).length < TUNING.entityCap) {
      g.spawn('mouse', {
        x: e.x, y: e.y,
        r: TUNING.mouseR,
        hp: TUNING.mouseHp, maxHp: TUNING.mouseHp,
        team: 'vermin',
        st: { target: null, bite: 0, speed: TUNING.mouseSpeed + 8, biteDmg: TUNING.mouseBite },
      });
    }
  }

  // contact damage
  if (p && p.st.downT <= 0 && p.st.inv <= 0) {
    const dx = p.x - e.x, dy = p.y - e.y;
    if (dx * dx + dy * dy <= (p.r + e.r) ** 2) g.damage(p, 1 + phase * 0.5, e);
  }
  for (const r of g.registers) {
    if (r.dead) continue;
    const dx = r.x - e.x, dy = r.y - e.y;
    if (dx * dx + dy * dy <= (r.r + e.r) ** 2) {
      e.st._regBite = (e.st._regBite ?? 0) - dt;
      if ((e.st._regBite ?? 0) <= 0) {
        e.st._regBite = 0.4;
        g.damage(r, 3, e);
      }
    }
  }
  e.frame = (e.frame + dt * 4) % 2;
}
