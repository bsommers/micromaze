# Next steps — factory promotion (as of 2026-11-26)

## Done this session (uncommitted in ~/src/fun/game-factory, branch `multilang`)
- `factory-core/webtools/capabilities.mjs`: `web.validate-level`, `web.botplay`, `web.sheet`, `web.verify`, `web.serve`.
  Each runs the project's own `tools/*.mjs` or `scripts/verify.sh` via `execFile` (no shell). `web.serve` is plan-only unless `yes:true`.
- Registered in `factory-core/index.mjs`; `test/webtools.test.mjs` runs against ../micromaze.
- `tools/web/serve.mjs` and micromaze `tools/serve.mjs` read `SERVE_HOST` (default 0.0.0.0).
- Regenerated Go/Rust/Python clients (`bin/factory call clients.generate '{}'`). Factory tests: 228/228.
- Nothing committed or pushed. The user's own changes (docs/CHECKPOINT.md, docs/PLAN-3D-ACTION.md, raw_spec/) stay unstaged.

## 1. Land it (needs the user's OK to commit/push)
1. Commit factory: webtools module + test + index + serve.mjs + regenerated clients (stage by path).
2. Commit micromaze `tools/serve.mjs` (SERVE_HOST), keep behaviour unchanged by default.

## 2. verify.sh generalization
- Replace the hardcoded level list (`blackfriday gtadrop backtoschool gpuscalper`) with a loop over `src/levels/*.json` ids.
- Ship a generic `scripts/verify.sh` in `templates/web-project` (lint:imports, test, validate each level, botplay).
- Add a `web.verify` test on a scaffolded project (the current test skips it because it is slow).

## 3. Scaffold the tools into new web projects
- Scaffolded projects only copy `factory/tools/*.{sh,mjs}`. `tools/web/*` (serve, sheet, shot, check-imports) does not reach them.
  Copy `tools/web` into `<project>/tools` so `web.*` works on a fresh `factory project new --web`.
- Add `tools/validate-level.mjs` and `tools/botplay.mjs` templates (MicroMaze versions import game modules; make them
  read `src/levels/*` through the template's `core/levels` API).
- Replace the factory `tools/web/sheet.mjs` with the newer MicroMaze copy (creates the nested out dir).

## 4. Adapter gaps (pixbuf-web)
- px32 variants, character lore, per-frame PNGs and sheet export still live in `tools/export-characters.mjs`.

## 5. Known gaps to close
- 33 `test/lib/*` tests fail inside a scaffolded project (they import factory-root `test/helpers`). Inline or ship the helpers.
- Start menu in scaffolded games has never run in a browser. Use claude-in-chrome, or `tools/shot.mjs`, for a smoke pass.
- Unverified: draw.io files are only XML-parsed; "Node 22+" in running.md is a guess; touch can't throw Bawlz.

## 6. Surface parity (designing-uniform-surfaces)
- Expose `web.*` over HTTP and MCP with a test that each capability appears in `/openapi.json` (the clients drift test covers part of this).
- Document the five capabilities in the factory README and CHANGELOG.
