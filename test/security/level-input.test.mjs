import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from '../../src/levels/load-node.js';
import { validateLevel } from '../../src/levels/level.js';

test('TC-08 rejects polluted / huge / malformed defs', () => {
  const base = structuredClone(loadLevel('store01'));
  Object.defineProperty(base, 'constructor', { value: {}, enumerable: true });
  assert.equal(validateLevel(base).ok, false);

  const huge = structuredClone(loadLevel('store01'));
  huge.tiles = Array.from({ length: 300 }, () => '#'.repeat(300));
  assert.equal(validateLevel(huge).ok, false);

  const bad = structuredClone(loadLevel('store01'));
  bad.loseWhen = 'maybe';
  assert.equal(validateLevel(bad).ok, false);
});
