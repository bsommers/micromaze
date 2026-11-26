import { TUNING } from '../core/defs.js';
import { isSolidAt } from '../levels/level.js';

function resolveCircle(level, e, nx, ny) {
  let x = nx, y = ny;
  const r = e.r;
  // axis slide vs solid tiles (sample 4 corners + midpoints)
  const samples = [
    [x - r, y], [x + r, y], [x, y - r], [x, y + r],
    [x - r * 0.7, y - r * 0.7], [x + r * 0.7, y - r * 0.7],
    [x - r * 0.7, y + r * 0.7], [x + r * 0.7, y + r * 0.7],
  ];
  let hit = false;
  for (const [sx, sy] of samples) {
    if (isSolidAt(level, sx, sy)) { hit = true; break; }
  }
  if (!hit) return { x, y };
  // try x-only then y-only
  let ox = e.x, oy = e.y;
  x = nx; y = oy;
  hit = false;
  for (const [sx, sy] of [[x - r, y], [x + r, y], [x, y - r], [x, y + r]]) {
    if (isSolidAt(level, sx, sy)) { hit = true; break; }
  }
  if (!hit) return { x, y };
  x = ox; y = ny;
  hit = false;
  for (const [sx, sy] of [[x - r, y], [x + r, y], [x, y - r], [x, y + r]]) {
    if (isSolidAt(level, sx, sy)) { hit = true; break; }
  }
  if (!hit) return { x, y };
  return { x: ox, y: oy };
}

export function makePlayer(spawn) {
  return {
    id: 1,
    kind: 'player',
    x: spawn.x, y: spawn.y, vx: 0, vy: 0,
    r: TUNING.playerR,
    hp: TUNING.playerHp, maxHp: TUNING.playerHp,
    team: 'store', face: 0, pose: 'idle', frame: 0,
    dead: false, ttl: null,
    st: { cd: 0, throwCd: 0, inv: 0, downT: 0, aimX: 1, aimY: 0 },
  };
}

export function updatePlayer(g, dt, input) {
  const p = g.player;
  if (!p || p.dead) return;
  if (p.st.downT > 0) {
    p.st.downT -= dt;
    p.pose = 'down';
    p.vx = 0; p.vy = 0;
    if (p.st.downT <= 0) {
      p.hp = p.maxHp;
      p.x = g.level.playerSpawn.x;
      p.y = g.level.playerSpawn.y;
      p.st.inv = TUNING.respawnInv;
      p.pose = 'idle';
    }
    return;
  }
  if (p.st.inv > 0) p.st.inv -= dt;
  if (p.st.cd > 0) p.st.cd -= dt;
  if (p.st.throwCd > 0) p.st.throwCd -= dt;

  let mx = input.mx ?? 0, my = input.my ?? 0;
  if (!Number.isFinite(mx)) mx = 0;
  if (!Number.isFinite(my)) my = 0;
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  const sp = TUNING.playerSpeed;
  p.vx = mx * sp;
  p.vy = my * sp;
  const nx = p.x + p.vx * dt;
  const ny = p.y + p.vy * dt;
  const pos = resolveCircle(g.level, p, nx, ny);
  p.x = pos.x; p.y = pos.y;

  const ax = input.ax ?? 0, ay = input.ay ?? 0;
  if (ax !== 0 || ay !== 0) {
    const al = Math.hypot(ax, ay) || 1;
    p.st.aimX = ax / al;
    p.st.aimY = ay / al;
    p.face = Math.atan2(p.st.aimY, p.st.aimX);
  } else if (ml > 0.01) {
    p.face = Math.atan2(my, mx);
    p.st.aimX = Math.cos(p.face);
    p.st.aimY = Math.sin(p.face);
  }

  p.pose = ml > 0.05 ? 'run' : 'idle';
  if (p.pose === 'run') p.frame = (p.frame + dt * 8) % 4;
  else p.frame = (p.frame + dt * 2) % 2;
}

export { resolveCircle };
