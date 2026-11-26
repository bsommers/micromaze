import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT } from '../../src/core/defs.js';

test('TC-03 mouse bite damages register and emits lost at 0', () => {
  const bus = createBus();
  const lost = [];
  bus.on('register_lost', (p) => lost.push(p));
  const g = createGame({ seed: 1, level: structuredClone(loadLevel('store01')), bus });
  g.state = 'play';
  const r = g.registers[0];
  const before = r.hp;
  g.spawn('mouse', {
    x: r.x, y: r.y, r: 5, hp: 5, maxHp: 5, team: 'vermin',
    st: { bite: 0, speed: 0, biteDmg: 3 },
  });
  for (let i = 0; i < 10; i++) g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.ok(r.hp < before);
  r.hp = 1;
  g.ents.filter((e) => e.kind === 'mouse').forEach((m) => { m.st.bite = 0; });
  for (let i = 0; i < 5; i++) g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  // force kill
  g.damage(r, 99, null);
  assert.equal(r.dead, true);
  assert.ok(lost.some((p) => p.regId === r.st.regId));
});
