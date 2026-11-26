import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from '../../src/levels/load-node.js';
import { LEVELS, validateLevel } from '../../src/levels/level.js';
import { applyDifficulty, DIFFICULTIES } from '../../src/levels/difficulty.js';

test('medium is identity; input never mutated', () => {
  const l = loadLevel('store01'); const before = JSON.stringify(l);
  assert.deepEqual(applyDifficulty(l, 'medium'), l);
  applyDifficulty(l, 'insane');
  assert.equal(JSON.stringify(l), before);
});
test('every level x difficulty validates, one Pete, monotone mouse count', () => {
  for (const id of LEVELS) {
    const base = loadLevel(id); let prev = 0;
    for (const d of DIFFICULTIES) {
      const v = applyDifficulty(base, d);
      assert.ok(validateLevel(v).ok, `${id}/${d}`);
      const mice = v.waves.flatMap((w) => w.groups).filter((g) => g.kind === 'mouse').reduce((a, g) => a + g.count, 0);
      assert.ok(mice >= prev, `${id}/${d} mice monotone`); prev = mice;
    }
  }
});
test('unknown difficulty falls back to medium', () => {
  const l = loadLevel('store01');
  assert.deepEqual(applyDifficulty(l, 'nope'), l);
});
