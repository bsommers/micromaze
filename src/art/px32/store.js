import { PixBuf, shade, mix } from '../../kits/art-kit/pixbuf.js';
import { PAL32 } from '../../core/defs.js';

const P = PAL32;
const o = (b) => b.outline(P.shadow, { diagonal: true });

function register(frame) {
  const p = new PixBuf(32, 32);
  p.rect(4, 6, 24, 20, P.counter);
  p.rect(6, 8, 20, 12, shade(P.counter, 0.88));
  p.rect(8, 10, 16, 8, P.floor2);
  p.rect(10, 12, 12, 4, frame ? P.amber : mix(P.green, P.glow, 0.3));
  p.rect(12, 22, 8, 4, P.wall);
  p.hline(6, 6, 20, shade(P.counter, 1.12));
  p.rect(6, 6, 20, 2, mix(P.counter, P.metal, 0.2));
  return o(p);
}

function tileFloor() {
  const p = new PixBuf(32, 32);
  p.fill(P.floor);
  p.rect(0, 0, 32, 32, P.floorHi);
  p.fill(P.floor);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const stripe = ((x >> 4) ^ (y >> 4)) & 1;
      p.set(x, y, stripe ? P.floor : mix(P.floor, P.floorHi, 0.35));
    }
  }
  p.hline(0, 15, 32, shade(P.floor2, 0.9));
  p.vline(15, 0, 32, shade(P.floor2, 0.9));
  return p;
}

function tileWall() {
  const p = new PixBuf(32, 32);
  p.fill(P.wall);
  p.hline(0, 0, 32, mix(P.wall, P.metal, 0.25));
  p.hline(0, 31, 32, shade(P.wall, 0.72));
  for (let y = 8; y < 32; y += 8) p.hline(0, y, 32, shade(P.wall, 0.82));
  return o(p);
}

function tileShelf() {
  const p = new PixBuf(32, 32);
  p.fill(P.shelf);
  p.rect(0, 0, 32, 6, mix(P.shelf, P.shelfHi, 0.4));
  p.hline(0, 14, 32, P.wall);
  p.hline(0, 31, 32, shade(P.shelf, 0.78));
  p.rect(4, 8, 6, 4, P.blue);
  p.rect(14, 8, 6, 4, P.amber);
  p.rect(24, 8, 6, 4, mix(P.green, P.glow, 0.2));
  return o(p);
}

function tileCounter() {
  const p = new PixBuf(32, 32);
  p.fill(P.counter);
  p.rect(0, 0, 32, 4, shade(P.counter, 1.15));
  p.hline(0, 16, 32, shade(P.counter, 0.8));
  p.rect(2, 20, 10, 8, mix(P.floor2, P.metal, 0.15));
  p.rect(20, 20, 10, 8, mix(P.floor2, P.metal, 0.15));
  return o(p);
}

function tileDoor() {
  const p = new PixBuf(32, 32);
  p.fill(P.floor2);
  p.rect(8, 4, 16, 26, P.amber);
  p.rect(10, 6, 12, 22, shade(P.amber, 0.86));
  p.circle(22, 18, 2, P.yellow);
  p.frame(8, 4, 16, 26, P.shadow);
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