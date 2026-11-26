import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { DT } from '../../src/core/defs.js';

test('TC-05 loseWhen all vs any', () => {
  const all = createGame({ seed: 1, level: structuredClone(loadLevel('store01')), bus: createBus() });
  all.state = 'play';
  all.registers[0].dead = true; all.registers[0].hp = 0;
  all.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.equal(all.outcome, null);

  const anyLv = structuredClone(loadLevel('store01'));
  anyLv.loseWhen = 'any';
  const any = createGame({ seed: 1, level: anyLv, bus: createBus() });
  any.state = 'play';
  any.registers[0].dead = true; any.registers[0].hp = 0;
  any.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.equal(any.outcome?.win, false);
});

test('TC-04 victory requires final wave cleared and no vermin', () => {
  const g = createGame({ seed: 1, level: structuredClone(loadLevel('store01')), bus: createBus() });
  g.state = 'play';
  // force scheduler into final spawned-out empty state
  g._sched = {
    finalSpawnedOut: true,
    update() {},
    get waveIdx() { return 2; },
  };
  g.waveIdx = 2;
  g.ents.forEach((e) => { if (e.kind === 'mouse' || e.kind === 'pete') e.dead = true; });
  g.pete = null;
  g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.equal(g.outcome?.win, true);
  assert.equal(g.outcome?.reason, 'all_waves_cleared');
});

test('lose before win same tick', () => {
  const g = createGame({ seed: 1, level: structuredClone(loadLevel('store01')), bus: createBus() });
  g.state = 'play';
  g._sched = { finalSpawnedOut: true, update() {}, get waveIdx() { return 2; } };
  g.ents.forEach((e) => { if (e.kind === 'mouse' || e.kind === 'pete') e.dead = true; });
  for (const r of g.registers) { r.dead = true; r.hp = 0; }
  g.update(DT, { mx: 0, my: 0, ax: 1, ay: 0, fire: false, throwPressed: false });
  assert.equal(g.outcome?.win, false);
});
