// Settings persistence. Node-safe when storage is injected / absent.
export const SETTINGS_KEY = 'micromaze.settings';
export const DEFAULTS = Object.freeze({
  master: 0.8, sfx: 1, music: 0.7, mute: false, gfx: '16bit', crt: false,
});

function store(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
const clamp01 = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

export function sanitizeSettings(o) {
  o = o && typeof o === 'object' ? o : {};
  const gfx = o.gfx === '32bit' ? '32bit' : '16bit';
  return {
    master: clamp01(o.master, DEFAULTS.master),
    sfx: clamp01(o.sfx, DEFAULTS.sfx),
    music: clamp01(o.music, DEFAULTS.music),
    mute: typeof o.mute === 'boolean' ? o.mute : DEFAULTS.mute,
    crt: typeof o.crt === 'boolean' ? o.crt : DEFAULTS.crt,
    gfx,
  };
}
export function loadSettings(storage) {
  try {
    const s = store(storage);
    return sanitizeSettings(s ? JSON.parse(s.getItem(SETTINGS_KEY)) : null);
  } catch { return sanitizeSettings(null); }
}
export function saveSettings(settings, storage) {
  try {
    const s = store(storage);
    if (s) { s.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings))); return true; }
  } catch { /* ignore */ }
  return false;
}
