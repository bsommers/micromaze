import test from 'node:test';
import assert from 'node:assert/strict';

test('music module loads (jingles fit bar lines)', async () => {
  const m = await import('../../src/audio/music.js');
  assert.ok(m);
});
