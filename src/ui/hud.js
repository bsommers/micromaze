import { W, H } from '../core/defs.js';

let lastTaunt = null;
let hudWired = false;

function bar(ctx, x, y, w, h, frac, fg, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
  ctx.strokeStyle = '#0d0b12';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function drawHud(ctx, game, w = W, h = H) {
  if (!hudWired && game.bus) {
    game.bus.on('taunt', (t) => { lastTaunt = t; });
    hudWired = true;
  }

  ctx.save();
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e8e6f0';
  ctx.fillText(`SCORE ${game.score | 0}`, 6, 4);
  const wave = `${(game.waveIdx ?? 0) + 1}/${game.waveCount ?? 1}`;
  ctx.fillText(`WAVE ${wave}`, 6, 14);
  ctx.fillStyle = '#2ec4b6';
  ctx.fillText(`BAWLZ ${game.ammo?.bawlz ?? 0}`, 6, 24);

  const p = game.player;
  if (p && p.maxHp > 0) {
    bar(ctx, w - 54, 4, 48, 5, p.hp / p.maxHp, '#3dd68c', '#2a2433');
    ctx.fillStyle = '#e8e6f0';
    ctx.fillText('HP', w - 54, 11);
  }

  for (const reg of game.registers ?? []) {
    if (reg.dead) continue;
    const rx = reg.x - (game._camX ?? 0) - 12;
    const ry = reg.y - (game._camY ?? 0) - 22;
    if (rx < -20 || rx > w + 20 || ry < -10 || ry > h) continue;
    bar(ctx, rx, ry, 24, 3, reg.hp / reg.maxHp, '#4d9de0', '#1a1c2c');
  }

  if (lastTaunt?.text) {
    const age = game._tauntAge ?? 0;
    const dur = lastTaunt.dur ?? 2.4;
    const a = Math.max(0, 1 - age / dur);
    if (a > 0) {
      ctx.globalAlpha = Math.min(1, a * 1.2);
      ctx.fillStyle = lastTaunt.speaker === 'pete' ? '#e87ad6' : '#f5d76e';
      ctx.textAlign = 'center';
      const lines = lastTaunt.text.slice(0, 48);
      ctx.fillText(lines, w >> 1, h - 28);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}