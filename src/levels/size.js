// Level size = pure transform of a validated LevelDef: every tile becomes a k x k block
// (real extra cells / floor area, not image scaling). 1x is the identity.
export const SIZES = Object.freeze([1, 2, 3]);
export const SIZE_SCORE = Object.freeze({ 1: 1, 2: 1.5, 3: 2 });

export function normalizeSize(s) {
  const n = Number(s);
  return SIZES.includes(n) ? n : 1;
}

export function applySize(level, size) {
  const k = normalizeSize(size);
  const out = structuredClone(level);
  if (k === 1) return out;
  out.tiles = level.tiles.flatMap((row) => {
    const wide = [...row].map((c) => c.repeat(k)).join('');
    return Array.from({ length: k }, () => wide);
  });
  const pt = (o) => { o.x *= k; o.y *= k; };
  pt(out.playerSpawn);
  out.registers.forEach(pt);
  out.spawns.forEach(pt);
  // more floor => more vermin and more supplies; Pete is never duplicated
  for (const key of Object.keys(out.startAmmo ?? {})) out.startAmmo[key] *= k;
  for (const w of out.waves) {
    for (const g of w.groups) if (g.kind === 'mouse') g.count *= k;
  }
  out.size = k;
  return out;
}
