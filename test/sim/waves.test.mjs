import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT } from '../../src/core/defs.js';

test('waves spawn mice then advance', () => {
  const g = createGame({ seed: 1, level: structuredClone(loadLevel('store01')), bus: createBus() });
  g.state = 'play';
  let sawMouse = false;
  for (let i = 0; i < 180; i++) {
    g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
    if (g.ents.some((e) => e.kind === 'mouse' && !e.dead)) sawMouse = true;
  }
  assert.ok(sawMouse);
  const st = g._sched.tick(0);
  assert.equal(typeof st.spawnedOut, 'boolean');
  assert.equal(typeof st.verminAlive, 'boolean');
});
