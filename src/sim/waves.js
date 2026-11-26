import { TUNING } from '../core/defs.js';

export function createWaveScheduler(g) {
  const waves = g.level.waves;
  let waveIdx = -1;
  let state = 'idle'; // idle | spawning | waiting_clear | intermission
  let timer = 0;
  let queues = []; // {left, every, t, kind, spawn, hp, speed}
  let spawnedOut = false;

  function pickSpawn(spec) {
    const list = g.level.spawns;
    if (spec === 'any') return list[g.rng.int(0, list.length - 1)];
    return list.find((s) => s.id === spec) ?? list[0];
  }

  function startWave(i) {
    waveIdx = i;
    g.waveIdx = i;
    const w = waves[i];
    queues = (w.groups ?? []).map((gr) => ({
      left: gr.count,
      every: gr.every,
      t: 0,
      kind: gr.kind,
      spawn: gr.spawn ?? 'any',
      hp: gr.hp,
      speed: gr.speed,
    }));
    spawnedOut = false;
    state = 'spawning';
    timer = w.delay ?? 0;
    if (g.state === 'intermission' || g.state === 'intro') g.state = 'play';
    g.emit('wave_start', { idx: i });
    g.emit('sfx', { name: 'wave' });
    if (queues.some((q) => q.kind === 'pete')) {
      g.emit('sfx', { name: 'pete' });
      g._taunts?.on('pete_arrive');
    }
  }

  function spawnOne(q) {
    if (g.ents.filter((e) => !e.dead).length >= TUNING.entityCap) return false;
    const sp = pickSpawn(q.spawn);
    if (q.kind === 'pete') {
      if (g.pete && !g.pete.dead) return false;
      const e = g.spawn('pete', {
        x: sp.x, y: sp.y,
        r: TUNING.peteR,
        hp: q.hp ?? TUNING.peteHp, maxHp: q.hp ?? TUNING.peteHp,
        team: 'vermin',
        st: { phase: 1, spawnT: 1, dashT: 0, dashCd: 1, speed: q.speed ?? TUNING.peteSpeed },
      });
      g.pete = e;
      g.emit('sfx', { name: 'pete' });
    } else {
      g.spawn('mouse', {
        x: sp.x, y: sp.y,
        r: TUNING.mouseR,
        hp: q.hp ?? TUNING.mouseHp, maxHp: q.hp ?? TUNING.mouseHp,
        team: 'vermin',
        st: { target: null, bite: 0, speed: q.speed ?? TUNING.mouseSpeed, biteDmg: TUNING.mouseBite },
      });
    }
    return true;
  }

  function verminAlive() {
    return g.ents.some((e) => !e.dead && (e.kind === 'mouse' || e.kind === 'pete'));
  }

  function update(dt) {
    if (g.state !== 'play' && g.state !== 'intermission') return;

    if (waveIdx < 0) {
      startWave(0);
      return;
    }

    if (state === 'intermission') {
      timer -= dt;
      if (timer <= 0) {
        if (waveIdx + 1 < waves.length) startWave(waveIdx + 1);
        else state = 'done';
      }
      return;
    }

    if (state === 'spawning') {
      if (timer > 0) { timer -= dt; return; }
      let any = false;
      for (const q of queues) {
        if (q.left <= 0) continue;
        any = true;
        q.t -= dt;
        if (q.t <= 0) {
          if (spawnOne(q)) {
            q.left--;
            q.t = q.every;
          }
        }
      }
      if (!any) {
        spawnedOut = true;
        state = 'waiting_clear';
      }
    }

    if (state === 'waiting_clear') {
      if (!verminAlive()) {
        const w = waves[waveIdx];
        g.score += w.clearBonus ?? 0;
        g.emit('wave_clear', { idx: waveIdx, bonus: w.clearBonus ?? 0 });
        if (waveIdx + 1 >= waves.length) {
          state = 'done';
        } else {
          state = 'intermission';
          g.state = 'intermission';
          timer = g.level.intermission ?? TUNING.intermissionDefault;
        }
      }
    }
  }

  function tick(dt) {
    update(dt);
    return { spawnedOut, verminAlive: verminAlive(), waveIdx, state };
  }

  return {
    update,
    tick,
    get waveIdx() { return waveIdx; },
    get spawnedOut() { return spawnedOut; },
    get done() { return state === 'done' && waveIdx + 1 >= waves.length && !verminAlive(); },
    get finalSpawnedOut() {
      return waveIdx >= waves.length - 1 && spawnedOut;
    },
  };
}
