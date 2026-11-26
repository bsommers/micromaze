# Implementation Plan: MicroMaze MVP

## 1. Goal
Deliver one playable zero-dep browser level: top-down store defense with scanner + Bawlz, Christopher taunts, Pete boss wave, and a runtime `16bit`/`32bit` art toggle. Contracts in `ARCHITECTURE.md` are binding.

**As-built note (post [Adversarial plan review](5751bd5f-6dae-428e-94e0-bbc04ea8d3ee)):** MVP shipped; contract pins for dt accumulator (≤2 steps), walkable counters, event-driven flow rebuild, grenade air collision, vermin-only splash (Pete included), and phase ordering are applied.

## 2. Motivation (Measured)
- Observed: empty scaffold; no fps/playtest baseline yet.
- Expected: green verify suite below; LAN tracker at `:4880`; bot clears `store01` ≥8/10 seeds.

## 3. Architecture Changes
```
Current:  factory --web stub + kits/lib
Proposed: core → sim (game/weapons/vermin/taunts) → levels/store01
          art px16|px32 → registry → render/ui/audio
          tools: validate-level, botplay, LAN tracker
```

## 4. Contracts & Schemas
See `ARCHITECTURE.md` §§4–6 (Input, Entity, LevelDef, WEAPONS, GraphicsMode, taunts, win/lose, ownership).

## 5. Global Constraints
- Deterministic Node-safe sim; zero deps; disjoint owns; parody IP rules; gfx mode never mutates sim; splash never hits registers/player; lose-before-win same tick.

## 6. Pre-Build Exhaustive Test Matrix
Full matrix in planning session (TC 1.1–6.10). Critical subset:

| ID | Dimension | Scenario | Expected | Tier | File |
|---|---|---|---|---|---|
| TC-01 | Happy | createGame(store01) | player+registers; Node-importable | smoke | `test/smoke.test.mjs` |
| TC-02 | Happy | fire scanner / throw Bawlz | projectile + splash kills mice only | unit | `test/sim/weapons.test.mjs` |
| TC-03 | Happy | mouse bites register | hp↓; register_lost when 0 | unit | `test/sim/registers.test.mjs` |
| TC-04 | Happy | final wave + pete dead | victory | integration | `test/sim/winlose.test.mjs` |
| TC-05 | Happy | loseWhen all/any | defeat rules | integration | `test/sim/winlose.test.mjs` |
| TC-06 | Happy | player hp0 | downed → respawn; not defeat | integration | `test/sim/downed.test.mjs` |
| TC-07 | Boundary | splash r±ε; ammo 0; dt 0/huge | documented inclusion; no NaN | unit | `test/sim/boundary.test.mjs` |
| TC-08 | Negative | bad LevelDef / polluted JSON | typed validate errors; no proto pollute | unit/security | `test/levels/validate.test.mjs`, `test/security/level-input.test.mjs` |
| TC-09 | Determinism | same seed+inputs 3600 ticks | deep-equal snapshots; no Math.random in sim | integration/security | `test/sim/determinism.test.mjs`, `test/security/purity.test.mjs` |
| TC-10 | Isolation | gfx 16↔32 mid-run | snapshot hash unchanged | integration | `test/art/gfx-sim-independence.test.mjs` |
| TC-11 | System | botplay store01 seeds 1..10 | ≥8 clears | system | `test/system/botplay.test.mjs` |
| TC-12 | Fault | bus handler throws | sim consistent | torture | `test/sim/bus-fault.test.mjs` |

Tie-breaks pinned: **lose before win** same tick; splash **inclusive** of radius; fixed-step only (chunked dt ≠ single large dt unless substepped). Camera/collision/flow-field/ammo UI pinned in `ARCHITECTURE.md` §3.

## 7. Tasks

### Task 0: Tracker + plan surface (done in planning)
**Files:** `package.json`, `tools/swarm-tracker/dashboard/server.mjs`, `README.md`, `docs/swarm/SWARM.md`
**Produces:** LAN tracker `:4880` with `TRACKER_ALLOW=127.0.0.1,::1,192.168.1.`
- [x] Allowlist + npm scripts
- [ ] `npm run plan` after SWARM filled → `.tracker/plan.json`

