import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT } from '../../src/core/defs.js';

test('TC-12 bus handler throw does not crash sim', () => {
  const bus = {
    on() { return () => {}; },
    emit() { throw new Error('boom'); },
  };
  const g = createGame({ seed: 1, level: structuredClone(loadLevel('store01')), bus });
  g.state = 'play';
  assert.doesNotThrow(() => {
    for (let i = 0; i < 30; i++) {
      g.update(DT, { mx: 1, my: 0, ax: 1, ay: 0, fire: true, throwPressed: i === 5 });
    }
  });
  assert.ok(Number.isFinite(g.player.x));
  assert.equal(g.outcome, null);
});
