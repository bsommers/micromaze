# Running MicroMaze

Requirements: a modern browser to play; Node 22+ for tooling (`tools/shot.mjs` uses Node's built-in WebSocket), Google Chrome for screenshots. No `npm install` is needed (no dependencies).

## Play

Online: https://bsommers.github.io/micromaze/

Locally:

```sh
cd /home/bill/src/fun/micromaze   # or your clone
npm start                          # http://127.0.0.1:4881/  (PORT=5000 npm start to change)
```

`tools/serve.mjs` is a tiny static server (no-store caching, path traversal blocked) bound to `0.0.0.0`, so other machines on your network can reach it at `http://<your-ip>:4881/`.

## URL parameters

| Param | Values | Effect |
|---|---|---|
| `level` | `store01` `blackfriday` `gtadrop` `backtoschool` `gpuscalper` | Level (unknown falls back to `store01`) |
| `diff` | `easy` `medium` `hard` `insane` | Difficulty (default: saved setting, else medium) |
| `size` | `1` `2` `3` | Store size multiplier (default: saved setting, else 1) |
| `gfx` | `16bit` `32bit` | Art pack (also saved) |
| `seed` | integer | RNG seed (default 1) |
| `bot` | `1` | Autopilot plays; implies autostart |
| `autostart` | `1` | Skip start menu and intro |

Example: `http://127.0.0.1:4881/?level=blackfriday&diff=insane&gfx=32bit&seed=7&bot=1`

## Controls

WASD/arrows move; mouse aims; left click (hold) or Space fires the scanner (infinite); right click, F or E throws a Bawlz grenade (limited); Enter skips the intro; G toggles gfx; Esc or P opens the menu; touch is a stick plus a fire button.

## Ports and environment

| Service | Port | Command | Notes |
|---|---|---|---|
| Game | 4881 | `npm start` | `PORT` overrides |
| Swarm tracker | 4880 | `npm run tracker` | `TRACKER_PORT`, `TRACKER_HOST` (default 0.0.0.0), `TRACKER_ALLOW` comma list of address prefixes, default `127.0.0.1,::1,192.168.1.` (`*` = anyone; use with care) |

## Test and verify

```sh
npm test                 # node --test across test/**: sim, levels, art, security, system, kits, lib (157 tests)
npm run lint:imports     # import-graph check
npm run validate         # validates store01 only
npm run botplay          # store01 seeds 1-10, needs >= 8 clears
npm run verify           # lint:imports + tests + validate every level + botplay all levels (+ tracker probe)
```

`verify.sh` prints `VERIFY OK` on success. Non-store01 botplay lines are informational. A tracker that is not running is a warning, not a failure.

## Persistence

Browser `localStorage`: `micromaze.settings` (volume, mute, gfx, CRT, difficulty, size) and `micromaze.scores` (top 10 per `level:difficulty` or `level:difficulty:2x|3x`). Clear them in dev tools to reset, or use Menu -> Top Scores -> clear.

## Deploy

GitHub Pages serves the repo root from `main` (`/.nojekyll` present, level JSON fetched with relative URLs). See [how-to.md](how-to.md#deploy-to-github-pages).
