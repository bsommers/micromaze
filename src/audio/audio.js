import { describeSfx, describeSong, scheduleVoices, scheduleSong } from '../kits/audio-kit/index.js';
import { SFX_TABLE } from './sfx.js';
import { MUSIC_TABLE } from './music.js';

function ac() {
  const C = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return typeof C === 'function' ? new C() : null;
}

export function createAudio(bus, settings = {}) {
  let ctx = ac();
  if (!ctx) {
    return { unlock() {}, destroy() {}, applySettings() {} };
  }

  const master = ctx.createGain();
  const sfxGain = ctx.createGain();
  const musicGain = ctx.createGain();
  sfxGain.connect(master);
  musicGain.connect(master);
  master.connect(ctx.destination);

  let songStop = null;
  let songTimer = null;
  let curSong = null;
  let unlocked = false;

  function vol() {
    const s = settings;
    const m = s.mute ? 0 : (s.master ?? 0.8);
    master.gain.value = m;
    sfxGain.gain.value = s.mute ? 0 : (s.sfx ?? 1);
    musicGain.gain.value = s.mute ? 0 : (s.music ?? 0.7);
  }
  vol();

  function panFrom(x, y, cam) {
    if (!Number.isFinite(x) || !cam) return 0;
    const cx = (cam.x ?? 0) + 160;
    const dx = x - cx;
    return Math.max(-1, Math.min(1, dx / 160));
  }

  function playSfx(payload) {
    if (!ctx || settings.mute) return;
    const name = payload?.name;
    if (!name || !Object.hasOwn(SFX_TABLE, name)) return;
    try {
      const voices = describeSfx(SFX_TABLE, name, { pitch: payload.pitch ?? 1 });
      const when = ctx.currentTime + 0.01;
      const pitch = payload.rate ?? 1;
      if (pitch !== 1) for (const v of voices) { v.t /= pitch; v.dur /= pitch; }
      scheduleVoices(ctx, sfxGain, voices, when, { pan: panFrom(payload.x, payload.y, payload.cam), gain: 1 });
    } catch { /* bad sfx must not break game */ }
  }

  function loopSong(name) {
    if (!ctx || !Object.hasOwn(MUSIC_TABLE, name)) return;
    if (songStop) { try { songStop.stop(); } catch { /* */ } songStop = null; }
    if (songTimer) { clearTimeout(songTimer); songTimer = null; }
    const song = MUSIC_TABLE[name];
    const T = describeSong(song);
    const start = () => {
      if (!ctx) return;
      songStop = scheduleSong(ctx, musicGain, song, ctx.currentTime + 0.05);
      if (T.loop) songTimer = setTimeout(start, Math.max(50, T.length * 1000 - 40));
    };
    curSong = name;
    start();
  }

  const offSfx = bus.on('sfx', (p) => playSfx(p));
  const offMusic = bus.on('music', ({ name }) => loopSong(name));

  return {
    unlock() {
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();
      unlocked = true;
    },
    applySettings(s) {
      settings = s ?? settings;
      vol();
    },
    destroy() {
      offSfx();
      offMusic();
      if (songStop) try { songStop.stop(); } catch { /* */ }
      if (songTimer) clearTimeout(songTimer);
      try { ctx.close(); } catch { /* */ }
      ctx = null;
    },
    get unlocked() { return unlocked; },
    get currentSong() { return curSong; },
  };
}