import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT } from '../../src/core/defs.js';

const level = () => structuredClone(loadLevel('store01'));

test('createGame boots player and registers', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  assert.equal(g.player.kind, 'player');
  assert.ok(g.registers.length >= 3);
  assert.ok(g.registers.every((r) => r.hp > 0));
});

test('scanner fires projectile on fire', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: true, throwPressed: false });
  assert.ok(g.ents.some((e) => e.kind === 'projectile' && !e.dead));
  assert.equal(g.stats.shots, 1);
});

test('bawlz throw consumes ammo and never damages registers', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  g.ammo.bawlz = 2;
  const before = g.registers.map((r) => r.hp);
  // place grenade on top of register via throw toward it
  g.player.x = g.registers[0].x;
  g.player.y = g.registers[0].y - 20;
  g.update(DT, { mx: 0, my: 0, ax: 0, ay: 1, fire: false, throwPressed: true });
  for (let i = 0; i < 120; i++) g.update(DT, { mx: 0, my: 0, ax: 0, ay: 1, fire: false, throwPressed: false });
  assert.equal(g.ammo.bawlz, 1);
  assert.deepEqual(g.registers.map((r) => r.hp), before);
});

test('determinism: same seed+inputs → equal snapshot', () => {
  const script = [];
  for (let i = 0; i < 180; i++) {
    script.push({ mx: Math.sin(i / 10), my: Math.cos(i / 13), ax: 1, ay: 0, fire: i % 5 === 0, throwPressed: i === 40 });
  }
  function run() {
    const g = createGame({ seed: 42, level: level(), bus: createBus() });
    g.state = 'play';
    for (const cmd of script) g.update(DT, cmd);
    return g.snapshot();
  }
  assert.deepEqual(run(), run());
});

test('player downed then respawns; not defeat', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  g.damage(g.player, 99, null);
  assert.ok(g.player.st.downT > 0);
  assert.equal(g.outcome, null);
  for (let i = 0; i < 180; i++) g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.ok(g.player.st.downT <= 0);
  assert.equal(g.player.hp, g.player.maxHp);
});

test('loseWhen all: defeat only when every register dead', () => {
  const g = createGame({ seed: 1, level: level(), bus: createBus() });
  g.state = 'play';
  g.registers[0].hp = 0; g.registers[0].dead = true;
  g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.equal(g.outcome, null);
  for (const r of g.registers) { r.hp = 0; r.dead = true; }
  g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.equal(g.outcome?.win, false);
  assert.equal(g.outcome?.reason, 'registers_destroyed');
});

test('no Math.random in sim snapshot path', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  for (const f of ['game.js', 'player.js', 'weapons.js', 'enemies.js', 'pete.js', 'waves.js', 'taunts.js']) {
    const src = readFileSync(join('src/sim', f), 'utf8');
    assert.equal(src.includes('Math.random'), false, f);
  }
});
