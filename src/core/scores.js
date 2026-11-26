// Local top-scores store. Node-safe: storage injectable, never throws.
export const SCORES_KEY = 'micromaze.scores';
export const MAX_PER_LEVEL = 10;

function store(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function sanitizeScores(o) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const id of Object.keys(o)) {
    if (id === '__proto__' || id === 'constructor' || id === 'prototype' || !Array.isArray(o[id])) continue;
    out[id] = o[id]
      .filter((e) => e && Number.isFinite(e.score) && e.score >= 0)
      .map((e) => ({
        score: Math.floor(e.score),
        win: !!e.win,
        t: Number.isFinite(e.t) ? Math.round(e.t * 10) / 10 : 0,
        date: typeof e.date === 'string' ? e.date.slice(0, 10) : '',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PER_LEVEL);
  }
  return out;
}

export function loadScores(storage) {
  try {
    const s = store(storage);
    return sanitizeScores(s ? JSON.parse(s.getItem(SCORES_KEY)) : null);
  } catch { return {}; }
}

/** Record a finished run; returns { rank (1-based or 0 if not on board), scores }. */
export function recordScore(levelId, entry, storage, now = new Date()) {
  const all = loadScores(storage);
  const list = all[levelId] ?? [];
  const e = { score: entry.score, win: !!entry.win, t: entry.t, date: now.toISOString() };
  list.push(e);
  all[levelId] = list;
  const clean = sanitizeScores(all);
  const rank = (clean[levelId] ?? []).findIndex((x) => x.score === Math.floor(e.score) && x.date === e.date.slice(0, 10) && x.t === Math.round((e.t || 0) * 10) / 10) + 1;
  try {
    const s = store(storage);
    if (s) s.setItem(SCORES_KEY, JSON.stringify(clean));
  } catch { /* ignore */ }
  return { rank, scores: clean };
}

export function clearScores(storage) {
  try { store(storage)?.removeItem(SCORES_KEY); } catch { /* ignore */ }
}
