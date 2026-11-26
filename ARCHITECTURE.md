# MicroMaze — Architecture & Contracts

Binding execution contract. If a module disagrees with this file, the module is wrong. Record deviations in `docs/swarm/reports/<id>.md`.

> Documentation hub (guides, how-to, diagrams): [docs/README.md](docs/README.md)

## 1. Goal
Ship one playable top-down pixel wave-defense level: a parody big-box electronics store. The player (store tech) guards checkout registers from micro-mice with a **price-scanner gun** and lobbed **Bawlz** drink cans. Manager **Christopher** yells taunts. Boss **Perring Parkway Pete** leads the vermin. Runtime toggle **`16bit` | `32bit`** pixel art. Later levels are data-only `LevelDef` JSON.

## 2. Motivation (measured)
- Observed: scaffold only (`src/main.js` stub); **no baseline fps / token / playtest numbers**.
- Target (proposed, unmeasured until first green botplay): 60 fps with ≤120 live entities; `npm test` + `lint:imports` + `validate-level` + `botplay` green; tracker live on LAN.

## 3. Architecture
```
input (browser) → createGame.update(dt, Input) → bus.emit → render | audio | ui
                     ↑ Node-safe                     ↑ pure view of snapshot
LevelDef JSON ───────┘
GraphicsMode switches art packs only; sim/hitboxes identical.
```

Stack: zero-dep ES modules (game-factory `--web`). Keep `src/kits/**` and `src/lib/**` (art-kit, audio-kit, fx-kit, collision2d, autopilot-kit). Do **not** import 3D libs (`combat3d`, `boss3d`, …).

Coordinates: logical **320×180** pixels, x right, y down, origin top-left. Entity `(x,y)` = **centre** (pixel centres). Hitboxes = circles (`r` from `TUNING`, never sprite size). 16 px tiles. Sim step `DT = 1/60`. `g.update` accumulates at most **two** steps then **drops** leftover (input dt clamped by `TUNING.maxDt`).

**Camera / aim:** `camera = { x, y }` top-left of the 320×180 view; `camera.x = clamp(player.x - W/2, 0, worldW - W)` (same for y). Pointer → world via camera + canvas letterbox/scale in `input.js`. Sim never reads gfx mode. `throwPressed` is a one-frame edge; ammo 0 → throw no-op.

**Tile collision:** **blocking** = `wall|shelf`. **walkable** = `floor|door|counter`. Bodies slide on blockers; projectiles die on blockers; grenades ignore solids while `z>0`, collide when grounded (`TUNING.grenadeBounce`).

**Flow field:** one shared field to nearest live register. Rebuild on **`register_lost`** and **wave advance** only — never per-mouse BFS.

**Combat teams:** scanner + splash hit `team==='vermin'` only (mice **and** Pete). Splash: `dmg*(1-d/R)` for `d<=R`. Never damages registers/player.

**Tick order (play):** weapons → vermin → waves → taunts → **downed already applied in damage** → **lose** → **win** (win only while `state==='play'` / post-intermission play). Only `game.js` writes `g.state` / `g.outcome`.

**Ammo UI:** HUD reads `g.ammo.bawlz` only.

## 4. Contracts

### 4.1 Input & game
```js
/** @typedef {{ mx:number, my:number, ax:number, ay:number,
 *   fire:boolean, throwPressed:boolean, startPressed?:boolean }} Input */
// mx/my ∈ [-1,1] (sim normalises diagonals); ax/ay aim in world space; (0,0)=keep last aim
// fire held → scanner auto at cooldown; throwPressed edge → one Bawlz lob

export function createGame({ seed = 1, level /*LevelDef*/, bus, weapons = WEAPONS });
// g.update(dt, input)
// Read-only: g.t, g.state:'intro'|'play'|'intermission'|'victory'|'defeat',
//   g.waveIdx, g.waveCount, g.score, g.player, g.ents, g.registers, g.pete,
//   g.ammo:{bawlz:number}, g.outcome:null|{win:boolean, reason, t}, g.rng, g.bus,
//   g.stats:{shots,hits,kills,thrown}
// Hooks: g.spawn, g.damage, g.emit, g.fx, g.popup, g.snapshot()→JSON
```

### 4.2 Entities
```js
/** @typedef {'player'|'register'|'mouse'|'pete'|'projectile'|'grenade'|'pickup'} EntityKind */
/** @typedef {{ id:number, kind:EntityKind, x:number, y:number, vx:number, vy:number, r:number,
 *   hp:number, maxHp:number, team:'store'|'vermin'|'neutral', face:number, pose:string, frame:number,
 *   dead:boolean, ttl:number|null, st:object }} Entity */
// player.st:{ cd, inv, downT }  register.st:{ regId }
// mouse.st:{ target, bite }     pete.st:{ phase:1|2|3, spawnT, dashT }
// projectile.st:{ weapon:'scanner', owner, dmg }  grenade.st:{ fuse, z, vz }
// pickup.st:{ give:'bawlz'|'hp', n }
```

