import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT } from '../../src/core/defs.js';

test('TC-09 same seed+inputs → equal snapshots over long run', () => {
  const script = [];
  for (let i = 0; i < 600; i++) {
    script.push({
      mx: Math.sin(i / 11), my: Math.cos(i / 17),
      ax: Math.cos(i / 9), ay: Math.sin(i / 9),
      fire: i % 4 === 0, throwPressed: i % 77 === 0, startPressed: i === 0,
    });
  }
  function run(seed) {
    const g = createGame({ seed, level: structuredClone(loadLevel('store01')), bus: createBus() });
    for (const cmd of script) g.update(DT, cmd);
    return g.snapshot();
  }
  assert.deepEqual(run(99), run(99));
  const a = run(3), b = run(4);
  assert.ok(Number.isFinite(a.player.x) && Number.isFinite(b.player.x));
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});
