// Difficulty = pure transform of a validated LevelDef. Medium is the identity.
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'insane']);

const MODS = Object.freeze({
  easy:   { hp: 0.7, speed: 0.85, count: 0.75, every: 1.2, regHp: 1.5, ammo: 1.5, drop: 0.15 },
  medium: { hp: 1, speed: 1, count: 1, every: 1, regHp: 1, ammo: 1, drop: 0 },
  hard:   { hp: 1.3, speed: 1.15, count: 1.3, every: 0.85, regHp: 0.85, ammo: 0.8, drop: -0.05 },
  insane: { hp: 1.7, speed: 1.35, count: 1.8, every: 0.7, regHp: 0.7, ammo: 0.6, drop: -0.1 },
});

export const SCORE_MULT = Object.freeze({ easy: 0.5, medium: 1, hard: 1.5, insane: 2 });

export function normalizeDifficulty(d) {
  return DIFFICULTIES.includes(d) ? d : 'medium';
}

export function applyDifficulty(level, difficulty) {
  const d = normalizeDifficulty(difficulty);
  const m = MODS[d];
  const out = structuredClone(level);
  if (d === 'medium') return out;
  const r = (n) => Math.max(1, Math.round(n));
  for (const reg of out.registers) reg.hp = r(reg.hp * m.regHp);
  for (const k of Object.keys(out.startAmmo ?? {})) out.startAmmo[k] = r(out.startAmmo[k] * m.ammo);
  if (typeof out.dropChance === 'number') out.dropChance = Math.min(1, Math.max(0, out.dropChance + m.drop));
  for (const w of out.waves) {
    for (const g of w.groups) {
      if (g.kind === 'mouse') g.count = r(g.count * m.count); // exactly one Pete group: never scaled
      if (typeof g.hp === 'number') g.hp = r(g.hp * m.hp);
      if (typeof g.speed === 'number') g.speed = Math.round(g.speed * m.speed * 10) / 10;
      if (g.every > 0) g.every = Math.round(g.every * m.every * 1000) / 1000;
    }
  }
  out.difficulty = d;
  return out;
}
