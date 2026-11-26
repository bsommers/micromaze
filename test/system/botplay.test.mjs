import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('TC-11 botplay clears ≥8/10 seeds', () => {
  const r = spawnSync(process.execPath, [
    'tools/botplay.mjs', '--level', 'store01',
    '--seeds', '1,2,3,4,5,6,7,8,9,10', '--max-t', '180',
  ], { encoding: 'utf8', cwd: process.cwd() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /cleared (8|9|10)\/10/);
});
