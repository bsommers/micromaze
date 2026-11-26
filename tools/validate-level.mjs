#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateLevel } from '../src/levels/level.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/validate-level.mjs <level.json>');
  process.exit(2);
}
let def;
try {
  def = JSON.parse(readFileSync(resolve(path), 'utf8'));
} catch (e) {
  console.error('io/parse:', e.message || e);
  process.exit(2);
}
const v = validateLevel(def);
if (!v.ok) {
  console.error('INVALID', v.errors.join('\n'));
  process.exit(1);
}
console.log('OK', def.id, def.waves?.length, 'waves');
process.exit(0);
