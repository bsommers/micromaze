import { W, H } from '../core/defs.js';

function overlay(ctx, w, h, alpha) {
  ctx.fillStyle = `rgba(13,11,18,${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

export function drawScreens(ctx, game, w = W, h = H) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = w >> 1;
  const cy = h >> 1;

  if (game.state === 'intro' && !game.outcome) {
    overlay(ctx, w, h, 0.55);
    ctx.fillStyle = '#f5d76e';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('MICRO MAZE', cx, cy - 28);
    ctx.fillStyle = '#e8e6f0';
    ctx.font = '8px monospace';
    ctx.fillText('Defend the registers. Scanner + Bawlz.', cx, cy - 10);
    ctx.fillText('ENTER — start', cx, cy + 14);
    ctx.fillStyle = '#7a6f8a';
    ctx.fillText('WASD move · mouse aim · LMB/Space scanner · RMB/F Bawlz · Esc pause', cx, cy + 28);
  }

  if (game.outcome?.win) {
    overlay(ctx, w, h, 0.65);
    ctx.fillStyle = '#3dd68c';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('STORE SAVED', cx, cy - 12);
    ctx.fillStyle = '#e8e6f0';
    ctx.font = '8px monospace';
    ctx.fillText(`Score ${game.score | 0}`, cx, cy + 6);
  } else if (game.outcome && !game.outcome.win) {
    overlay(ctx, w, h, 0.7);
    ctx.fillStyle = '#e83b3b';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('REGISTERS LOST', cx, cy - 12);
    ctx.fillStyle = '#e8e6f0';
    ctx.font = '8px monospace';
    ctx.fillText(game.outcome.reason ?? 'defeat', cx, cy + 6);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}