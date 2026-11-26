# Implementation Plan: MicroMaze MVP

## 1. Goal
Deliver one playable zero-dep browser level: top-down store defense with scanner + Bawlz, Christopher taunts, Pete boss wave, and a runtime `16bit`/`32bit` art toggle. Contracts in `ARCHITECTURE.md` are binding.

**As-built:** MVP + adversarial pins + full TC matrix + `scripts/verify.sh` executed.

## 2. Motivation (Measured)
- Observed (post-build): botplay **10/10** clears; `npm test` green; tracker `:4880` LAN.
- Expected: gates in §9 stay green.

## 3. Architecture Changes
```
factory --web stub → core/sim/levels/art/render/audio/ui + validate/botplay/verify
```

## 4. Contracts & Schemas
See `ARCHITECTURE.md` §§4–6.

## 5. Global Constraints
Deterministic Node-safe sim; zero deps; parody IP; gfx ≠ sim; splash vermin-only; lose-before-win.

## 6. Pre-Build Exhaustive Test Matrix
| ID | Status | File |
|---|---|---|
| TC-01 | done | `test/sim/api.test.mjs` |
| TC-02 | done | `test/sim/weapons.test.mjs` |
| TC-03 | done | `test/sim/registers.test.mjs` |
| TC-04/05 | done | `test/sim/winlose.test.mjs` |
| TC-06 | done | `test/sim/downed.test.mjs` |
| TC-07 | done | `test/sim/boundary.test.mjs` |
| TC-08 | done | `test/levels/validate.test.mjs`, `test/security/level-input.test.mjs` |
| TC-09 | done | `test/sim/determinism.test.mjs`, `test/security/purity.test.mjs` |
| TC-10 | done | `test/art/gfx-sim-independence.test.mjs` |
| TC-11 | done | `test/system/botplay.test.mjs` |
| TC-12 | done | `test/sim/bus-fault.test.mjs` |

## 7. Tasks
### Task 0: Tracker + plan — [x]
### Task 1: Core defs — [x]
### Task 2: LevelDef + validator — [x]
### Task 3: Sim core — [x]
### Task 4: Vermin + waves + Pete — [x]
### Task 5: Taunts — [x]
### Task 6: Art + render — [x]
### Task 7: Audio + UI shell — [x]
### Task 8: Autopilot + botplay + gates — [x]

## 8. Threat & Failure Model
Unchanged; mitigations verified via botplay, purity scan, splash tests, TRACKER_ALLOW.

## 9. Verification Plan
```bash
npm run verify   # lint + test + validate + botplay (+ tracker probe)
```
