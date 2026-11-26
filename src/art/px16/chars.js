import { PixBuf, shade } from '../../kits/art-kit/pixbuf.js';
import { PAL16 } from '../../core/defs.js';

const P = PAL16;
const o = (b) => b.outline(P.outline);

/** Orange-tabby store tech torso + head (shared). */
function techBody(p, legOff = 0) {
  p.rect(5, 4, 6, 4, P.skin);
  p.rect(6, 3, 4, 1, P.outline);
  p.set(6, 3, P.skin);
  p.set(9, 3, P.skin);
  p.rect(4, 7, 8, 5, P.orange);
  p.rect(5, 8, 2, 3, shade(P.orange, 0.85));
  p.rect(4, 12, 3, 3, P.floor);
  p.rect(9, 12 + legOff, 3, 3 - legOff, P.floor);
  p.rect(4, 12 - legOff, 3, 3 + legOff, P.floor);
  p.hline(5, 9, 6, shade(P.orange, 1.1));
  p.set(7, 5, P.amber);
  p.set(8, 5, P.amber);
}

function playerIdle(frame) {
  const p = new PixBuf(16, 16);
  techBody(p, frame ? 1 : 0);
  p.rect(11, 8, 4, 2, P.wall);
  p.rect(12, 9, 2, 1, P.blue);
  return o(p);
}

function playerRun(frame) {
  const p = new PixBuf(16, 16);
  const phases = [0, 1, 0, -1];
  techBody(p, phases[frame % 4]);
  p.line(11, 9, 14, 7, P.wall);
  return o(p);
}

function playerDown() {
  const p = new PixBuf(16, 16);
  p.rect(2, 10, 12, 4, P.orange);
  p.rect(3, 8, 6, 3, P.skin);
  p.rect(9, 9, 5, 3, P.floor);
  p.set(5, 9, P.amber);
  p.circle(12, 11, 1, P.red);
  return o(p);
}

function mouse(frame) {
  const p = new PixBuf(16, 16);
  const t = frame & 1;
  p.ellipse(8, 9, 5, 4, P.wall);
  p.circle(12, 7, 2, P.wall);
  p.set(13, 6, P.amber);
  p.circle(3, 7, 1, P.pink);
  p.circle(3, 9, 1, P.pink);
  p.line(14, 8, 15 - t, 9 + t, P.outline);
  return o(p);
}

function pete(frame) {
  const p = new PixBuf(24, 24);
  p.ellipse(12, 14, 8, 7, P.pete);
  p.ellipse(12, 9, 7, 6, P.pete);
  p.circle(9, 9, 2, P.white);
  p.circle(15, 9, 2, P.white);
  p.circle(9, 9, 1, P.peteEye);
  p.circle(15, 9, 1, P.peteEye);
  p.rect(10, 11, 4, 2, shade(P.pete, 0.7));
  p.circle(6, 7, 2, P.pete);
  p.circle(18, 7, 2, P.pete);
  p.line(5, 17, 4 + (frame ? 1 : 0), 22, P.outline);
  p.line(19, 17, 20 - (frame ? 1 : 0), 22, P.outline);
  p.ellipse(17, 13, 3, 2, shade(P.pete, 0.85));
  return o(p);
}

function projectile() {
  const p = new PixBuf(8, 8);
  p.circle(4, 4, 2, P.green);
  p.circle(4, 4, 1, P.white);
  p.setMat({ emit: 0.6, gloss: 0.3 }, 0, 0, 8, 8);
  return o(p);
}

function grenade(frame) {
  const p = new PixBuf(8, 8);
  const rot = frame & 1;
  p.rect(2 + rot, 2, 4, 5, P.can);
  p.rect(3, 1, 2, 1, P.wall);
  p.hline(2, 4, 4, P.can2);
  return o(p);
}

function pickupBawlz() {
  const p = new PixBuf(12, 12);
  p.rect(3, 2, 6, 8, P.can);
  p.rect(3, 2, 6, 2, shade(P.can, 1.15));
  p.rect(4, 5, 4, 1, P.white);
  p.set(4, 5, P.dark);
  p.set(5, 5, P.dark);
  p.set(6, 5, P.dark);
  return o(p);
}

function pickupHp() {
  const p = new PixBuf(12, 12);
  p.rect(4, 3, 4, 6, P.green);
  p.rect(2, 5, 8, 2, P.green);
  p.rect(5, 2, 2, 1, shade(P.green, 1.2));
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