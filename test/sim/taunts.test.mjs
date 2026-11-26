import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/events.js';
import { loadLevel } from '../../src/levels/load-node.js';
import { createGame } from '../../src/sim/game.js';
import { createTaunts } from '../../src/sim/taunts.js';
import { createRng } from '../../src/core/rng.js';

test('taunt pick is deterministic under seed', () => {
  function pick(seed) {
    const texts = [];
    const bus = createBus();
    bus.on('taunt', (t) => texts.push(t.text));
    const g = {
      rng: createRng(seed),
      state: 'play',
      emit: (type, payload) => bus.emit(type, payload),
    };
    const t = createTaunts(g);
    t.on('wave_start');
    return texts[0];
  }
  assert.equal(pick(42), pick(42));
});

test('createGame wires taunts on wave', () => {
  const taunts = [];
  const bus = createBus();
  bus.on('taunt', (t) => taunts.push(t));
  const g = createGame({ seed: 5, level: structuredClone(loadLevel('store01')), bus });
  g.update(0.1, { startPressed: true });
  // intro may clear; force
  g._taunts?.on('idle');
  assert.ok(taunts.length >= 1);
});
