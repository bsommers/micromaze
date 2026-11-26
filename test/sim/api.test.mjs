import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT } from '../../src/core/defs.js';

const level = () => structuredClone(loadLevel('store01'));

test('TC-01 createGame requires level and bus', () => {
  assert.throws(() => createGame({ seed: 1, bus: createBus() }), TypeError);
  assert.throws(() => createGame({ seed: 1, level: level() }), TypeError);
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  assert.equal(typeof g.update, 'function');
  assert.equal(typeof g.snapshot, 'function');
});

test('update ignores NaN/negative/Infinity dt', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  const before = g.snapshot();
  g.update(NaN, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  g.update(-1, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  g.update(Infinity, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.deepEqual(g.snapshot().player.x, before.player.x);
});

test('missing input fields default safely', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  g.update(DT, {});
  assert.ok(Number.isFinite(g.player.x));
});
