# Swarm manifest — MicroMaze

Single source of truth for the agent swarm. `npm run plan` → `docs/swarm/prompts/<id>.md` + `.tracker/plan.json`.

## @meta
project: MicroMaze
tagline: Defend the registers from Perring Parkway Pete's micro-mice
root: /home/bill/src/fun/micromaze
tracker_port: 4880

## @preamble
You are subagent `{{id}}` ({{name}}) in a parallel swarm building **MicroMaze** in `{{root}}`. Model tier: {{model}}.

Rules:
1. `ARCHITECTURE.md` is the binding contract. Grep `^## ` then read only needed sections. `docs/plan.md` has the task order and test matrix.
2. Own ONLY: {{owns}}. You may also write tests under `test/` for your module, your report, and `out/` scratch. Never edit files you do not own. Guard missing imports with fallbacks.
3. Report: `node tools/swarm-tracker/bin/track.mjs {{id}} start|progress|done|blocked|failed "…"`.
4. Verify for real. Cap concurrency ~4. Prefer flash/sonnet for implementation; opus only for contract edits.
5. Finish with `docs/swarm/reports/{{id}}.md` (What I built · Verification · Deviations · Mistakes · Learnings · Requests).
6. IP: parody store only — no Micro Center logos; BAWLZ parody; fictional Christopher; Pete = KÄSEKRIEG rat.

## core-defs | sonnet | 0 | lead | Core defs
owns: src/core/defs.js, src/core/events.js, src/core/rng.js, src/core/settings.js
Frozen constants: W/H 320x180, TUNING, WEAPONS, PAL16/PAL32, ART manifest, EVENTS, SFX, MUSIC, TAUNTS. Re-export createRng. Write failing smoke/api tests first per docs/plan.md TC-01.

## level-data | sonnet | 1 | eng | Level data
owns: src/levels/level.js, src/levels/store01.json, tools/validate-level.mjs
LevelDef load + validateLevel path proofs. store01: aisles, ≥3 registers, mouse vents, final Pete wave. CLI exit 0/1/2. Tests: test/levels/*, test/security/level-input.test.mjs.

## sim-core | sonnet | 1 | eng | Sim core
owns: src/sim/game.js, src/sim/player.js, src/sim/weapons.js
createGame/update, scanner + Bawlz, splash never hits store team, downed/respawn, win/lose (lose-before-win). Tests: test/sim/{weapons,winlose,downed,splash,boundary,determinism,api,snapshot}.test.mjs.

## sim-vermin | sonnet | 2 | eng | Vermin AI
owns: src/sim/enemies.js, src/sim/pete.js, src/sim/waves.js
Flow-field mice → registers, wave scheduler, Pete phases 1–3. Depends on sim-core spawn/damage hooks (use fallbacks until present).

## sim-taunts | haiku | 2 | eng | Manager taunts
owns: src/sim/taunts.js
createTaunts; Christopher + Pete lines; prio + tauntGap; seeded pick.

## art-16 | sonnet | 2 | art | 16-bit art
owns: src/art/px16/chars.js, src/art/px16/store.js, src/art/px16/fx.js
PixBuf pack matching defs.ART; ≤64 colours; 1px outline; sheet.mjs preview.

## art-32 | sonnet | 2 | art | 32-bit art
owns: src/art/px32/chars.js, src/art/px32/store.js, src/art/px32/fx.js
Richer pack; 32×32 sprites; same ART names as px16.

## render | sonnet | 3 | eng | Render
owns: src/art/registry.js, src/render/renderer.js, src/render/camera.js, src/render/particles.js
buildArt({mode}), createRenderer, setGfx without sim drift. Test: test/art/gfx-sim-independence.test.mjs.

## audio | sonnet | 3 | eng | Audio
owns: src/audio/audio.js, src/audio/sfx.js, src/audio/music.js
audio-kit recipes; bus sfx/music only.

## ui-shell | sonnet | 3 | eng | UI shell
owns: src/main.js, index.html, style.css, src/core/input.js, src/ui/hud.js, src/ui/screens.js, src/ui/touch.js
Fixed-step loop, mouse aim→ax/ay, menus, Christopher banner, window.__micromaze, ?gfx= ?autostart=.

## qa-bot | sonnet | 4 | qa | Autopilot QA
owns: src/sim/autopilot.js, tools/botplay.mjs
Bot clears store01 ≥8/10 seeds skill 1. test/system/botplay.test.mjs. Run full verify gates from ARCHITECTURE.md §7.
