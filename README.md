# MicroMaze

A zero-dependency, top-down pixel wave-defense game: a Micro Center parody. You are a store tech with a **price-scanner gun** (infinite ammo) and limited **Bawlz** drink-can grenades. Micro-mice pour out of the stockroom to gnaw the checkout registers, led by boss **Perring Parkway Pete**, while your cruel manager **Christopher** yells taunts from the cameras.

**Play it:** https://bsommers.github.io/micromaze/

Plain ES modules, no build step, no runtime dependencies. Needs Node 20+ for tooling (tests, bot, local server); the game itself runs in any modern browser.

## Quick start

```sh
git clone https://github.com/bsommers/micromaze.git && cd micromaze
npm start                 # static server on http://127.0.0.1:4881/ (binds 0.0.0.0)
npm test                  # 157 tests
npm run verify            # full gate: imports lint, tests, validate all levels, botplay
```

Open http://127.0.0.1:4881/ and pick a level from the menu, or jump straight in:
`http://127.0.0.1:4881/?level=gpuscalper&diff=hard&autostart=1`

## Levels

| id | Name | Waves | Registers | Lose when |
|---|---|---|---|---|
| `store01` | Front Checkout | 3 | 3 | all registers lost |
| `blackfriday` | Black Friday | 5 | 4 | all registers lost |
| `gtadrop` | GTA Drop Day | 5 | 3 | all registers lost |
| `backtoschool` | Back to School | 4 | 3 | all registers lost |
| `gpuscalper` | GPU Scalper Panic | 5 | 2 | **any** register lost |

Every level is a validated JSON `LevelDef` with exactly one Pete group, on the final wave. Win by clearing all waves (including Pete); lose when the lose condition trips.

## Controls

| Input | Action |
|---|---|
| `W A S D` / arrow keys | Move |
| Mouse | Aim |
| Left click (hold) or `Space` | Fire scanner (infinite ammo) |
| Right click, `F` or `E` | Throw Bawlz grenade (area damage, limited ammo, see HUD) |
| Walk over pickups | Refill Bawlz / health |
| `Enter` | Skip intro |
| `G` | Toggle 16-bit / 32-bit art |
| `Esc` or `P` | Start/pause menu |
| Touch | Left stick moves, fire button shoots (no grenade on touch) |

## Difficulties

`easy`, `medium` (default, identity), `hard`, `insane`. Difficulty is a pure transform of the level (enemy HP, speed, counts, spawn gaps, register HP, starting ammo, drop chance). Final score is multiplied by 0.5 / 1 / 1.5 / 2. Choose it in the menu, with `?diff=hard`, or `node tools/botplay.mjs --diff hard`.

## Store size

The level menu also has a **Store size** row: `1x` (as authored), `2x`, `3x`. Each tile becomes a k x k block of real floor, positions scale by k, mouse counts and starting Bawlz ammo scale by k, and Pete is never duplicated. Score multiplier 1 / 1.5 / 2, stacked with the difficulty multiplier.

## URL parameters

`level` (id above), `diff` (easy|medium|hard|insane), `size` (1|2|3), `gfx` (`16bit`|`32bit`), `seed` (integer, deterministic runs), `bot=1` (autopilot plays), `autostart=1` (skip menu and intro).

## Other commands

```sh
npm run botplay                        # autopilot, store01, seeds 1-10 (needs 8/10 clears)
node tools/validate-level.mjs src/levels/store01.json
npm run tracker                        # swarm dashboard on :4880 (LAN allowlist)
node tools/export-characters.mjs       # regenerate assets/characters/
```

## Documentation

Start at [docs/README.md](docs/README.md): purpose, architecture, running, how-to recipes, and per-subsystem guides. Binding contracts live in [ARCHITECTURE.md](ARCHITECTURE.md).

## License

See [LICENSE](LICENSE). Parody; all characters and brands are fictional or used satirically.
