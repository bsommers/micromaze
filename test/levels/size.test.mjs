import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from '../../src/levels/load-node.js';
import { LEVELS, validateLevel } from '../../src/levels/level.js';
import { applySize, SIZES } from '../../src/levels/size.js';
import { applyDifficulty, DIFFICULTIES } from '../../src/levels/difficulty.js';

test('1x identity, input not mutated', () => {
  const l = loadLevel('store01'); const b = JSON.stringify(l);
  assert.deepEqual(applySize(l, 1), l);
  applySize(l, 3); assert.equal(JSON.stringify(l), b);
});
test('k x grid dims, valid for all levels x sizes x difficulties, one Pete', () => {
  for (const id of LEVELS) {
    const base = loadLevel(id);
    for (const k of SIZES) {
      const s = applySize(base, k);
      assert.equal(s.tiles.length, base.tiles.length * k);
      assert.equal(s.tiles[0].length, base.tiles[0].length * k);
      for (const d of DIFFICULTIES) {
        const v = applyDifficulty(s, d);
        assert.ok(validateLevel(v).ok, `${id} ${k}x ${d}: ${validateLevel(v).errors}`);
        assert.equal(v.waves.flatMap((w) => w.groups).filter((g) => g.kind === 'pete').length, 1);
      }
    }
  }
});
test('unknown size -> 1x', () => {
  const l = loadLevel('store01');
  assert.deepEqual(applySize(l, 'x'), l);
});
