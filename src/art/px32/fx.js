import { PixBuf, shade, mix } from '../../kits/art-kit/pixbuf.js';
import { PAL32 } from '../../core/defs.js';

const P = PAL32;
const o = (b) => b.outline(P.shadow, { diagonal: true });

function fxExplode(frame) {
  const p = new PixBuf(48, 48);
  const cx = 24;
  const cy = 24;
  const r = 8 + frame * 6;
  const cols = [P.yellow, P.amber, mix(P.red, P.amber, 0.5), P.orange];
  p.circle(cx, cy, Math.min(r, 20), cols[frame % 4]);
  if (frame > 0) p.circle(cx, cy, Math.max(2, r - 6), cols[(frame + 1) % 4]);
  if (frame < 3) {
    const spokes = 8 + frame * 2;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const dx = Math.round(Math.cos(a) * (r + 4));
      const dy = Math.round(Math.sin(a) * (r + 4));
      p.set(cx + dx, cy + dy, mix(P.white, P.glow, 0.3));
      if (i % 2 === 0) p.set(cx + (dx >> 1), cy + (dy >> 1), P.amber);
    }
  }
  if (frame === 3) {
    p.circle(cx, cy, 6, shade(P.amber, 0.55));
    p.setMat({ emit: 0.5 }, 0, 0, 48, 48);
  }
  return o(p);
}

function fxSpark(frame) {
  const p = new PixBuf(16, 16);
  const c = frame ? P.amber : mix(P.yellow, P.glow, 0.25);
  p.line(8, 2, 8, 14, c);
  p.line(2, 8, 14, 8, c);
  if (!frame) {
    p.line(4, 4, 12, 12, shade(c, 0.85));
    p.line(12, 4, 4, 12, shade(c, 0.85));
  }
  p.circle(8, 8, 2, P.white);
  p.setMat({ emit: 0.85, spark: 0.55, gloss: 0.3 }, 0, 0, 16, 16);
  return o(p);
}

export function build() {
  return {
    fx_explode: [0, 1, 2, 3].map((f) => fxExplode(f)),
    fx_spark: [fxSpark(0), fxSpark(1)],
  };
}