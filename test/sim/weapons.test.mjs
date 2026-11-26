import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT, WEAPONS } from '../../src/core/defs.js';
import { explodeGrenade } from '../../src/sim/weapons.js';

const level = () => structuredClone(loadLevel('store01'));

test('TC-02 scanner spawns projectile toward aim', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: true, throwPressed: false });
  const shot = g.ents.find((e) => e.kind === 'projectile' && !e.dead);
  assert.ok(shot);
  assert.ok(shot.vx > 0);
});

test('TC-02 bawlz splash damages vermin including pete, not registers/player', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  const cx = 160, cy = 100;
  const mouse = g.spawn('mouse', {
    x: cx + 5, y: cy, r: 5, hp: 10, maxHp: 10, team: 'vermin',
    st: { bite: 99, speed: 0 },
  });
  const pete = g.spawn('pete', {
    x: cx, y: cy + 5, r: 10, hp: 20, maxHp: 20, team: 'vermin',
    st: { phase: 1, spawnT: 99, dashT: 0, dashCd: 99, speed: 0 },
  });
  g.pete = pete;
  const regHp = g.registers.map((r) => r.hp);
  const playerHp = g.player.hp;
  explodeGrenade(g, { x: cx, y: cy, dead: false, st: { splashR: WEAPONS.bawlz.splashR, dmg: 4 } });
  assert.ok(mouse.hp < 10 || mouse.dead);
  assert.ok(pete.hp < 20 || pete.dead);
  assert.deepEqual(g.registers.map((r) => r.hp), regHp);
  assert.equal(g.player.hp, playerHp);
});

test('ammo 0 throw is no-op', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  g.ammo.bawlz = 0;
  g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: true });
  assert.equal(g.ents.filter((e) => e.kind === 'grenade' && !e.dead).length, 0);
  assert.equal(g.stats.thrown, 0);
});
