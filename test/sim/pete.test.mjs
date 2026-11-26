import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT } from '../../src/core/defs.js';

test('pete phases emit on hp thresholds', () => {
  const phases = [];
  const bus = createBus();
  bus.on('pete_phase', (p) => phases.push(p.phase));
  const g = createGame({ seed: 1, level: structuredClone(loadLevel('store01')), bus });
  g.state = 'play';
  const pete = g.spawn('pete', {
    x: 160, y: 80, r: 10, hp: 30, maxHp: 30, team: 'vermin',
    st: { phase: 1, spawnT: 99, dashT: 0, dashCd: 99, speed: 0 },
  });
  g.pete = pete;
  pete.hp = 5; // < 33% → phase 3
  g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.equal(pete.st.phase, 3);
  assert.ok(phases.includes(3));
});
