import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from '../../src/levels/load-node.js';
import { validateLevel } from '../../src/levels/level.js';

test('store01 validates', () => {
  const def = loadLevel('store01');
  const v = validateLevel(def);
  assert.equal(v.ok, true, v.errors?.join('; '));
});

test('rejects missing pete', () => {
  const def = structuredClone(loadLevel('store01'));
  def.waves = [{ id: 'w', delay: 0, clearBonus: 0, groups: [{ kind: 'mouse', count: 1, every: 0, spawn: 'any' }] }];
  const v = validateLevel(def);
  assert.equal(v.ok, false);
});

test('rejects prototype pollution keys', () => {
  const def = structuredClone(loadLevel('store01'));
  Object.defineProperty(def.legend, '__proto__', { value: 'floor', enumerable: true, configurable: true });
  const v = validateLevel(def);
  assert.equal(v.ok, false);
});
