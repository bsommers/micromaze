#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const mods = ['px16/chars', 'px16/store', 'px16/fx'];
for (const m of mods) {
  const r = spawnSync(process.execPath, ['tools/sheet.mjs', m, '--scale', '4'], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status) process.exit(r.status ?? 1);
}
console.log('sheets ok');
