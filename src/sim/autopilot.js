// Deterministic bot: guard registers, focus nearest threat, scanner + bawlz.
export function createBot({ skill = 1 } = {}) {
  let throwCd = 0;
  let strafeSign = 1;
  return {
    reset() { throwCd = 0; strafeSign = 1; },
    decide(g) {
      const p = g.player;
      if (!p || g.state === 'intro' || g.state === 'intermission') {
        return { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false, startPressed: true };
      }
      if (p.st.downT > 0) {
        return { mx: 0, my: 0, ax: p.st.aimX, ay: p.st.aimY, fire: false, throwPressed: false };
      }

      const vermin = g.ents.filter((e) => !e.dead && (e.kind === 'mouse' || e.kind === 'pete'));
      let target = null, best = Infinity;
      for (const e of vermin) {
        let w = Math.hypot(e.x - p.x, e.y - p.y);
        if (e.kind === 'pete') w *= 0.25;
        let nearReg = false;
        for (const r of g.registers) {
          if (r.dead) continue;
          if (Math.hypot(e.x - r.x, e.y - r.y) < 70) { nearReg = true; break; }
        }
        if (nearReg) w *= 0.35;
        if (w < best) { best = w; target = e; }
      }

      let ax = p.st.aimX, ay = p.st.aimY;
      let mx = 0, my = 0;

      // Guard point: midpoint of live registers, slightly above
      let gx = 0, gy = 0, gn = 0;
      for (const r of g.registers) {
        if (r.dead) continue;
        gx += r.x; gy += r.y - 28; gn++;
      }
      if (gn) { gx /= gn; gy /= gn; } else { gx = 160; gy = 100; }

      // Stay near registers unless chasing Pete
      const toGuardX = gx - p.x, toGuardY = gy - p.y;
      const guardDist = Math.hypot(toGuardX, toGuardY);

      if (target) {
        ax = target.x - p.x;
        ay = target.y - p.y;
        const L = Math.hypot(ax, ay) || 1;
        ax /= L; ay /= L;
        const d = Math.hypot(target.x - p.x, target.y - p.y);
        const prefer = target.kind === 'pete' ? 60 : 40;
        if (target.kind !== 'pete' && guardDist > 55) {
          mx = toGuardX / (guardDist || 1); my = toGuardY / (guardDist || 1);
        } else if (d > prefer + 10) { mx = ax; my = ay; }
        else if (d < prefer - 8) { mx = -ax; my = -ay; }
        else {
          if ((g.tick | 0) % 90 === 0) strafeSign *= -1;
          mx = -ay * strafeSign; my = ax * strafeSign;
        }
      } else {
        if (guardDist > 12) {
          mx = toGuardX / guardDist; my = toGuardY / guardDist;
        }
        ax = 0; ay = 1;
      }

      throwCd = Math.max(0, throwCd - 1 / 60);
      let throwPressed = false;
      if (skill >= 1 && target && (g.ammo.bawlz ?? 0) > 0 && throwCd <= 0) {
        const d = Math.hypot(target.x - p.x, target.y - p.y);
        const cluster = vermin.filter((e) => Math.hypot(e.x - target.x, e.y - target.y) < 36).length;
        if (d < 100 && (cluster >= 2 || target.kind === 'pete' || d < 55)) {
          throwPressed = true;
          throwCd = 0.55;
        }
      }

      return { mx, my, ax, ay, fire: !!target || skill >= 1, throwPressed, startPressed: false };
    },
  };
}
