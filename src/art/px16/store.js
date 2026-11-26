import { PixBuf, shade } from '../../kits/art-kit/pixbuf.js';
import { PAL16 } from '../../core/defs.js';

const P = PAL16;
const o = (b) => b.outline(P.outline);

function register(frame) {
  const p = new PixBuf(16, 16);
  p.rect(2, 3, 12, 10, P.counter);
  p.rect(3, 4, 10, 6, shade(P.counter, 0.9));
  p.rect(4, 5, 8, 4, P.floor2);
  p.rect(5, 6, 6, 2, frame ? P.amber : P.green);
  p.rect(6, 11, 4, 2, P.wall);
  p.hline(3, 3, 10, shade(P.counter, 1.1));
  return o(p);
}

function tileFloor() {
  const p = new PixBuf(16, 16);
  p.fill(P.floor);
  p.hline(0, 7, 16, P.floor2);
  p.vline(7, 0, 16, P.floor2);
  p.set(3, 3, shade(P.floor, 1.08));
  p.set(11, 11, shade(P.floor, 0.92));
  return p;
}

function tileWall() {
  const p = new PixBuf(16, 16);
  p.fill(P.wall);
  p.hline(0, 0, 16, shade(P.wall, 1.15));
  p.hline(0, 15, 16, shade(P.wall, 0.75));
  for (let y = 4; y < 16; y += 4) p.hline(0, y, 16, shade(P.wall, 0.85));
  return o(p);
}

function tileShelf() {
  const p = new PixBuf(16, 16);
  p.fill(P.shelf);
  p.rect(0, 0, 16, 3, shade(P.shelf, 1.1));
  p.hline(0, 7, 16, P.wall);
  p.hline(0, 15, 16, shade(P.shelf, 0.8));
  p.rect(2, 4, 3, 2, P.blue);
  p.rect(7, 4, 3, 2, P.amber);
  p.rect(11, 4, 3, 2, P.green);
  return o(p);
}

function tileCounter() {
  const p = new PixBuf(16, 16);
  p.fill(P.counter);
  p.rect(0, 0, 16, 2, shade(P.counter, 1.12));
  p.hline(0, 8, 16, shade(P.counter, 0.82));
  p.rect(1, 10, 5, 4, P.floor2);
  p.rect(10, 10, 5, 4, P.floor2);
  return o(p);
}

function tileDoor() {
  const p = new PixBuf(16, 16);
  p.fill(P.floor2);
  p.rect(4, 2, 8, 13, P.amber);
  p.rect(5, 3, 6, 11, shade(P.amber, 0.88));
  p.circle(11, 9, 1, P.yellow);
  p.frame(4, 2, 8, 13, P.outline);
  return p;
}

export function build() {
  return {
    register: [register(0), register(1)],
    tile_floor: tileFloor(),
    tile_wall: tileWall(),
    tile_shelf: tileShelf(),
    tile_counter: tileCounter(),
    tile_door: tileDoor(),
  };
}