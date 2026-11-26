# Purpose

MicroMaze is a small, finished-feeling browser game and a reference for building one with **zero dependencies**: ES modules, Canvas 2D, WebAudio, and Node's built-in test runner. It parodies a big-box electronics store: the player is a store tech defending checkout registers from micro-mice and boss Perring Parkway Pete, while manager Christopher taunts.

## Goals

- Playable in a static host (GitHub Pages) with no build step.
- A simulation that is **deterministic and Node-safe**, so a bot can play it headless and tests can assert outcomes.
- **Data-driven levels**: new levels are JSON, validated by `validateLevel`, with no code changes beyond registering the id.
- Two art modes (16-bit and 32-bit) that change pixels only, never gameplay.
- Difficulty as a pure transform of level data.

## Non-goals

- No 3D (the vendored `src/lib` 3D modules are unused).
- No networking or accounts; scores are local (`localStorage`).
- No npm runtime dependencies.

## Design principles

1. Sim never reads render, audio, DOM, or gfx mode; it talks out through an event bus.
2. One writer for game state: only `src/sim/game.js` sets `g.state` and `g.outcome`.
3. Fixed timestep `DT = 1/60`, at most 2 steps per frame, seeded RNG.
4. Contracts first: [../ARCHITECTURE.md](../ARCHITECTURE.md) is binding; if a module disagrees, the module is wrong.
5. Regression lessons are recorded ([LEARNINGS.md](LEARNINGS.md)). Example: a music jingle that crossed a bar line threw at module load and left a blank canvas in the browser while Node tests stayed green; this is why a headless Chrome console check exists ([how-to.md](how-to.md#headless-console-check)).
