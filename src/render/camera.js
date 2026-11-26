import { W, H } from '../core/defs.js';

export function createCamera(game) {
  let x = 0;
  let y = 0;
  const lb = { ox: 0, oy: 0, scale: 1 };

  return {
    get x() { return x; },
    get y() { return y; },
    get lb() { return lb; },
    setLetterbox(ox, oy, scale) {
      lb.ox = ox;
      lb.oy = oy;
      lb.scale = scale;
    },
    update() {
      const p = game.player;
      if (!p) return;
      const ww = game.worldW ?? W;
      const wh = game.worldH ?? H;
      x = Math.max(0, Math.min(ww - W, p.x - W * 0.5));
      y = Math.max(0, Math.min(wh - H, p.y - H * 0.5));
      game._camX = x;
      game._camY = y;
    },
  };
}