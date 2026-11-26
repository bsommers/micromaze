import { SOLID, TILE } from '../core/defs.js';

export const LEVELS = Object.freeze(['store01', 'blackfriday', 'gtadrop', 'backtoschool', 'gpuscalper']);

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function assertPlain(o, path = 'root') {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return;
  for (const k of Reflect.ownKeys(o)) {
    const key = typeof k === 'string' ? k : String(k);
    if (FORBIDDEN.has(key)) throw new Error(`forbidden key ${key} at ${path}`);
    if (typeof k === 'string') assertPlain(o[k], `${path}.${k}`);
  }
}

/** Parse + validate an already-loaded LevelDef object (browser-safe). */
export function parseLevel(def) {
  assertPlain(def);
  const v = validateLevel(def);
  if (!v.ok) throw new Error(`invalid level: ${v.errors.join('; ')}`);
  return def;
}

function tileAt(def, tx, ty) {
  const row = def.tiles[ty];
  if (!row || tx < 0 || tx >= row.length) return 'wall';
  const ch = row[tx];
  return def.legend[ch] ?? 'wall';
}

function walkable(kind) {
  return kind === 'floor' || kind === 'door' || kind === 'counter';
}

function neighbors(tx, ty, cols, rows) {
  const out = [];
  if (tx > 0) out.push([tx - 1, ty]);
  if (tx + 1 < cols) out.push([tx + 1, ty]);
  if (ty > 0) out.push([tx, ty - 1]);
  if (ty + 1 < rows) out.push([tx, ty + 1]);
  return out;
}

