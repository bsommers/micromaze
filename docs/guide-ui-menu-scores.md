# Guide: UI, menu, settings, scores, input

## Input (`src/core/input.js`, `src/ui/touch.js`)

`createInput(canvas, getCamera, { onGfxToggle })` converts keyboard and mouse into the sim Input `{ mx, my, ax, ay, fire, throwPressed, startPressed }`. Aim is pointer position projected to the world through the camera and letterbox, minus the player position.

| Input | Effect |
|---|---|
| WASD / arrows | move (normalised) |
| Left mouse hold, Space | `fire` (scanner) |
| Right mouse, F, E | `throwPressed` edge (Bawlz) |
| Enter or Space | `startPressed` edge (skips intro) |
| G | toggles gfx via `onGfxToggle` |
| Esc / P | handled in `main.js`: opens or closes the menu |

Touch: left 40% of the canvas is a stick, right side is fire. No grenade on touch. The bot (`?bot=1`) replaces all input.

## Start / pause menu (`src/ui/startmenu.js`)

DOM overlay `#startmenu`, styled in `style.css`. Views:

- **Main**: Resume (when a run is live), Play or Restart/Levels, Controls, Options, Top Scores.
- **Levels (Play)**: a Difficulty row (EASY..INSANE), a Store size row (1x/2x/3x) showing the combined score multiplier, then one button per level with your best score for the current level, difficulty and size. Choosing a level reloads the page with `?level=&diff=&size=&autostart=1` (a clean restart).
- **Controls**: table from the `CONTROLS` array.
- **Options**: mute, master/SFX/music sliders, gfx 16/32-bit, CRT overlay.
- **Top Scores**: per level, with a Clear scores button.

The loop freezes sim time while the menu is open. Esc or P toggles it (cannot dismiss after game over). `LEVEL_TITLES` in this file holds display names.

## End card (`src/ui/levelmenu.js`)

`createLevelMenu(currentId)` shows the end-of-level DOM card once `game.outcome` exists, with replay and next-level links (`LEVELS` order).

## Canvas UI

`src/ui/hud.js` `drawHud` (score, wave, Bawlz count, HP, register bars, taunt banner); `src/ui/screens.js` `drawScreens` (intro card, STORE SAVED, REGISTERS LOST). The HUD reads `game.ammo.bawlz` only.

## Settings (`src/core/settings.js`)

`localStorage['micromaze.settings']`, sanitised on every load and save.

| Key | Default | Range |
|---|---|---|
| `master` | 0.8 | 0..1 |
| `sfx` | 1 | 0..1 |
| `music` | 0.7 | 0..1 |
| `mute` | false | bool |
| `gfx` | `16bit` | `16bit` / `32bit` |
| `crt` | false | bool (adds `body.crt`) |
| `difficulty` | `medium` | easy/medium/hard/insane |
| `size` | 1 | 1/2/3 |

`loadSettings(storage?)` and `saveSettings(s, storage?)` accept an injected storage and never throw. URL `?gfx=`, `?diff=`, `?size=` override the saved values for that page load.

## Scores (`src/core/scores.js`)

`localStorage['micromaze.scores']` maps a key to an array of `{ score, win, t, date }`, top **10** per key, sorted descending. Key format: `<level>:<difficulty>` for 1x, `<level>:<difficulty>:2x` or `:3x` otherwise. `main.js` records on the `game_over` event with `round(rawScore * SCORE_MULT[diff] * SIZE_SCORE[size])`. API: `loadScores`, `recordScore(key, entry, storage?, now?)` (returns `{ rank, scores }`), `clearScores`, `sanitizeScores` (drops `__proto__`-style keys and malformed rows). Tests: `test/sim/scores.test.mjs`.
