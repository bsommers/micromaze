import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART } from '../../src/core/defs.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../assets/characters');
const lib = JSON.parse(readFileSync(join(dir, 'library.json'), 'utf8'));

test('library.json covers every px16/chars manifest name with matching frames and sizes', () => {
  const want = ART.filter((a) => a.module === 'px16/chars');
  const have = new Map();
  for (const c of lib.characters) for (const m of ['px16', 'px32']) for (const s of c.modes[m].sprites) have.set(m + ':' + s.name, s);
  for (const a of want) {
    const s16 = have.get('px16:' + a.name), s32 = have.get('px32:' + a.name);
    assert.ok(s16 && s32, `missing ${a.name}`);
    assert.equal(s16.frames.length, a.frames);
    assert.equal(s32.frames.length, a.frames);
    assert.deepEqual([s16.width, s16.height], [a.w, a.h]);
    assert.deepEqual([s32.width, s32.height], [a.w * 2, a.h * 2]);
  }
  assert.equal(have.size, want.length * 2);
});

test('every referenced PNG exists with a PNG header', () => {
  const files = [lib.sheets.px16, lib.sheets.px32];
  for (const c of lib.characters) for (const m of Object.values(c.modes)) { if (m.sheet) files.push(m.sheet); for (const s of m.sprites) files.push(...s.frames); }
  for (const f of files) {
    const p = join(dir, f);
    assert.ok(existsSync(p), f);
    assert.equal(readFileSync(p).subarray(1, 4).toString(), 'PNG', f);
  }
  assert.ok(existsSync(join(dir, 'README.md')));
});
