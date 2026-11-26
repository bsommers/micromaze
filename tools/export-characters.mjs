#!/usr/bin/env node
// Deterministic character asset exporter.
// node tools/export-characters.mjs  -> assets/characters/{px16,px32}/*.png, sheet.png, library.json, README.md
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './sheet.mjs';
import { ART } from '../src/core/defs.js';
import { build as build16 } from '../src/art/px16/chars.js';
import { build as build32 } from '../src/art/px32/chars.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'assets/characters');

export const MODES = [
  { id: 'px16', mode: '16bit', scale: 1, build: build16 },
  { id: 'px32', mode: '32bit', scale: 2, build: build32 },
];

/** Characters (roles) and the manifest art names each one owns. */
export const CHARACTERS = [
  {
    id: 'scanner_tech', name: 'Scanner Tech', role: 'player', art: ['player_idle', 'player_run', 'player_down'],
    description: 'Orange-tabby store tech with a price-scanner gun and a name tag nobody reads. Paid in exposure and employee-discount coupons, sworn to defend the registers from the micro-mice. Goes horizontal when overwhelmed, then gets yelled at to stand back up.',
  },
  {
    id: 'christopher', name: 'Christopher', role: 'manager (voice only)', art: [],
    description: 'The cruel, fictional floor manager. Never seen, only heard: watches the cameras, takes every lost register personally, and has never once said thank you. No sprite; appears as taunt banners.',
  },
  {
    id: 'micro_mouse', name: 'Micro-Mouse', role: 'enemy (swarm)', art: ['mouse'],
    description: 'Wireless, ergonomic, and hungry. Micro-mice pour out of the stockroom in waves to gnaw the checkout registers. Small, fast in numbers, two scans to clear.',
  },
  {
    id: 'pete', name: 'Perring Parkway Pete', role: 'boss', art: ['pete'],
    description: 'The big rat himself, boss of Perring Parkway and landlord of the clearance aisle. Dashes, spawns micro-mice on a timer, and gets meaner as his health drops. Squeaks at store boys.',
  },
  {
    id: 'scanner_bolt', name: 'Scanner Bolt', role: 'projectile', art: ['projectile'],
    description: 'The price-scanner beam: infinite ammo, one damage, zero returns accepted.',
  },
  {
    id: 'bawlz_can', name: 'BAWLZ Can', role: 'grenade + pickup', art: ['grenade', 'pickup_bawlz'],
    description: 'Parody energy-drink can, lobbed as a grenade for splash damage. Caffeinated, carbonated, not covered by the protection plan. The pickup frame restocks the can supply.',
  },
  {
    id: 'hp_pack', name: 'Health Pack', role: 'pickup', art: ['pickup_hp'],
    description: 'Green plus-sign first aid, restocked from the break room. Restores health; does not restore dignity.',
  },
];

const hex2 = (n) => n.toString(16).padStart(2, '0');
const mkdir = (p) => mkdirSync(p, { recursive: true });

function framesOf(built, name) {
  const v = built[name];
  return Array.isArray(v) ? v : [v];
}

function paletteOf(frames) {
  const set = new Set();
  for (const f of frames) for (let i = 0; i < f.rgba.length; i += 4) if (f.rgba[i + 3] >= 128) set.add('#' + hex2(f.rgba[i]) + hex2(f.rgba[i + 1]) + hex2(f.rgba[i + 2]));
  return [...set].sort();
}

function sheetOf(rows) {
  const gap = 2;
  const W = Math.max(...rows.map((fr) => fr.reduce((s, f) => s + f.w + gap, gap)));
  const H = rows.reduce((s, fr) => s + Math.max(...fr.map((f) => f.h)) + gap, gap);
  const px = new Uint8Array(W * H * 4);
  let y0 = gap;
  for (const fr of rows) {
    let x0 = gap;
    for (const f of fr) {
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) px.set(f.rgba.subarray((y * f.w + x) * 4, (y * f.w + x) * 4 + 4), ((y0 + y) * W + x0 + x) * 4);
      x0 += f.w + gap;
    }
    y0 += Math.max(...fr.map((f) => f.h)) + gap;
  }
  return encodePNG(W, H, px);
}

export function exportCharacters(outDir = OUT) {
  rmSync(outDir, { recursive: true, force: true });
  const names = ART.filter((a) => a.module === 'px16/chars').map((a) => a.name);
  const built = Object.fromEntries(MODES.map((m) => [m.id, m.build()]));
  const files = {};
  for (const m of MODES) {
    mkdir(join(outDir, m.id));
    const rows = [];
    for (const n of names) {
      const fr = framesOf(built[m.id], n);
      rows.push(fr);
      fr.forEach((f, i) => writeFileSync(join(outDir, m.id, `${n}_${i}.png`), encodePNG(f.w, f.h, new Uint8Array(f.rgba.buffer, f.rgba.byteOffset, f.rgba.length))));
    }
    writeFileSync(join(outDir, m.id, 'sheet.png'), sheetOf(rows));
  }
  const chars = CHARACTERS.map((c) => {
    const modes = {};
    for (const m of MODES) {
      const sprites = c.art.map((n) => {
        const fr = framesOf(built[m.id], n);
        return { name: n, width: fr[0].w, height: fr[0].h, frames: fr.map((_, i) => `${m.id}/${n}_${i}.png`) };
      });
      modes[m.id] = { gfxMode: m.mode, scale: m.scale, sheet: c.art.length ? `${m.id}/sheet.png` : null, sprites, palette: paletteOf(c.art.flatMap((n) => framesOf(built[m.id], n))) };
    }
    return { id: c.id, name: c.name, role: c.role, description: c.description, art: c.art, modes };
  });
  const lib = {
    $schema: 'tools/library/schemas/library.schema.json', formatVersion: 2, name: 'micromaze-characters', version: '0.1.0',
    license: 'MIT', description: 'MicroMaze parody character sprites (16-bit and 32-bit), transparent PNGs with sheets.',
    tags: ['sprite', 'pixel-art', 'characters', 'parody', 'top-down'], assetTypes: ['sprite'], authors: ['MicroMaze contributors'],
    sheets: { px16: 'px16/sheet.png', px32: 'px32/sheet.png' }, characters: chars,
  };
  writeFileSync(join(outDir, 'library.json'), JSON.stringify(lib, null, 2) + '\n');
  const readme = `# micromaze-characters

Parody character sprites for MicroMaze, exported from \`src/art/px16/chars.js\` and \`src/art/px32/chars.js\`.
Generated by \`node tools/export-characters.mjs\` (deterministic; do not edit by hand). See \`docs/CHARACTERS.md\`.

## Layout

- \`library.json\` manifest: characters, display names, roles, lore, frames, sizes, palettes, per-mode files
- \`px16/<name>_<frame>.png\`: native 16-bit frames (transparent background); \`px16/sheet.png\` all frames, one row per sprite
- \`px32/...\`: same at 2x resolution (32-bit mode)

## Characters

${chars.map((c) => `- **${c.name}** (${c.role}): ${c.art.length ? c.art.join(', ') : 'no sprite'}`).join('\n')}

## Reuse

Load \`library.json\`, look up a character, and read \`modes.px16\` or \`modes.px32\` for sprite sizes and frame paths.
Frames are plain RGBA PNGs: use nearest-neighbor scaling. Licensed MIT; parody only, no real brand logos.
`;
  writeFileSync(join(outDir, 'README.md'), readme);
  return lib;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lib = exportCharacters();
  console.log(`exported ${lib.characters.length} characters to ${OUT}`);
}
