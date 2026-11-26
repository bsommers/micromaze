import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { buildArt } from '../../src/art/registry.js';
import { DT } from '../../src/core/defs.js';

test('gfx mode art builds and sim ignores art', () => {
  const a16 = buildArt({ mode: '16bit' });
  const a32 = buildArt({ mode: '32bit' });
  assert.equal(a16.scale, 1);
  assert.equal(a32.scale, 2);
  assert.ok(a16.has('player_idle') && a32.has('pete'));

  function run() {
    const g = createGame({ seed: 7, level: structuredClone(loadLevel('store01')), bus: createBus() });
    g.state = 'play';
    for (let i = 0; i < 60; i++) {
      g.update(DT, { mx: 1, my: 0, ax: 1, ay: 0, fire: true, throwPressed: i === 10 });
    }
    return g.snapshot();
  }
  // art build must not affect sim
  buildArt({ mode: '32bit' });
  const s1 = run();
  buildArt({ mode: '16bit' });
  const s2 = run();
  assert.deepEqual(s1, s2);
});
