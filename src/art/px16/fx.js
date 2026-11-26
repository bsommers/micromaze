import { PixBuf, shade } from '../../kits/art-kit/pixbuf.js';
import { PAL16 } from '../../core/defs.js';

const P = PAL16;
const o = (b) => b.outline(P.outline);

function fxExplode(frame) {
  const p = new PixBuf(24, 24);
  const cx = 12;
  const cy = 12;
  const r = 4 + frame * 3;
  const cols = [P.yellow, P.amber, P.red, P.orange];
  p.circle(cx, cy, Math.min(r, 10), cols[frame % 4]);
  if (frame > 0) p.circle(cx, cy, Math.max(1, r - 3), cols[(frame + 1) % 4]);
  if (frame < 3) {
    const spokes = 6 + frame;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const dx = Math.round(Math.cos(a) * (r + 2));
      const dy = Math.round(Math.sin(a) * (r + 2));
      p.set(cx + dx, cy + dy, P.white);
    }
  }
  if (frame === 3) p.circle(cx, cy, 3, shade(P.amber, 0.6));
  return o(p);
}

function fxSpark(frame) {
  const p = new PixBuf(8, 8);
  const c = frame ? P.amber : P.yellow;
  p.line(4, 1, 4, 7, c);
  p.line(1, 4, 7, 4, c);
  if (!frame) {
    p.line(2, 2, 6, 6, shade(c, 0.8));
    p.line(6, 2, 2, 6, shade(c, 0.8));
  }
  p.circle(4, 4, 1, P.white);
  p.setMat({ emit: 0.7, spark: 0.4 }, 0, 0, 8, 8);
  return o(p);
}

export function build() {
  return {
    fx_explode: [0, 1, 2, 3].map((f) => fxExplode(f)),
    fx_spark: [fxSpark(0), fxSpark(1)],
  };
}