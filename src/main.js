import { DT } from './core/defs.js';
import { createBus } from './core/events.js';
import { loadSettings, saveSettings, sanitizeSettings } from './core/settings.js';
import { createInput } from './core/input.js';
import { fetchLevel } from './levels/load-browser.js';
import { createGame } from './sim/game.js';
import { createAudio } from './audio/audio.js';
import { createCamera } from './render/camera.js';
import { createGameParticles } from './render/particles.js';
import { createRenderer, buildArtFallback } from './render/renderer.js';
import { createBot } from './sim/autopilot.js';
import { createTouch } from './ui/touch.js';
import { createLevelMenu } from './ui/levelmenu.js';
import { createStartMenu } from './ui/startmenu.js';
import { recordScore } from './core/scores.js';
import { LEVELS } from './levels/level.js';

const qs = new URLSearchParams(globalThis.location?.search ?? '');
let settings = loadSettings();
if (qs.get('gfx') === '32bit' || qs.get('gfx') === '16bit') settings = sanitizeSettings({ ...settings, gfx: qs.get('gfx') });
const seed = Number(qs.get('seed')) || 1;
const useBot = qs.get('bot') === '1';
const autostart = qs.get('autostart') === '1';

const levelId = LEVELS.includes(qs.get('level')) ? qs.get('level') : 'store01';
const canvas = document.getElementById('game');
const bus = createBus();
const autoBot = useBot ? createBot({ skill: 1 }) : null;

async function loadArt(mode) {
  try {
    const { buildArt } = await import('./art/registry.js');
    return buildArt({ mode });
  } catch {
    return buildArtFallback({ mode });
  }
}

async function boot() {
  const level = await fetchLevel(levelId);
  let art = await loadArt(settings.gfx);
  const game = createGame({ seed, level, bus });
  const camera = createCamera(game);
  const particles = createGameParticles(bus);
  const audio = createAudio(bus, settings);
  const renderer = createRenderer(canvas, { art, bus, settings, particles });

  const menu = createLevelMenu(levelId);
  const applySettings = (next) => {
    const gfxChanged = next.gfx !== settings.gfx;
    settings = sanitizeSettings(next);
    saveSettings(settings);
    audio.applySettings(settings);
    document.body.classList.toggle('crt', settings.crt);
    if (gfxChanged) void loadArt(settings.gfx).then((a) => { art = a; renderer.setArt(a); });
  };
  document.body.classList.toggle('crt', settings.crt);
  let started = autostart || useBot;
  const startMenu = createStartMenu({
    currentId: levelId,
    getSettings: () => settings,
    onSettings: applySettings,
    onPlay: (id) => {
      const u = new URL(globalThis.location.href);
      u.searchParams.set('level', id);
      u.searchParams.set('autostart', '1');
      globalThis.location.href = u.pathname + u.search;
    },
    onResume: () => { audio.unlock(); },
    canResume: () => started && !game.outcome,
  });
  if (!started) startMenu.open('main');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (startMenu.isOpen) { if (started && !game.outcome) startMenu.close(true); }
      else { startMenu.open('main'); }
    }
  });
  bus.on('game_over', ({ win, score }) => {
    recordScore(levelId, { score: score ?? game.score, win, t: game.t });
  });
  let tauntAge = 999;
  bus.on('taunt', () => { tauntAge = 0; });

  const touch = createTouch(canvas);
  const input = createInput(canvas, () => ({
    x: camera.x, y: camera.y, lb: renderer.letterbox,
  }), {
    onGfxToggle: () => applySettings({ ...settings, gfx: settings.gfx === '16bit' ? '32bit' : '16bit' }),
  });

  let last = performance.now();
  let acc = 0;

  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    tauntAge += dt;
    game._tauntAge = tauntAge;

    camera.update();
    let inp = input.sample(game.player);
    const t = touch.sample();
    if (t.active || t.mx || t.my || t.fire) {
      inp = { ...inp, mx: t.mx || inp.mx, my: t.my || inp.my, fire: inp.fire || t.fire };
    }
    if (autoBot) inp = autoBot.decide(game);

    if (startMenu.isOpen) acc = 0;
    while (acc >= DT) {
      game.update(DT, inp);
      particles.update(DT);
      inp = { ...inp, throwPressed: false, startPressed: false };
      acc -= DT;
    }

    menu.update(game.outcome);
    renderer.draw(game, acc / DT, camera);
    audio.unlock();
    requestAnimationFrame(frame);
  }

  if (autostart && game.state === 'intro') {
    game.update(0, { startPressed: true });
  }

  window.__micromaze = {
    game,
    bus,
    settings,
    setGfx(mode) { applySettings({ ...settings, gfx: mode }); },
  };

  canvas.addEventListener('click', () => audio.unlock(), { once: true });
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e83b3b';
  ctx.font = '14px monospace';
  ctx.fillText(String(e.message || e), 20, 40);
});