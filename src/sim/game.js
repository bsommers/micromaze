import { DT, TUNING, WEAPONS } from '../core/defs.js';
import { createRng } from '../core/rng.js';
import { buildFlowField, levelSize } from '../levels/level.js';
import { makePlayer, updatePlayer } from './player.js';
import { tryFireScanner, tryThrowBawlz, updateProjectiles, updateGrenades, updatePickups } from './weapons.js';
import { updateMice } from './enemies.js';
import { updatePete } from './pete.js';
import { createWaveScheduler } from './waves.js';
import { createTaunts } from './taunts.js';

export function createGame({ seed = 1, level, bus, weapons = WEAPONS } = {}) {
  if (!level || typeof level !== 'object') throw new TypeError('createGame: level required');
  if (!bus || typeof bus.emit !== 'function') throw new TypeError('createGame: bus required');
  const rng = createRng(seed >>> 0 || 1);
  const size = levelSize(level);
  let nextId = 2;

  const g = {
    t: 0,
    tick: 0,
    state: 'intro',
    stateT: TUNING.introTime,
    waveIdx: 0,
    waveCount: level.waves.length,
    score: 0,
    player: null,
    ents: [],
    registers: [],
    pete: null,
    ammo: { bawlz: level.startAmmo?.bawlz ?? 6 },
    outcome: null,
    rng,
    bus,
    level,
    weapons,
    worldW: size.worldW,
    worldH: size.worldH,
    stats: { shots: 0, hits: 0, kills: 0, thrown: 0 },
    _flow: null,
    _flowTick: 0,
    _sched: null,
    _taunts: null,
    _acc: 0,
  };

  g.emit = (type, payload) => { try { bus.emit(type, payload); } catch { /* bus faults must not crash sim */ } };
  g.fx = (type, x, y, opts) => g.emit('fx', { type, x, y, opts });
  g.popup = (text, x, y, color) => g.emit('popup', { text, x, y, color });

  g.spawn = (kind, props = {}) => {
    const { st: stIn, ...rest } = props;
    const e = {
      id: nextId++,
      kind,
      x: 0, y: 0, vx: 0, vy: 0,
      r: 4, hp: 1, maxHp: 1,
      team: 'neutral', face: 0, pose: 'idle', frame: 0,
      dead: false, ttl: null,
      ...rest,
      st: { ...(stIn ?? {}) },
    };
    g.ents.push(e);
    g.emit('spawn', { id: e.id, kind });
    return e;
  };

  g.damage = (target, n, src) => {
    if (!target || target.dead) return;
    if (target.kind === 'player' && target.st.inv > 0) return;
    const amt = Math.max(0, n);
    target.hp -= amt;
    g.emit('hit', { target: target.id, dmg: amt, src: src?.id });
    if (target.kind === 'register') {
      g.emit('register_hit', { regId: target.st.regId, hp: target.hp });
      g.emit('sfx', { name: 'register_hit', x: target.x, y: target.y });
      g._taunts?.on('register_hit');
    }
    if (target.kind === 'player') {
      g.emit('sfx', { name: 'hurt', x: target.x, y: target.y });
      target.st.inv = 0.4;
    }
    if (target.hp <= 0) {
      target.hp = 0;
      if (target.kind === 'player') {
        target.st.downT = TUNING.downTime;
        g.emit('player_down');
        g.emit('sfx', { name: 'down' });
        g._taunts?.on('player_down');
      } else if (target.kind === 'register') {
        target.dead = true;
        g.emit('register_lost', { regId: target.st.regId });
        g._taunts?.on('register_lost');
        g._flowTick = 0; // rebuild flow
      } else {
        target.dead = true;
        g.stats.kills++;
        g.score += target.kind === 'pete' ? 500 : 25;
        g.emit('kill', { id: target.id, kind: target.kind, x: target.x, y: target.y });
        g.emit('sfx', { name: 'kill', x: target.x, y: target.y });
        g._taunts?.bumpActivity();
        if (target.kind === 'pete') {
          g.pete = target;
          g._taunts?.on('pete_down');
        }
        maybeDrop(g, target);
      }
    }
  };

  function maybeDrop(g, target) {
    if (!g.rng.chance(g.level.dropChance ?? 0)) return;
    const table = g.level.pickupTable ?? [];
    if (!table.length) return;
    const tot = table.reduce((a, t) => a + (t.w ?? 1), 0);
    let r = g.rng.next() * tot;
    let pick = table[0];
    for (const t of table) { if ((r -= t.w ?? 1) < 0) { pick = t; break; } }
    g.spawn('pickup', {
      x: target.x, y: target.y, r: 5,
      hp: 1, maxHp: 1, team: 'neutral',
      st: { give: pick.give, n: pick.n ?? 1 },
    });
  }

  function rebuildFlow() {
    const live = g.registers.filter((r) => !r.dead);
    g._flow = live.length ? buildFlowField(g.level, live) : null;
  }

  function boot() {
    nextId = 2;
    g.ents = [];
    g.registers = [];
    g.pete = null;
    g.player = makePlayer(level.playerSpawn);
    g.ents.push(g.player);
    for (const r of level.registers) {
      const e = g.spawn('register', {
        x: r.x, y: r.y, r: TUNING.registerR,
        hp: r.hp, maxHp: r.hp, team: 'store',
        vx: 0, vy: 0,
        st: { regId: r.id },
      });
      g.registers.push(e);
    }
    rebuildFlow();
    g._sched = createWaveScheduler(g);
    g._taunts = createTaunts(g);
    g.emit('music', { name: 'store' });
  }

  boot();

  function checkLose() {
    const live = g.registers.filter((r) => !r.dead);
    if (level.loseWhen === 'any') {
      return live.length < g.registers.length;
    }
    return live.length === 0;
  }

  function checkWin() {
    if (!g._sched?.finalSpawnedOut) return false;
    const vermin = g.ents.some((e) => !e.dead && (e.kind === 'mouse' || e.kind === 'pete'));
    return !vermin;
  }

  function end(win, reason) {
    if (g.outcome) return;
    g.outcome = { win, reason, t: g.t };
    g.state = win ? 'victory' : 'defeat';
    g.emit('game_over', { win, reason, score: g.score });
    g.emit('sfx', { name: win ? 'win' : 'lose' });
    g.emit('music', { name: win ? 'victory' : 'title' });
    g._taunts?.on(win ? 'victory' : 'defeat');
  }

  function step(dt, input) {
    if (g.outcome) return;
    g.t += dt;
    g.tick++;

    if (g.state === 'intro') {
      g.stateT -= dt;
      if (g.stateT <= 0 || input.startPressed) {
        g.state = 'play';
        g._taunts?.on('wave_start');
      }
      return;
    }

    if (g.state === 'intermission') {
      g._sched.update(dt);
      g._taunts?.update(dt);
      if (g.state !== 'play') return;
      // fall through into play step after wave advance
    }

    if (g.state !== 'play') return;

    // sanitize dt
    if (!Number.isFinite(dt) || dt < 0) return;
    const use = Math.min(dt, TUNING.maxDt);

    updatePlayer(g, use, input ?? {});
    tryFireScanner(g, input ?? {});
    tryThrowBawlz(g, input ?? {});
    updateProjectiles(g, use);
    updateGrenades(g, use);
    updatePickups(g, use);

    g._flowTick--;
    if (g._flowTick <= 0) { rebuildFlow(); g._flowTick = TUNING.flowRebuild; }

    updateMice(g, use);
    updatePete(g, use);
    g._sched.update(use);
    g._taunts?.update(use);

    // compact dead non-register ents occasionally
    if ((g.tick & 31) === 0) {
      g.ents = g.ents.filter((e) => !e.dead || e.kind === 'register' || e.kind === 'player');
    }

    // lose before win
    if (checkLose()) { end(false, 'registers_destroyed'); return; }
    if (checkWin()) { end(true, 'all_waves_cleared'); return; }
  }

  g.update = (dt, input) => {
    if (!Number.isFinite(dt) || dt < 0 || dt === Infinity) return;
    // fixed step accumulator
    g._acc = (g._acc ?? 0) + Math.min(dt, 0.25);
    let guard = 0;
    while (g._acc >= DT && guard++ < 8) {
      step(DT, input);
      g._acc -= DT;
    }
  };

  g.snapshot = () => {
    const ent = (e) => ({
      id: e.id, kind: e.kind, x: e.x, y: e.y, vx: e.vx, vy: e.vy, r: e.r,
      hp: e.hp, maxHp: e.maxHp, team: e.team, face: e.face, pose: e.pose,
      frame: e.frame, dead: e.dead, ttl: e.ttl, st: { ...e.st },
    });
    return JSON.parse(JSON.stringify({
      t: g.t, tick: g.tick, state: g.state, waveIdx: g.waveIdx, score: g.score,
      ammo: { ...g.ammo }, outcome: g.outcome ? { ...g.outcome } : null,
      stats: { ...g.stats },
      player: ent(g.player),
      registers: g.registers.map(ent),
      ents: g.ents.filter((e) => e !== g.player).map(ent).sort((a, b) => a.id - b.id),
      pete: g.pete ? ent(g.pete) : null,
    }));
  };

  return g;
}
