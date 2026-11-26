# MicroMaze documentation hub

| Doc | Read it for |
|---|---|
| [purpose.md](purpose.md) | What the game is, who it is for, design principles |
| [architecture.md](architecture.md) | Module map, data flow, determinism, state machine |
| [running.md](running.md) | Install, serve, URL params, ports, tests, deploy |
| [how-to.md](how-to.md) | Recipes: add a level / difficulty tweak / character / SFX / music, export library, botplay, verify, headless console check, Pages, LAN tracker |
| [guide-sim.md](guide-sim.md) | The simulation (`src/sim`, `src/core`) |
| [guide-levels.md](guide-levels.md) | LevelDef schema, validation, difficulty |
| [guide-ui-menu-scores.md](guide-ui-menu-scores.md) | Menu, HUD, settings, scores, input |
| [guide-art-audio.md](guide-art-audio.md) | Art packs, renderer, SFX, music |
| [guide-tooling.md](guide-tooling.md) | `tools/`, `scripts/verify.sh`, tracker |

Diagrams: [diagrams/ascii_architecture.txt](diagrams/ascii_architecture.txt), and Mermaid + draw.io pairs `module_architecture`, `game_loop_sequence`, `wave_level_dataflow` in [diagrams/](diagrams/).

Pre-existing docs (kept as-is): [../ARCHITECTURE.md](../ARCHITECTURE.md) (binding contracts), [CHARACTERS.md](CHARACTERS.md), [KITS.md](KITS.md), [LEARNINGS.md](LEARNINGS.md), [PLAYBOOK.md](PLAYBOOK.md), [plan.md](plan.md), [swarm/SWARM.md](swarm/SWARM.md).

Vendored code: `src/kits/` (art-kit, audio-kit, fx-kit, character-kit, docs-kit, raytrace-kit; factory kits used for pixel buffers and synth) and `src/lib/` (generic 2D/3D game libraries; only 2D helpers are exercised, 3D ones are unused). Treat both as third-party; see [KITS.md](KITS.md).
