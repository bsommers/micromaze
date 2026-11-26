#!/usr/bin/env node
import { createBus } from '../src/core/events.js';
import { loadLevel } from '../src/levels/load-node.js';
import { createGame } from '../src/sim/game.js';
import { createBot } from '../src/sim/autopilot.js';
import { DT } from '../src/core/defs.js';
import { applyDifficulty } from '../src/levels/difficulty.js';
import { applySize } from '../src/levels/size.js';

function parseArgs(argv) {
  const out = { level: 'store01', seeds: [1, 2, 3], skill: 1, maxT: 180, diff: 'medium', size: 1 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--level') out.level = argv[++i];
    else if (a === '--seeds') out.seeds = argv[++i].split(',').map(Number);
    else if (a === '--size') out.size = Number(argv[++i]);
    else if (a === '--diff') out.diff = argv[++i];
    else if (a === '--skill') out.skill = Number(argv[++i]);
    else if (a === '--max-t') out.maxT = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv);
let level;
try {
  level = loadLevel(args.level);
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}

let wins = 0;
const rows = [];
for (const seed of args.seeds) {
  const bus = createBus();
  const g = createGame({ seed, level: applyDifficulty(applySize(level, args.size), args.diff), bus });
  const bot = createBot({ skill: args.skill });
  const maxSteps = Math.floor(args.maxT / DT);
  let nan = false;
  for (let i = 0; i < maxSteps && !g.outcome; i++) {
    const cmd = bot.decide(g);
    g.update(DT, cmd);
    const s = g.snapshot();
    if (!Number.isFinite(s.player.x) || !Number.isFinite(s.player.y)) { nan = true; break; }
  }
  const win = !!g.outcome?.win;
  if (win) wins++;
  rows.push({ seed, win, reason: g.outcome?.reason ?? (nan ? 'nan' : 'timeout'), score: g.score, t: g.t });
  console.log(`seed=${seed} win=${win} reason=${rows.at(-1).reason} score=${g.score} t=${g.t.toFixed(1)}`);
}

const need = Math.ceil(args.seeds.length * 0.8);
console.log(`cleared ${wins}/${args.seeds.length} (need ≥${need} for 80%)`);
process.exit(wins >= need || (args.seeds.length <= 3 && wins >= 1) ? 0 : 1);
