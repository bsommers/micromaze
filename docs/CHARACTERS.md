# MicroMaze Character Bible

All characters are parody and fictional: no real store logos, BAWLZ is a parody drink, Pete is a rat. Sprites are generated in code
(`src/art/px16/chars.js`, `src/art/px32/chars.js`) and exported as a library to `assets/characters/` by `node tools/export-characters.mjs`.

| Id | Name | Role | Art names (manifest) |
|---|---|---|---|
| scanner_tech | Scanner Tech | player | player_idle (2), player_run (4), player_down (1) |
| christopher | Christopher | manager, voice only | none |
| micro_mouse | Micro-Mouse | enemy swarm | mouse (2) |
| pete | Perring Parkway Pete | boss | pete (2) |
| scanner_bolt | Scanner Bolt | projectile | projectile (1) |
| bawlz_can | BAWLZ Can | grenade and pickup | grenade (2), pickup_bawlz (1) |
| hp_pack | Health Pack | pickup | pickup_hp (1) |

Sizes: px16 sprites are 16x16 (Pete 24x24, projectile/grenade 8x8, pickups 12x12); px32 is exactly 2x.

## Scanner Tech (player)
Orange-tabby store tech with a price-scanner gun. 5 HP, speed 90, goes down for 2s then respawns with 1.5s invulnerability.
Fires the infinite-ammo scanner (1 damage, 0.14s cooldown) and lobs counted BAWLZ cans (4 damage, 28px splash). Idle holds the scanner,
run is a 4-frame cycle, down is the flat-on-the-floor frame.

## Christopher (manager)
Cruel, fictional, always watching the cameras. No sprite: he exists as the taunt banner speaker. Triggers (`src/sim/taunts.js`, lines in `TAUNTS` in `src/core/defs.js`):
wave_start, wave_clear, register_hit, register_lost, player_down, idle (after 8s), streak, victory, defeat, pete_arrive/pete_phase/pete_down.
Style: all-caps escalation, workplace threats (locker, inventory forever), never praise. Examples: "Mice. On. My. Floor. Fix it!", "Store saved. Don't expect a raise."
Priority: defeat/victory 2, register_lost/pete_arrive 1, else 0; minimum 3s gap between taunts.

## Micro-Mouse (enemy)
Swarm unit: 2 HP, speed 38, bites for 1 on a 0.7s cooldown, chases registers via the flow field. Two-frame tail wiggle. Wave filler and Pete's minions.

## Perring Parkway Pete (boss)
Giant brown rat, 40 HP, speed 55, dashes (140 speed for 0.35s, 2.4s cooldown), spawns micro-mice every 10s, escalates in phases.
Taunts as himself on arrival: "Squeak for me, store boy!", "Perring Parkway owns this aisle!", "Micro-mice, feast!"
Christopher reacts: "Parkway Pete? In MY store?!", "Finally. Sweep the aisle."

## Props
Scanner Bolt: green glowing bolt (emissive material channel). BAWLZ Can: teal can, spins across two frames as a grenade; the pickup restocks ammo.
Health Pack: green cross, restores HP.

## Reuse
- `assets/characters/library.json`: per character, `modes.px16|px32` give `sprites[]` (name, width, height, frame PNG paths), `sheet`, and `palette` (hex list). Also top-level `sheets`.
- Frames are transparent RGBA PNGs named `<art name>_<frame>.png`; scale with nearest-neighbor only.
- Regenerate with `node tools/export-characters.mjs` (byte-identical on rerun). `test/art/character-library.test.mjs` checks the library against the `ART` manifest and that every PNG exists.
- To add a character: add art in both chars.js files and `ART` in defs.js, then add an entry to `CHARACTERS` in the exporter.
