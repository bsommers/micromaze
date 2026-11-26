import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function scan(dir) {
  const bad = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const src = readFileSync(join(dir, name), 'utf8');
    for (const needle of ['Math.random', 'Date.now', 'performance.now', 'document.', 'window.']) {
      if (src.includes(needle)) bad.push(`${name}:${needle}`);
    }
  }
  return bad;
}

test('TC-09 sim/levels/art have no Math.random/DOM clocks', () => {
  assert.deepEqual(scan('src/sim'), []);
  // levels/load-node uses fs only — art and level.js must be pure
  const levelSrc = readFileSync('src/levels/level.js', 'utf8');
  assert.equal(levelSrc.includes('Math.random'), false);
  assert.deepEqual(scan('src/art'), []);
  assert.deepEqual(scan('src/art/px16'), []);
  assert.deepEqual(scan('src/art/px32'), []);
});
