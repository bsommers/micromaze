import { createParticles } from '../kits/fx-kit/index.js';

const FX_MAP = {
  explode: 'sparkle',
  spawn: 'dust',
  hit: 'poof',
  spark: 'sparkle',
};

export function createGameParticles(bus) {
  const parts = createParticles({ seed: 90210, max: 200 });
  const off = bus.on('fx', ({ type, x, y }) => {
    const preset = FX_MAP[type] ?? 'dust';
  parts.burst(preset, x, y);
  });
  return {
    particles: parts,
    update(dt) { parts.update(dt); },
    draw(ctx, camX, camY) {
      ctx.save();
      ctx.translate(-camX, -camY);
      parts.draw(ctx);
      ctx.restore();
    },
    destroy() { off(); parts.clear(); },
  };
}