### 4.3 LevelDef / WaveDef
```js
/** @typedef {{ id:string, name:string, version:1,
 *   tiles:string[], legend:Record<string,'floor'|'shelf'|'wall'|'counter'|'door'>,
 *   playerSpawn:{x:number,y:number}, registers:{id:string,x:number,y:number,hp:number}[],
 *   spawns:{id:string,x:number,y:number}[], loseWhen:'all'|'any',
 *   waves:WaveDef[], intermission:number, startAmmo:{bawlz:number},
 *   pickupTable:{give:'bawlz'|'hp', n:number, w:number}[], dropChance:number,
 *   taunts?:Partial<Record<TauntTrigger,string[]>> }} LevelDef */
/** @typedef {{ id:string, delay:number, clearBonus:number,
 *   groups:{ kind:'mouse'|'pete', count:number, every:number, spawn:string|'any', hp?:number, speed?:number }[] }} WaveDef */
// loadLevel(id), validateLevel(def)→{ok,errors[]}, LEVELS:string[]
// Validator: path spawn→≥1 register; player→all registers; unique ids; exactly one pete group on final wave.
```

### 4.4 Weapons
```js
// defs.WEAPONS — numbers only here / TUNING
// scanner: projectile, infinite ammo, cooldown~0.18, dmg 1, speed 260, range 200
// bawlz:   lobbed, counted ammo, cooldown~0.6, dmg 4, fuse~0.9, splashR~28
// Splash falloff linear; NEVER damages registers or player.
```

### 4.5 GraphicsMode
```js
/** @typedef {'16bit'|'32bit'} GraphicsMode */
// buildArt({ mode }) → { mode, scale:1|2, get, frames, has, names }
// px16: ≤64 colours, 1px outline, 16×16 sprites → draw buffer 320×180
// px32: ≤256 colours, richer ramps, 32×32 sprites → draw buffer 640×360
// Switch: settings.gfx, key G, ?gfx=, __micromaze.setGfx — sim snapshot unchanged
```

### 4.6 Taunts & win/lose
```js
/** @typedef {'wave_start'|'wave_clear'|'register_hit'|'register_lost'|'player_down'|
 *   'pete_arrive'|'pete_phase'|'pete_down'|'idle'|'streak'|'victory'|'defeat'} TauntTrigger */
// bus 'taunt': { speaker:'christopher'|'pete', text, dur, trigger, prio:0|1|2 }
// Win: final wave spawned-out + no vermin + pete dead → 'victory' (reason 'all_waves_cleared')
// Lose: loseWhen 'all'|'any' on registers → 'defeat' ('registers_destroyed')
// Same-tick: lose checked before win. Player hp≤0 → downed TUNING.downTime, respawn at playerSpawn (not game-over).
```

Events (sim emits): `wave_start` `wave_clear` `spawn` `shot` `hit` `kill` `register_hit` `register_lost` `throw` `explode` `pickup` `player_down` `pete_phase` `taunt` `sfx` `music` `game_over`.

## 5. Global constraints
1. Determinism: seeded `createRng` only; iterate entities by id; same seed+inputs ⇒ equal `snapshot()`.
2. Node-safe: `src/sim`, `src/levels`, `src/art`, `src/core` (except `input.js`), pure audio tables — no DOM at import.
3. Zero runtime deps. `npm test` = node:test. `tools/check-imports.mjs` → 0 errors.
4. Disjoint owns (§6). Always frozen: `src/kits/**`, `src/lib/**`. Tracker tooling may gain LAN allowlist fixes. **Do not freeze `input.js` with core-defs** — ui-shell owns it. `defs.js` publishes TUNING keys + ART names before art/sim; TUNING *values* editable by sim-core only after wave 0. Swarm: **phase N starts only when phase N−1 agents are done** (sim-vermin after sim-core). Only `game.js` writes win/lose. Factory proposals → `../game-factory/proposed/micromaze/`.
5. IP: parody store **"MICRO MAZE"** — no Micro Center wordmark/logo/trade-dress. **"BAWLZ"** plain can lettering only (no bottle silhouette copy). **Christopher** fiction. **Pete**: original PixBuf rat in this repo (house character vibe; do not copy `colby-rig.mjs` verbatim).
6. Tracker binds `0.0.0.0` only with explicit `TRACKER_ALLOW` prefixes (default loopback). Prefer keep `192.168.1.` on LAN builds; never `ALLOW=*`.
7. Prefer `??` over `||`. Bus subscribe at construction.

## 6. Module ownership
| id | owns |
|---|---|
| core-defs | `src/core/{defs,events,rng,settings}.js` |
| sim-core | `src/sim/{game,player,weapons}.js` |
| sim-vermin | `src/sim/{enemies,pete,waves}.js` |
| sim-taunts | `src/sim/taunts.js` |
| level-data | `src/levels/{level.js,store01.json}`, `tools/validate-level.mjs` |
| art-16 | `src/art/px16/{chars,store,fx}.js` |
| art-32 | `src/art/px32/{chars,store,fx}.js` |
| render | `src/art/registry.js`, `src/render/{renderer,camera,particles}.js` |
| audio | `src/audio/{audio,sfx,music}.js` |
| ui-shell | `src/main.js`, `index.html`, `style.css`, `src/core/input.js`, `src/ui/{hud,screens,touch}.js` |
| qa-bot | `src/sim/autopilot.js`, `tools/botplay.mjs` |

## 7. Verification gates
1. `npm run lint:imports`
2. `npm test`
3. `node tools/validate-level.mjs src/levels/store01.json`
4. `node tools/botplay.mjs --level store01 --seeds 1,2,3` (≥8/10 clear at skill 1 when full seed set)
5. `node tools/shot.mjs … --strict` (optional visual; needs Chrome)
