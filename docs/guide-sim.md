# Guide: simulation (`src/sim`, `src/core`)

Entry point: `createGame({ seed, level, bus, weapons? })` in `src/sim/game.js`. It returns `g` with `update(dt, input)` and `snapshot()`. It never touches DOM, canvas, audio or localStorage, so it runs in Node (tests, botplay).

## Time

- `DT = 1/60`. `g.update(dt, input)` clamps `dt` to `TUNING.maxDt` (1/30), runs at most **2** fixed steps, then drops any remainder. Non-finite or negative dt is ignored.
- `RNG`: `createRng(seed)` (`src/core/rng.js`), methods `next`, `int`, `chance`, `pick`. All randomness (spawn point choice, pickup drops, taunt lines) goes through it. Same seed, level and input stream gives an identical run.

## Input shape

`{ mx, my, ax, ay, fire, throwPressed, startPressed }`: move vector, aim vector, scanner held, grenade one-frame edge, skip-intro edge. Browser: `src/core/input.js` (+ `src/ui/touch.js`). Bot: `src/sim/autopilot.js` `createBot({ skill }).decide(g)`.

## State

`g.state`: `intro` -> `play` <-> `intermission` -> `victory` | `defeat`. Only `game.js` writes `g.state` and `g.outcome` (`{ win, reason, t }`, reasons `registers_destroyed` / `all_waves_cleared`). Lose is checked before win in the same tick. Lose rule per level: `loseWhen: 'all'` (every register dead) or `'any'` (first register dead).

## Entities

`g.spawn(kind, props)` creates `{ id, kind, x, y, vx, vy, r, hp, maxHp, team, face, pose, frame, dead, ttl, st }`. Position is the centre; hitboxes are circles whose radius comes from `TUNING`, not sprite size. Kinds: `player`, `register`, `mouse`, `pete`, `projectile`, `grenade`, `pickup`. Teams: `store`, `vermin`, `neutral`. Dead non-register, non-player entities are compacted every 32 ticks. Entity cap `TUNING.entityCap = 120`.

## Systems (tick order in play)

| Order | Function | File | Notes |
|---|---|---|---|
| 1 | `updatePlayer` | `player.js` | speed 90, hp 5, 0.4 s hit invulnerability, downed for 2 s then respawn with 1.5 s invulnerability, tile slide via `resolveCircle` |
| 2 | `tryFireScanner` | `weapons.js` | projectile, cooldown 0.14, dmg 1, range 220, infinite |
| 3 | `tryThrowBawlz` | `weapons.js` | lobbed, cooldown 0.6, dmg 4, fuse 0.9, splash radius 28 with linear falloff, uses `g.ammo.bawlz` (no-op at 0) |
| 4 | `updateProjectiles/Grenades/Pickups` | `weapons.js` | projectiles die on solids; grenades ignore solids while airborne and bounce once; pickups `bawlz` (cap 99) and `hp` |
| 5 | `updateMice` | `enemies.js` | follow flow field, blend toward player within 48 px, bite registers |
| 6 | `updatePete` | `pete.js` | phases by hp (66% / 33%), dash, spawns mice every 10 s / phase, chases player in phase 2+ |
| 7 | wave scheduler | `waves.js` | see below; flow field rebuilt when wave index changes |
| 8 | taunts | `taunts.js` | Christopher/Pete lines on triggers with 3 s gap and priority |

Damage goes through `g.damage(target, n, src)` which emits `hit`, handles register loss (`register_lost`, flow rebuild), player downing, kills (score 25 mouse / 500 Pete, drop roll using `dropChance` and weighted `pickupTable`).

## Wave scheduler

Per wave: `delay`, then each group spawns `count` entities every `every` seconds at its `spawn` id (`any` = random). When all spawned and no vermin alive: add `clearBonus`, emit `wave_clear`, enter `intermission` (`level.intermission` s), start next. After the final wave spawns out and vermin are dead, `checkWin` fires. Pete: one per game, refuses to spawn twice.

## Flow field

`buildFlowField(level, liveRegisters)` (`levels/level.js`): BFS over walkable tiles from cells adjacent to live registers; `step(x, y)` returns a unit vector. Shared by all vermin; rebuilt only on `register_lost` and wave start.

## Events

`src/core/events.js`: `bus.on(type, fn)` returns an unsubscribe; `'*'` listens to all. Canonical names are in `EVENTS` in `defs.js`. Emission faults are swallowed by `g.emit`.

## Snapshot

`g.snapshot()` returns a JSON-clean copy (player, registers, ents, pete, stats, ammo, outcome) for tests and tools.

## Tests

`test/sim/*.test.mjs`: api, boundary, bus-fault, determinism, downed, game, pete, registers, scores, taunts, waves, weapons, winlose. Run `node --test test/sim/*.test.mjs`.
