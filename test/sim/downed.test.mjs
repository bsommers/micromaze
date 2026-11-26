import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT, TUNING } from '../../src/core/defs.js';

test('TC-06 player downed then respawns; not defeat', () => {
  const g = createGame({ seed: 1, level: structuredClone(loadLevel('store01')), bus: createBus() });
  g.state = 'play';
  g.damage(g.player, 99, null);
  assert.ok(g.player.st.downT > 0);
  assert.equal(g.outcome, null);
  const steps = Math.ceil(TUNING.downTime / DT) + 2;
  for (let i = 0; i < steps; i++) {
    g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  }
  assert.ok(g.player.st.downT <= 0);
  assert.equal(g.player.hp, g.player.maxHp);
  assert.equal(g.player.x, g.level.playerSpawn.x);
  assert.equal(g.player.y, g.level.playerSpawn.y);
});
