import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT, WEAPONS } from '../../src/core/defs.js';
import { explodeGrenade } from '../../src/sim/weapons.js';

const level = () => structuredClone(loadLevel('store01'));

test('TC-07 dt=0 leaves snapshot unchanged', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  const a = g.snapshot();
  g.update(0, { mx: 1, my: 0, ax: 1, ay: 0, fire: true, throwPressed: false });
  assert.deepEqual(g.snapshot().t, a.t);
});

test('TC-07 splash inclusive at radius', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  const R = WEAPONS.bawlz.splashR;
  const mouse = g.spawn('mouse', {
    x: 100, y: 100, r: 1, hp: 10, maxHp: 10, team: 'vermin', st: { bite: 99, speed: 0 },
  });
  const grenade = {
    x: 100 + R, y: 100, dead: false,
    st: { splashR: R, dmg: 4 },
  };
  explodeGrenade(g, grenade);
  assert.ok(mouse.hp < 10, 'edge of splash radius should hit');
});

test('diagonal move input does not NaN', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  g.update(DT, { mx: 1, my: 1, ax: 0, ay: 0, fire: false, throwPressed: false });
  assert.ok(Number.isFinite(g.player.x) && Number.isFinite(g.player.y));
});
