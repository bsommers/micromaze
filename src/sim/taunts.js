import { TAUNTS, TUNING } from '../core/defs.js';

export function createTaunts(g, lines = TAUNTS) {
  let gap = 0;
  let idle = 0;
  let curPrio = -1;

  function say(speaker, text, trigger, prio) {
    if (prio < curPrio && gap > 0) return;
    curPrio = prio;
    gap = TUNING.tauntGap;
    g.emit('taunt', { speaker, text, dur: 2.4, trigger, prio });
    g.emit('sfx', { name: 'taunt_beep' });
  }

  function on(trigger, ctx = {}) {
    const table = lines[trigger];
    if (!table?.length) return;
    const text = g.rng.pick(table);
    const prio = trigger === 'defeat' || trigger === 'victory' ? 2
      : trigger === 'register_lost' || trigger === 'pete_arrive' ? 1 : 0;
    const speaker = trigger.startsWith('pete') && trigger !== 'pete_arrive' ? 'pete' : 'christopher';
    if (speaker === 'pete' && lines.pete_lines?.length && trigger === 'pete_arrive') {
      say('pete', g.rng.pick(lines.pete_lines), trigger, prio);
      return;
    }
    say(speaker === 'pete' ? 'pete' : 'christopher', text, trigger, prio);
    void ctx;
  }

  function update(dt) {
    if (gap > 0) gap -= dt;
    else curPrio = -1;
    if (g.state === 'play') {
      idle += dt;
      if (idle >= TUNING.idleTauntAfter) {
        idle = 0;
        on('idle');
      }
    }
  }

  function bumpActivity() { idle = 0; }

  return { on, update, bumpActivity };
}
