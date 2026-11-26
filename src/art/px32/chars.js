import { PixBuf, shade, mix } from '../../kits/art-kit/pixbuf.js';
import { PAL32 } from '../../core/defs.js';

const P = PAL32;
const o = (b) => b.outline(P.shadow, { diagonal: true });

function block(p, x, y, w, h, c) {
  p.rect(x, y, w, h, c);
}

function techBody(p, legOff = 0) {
  block(p, 10, 8, 12, 8, P.skin);
  block(p, 12, 6, 8, 4, shade(P.skin, 0.95));
  block(p, 8, 14, 16, 10, P.orange);
  block(p, 10, 16, 6, 6, shade(P.orange, 0.82));
  block(p, 22, 16, 4, 6, mix(P.orange, P.amber, 0.2));
  block(p, 8, 24, 6, 6 + legOff, P.floor);
  block(p, 20, 24 - legOff, 6, 6 + legOff, P.floor);
  block(p, 10, 18, 12, 2, shade(P.orange, 1.15));
  p.circle(14, 11, 2, P.amber);
  p.circle(18, 11, 2, P.amber);
  block(p, 13, 7, 6, 2, shade(P.outline, 0.5));
}

function playerIdle(frame) {
  const p = new PixBuf(32, 32);
  techBody(p, frame ? 2 : 0);
  block(p, 22, 16, 8, 4, P.metal);
  block(p, 24, 18, 4, 2, mix(P.blue, P.glass, 0.3));
  return o(p);
}

function playerRun(frame) {
  const p = new PixBuf(32, 32);
  const phases = [0, 2, 0, -2];
  techBody(p, phases[frame % 4]);
  p.line(22, 18, 28, 14, P.metal);
  return o(p);
}

function playerDown() {
  const p = new PixBuf(32, 32);
  block(p, 4, 20, 24, 8, P.orange);
  block(p, 6, 16, 12, 6, P.skin);
  block(p, 18, 18, 10, 6, P.floor);
  p.circle(10, 18, 2, P.amber);
  p.circle(24, 22, 3, mix(P.red, P.amber, 0.3));
  return o(p);
}

function mouse(frame) {
  const p = new PixBuf(32, 32);
  const t = frame & 1;
  p.ellipse(16, 18, 10, 8, shade(P.wall, 0.95));
  p.ellipse(24, 14, 4, 4, P.wall);
  p.circle(26, 12, 2, P.amber);
  p.circle(6, 14, 2, P.pink);
  p.circle(6, 18, 2, P.pink);
  p.line(28, 16, 30 - t * 2, 18 + t * 2, P.shadow);
  return o(p);
}

function pete(frame) {
  const p = new PixBuf(48, 48);
  p.ellipse(24, 28, 16, 14, P.pete);
  p.ellipse(24, 18, 14, 12, shade(P.pete, 1.05));
  p.circle(18, 18, 4, P.white);
  p.circle(30, 18, 4, P.white);
  p.circle(18, 18, 2, P.peteEye);
  p.circle(30, 18, 2, P.peteEye);
  block(p, 20, 22, 8, 4, shade(P.pete, 0.65));
  p.circle(12, 14, 4, shade(P.pete, 0.9));
  p.circle(36, 14, 4, shade(P.pete, 0.9));
  p.line(10, 34, 8 + (frame ? 2 : 0), 44, P.shadow);
  p.line(38, 34, 40 - (frame ? 2 : 0), 44, P.shadow);
  p.ellipse(34, 26, 6, 4, mix(P.pete, P.amber, 0.15));
  return o(p);
}

function projectile() {
  const p = new PixBuf(16, 16);
  p.circle(8, 8, 4, mix(P.green, P.glow, 0.35));
  p.circle(8, 8, 2, P.white);
  p.setMat({ emit: 0.75, gloss: 0.45, spark: 0.2 }, 0, 0, 16, 16);
  return o(p);
}

function grenade(frame) {
  const p = new PixBuf(16, 16);
  const rot = frame & 1;
  block(p, 4 + rot, 4, 8, 10, P.can);
  block(p, 6, 2, 4, 2, P.metal);
  block(p, 4, 8, 8, 2, P.can2);
  p.hline(5, 10, 6, shade(P.can, 1.2));
  return o(p);
}

function pickupBawlz() {
  const p = new PixBuf(24, 24);
  block(p, 6, 4, 12, 16, P.can);
  block(p, 6, 4, 12, 4, mix(P.can, P.glow, 0.2));
  block(p, 8, 10, 8, 3, P.white);
  for (let i = 0; i < 5; i++) p.set(9 + i, 11, P.shadow);
  return o(p);
}

function pickupHp() {
  const p = new PixBuf(24, 24);
  block(p, 8, 6, 8, 12, P.green);
  block(p, 4, 10, 16, 4, mix(P.green, P.glow, 0.25));
  block(p, 10, 4, 4, 2, shade(P.green, 1.25));
  return o(p);
}

export function build() {
  return {
    player_idle: [playerIdle(0), playerIdle(1)],
    player_run: [0, 1, 2, 3].map((f) => playerRun(f)),
    player_down: [playerDown()],
    mouse: [mouse(0), mouse(1)],
    pete: [pete(0), pete(1)],
    projectile: [projectile()],
    grenade: [grenade(0), grenade(1)],
    pickup_bawlz: [pickupBawlz()],
    pickup_hp: [pickupHp()],
  };
}