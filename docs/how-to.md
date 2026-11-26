# How-to recipes

All commands run from the repo root (`/home/bill/src/fun/micromaze`).

## Add a level

1. Copy a template: `cp src/levels/store01.json src/levels/mylevel.json`.
2. Edit it (schema in [guide-levels.md](guide-levels.md)): `id` must be `mylevel`, keep `version: 1`, draw `tiles` (all rows the same length), set `registers`, `spawns`, `waves`. Exactly one `pete` group, on the final wave.
3. Validate: `node tools/validate-level.mjs src/levels/mylevel.json` (prints `OK mylevel N waves`).
4. Register the id in `LEVELS` in `src/levels/level.js` (loaders reject unknown ids).
5. Add a display title in `LEVEL_TITLES` in `src/ui/startmenu.js`.
6. Check the bot can play it: `node tools/botplay.mjs --level mylevel --seeds 1,2,3,4,5`.
7. Add the id to the loop in `scripts/verify.sh` (`for L in blackfriday ...`) and update the level table in README.md.
8. Try it: `npm start`, open `/?level=mylevel&autostart=1`.

## Add a difficulty tweak

Difficulty lives in `src/levels/difficulty.js`.

- Change numbers: edit the `MODS` row (`hp speed count every regHp ammo drop`) and, for scoring, `SCORE_MULT`.
- Add a knob: add the key to every `MODS` row, apply it inside `applyDifficulty` (it must stay a pure transform of a `structuredClone`; medium must stay the identity; never scale the single Pete group's count).
- Add a whole tier: append to `DIFFICULTIES`, `MODS`, `SCORE_MULT`, and the allowed list in `src/core/settings.js` (`sanitizeSettings`).
- Test: `node --test test/levels/difficulty.test.mjs`, then `node tools/botplay.mjs --level store01 --seeds 1,2,3 --diff insane`.

## Add a store-size tweak

Size lives in `src/levels/size.js` (`SIZES`, `SIZE_SCORE`, `applySize`). `applySize` must remain a pure transform of a `structuredClone`, with 1x as the identity, and must never duplicate Pete. To scale another field, multiply it inside `applySize`. Composition order (keep it): `applyDifficulty(applySize(level, size), diff)`. Test: `node --test test/levels/size.test.mjs`, then `node tools/botplay.mjs --level store01 --seeds 1,2,3 --size 2`.

## Add a character or art

Sprites are code, drawn into pixel buffers (see [guide-art-audio.md](guide-art-audio.md)).

1. Add an entry to the `ART` manifest in `src/core/defs.js` (`name`, `w`, `h`, `frames`, `module` such as `px16/chars`).
2. Implement the same name in **both** `src/art/px16/<module>.js` and `src/art/px32/<module>.js` (the 32-bit pack is 2x). Missing names render as a tinted fallback box.
3. Use it from `src/render/renderer.js` (`spriteName(e)` maps entity to art name).
4. Add it to `CHARACTERS` in `tools/export-characters.mjs` if it is a character, then re-export (below).
5. Preview: `node tools/make-sheets.mjs` (writes `out/previews/px16/*.png`), run `npm test` (`test/art/*`).

## Add SFX or music

SFX: add the name to `SFX` in `src/core/defs.js`, add a recipe `name: (v) => v({ src, dur, gain, f })` to `SFX_TABLE` in `src/audio/sfx.js`, and emit it from the sim with `g.emit('sfx', { name })`.

Music: add the name to `MUSIC` in `src/core/defs.js`, a song to `MUSIC_TABLE` in `src/audio/music.js` (a `jingle('C4:4 ...', { bpm })` or a multi-channel loop), and emit `g.emit('music', { name })`.

Bar-line rule: every pattern's note lengths must sum to whole bars. A jingle that crosses a bar line throws during module load, which blanks the browser canvas (see [LEARNINGS.md](LEARNINGS.md)). Always run:

```sh
node --test test/system/music-load.test.mjs
```

and the [headless console check](#headless-console-check).

## Export the character library

```sh
node tools/export-characters.mjs
```

Deterministically regenerates `assets/characters/` (`px16/`, `px32/` PNG frames, `sheet.png`, `library.json`, `README.md`). Do not hand-edit those files. Details in [CHARACTERS.md](CHARACTERS.md).

## Run botplay

```sh
npm run botplay                                              # store01, seeds 1..10
node tools/botplay.mjs --level gpuscalper --seeds 1,2,3 --diff hard
node tools/botplay.mjs --level store01 --seeds 1 --max-t 120 --skill 1
```

Flags: `--level`, `--seeds a,b,c`, `--diff easy|medium|hard|insane`, `--size 1|2|3`, `--skill`, `--max-t` (sim seconds, default 180). Exit 0 needs at least 80% of seeds cleared (or 1 win when 3 or fewer seeds). In the browser: `?bot=1`.

## Run verify

```sh
npm run verify
```

Runs `lint:imports`, `npm test`, validates every `src/levels/*.json`, botplay store01 (gating) and the other four levels (informational), probes the tracker on :4880 (warning only), then prints `VERIFY OK`.

## Headless console check

Catches browser-only load failures that Node tests miss (the blank-canvas bug). Needs Google Chrome.

```sh
mkdir -p out/shots
node tools/shot.mjs --url "/index.html?autostart=1&seed=1" --out out/shots/console.png --wait 2000 --strict
```

`tools/shot.mjs` starts its own static server, drives headless Chrome over CDP, and with `--strict` exits non-zero on any console error or uncaught exception. Success prints JSON with `"ok": true`, `"console": []`, `"errors": []`. Check every level:

```sh
for L in store01 blackfriday gtadrop backtoschool gpuscalper; do
  node tools/shot.mjs --url "/index.html?level=$L&autostart=1" --out out/shots/$L.png --wait 2000 --strict | grep '"ok"'
done
```

## Deploy to GitHub Pages

The site is the repo root on `main`; `.nojekyll` is committed and levels are fetched relatively, so it works under `/micromaze/`.

```sh
npm run verify
git push origin main
```

One-time setup: repo Settings -> Pages -> Source: Deploy from a branch -> `main` / `(root)`. Then open https://bsommers.github.io/micromaze/ and run the headless check against the live URL if desired:
`node tools/shot.mjs --url "https://bsommers.github.io/micromaze/?autostart=1" --out out/shots/live.png --wait 3000 --strict`.

## Run the game and tracker on the LAN

```sh
npm start                                   # game on 0.0.0.0:4881
npm run tracker                             # swarm dashboard on 0.0.0.0:4880
TRACKER_ALLOW=127.0.0.1,::1,192.168.1.,10.0.0. npm run tracker   # widen allowlist
```

The game server has no allowlist; only expose it on trusted networks. The tracker only answers clients whose address matches `TRACKER_ALLOW` prefixes (default loopback + `192.168.1.`); `TRACKER_ALLOW=*` opens it to anyone, so avoid that.
