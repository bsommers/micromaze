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

const qs = new URLSearchParams(globalThis.location?.search ?? '');
let settings = loadSettings();
if (qs.get('gfx') === '32bit' || qs.get('gfx') === '16bit') settings = sanitizeSettings({ ...settings, gfx: qs.get('gfx') });
const seed = Number(qs.get('seed')) || 1;
const useBot = qs.get('bot') === '1';
const autostart = qs.get('autostart') === '1';

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
  const level = await fetchLevel('store01');
  let art = await loadArt(settings.gfx);
  const game = createGame({ seed, level, bus });
  const camera = createCamera(game);
  const particles = createGameParticles(bus);
  const audio = createAudio(bus, settings);
  const renderer = createRenderer(canvas, { art, bus, settings, particles });

  let tauntAge = 999;
  bus.on('taunt', () => { tauntAge = 0; });

  const input = createInput(canvas, () => ({
    x: camera.x, y: camera.y, lb: renderer.letterbox,
  }), {
    onGfxToggle: () => {
      settings.gfx = settings.gfx === '16bit' ? '32bit' : '16bit';
      saveSettings(settings);
      void loadArt(settings.gfx).then((a) => { art = a; renderer.setArt(a); });
    },
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
    if (autoBot) inp = autoBot.decide(game);

    while (acc >= DT) {
      game.update(DT, inp);
      particles.update(DT);
      inp = { ...inp, throwPressed: false, startPressed: false };
      acc -= DT;
    }

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
    setGfx(mode) {
      settings = sanitizeSettings({ ...settings, gfx: mode });
      saveSettings(settings);
      return loadArt(settings.gfx).then((a) => { art = a; renderer.setArt(a); });
    },
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