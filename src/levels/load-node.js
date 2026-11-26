// Node-only level loader (uses fs). Browser must fetch JSON + parseLevel instead.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, parseLevel } from './level.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadLevel(id) {
  if (!LEVELS.includes(id)) throw new RangeError(`unknown level: ${id}`);
  const raw = readFileSync(join(HERE, `${id}.json`), 'utf8');
  return parseLevel(JSON.parse(raw));
}
