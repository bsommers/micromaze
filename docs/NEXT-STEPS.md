# Next steps (as of 2026-11-27)

Factory promotion is landed (game-factory branch `multilang`, 316/316 tests):
- `web.*` capabilities (validate-level, botplay, sheet, verify, serve) on registry/HTTP/MCP/clients; openapi + MCP parity asserted in `test/webtools.test.mjs`.
- `--web` scaffolds ship generic `tools/validate-level.mjs`, `tools/botplay.mjs`, `scripts/verify.sh` (levels discovered from `src/levels/*.json`), the new `sheet.mjs`, and mount the start menu in `main.js` (smoke-checked in headless Chrome, no console errors).
- Scaffolds drop the 7 `test/lib` tests that read factory-root `spec/` (213 tests pass in a fresh scaffold).
- pixbuf-web adapter exports px32 variants and per-frame PNGs. MicroMaze `scripts/verify.sh` loops over levels.

## Still open
- Character lore stays in `tools/export-characters.mjs` (game-specific; no generic convention yet).
- Menu smoke covered only main view; Controls/Options/Scores/level picker not clicked through.
- draw.io files are only XML-parsed; "Node 22+" in running.md is a guess; touch can't throw Bawlz.
- gtadrop botplay clears 3/5 at medium (informational in verify.sh).
