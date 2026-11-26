# Architecture

Binding contracts are in [../ARCHITECTURE.md](../ARCHITECTURE.md). This page is the map.

```
 browser input ──► src/main.js ──► sim/game.js ──bus events──► render | audio | ui
 (core/input,       (boot, loop)      ▲  (Node-safe)
  ui/touch)                           │
 LevelDef JSON ► levels/load-browser ─┘ ► applySize ► applyDifficulty (after validate)
```

Full diagram: [diagrams/ascii_architecture.txt](diagrams/ascii_architecture.txt). Mermaid/draw.io: [module_architecture](diagrams/module_architecture.mmd), [game_loop_sequence](diagrams/game_loop_sequence.mmd), [wave_level_dataflow](diagrams/wave_level_dataflow.mmd).

## Layers

| Layer | Path | Rule |
|---|---|---|
| Core constants and utilities | `src/core/` | `defs.js` (W=320, H=180, TILE=16, DT, TUNING, WEAPONS, palettes, ART manifest, EVENTS, SFX, MUSIC, TAUNTS), `events.js` (bus), `rng.js`, `input.js`, `settings.js`, `scores.js` |
| Simulation | `src/sim/` | Pure, deterministic, no DOM. `game.js` owns state |
| Levels | `src/levels/` | JSON LevelDefs, validator, flow field, difficulty transform, loaders |
| Render | `src/render/` | Canvas draw from game snapshot; camera; particles |
| UI | `src/ui/` | HUD and end screens drawn on canvas; DOM overlays (start menu, end card, touch) |
| Audio | `src/audio/` | WebAudio from bus `sfx` and `music` events, recipes in `sfx.js` and `music.js` |
| Art | `src/art/` | `px16/` and `px32/` packs build PixBufs; `registry.js` selects one |
| Vendored | `src/kits/`, `src/lib/` | Factory kits (pixel buffer, synth) and generic libs; not project code |
| Tooling | `tools/`, `scripts/`, `test/` | Node only |

## Boot sequence (`src/main.js`)

1. Parse URL params; load settings (`micromaze.settings`); `?gfx=` overrides.
2. `normalizeDifficulty(?diff ?? settings.difficulty)` and `normalizeSize(?size ?? settings.size)`.
3. `fetchLevel(levelId)` (relative URL, validated) then `applyDifficulty(applySize(level, size), difficulty)`.
4. Build art pack (dynamic import, falls back to tinted boxes), `createGame`, camera, particles, audio, renderer.
5. Show start menu unless `autostart=1` or `bot=1`.
6. `requestAnimationFrame` loop: sample input (keyboard, mouse, touch, or bot), accumulate time, call `game.update(DT, input)`, draw.

## State machine (owned by `game.js`)

`intro` (1.6 s or Enter) -> `play` <-> `intermission` (between waves) -> `victory` | `defeat`.

Tick order in play: player, scanner, grenade throw, projectiles, grenades, pickups, mice, Pete, wave scheduler (flow field rebuilds on wave change), taunts, then **lose check before win check**.

## Key mechanisms

- **Timestep**: `g.update(dt)` clamps dt to `maxDt` (1/30), runs at most 2 fixed 1/60 steps, drops the remainder. `main.js` also zeroes its accumulator while the menu is open (pause).
- **Determinism**: `createRng(seed)` seeded RNG; same seed + level + inputs gives same result (`test/sim/determinism.test.mjs`).
- **Pathing**: one shared BFS flow field toward the nearest live register, rebuilt only on `register_lost` and wave start.
- **Events**: `createBus()` synchronous; sim emits `wave_start`, `wave_clear`, `spawn`, `hit`, `kill`, `register_hit`, `register_lost`, `throw`, `explode`, `pickup`, `player_down`, `pete_phase`, `taunt`, `sfx`, `music`, `game_over`, `fx`, `popup`. Bus faults never crash the sim (`g.emit` try/catch).
- **Teams**: scanner and splash hit `vermin` (mice and Pete) only.
- **Entity cap**: 120 live entities; spawns are deferred when full.
- **Scoring**: mouse 25, Pete 500, wave `clearBonus`; at `game_over` `main.js` multiplies by `SCORE_MULT[difficulty] * SIZE_SCORE[size]` and calls `recordScore('<level>:<difficulty>[:2x|3x]', ...)`.
- **Graphics mode** switches art packs only; hitboxes come from `TUNING` radii (`test/art/gfx-sim-independence.test.mjs`).

See the subsystem guides for detail: [guide-sim](guide-sim.md), [guide-levels](guide-levels.md), [guide-ui-menu-scores](guide-ui-menu-scores.md), [guide-art-audio](guide-art-audio.md), [guide-tooling](guide-tooling.md).
