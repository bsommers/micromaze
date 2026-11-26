# Guide: levels and difficulty (`src/levels`)

## Files

| File | Role |
|---|---|
| `store01.json`, `blackfriday.json`, `gtadrop.json`, `backtoschool.json`, `gpuscalper.json` | LevelDef data |
| `level.js` | `LEVELS` registry, `validateLevel`, `parseLevel`, `levelSize`, `isSolidAt`, `buildSolidAabbs`, `buildFlowField` |
| `load-browser.js` | `fetchLevel(id)`: relative `fetch` + validate (works under a Pages sub-path) |
| `load-node.js` | `loadLevel(id)`: `fs` read + `parseLevel` (tests, botplay) |
| `size.js` | `applySize(level, k)`, `SIZES` [1,2,3], `SIZE_SCORE`, `normalizeSize` |
| `difficulty.js` | `applyDifficulty(level, diff)`, `DIFFICULTIES`, `SCORE_MULT`, `normalizeDifficulty` |

## Registered levels

| id | Title | Grid (cols x rows) | Waves | Registers | `loseWhen` | `dropChance` |
|---|---|---|---|---|---|---|
| `store01` | Front Checkout | 20 x 11 | 3 | 3 | all | 0.35 |
| `blackfriday` | Black Friday | 24 x 14 | 5 | 4 | all | 0.55 |
| `gtadrop` | GTA Drop Day | 26 x 14 | 5 | 3 | all | 0.5 |
| `backtoschool` | Back to School | 22 x 13 | 4 | 3 | all | 0.6 |
| `gpuscalper` | GPU Scalper Panic | 20 x 12 | 5 | 2 | any | 0.3 |

## LevelDef schema (version 1)

```jsonc
{
  "id": "store01",                      // must be in LEVELS to load
  "name": "MICRO MAZE — Front Checkout",
  "version": 1,
  "tiles": ["####", "#..#"],            // equal-length rows, max 256x256, 16 px per tile
  "legend": { "#": "wall", ".": "floor", "S": "shelf", "P": "counter", "D": "door" },
  "playerSpawn": { "x": 160, "y": 120 },        // world pixels, must be on a walkable tile
  "registers": [{ "id": "r1", "x": 120, "y": 136, "hp": 60 }],
  "spawns": [{ "id": "n", "x": 160, "y": 32 }],
  "loseWhen": "all",                    // "all" | "any"
  "intermission": 0.8,                  // seconds between waves
  "startAmmo": { "bawlz": 8 },
  "dropChance": 0.35,                   // 0..1 chance a kill drops a pickup
  "pickupTable": [{ "give": "bawlz", "n": 2, "w": 3 }, { "give": "hp", "n": 1, "w": 1 }],
  "waves": [{
    "id": "w1", "delay": 0.3, "clearBonus": 100,
    "groups": [{ "kind": "mouse", "count": 3, "every": 0.8, "spawn": "any", "hp": 2, "speed": 30 }]
  }]
}
```

Tiles: `wall` and `shelf` block; `floor`, `door`, `counter` are walkable. Unknown legend characters are treated as wall. Group `kind` is `mouse` or `pete`; `spawn` is a spawn id or `any`; `hp` and `speed` override `TUNING` defaults.

## Validation rules (`validateLevel`, CLI `node tools/validate-level.mjs <file>`)

- Prototype-pollution keys (`__proto__`, `constructor`, `prototype`) rejected anywhere.
- `version === 1`, string `id`, non-empty ragged-free `tiles`, `legend`, `loseWhen` in {all, any}, non-empty `registers`, `spawns`, `waves`.
- Unique register and spawn ids; register `hp` in (0, 1e6].
- Every wave has an `id` and groups; group `count` in [1, 500], `every >= 0`, known `spawn`.
- **Exactly one `pete` group, and it must be in the final wave.**
- Reachability: player spawn walkable; player reaches every register; every spawn reaches a register.

Exit codes of the CLI: 0 ok, 1 invalid, 2 usage/IO.

## Difficulty

Pure function: `applyDifficulty(level, d)` deep-clones (`structuredClone`) and returns a modified copy tagged `difficulty`; `medium` returns an unchanged clone.

| | easy | medium | hard | insane |
|---|---|---|---|---|
| enemy hp | 0.7 | 1 | 1.3 | 1.7 |
| enemy speed | 0.85 | 1 | 1.15 | 1.35 |
| mouse count | 0.75 | 1 | 1.3 | 1.8 |
| spawn interval (`every`) | 1.2 | 1 | 0.85 | 0.7 |
| register hp | 1.5 | 1 | 0.85 | 0.7 |
| start ammo | 1.5 | 1 | 0.8 | 0.6 |
| drop chance (added) | +0.15 | 0 | -0.05 | -0.10 |
| score multiplier | 0.5 | 1 | 1.5 | 2 |

Values round to at least 1. The Pete group count is never scaled (only `mouse` groups scale). Selection order: `?diff=` URL param, then `settings.difficulty`, else `medium`. Botplay: `--diff`.

## Store size

`applySize(level, k)` (`src/levels/size.js`) is a pure transform on a `structuredClone`; 1x is the identity. For k = 2 or 3: every tile character becomes a k x k block (real extra floor, not image scaling); `playerSpawn`, `registers` and `spawns` coordinates are multiplied by k; `startAmmo` and every `mouse` group `count` are multiplied by k; the single Pete group is never duplicated; the result is tagged `size`. `SIZE_SCORE` = 1 / 1.5 / 2.

Selection: `?size=1|2|3`, else `settings.size`, else 1. Botplay: `--size N`.

**Composition order** (in `src/main.js`): `applyDifficulty(applySize(level, size), difficulty)`. Final score = raw score x `SCORE_MULT[difficulty]` x `SIZE_SCORE[size]`.

## Adding or tuning

See [how-to.md](how-to.md#add-a-level). Tests: `test/levels/validate.test.mjs`, `test/levels/difficulty.test.mjs`, `test/levels/size.test.mjs`, `test/security/level-input.test.mjs`.
