# Guide: tooling (`tools/`, `scripts/`, `test/`)

All tools are zero-dependency Node scripts (ES modules).

| Tool | Purpose | Example |
|---|---|---|
| `tools/serve.mjs` | Static dev server; `startStatic({root, port})` is importable | `npm start` (port 4881) |
| `tools/validate-level.mjs` | Validate a LevelDef file (exit 0/1/2) | `node tools/validate-level.mjs src/levels/gtadrop.json` |
| `tools/botplay.mjs` | Headless autopilot over seeds; `--level --seeds --diff --size --skill --max-t` | `node tools/botplay.mjs --level store01 --seeds 1,2,3 --diff hard --size 2` |
| `tools/check-imports.mjs` | Verifies relative imports resolve and named imports are exported | `npm run lint:imports` |
| `tools/shot.mjs` | Headless Chrome (CDP) screenshots, scripted keys/clicks, `--strict` console-error gate | see [how-to](how-to.md#headless-console-check) |
| `tools/smoke_web.sh` | Smoke-test a shipped single-file build in `dist/` | `sh tools/smoke_web.sh dist/x.html` |
| `tools/sheet.mjs`, `tools/make-sheets.mjs` | Art contact sheets to `out/previews/` | `node tools/make-sheets.mjs` |
| `tools/contact_sheet.sh` | ImageMagick montage of screenshots | `sh tools/contact_sheet.sh out.jpg 3 a.png b.png` |
| `tools/export-characters.mjs` | Regenerate `assets/characters/` | `node tools/export-characters.mjs` |
| `tools/swarm-tracker/` | Swarm progress dashboard (`npm run tracker`, port 4880) and `npm run plan` | see below |

## Verify gate (`scripts/verify.sh`, `npm run verify`)

1. `npm run lint:imports`
2. `npm test`
3. `validate-level` on every `src/levels/*.json`
4. `npm run botplay` (gating: store01, seeds 1-10, >= 8 clears) then botplay seeds 1-5 on the other four levels (informational)
5. Probe `http://127.0.0.1:4880/` (warn only)
6. Prints `VERIFY OK`; any failing gated step exits non-zero.

## Test suite (`npm test`, 157 tests)

`node --test` over `test/smoke.test.mjs`, `test/kits`, selected `test/lib`, and `test/{sim,levels,art,security,system}/*.test.mjs`. Highlights: determinism, win/lose ordering, bus faults, level validation and difficulty/size transforms, prototype-pollution rejection (`test/security`), gfx/sim independence, character library export, botplay clears >= 8/10 (`test/system/botplay.test.mjs`), music module load (`test/system/music-load.test.mjs`). Single file: `node --test test/sim/waves.test.mjs`.

## Swarm tracker

`npm run tracker` runs `tools/swarm-tracker/dashboard/server.mjs` with `TRACKER_ROOT=$PWD`, host `0.0.0.0`, port 4880. Access is limited to client addresses matching `TRACKER_ALLOW` prefixes (default `127.0.0.1,::1,192.168.1.`). State lives in the git-ignored `.tracker/`. Swarm process docs: [swarm/SWARM.md](swarm/SWARM.md), [PLAYBOOK.md](PLAYBOOK.md).

## Output locations

`out/` (screenshots, previews) and `.tracker/` are git-ignored. `tools/shot.mjs` honours `SCRATCH` for temp files; keep build output off `/tmp` (use `/datanapps`).