### Task 1: Core defs + failing contract tests
**Files:** `src/core/{defs,events,rng,settings}.js`, `test/smoke.test.mjs`, `test/sim/api.test.mjs`
**Produces:** W/H, TUNING, WEAPONS, PAL16/32, ART, EVENTS, TAUNTS
- [ ] Write failing TC-01 / api negatives
- [ ] Implement frozen core
- [ ] Verify: `npm test` (new tests red→green for core only)

### Task 2: LevelDef + validator
**Files:** `src/levels/{level.js,store01.json}`, `tools/validate-level.mjs`, `test/levels/*.test.mjs`, `test/security/level-input.test.mjs`
**Produces:** `loadLevel`, `validateLevel`, store01 layout (aisles + ≥3 registers + vents)
- [ ] Failing TC-08 path/schema cases
- [ ] Implement + wire CLI exit codes 0/1/2
- [ ] Verify: `node tools/validate-level.mjs src/levels/store01.json`

### Task 3: Sim core (player, weapons, win/lose, downed)
**Files:** `src/sim/{game,player,weapons}.js`, `test/sim/{weapons,winlose,downed,splash,boundary,determinism}.test.mjs`
**Produces:** `createGame` / `update` honoring Input + splash rules
- [ ] Failing TC-02..07, TC-09
- [ ] Minimal sim
- [ ] Verify: `node --test test/sim/*.test.mjs`

### Task 4: Vermin + waves + Pete
**Files:** `src/sim/{enemies,pete,waves}.js`, `test/sim/{waves,pete}.test.mjs`
**Produces:** flow-field mice, wave scheduler, 3-phase Pete
- [ ] Failing wave/pete tests
- [ ] Implement
- [ ] Verify: `npm test`

### Task 5: Taunts
**Files:** `src/sim/taunts.js`, HUD hook via bus
**Produces:** Christopher/Pete lines with prio + cooldown
- [ ] Unit: trigger selection deterministic under seed
- [ ] Verify: `npm test`

### Task 6: Art packs + registry + render
**Files:** `src/art/px16/*`, `src/art/px32/*`, `src/art/registry.js`, `src/render/*`, `test/art/*.test.mjs`
**Produces:** dual packs; `setGfx` without sim drift (TC-10)
- [ ] Failing gfx-independence tests
- [ ] Implement; `node tools/sheet.mjs` contact sheets → `out/`
- [ ] Verify: `npm test` + sheet tool

### Task 7: Audio + UI shell
**Files:** `src/audio/*`, `src/ui/*`, `src/main.js`, `index.html`, `style.css`, `src/core/input.js`
**Produces:** playable loop, mouse aim → ax/ay, menus, `__micromaze`
- [ ] Smoke load in browser via `npm start`
- [ ] Verify: `npm run lint:imports`

### Task 8: Autopilot + botplay + gates
**Files:** `src/sim/autopilot.js`, `tools/botplay.mjs`, `test/system/*`
**Produces:** TC-11 green; document verify script
- [ ] Failing botplay harness
- [ ] Bot clears store01
- [ ] Verify full suite (section 9)

## 8. Threat & Failure Model
| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Soft-lock (mice unreachable / player stuck) | Med | High | validate-level path proofs; botplay |
| Nondeterminism from Math.random / float order | Med | High | purity scan; id-ordered iteration; determinism tests |
| Splash team-kills registers | Med | High | contract + TC splash unit |
| Tracker open to WAN | Low | Med | TRACKER_ALLOW 192.168.1. + loopback only |
| Trademark / likeness risk | Med | High | parody naming; no logos; fictional manager |
| Parallel agent file collisions | High | Med | disjoint owns in SWARM; check-imports |
| Entity cap / perf cliff | Med | Med | TUNING cap + perf tier (gated) |

## 9. Verification Plan
```bash
npm run lint:imports          # 0 errors
npm test                      # all listed globs pass
node tools/validate-level.mjs src/levels/store01.json
node tools/botplay.mjs --level store01 --seeds 1,2,3,4,5,6,7,8,9,10
# optional: node tools/shot.mjs --strict …
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4880/   # expect 200
```
Expected: import lint clean; unit/integration green; validate exit 0; botplay ≥8/10 clears; tracker 200 from loopback and a 192.168.1.x client.
