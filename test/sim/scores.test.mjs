import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScore, loadScores, clearScores, sanitizeScores, MAX_PER_LEVEL } from '../../src/core/scores.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('records, sorts, caps per level', () => {
  const s = mem();
  for (let i = 0; i < 15; i++) recordScore('a', { score: i * 10, win: true, t: 5 }, s);
  const l = loadScores(s).a;
  assert.equal(l.length, MAX_PER_LEVEL);
  assert.equal(l[0].score, 140);
  assert.ok(l.every((e, i) => i === 0 || l[i - 1].score >= e.score));
});
test('rank 0 when not on board', () => {
  const s = mem();
  for (let i = 0; i < 10; i++) recordScore('a', { score: 100 + i, win: true, t: 1 }, s);
  assert.equal(recordScore('a', { score: 1, win: false, t: 1 }, s).rank, 0);
});
test('garbage / proto keys are dropped', () => {
  const o = JSON.parse('{"__proto__":[{"score":1}],"x":[{"score":"no"},{"score":5}],"y":3}');
  const c = sanitizeScores(o);
  assert.deepEqual(Object.keys(c), ['x']);
  assert.equal(c.x.length, 1);
});
test('corrupt storage yields empty; clear works', () => {
  const s = mem(); s.setItem('micromaze.scores', '{bad');
  assert.deepEqual(loadScores(s), {});
  recordScore('a', { score: 3, win: true, t: 1 }, s); clearScores(s);
  assert.deepEqual(loadScores(s), {});
});
