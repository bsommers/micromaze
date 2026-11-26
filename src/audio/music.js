import { jingle } from '../kits/audio-kit/index.js';

const STORE_BASS = ['C2:8 G1:8 A1:8 E2:8', 'F2:8 C2:8 G1:8 D2:8', 'G1:8 D2:8 A1:8 E2:8', 'C2:16 G1:16 C2:16 G1:16'];

/** defs.MUSIC tracks */
export const MUSIC_TABLE = {
  title: jingle('C4:4 E4:4 G4:4 .:4 C5:8', { bpm: 108, vel: 0.22, bass: ['C3:16', 'G2:16', 'C3:16', 'G2:16'] }),
  store: {
    bpm: 118,
    bars: 4,
    loop: true,
    channels: {
      bass: { wave: 'tri', vel: 0.35, gate: 0.95, sus: 0.75, pat: STORE_BASS },
      pad: {
        wave: 'tri', vel: 0.18, gate: 0.85, sus: 0.6,
        pat: ['C4:16', 'A3:16', 'F3:16', 'G3:16'],
      },
      lead: {
        wave: 'pulse', duty: 0.35, vel: 0.16, gate: 0.75, sus: 0.45,
        pat: [
          'E4:4 G4:4 C5:4 G4:4 .:4',
          'F4:4 A4:4 D5:4 A4:4 .:4',
          'G4:4 B4:4 E5:4 B4:4 .:4',
          'E4:8 G4:4 C5:8 .:4',
        ],
      },
    },
    drums: { vel: 0.85, pat: ['k...s...k.h.s...', 'k...s...k.h.s.h.', 'k...s...k.h.s...', 'k.h.s.k...s...'] },
  },
  boss: {
    bpm: 132,
    bars: 4,
    loop: true,
    channels: {
      bass: { wave: 'pulse', duty: 0.4, vel: 0.38, pat: ['G2:4 .:4 G2:4 .:4', 'F2:4 .:4 F2:4 .:4', 'E2:4 .:4 E2:4 .:4', 'D2:8 G2:8'] },
      lead: {
        wave: 'pulse', duty: 0.25, vel: 0.2, gate: 0.7,
        pat: [
          'B3:2 D4:2 F4:4 G4:4 .:8',
          'A3:2 C4:2 E4:4 F4:4 .:8',
          'G3:2 B3:2 D4:4 E4:4 .:8',
          'F3:4 A3:4 C4:8 .:8',
        ],
      },
    },
    drums: { vel: 0.9, pat: ['k.s.k.s.k.s.k.s.', 'k.s.K.s.k.s.k.s.', 'k.s.k.s.K.s.k.s.', 'k.s.k.s.k.s.K.s.'] },
  },
  victory: jingle('G4:2 B4:2 D5:4 G5:4 C6:4 .:8', { bpm: 124, vel: 0.24, bass: ['G2:16', 'D2:16', 'G2:16', 'D2:16'] }),
};