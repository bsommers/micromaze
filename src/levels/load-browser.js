import { validateLevel, LEVELS } from './level.js';

/** Fetch a LevelDef JSON in the browser (no loadLevel / fs). */
export async function fetchLevel(id) {
  if (!LEVELS.includes(id)) throw new RangeError(`unknown level: ${id}`);
  const url = new URL(`./${id}.json`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const def = await res.json();
  const v = validateLevel(def);
  if (!v.ok) throw new Error(`invalid level ${id}: ${v.errors.join('; ')}`);
  return def;
}