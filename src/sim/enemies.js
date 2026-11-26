import { TUNING } from '../core/defs.js';
import { resolveCircle } from './player.js';

export function updateMice(g, dt) {
  const field = g._flow;
  for (const e of g.ents) {
    if (e.dead || e.kind !== 'mouse') continue;
    // friction knockback
    e.vx *= 0.9; e.vy *= 0.9;
    let dir = { x: 0, y: 0 };
    if (field) dir = field.step(e.x, e.y);
    // also mildly chase player if close
    const p = g.player;
    if (p && p.st.downT <= 0) {
      const dx = p.x - e.x, dy = p.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 48 * 48) {
        const L = Math.sqrt(d2) || 1;
        dir = { x: dir.x * 0.4 + (dx / L) * 0.6, y: dir.y * 0.4 + (dy / L) * 0.6 };
      }
    }
    const L = Math.hypot(dir.x, dir.y) || 1;
    const sp = e.st.speed ?? TUNING.mouseSpeed;
    const mx = (dir.x / L) * sp + e.vx;
    const my = (dir.y / L) * sp + e.vy;
    const pos = resolveCircle(g.level, e, e.x + mx * dt, e.y + my * dt);
    e.x = pos.x; e.y = pos.y;
    e.face = Math.atan2(my, mx);
    e.frame = (e.frame + dt * 6) % 2;
    e.st.bite = (e.st.bite ?? 0) - dt;

    // bite registers
    for (const r of g.registers) {
      if (r.dead) continue;
      const dx = r.x - e.x, dy = r.y - e.y;
      if (dx * dx + dy * dy <= (r.r + e.r) ** 2) {
        if (e.st.bite <= 0) {
          e.st.bite = TUNING.mouseBiteCd;
          g.damage(r, e.st.biteDmg ?? TUNING.mouseBite, e);
        }
      }
    }
    // bite player
    if (p && p.st.downT <= 0 && p.st.inv <= 0) {
      const dx = p.x - e.x, dy = p.y - e.y;
      if (dx * dx + dy * dy <= (p.r + e.r) ** 2) {
        if (e.st.bite <= 0) {
          e.st.bite = TUNING.mouseBiteCd;
          g.damage(p, 1, e);
        }
      }
    }
  }
}
