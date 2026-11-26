# Guide: art, rendering, audio

## Art packs (`src/art`)

Sprites are generated in code with the vendored `PixBuf` kit (`src/kits/art-kit`), not loaded from image files.

- Manifest: `ART` in `src/core/defs.js` lists every sprite (`name`, `w`, `h`, `frames`, `module`). Both packs must provide every name.
- `px16/{chars,store,fx}.js` native 16-bit art; `px32/...` the same at 2x. Each exports `build()` returning `{ name: PixBuf | PixBuf[] }`.
- `registry.js` `buildArt({ mode })` merges the three modules, caches per mode, and exposes `get(name, frame)`, `frames(name)`, `has(name)`, `names()`. Missing names return a tinted outline box instead of throwing.
- Palettes: `PAL16`, `PAL32` in `defs.js`.
- Switching mode (menu, `G`, `?gfx=`) calls `loadArt` then `renderer.setArt`; gameplay is unaffected (`test/art/gfx-sim-independence.test.mjs`).

Entities: `player_*`, `mouse`, `pete`, `projectile`, `grenade`, `pickup_bawlz`, `pickup_hp`, `register`, `tile_*` (floor, wall, shelf, counter, door), `fx_explode`, `fx_spark`.

## Renderer (`src/render`)

- `renderer.js` `createRenderer(canvas, { art, bus, settings, particles })`: draws tiles, entities (via `spriteName(e)`), particles, HUD and screens to a 320x180 logical buffer, scaled with letterbox to the canvas. `draw(game, alpha, camera)`.
- `camera.js`: follows the player, clamped to the world; exposes the letterbox for pointer mapping.
- `particles.js`: `createGameParticles(bus)` reacts to `fx` events (explosions, sparks) using the fx-kit.

## Character library

`tools/export-characters.mjs` renders the character sprites to `assets/characters/` (`px16/`, `px32/`, sheets, `library.json`). Lore and character list: [CHARACTERS.md](CHARACTERS.md).

## Audio (`src/audio`)

- `audio.js` `createAudio(bus, settings)`: builds master/SFX/music gain nodes, listens for bus `sfx` and `music` events, unlocks on first user gesture (`unlock()`), and applies settings (`applySettings`: mute, master, sfx, music). Returns inert stubs if no `AudioContext` exists (Node).
- `sfx.js` `SFX_TABLE`: recipes (oscillator, duration, gain, frequency sweep, filters) for names in `SFX` (`scan`, `throw`, `explode`, `hit`, `kill`, `pickup`, `hurt`, `down`, `register_hit`, `wave`, `pete`, `taunt_beep`, `win`, `lose`). Positional pan from the event `x`.
- `music.js` `MUSIC_TABLE`: `title`, `victory` (short `jingle` strings), `store` and `boss` (looping multi-channel songs with drums). The game emits `music` `store` on boot, `victory` or `title` on game over.
- Synth kit: `src/kits/audio-kit` (`describeSfx`, `describeSong`, `scheduleVoices`, `scheduleSong`, `jingle`, `arp`).

### Bar-line rule and the blank-canvas bug

Song patterns must fill whole bars. A jingle that crossed a bar line threw when `music.js` was imported, which aborted module loading in the browser and left a blank canvas, while Node unit tests that did not import the module stayed green. Guards: `test/system/music-load.test.mjs` and the headless Chrome console check in [how-to.md](how-to.md#headless-console-check).
