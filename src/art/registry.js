import { PixBuf, ink } from '../kits/art-kit/pixbuf.js';
import { ART, PAL16, PAL32 } from '../core/defs.js';
import { build as build16Chars } from './px16/chars.js';
import { build as build16Store } from './px16/store.js';
import { build as build16Fx } from './px16/fx.js';
import { build as build32Chars } from './px32/chars.js';
import { build as build32Store } from './px32/store.js';
import { build as build32Fx } from './px32/fx.js';

/** @type {Record<string, { mode: string, scale: number, map: Record<string, import('../kits/art-kit/pixbuf.js').PixBuf | import('../kits/art-kit/pixbuf.js').PixBuf[]> } | null>} */
const cache = { '16bit': null, '32bit': null };

const FALLBACK_TINT = ['#e83b3b', '#4d9de0', '#3dd68c', '#f0a030', '#e87ad6'];

function artDef(name) {
  return ART.find((a) => a.name === name);
}

function fallback(name, scale, pal) {
  const def = artDef(name);
  const w = (def?.w ?? 16) * scale;
  const h = (def?.h ?? 16) * scale;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i) * (i + 1)) | 0;
  const tint = FALLBACK_TINT[Math.abs(hash) % FALLBACK_TINT.length];
  const p = new PixBuf(w, h);
  p.rect(0, 0, w, h, ink(tint, { a: 160 }));
  p.frame(0, 0, w, h, ink(pal.outline));
  return p;
}

function mergeBuilds(builders) {
  const map = {};
  for (const fn of builders) Object.assign(map, fn());
  return map;
}

function loadMode(mode) {
  if (cache[mode]) return cache[mode];
  const scale = mode === '32bit' ? 2 : 1;
  const builders =
    mode === '32bit'
      ? [build32Chars, build32Store, build32Fx]
      : [build16Chars, build16Store, build16Fx];
  const map = mergeBuilds(builders);
  cache[mode] = { mode, scale, map };
  return cache[mode];
}

/**
 * @param {{ mode?: '16bit'|'32bit' }} [opts]
 */
export function buildArt({ mode = '16bit' } = {}) {
  const m = mode === '32bit' ? '32bit' : '16bit';
  const pack = loadMode(m);
  const pal = m === '32bit' ? PAL32 : PAL16;

  return {
    mode: pack.mode,
    scale: pack.scale,
    get(name, frame = 0) {
      const entry = pack.map[name];
      if (entry == null) return fallback(name, pack.scale, pal);
      if (Array.isArray(entry)) {
        const f = entry[frame] ?? entry[0];
        return f ?? fallback(name, pack.scale, pal);
      }
      return entry;
    },
    frames(name) {
      const entry = pack.map[name];
      if (Array.isArray(entry)) return entry.length;
      const def = artDef(name);
      return def?.frames ?? 1;
    },
    has(name) {
      return Object.prototype.hasOwnProperty.call(pack.map, name);
    },
    names() {
      return ART.map((a) => a.name);
    },
  };
}