function bfsReach(def, sx, sy) {
  const rows = def.tiles.length;
  const cols = def.tiles[0]?.length ?? 0;
  const key = (x, y) => y * cols + x;
  const seen = new Set();
  const q = [[sx, sy]];
  seen.add(key(sx, sy));
  while (q.length) {
    const [x, y] = q.shift();
    for (const [nx, ny] of neighbors(x, y, cols, rows)) {
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      if (!walkable(tileAt(def, nx, ny))) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}

function cellOf(x, y) {
  return [Math.floor(x / TILE), Math.floor(y / TILE)];
}

export function validateLevel(def) {
  const errors = [];
  try {
    assertPlain(def);
  } catch (e) {
    return { ok: false, errors: [String(e.message || e)] };
  }
  if (!def || typeof def !== 'object') return { ok: false, errors: ['def must be object'] };
  if (def.version !== 1) errors.push('version must be 1');
  if (!def.id || typeof def.id !== 'string') errors.push('id required');
  if (!Array.isArray(def.tiles) || !def.tiles.length) errors.push('tiles required');
  const rows = def.tiles?.length ?? 0;
  const cols = def.tiles?.[0]?.length ?? 0;
  if (cols > 256 || rows > 256) errors.push('tiles too large');
  if (def.tiles?.some((r) => r.length !== cols)) errors.push('ragged tiles');
  if (!def.legend || typeof def.legend !== 'object') errors.push('legend required');
  if (def.loseWhen !== 'all' && def.loseWhen !== 'any') errors.push('loseWhen must be all|any');
  if (!Array.isArray(def.registers) || !def.registers.length) errors.push('registers required');
  if (!Array.isArray(def.spawns) || !def.spawns.length) errors.push('spawns required');
  if (!Array.isArray(def.waves) || !def.waves.length) errors.push('waves required');

  const ids = new Set();
  for (const r of def.registers ?? []) {
    if (!r?.id || ids.has(r.id)) errors.push(`bad/duplicate register id ${r?.id}`);
    ids.add(r.id);
    if (!(r.hp > 0) || r.hp > 1e6) errors.push(`register ${r.id} bad hp`);
  }
  for (const s of def.spawns ?? []) {
    if (!s?.id || ids.has('spawn:' + s.id)) errors.push(`bad/duplicate spawn id ${s?.id}`);
    ids.add('spawn:' + s.id);
  }

  let peteGroups = 0;
  def.waves?.forEach((w, wi) => {
    if (!w?.id) errors.push(`wave[${wi}] missing id`);
    if (!Array.isArray(w.groups) || !w.groups.length) errors.push(`wave ${w?.id} empty groups`);
    for (const g of w.groups ?? []) {
      if (g.kind !== 'mouse' && g.kind !== 'pete') errors.push(`wave ${w?.id} bad kind ${g.kind}`);
      if (g.kind === 'pete') peteGroups++;
      if (!(g.count >= 1) || g.count > 500) errors.push(`wave ${w?.id} bad count`);
      if (typeof g.every !== 'number' || g.every < 0) errors.push(`wave ${w?.id} bad every`);
      if (g.spawn !== 'any' && !(def.spawns ?? []).some((s) => s.id === g.spawn)) {
        errors.push(`wave ${w?.id} unknown spawn ${g.spawn}`);
      }
    }
  });
  if (peteGroups !== 1) errors.push(`exactly one pete group required (got ${peteGroups})`);
  const last = def.waves?.[def.waves.length - 1];
  if (last && !(last.groups ?? []).some((g) => g.kind === 'pete')) {
    errors.push('pete must be on final wave');
  }

  if (!errors.length && cols && rows) {
    const [px, py] = cellOf(def.playerSpawn.x, def.playerSpawn.y);
    if (!walkable(tileAt(def, px, py))) errors.push('playerSpawn not walkable');
    const reach = bfsReach(def, px, py);
    for (const r of def.registers) {
      const [rx, ry] = cellOf(r.x, r.y);
      if (!reach.has(ry * cols + rx) && !walkable(tileAt(def, rx, ry))) {
        errors.push(`no path player→register ${r.id}`);
      } else if (!reach.has(ry * cols + rx)) {
        // register on counter: check adjacent floor reachable
        const adj = neighbors(rx, ry, cols, rows).some(([ax, ay]) => reach.has(ay * cols + ax));
        if (!adj) errors.push(`no path player→register ${r.id}`);
      }
    }
    for (const s of def.spawns) {
      const [sx, sy] = cellOf(s.x, s.y);
      const sk = sy * cols + sx;
      let ok = reach.has(sk);
      if (!ok) {
        ok = neighbors(sx, sy, cols, rows).some(([ax, ay]) => reach.has(ay * cols + ax));
      }
      // spawn may be on door edge — require path to some register adjacency
      if (!ok) errors.push(`no path spawn ${s.id}→registers`);
      else {
        const toReg = def.registers.some((r) => {
          const [rx, ry] = cellOf(r.x, r.y);
          const fromSpawn = bfsReach(def, walkable(tileAt(def, sx, sy)) ? sx : neighbors(sx, sy, cols, rows).find(([ax, ay]) => walkable(tileAt(def, ax, ay)))?.[0] ?? sx,
            walkable(tileAt(def, sx, sy)) ? sy : neighbors(sx, sy, cols, rows).find(([ax, ay]) => walkable(tileAt(def, ax, ay)))?.[1] ?? sy);
          return neighbors(rx, ry, cols, rows).some(([ax, ay]) => fromSpawn.has(ay * cols + ax)) || fromSpawn.has(ry * cols + rx);
        });
        if (!toReg) errors.push(`spawn ${s.id} cannot reach any register`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function levelSize(def) {
  const cols = def.tiles[0].length;
  const rows = def.tiles.length;
  return { cols, rows, worldW: cols * TILE, worldH: rows * TILE };
}

export function isSolidAt(def, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const row = def.tiles[ty];
  if (!row || tx < 0 || tx >= row.length) return true;
  const kind = def.legend[row[tx]] ?? 'wall';
  return SOLID.has(kind);
}

export function buildSolidAabbs(def) {
  const out = [];
  const rows = def.tiles.length;
  const cols = def.tiles[0].length;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const kind = def.legend[def.tiles[ty][tx]] ?? 'wall';
      if (!SOLID.has(kind)) continue;
      out.push({
        minX: tx * TILE, minY: ty * TILE,
        maxX: (tx + 1) * TILE, maxY: (ty + 1) * TILE,
        kind,
      });
    }
  }
  return out;
}

/** Shared flow field: for each walkable cell, step toward nearest live register adjacency. */
export function buildFlowField(def, liveRegisters) {
  const rows = def.tiles.length;
  const cols = def.tiles[0].length;
  const key = (x, y) => y * cols + x;
  const dist = new Int32Array(cols * rows).fill(-1);
  const next = new Int16Array(cols * rows * 2).fill(-1);
  const q = [];
  for (const r of liveRegisters) {
    const [rx, ry] = cellOf(r.x, r.y);
    for (const [ax, ay] of [[rx, ry], ...neighbors(rx, ry, cols, rows)]) {
      if (!walkable(tileAt(def, ax, ay)) && !(ax === rx && ay === ry)) continue;
      if (!walkable(tileAt(def, ax, ay))) continue;
      const k = key(ax, ay);
      if (dist[k] === 0) continue;
      dist[k] = 0;
      q.push([ax, ay]);
    }
  }
  let qi = 0;
  while (qi < q.length) {
    const [x, y] = q[qi++];
    const d = dist[key(x, y)];
    for (const [nx, ny] of neighbors(x, y, cols, rows)) {
      if (!walkable(tileAt(def, nx, ny))) continue;
      const k = key(nx, ny);
      if (dist[k] !== -1) continue;
      dist[k] = d + 1;
      next[k * 2] = x;
      next[k * 2 + 1] = y;
      q.push([nx, ny]);
    }
  }
  return {
    cols, rows,
    step(wx, wy) {
      const tx = Math.floor(wx / TILE);
      const ty = Math.floor(wy / TILE);
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return { x: 0, y: 0 };
      const k = key(tx, ty);
      const nx = next[k * 2];
      const ny = next[k * 2 + 1];
      if (nx < 0) {
        // already at goal cell — nudge toward nearest register
        let best = null, bd = Infinity;
        for (const r of liveRegisters) {
          const dx = r.x - wx, dy = r.y - wy, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = { x: dx, y: dy }; }
        }
        if (!best || bd < 1) return { x: 0, y: 0 };
        const L = Math.hypot(best.x, best.y) || 1;
        return { x: best.x / L, y: best.y / L };
      }
      const cx = (nx + 0.5) * TILE - wx;
      const cy = (ny + 0.5) * TILE - wy;
      const L = Math.hypot(cx, cy) || 1;
      return { x: cx / L, y: cy / L };
    },
  };
}
