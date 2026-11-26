import { arp, midiHz } from '../kits/audio-kit/index.js';

/** SFX recipes for defs.SFX — consumed by describeSfx(SFX_TABLE, name). */
export const SFX_TABLE = {
  scan: (v) => {
    v({ src: 'square', dur: 0.06, gain: 0.12, f: [1200, 800], att: 0.002 });
    v({ src: 'sine', dur: 0.04, gain: 0.08, f: 1800, t: 0.02 });
  },
  throw: (v) => {
    v({ src: 'triangle', dur: 0.14, gain: 0.18, f: [220, 380], filters: [{ type: 'lp', f: 2500, q: 0.8 }] });
    v({ src: 'noise', dur: 0.05, gain: 0.06, f: 1, filters: [{ type: 'hp', f: 400, q: 0.5 }] });
  },
  explode: (v) => {
    v({ src: 'noise', dur: 0.45, gain: 0.28, att: 0.008, f: 1, filters: [{ type: 'lp', f: [4000, 200], q: 0.9 }] });
    v({ src: 'sine', dur: 0.2, gain: 0.2, f: [120, 40] });
  },
  hit: (v) => v({ src: 'square', dur: 0.07, gain: 0.14, f: [300, 150], att: 0.003 }),
  kill: (v, h) => arp(v, [64, 67, 72], 0.04, { src: 'square', dur: 0.1, gain: 0.16, lp: 2200 }),
  pickup: (v, h) => arp(v, [76, 79, 83], 0.045, { dur: 0.12, gain: 0.17, lp: 3000 }),
  hurt: (v) => {
    v({ src: 'saw', dur: 0.22, gain: 0.2, f: [350, 90], filters: [{ type: 'lp', f: 1400, q: 1 }] });
    v({ src: 'noise', dur: 0.08, gain: 0.1, f: 1 });
  },
  down: (v) => {
    v({ src: 'sine', dur: 0.35, gain: 0.22, f: [200, 60] });
    v({ src: 'triangle', dur: 0.25, gain: 0.12, f: [100, 45], t: 0.08 });
  },
  register_hit: (v) => {
    v({ src: 'square', dur: 0.12, gain: 0.18, f: [180, 90], att: 0.004 });
    v({ src: 'noise', dur: 0.06, gain: 0.08, f: 1, filters: [{ type: 'bp', f: 800, q: 1.2 }] });
  },
  wave: (v, h) => arp(v, [60, 64, 67, 72], 0.06, { src: 'square', dur: 0.14, gain: 0.15, lp: 2800 }),
  pete: (v) => {
    v({ src: 'saw', dur: 0.35, gain: 0.2, f: [80, 45], filters: [{ type: 'lp', f: 900, q: 0.8 }] });
    v({ src: 'square', dur: 0.2, gain: 0.12, f: [120, 70], t: 0.1 });
  },
  taunt_beep: (v) => v({ src: 'square', dur: 0.09, gain: 0.14, f: [520, 780], att: 0.003 }),
  win: (v, h) => arp(v, [72, 76, 79, 84, 88], 0.07, { src: 'square', dur: 0.16, gain: 0.18, lp: 3200 }),
  lose: (v) => {
    v({ src: 'sine', dur: 0.5, gain: 0.2, f: [220, 110] });
    v({ src: 'triangle', dur: 0.4, gain: 0.14, f: [180, 70], t: 0.12 });
  },
};