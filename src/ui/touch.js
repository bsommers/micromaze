/** Optional on-screen stick for mobile — merges into Input when pointers hit zones. */
export function createTouch(canvas) {
  const state = { mx: 0, my: 0, fire: false, throwPressed: false, active: false };
  if (!canvas || typeof canvas.addEventListener !== 'function') {
    return { sample: () => ({ ...state }), dispose() {} };
  }
  const on = (type, fn) => canvas.addEventListener(type, fn, { passive: false });
  function read(e) {
    const t = e.changedTouches?.[0] || e;
    const rect = canvas.getBoundingClientRect();
    const x = (t.clientX - rect.left) / rect.width;
    const y = (t.clientY - rect.top) / rect.height;
    // left third = stick, right = fire
    if (x < 0.4) {
      state.mx = (x - 0.2) * 5;
      state.my = (y - 0.5) * 2;
      const L = Math.hypot(state.mx, state.my) || 1;
      if (L > 1) { state.mx /= L; state.my /= L; }
      state.active = true;
    } else {
      state.fire = true;
    }
  }
  const start = (e) => { e.preventDefault(); read(e); };
  const move = (e) => { e.preventDefault(); if (state.active) read(e); };
  const end = (e) => {
    e.preventDefault();
    state.mx = 0; state.my = 0; state.fire = false; state.throwPressed = false; state.active = false;
  };
  on('touchstart', start); on('touchmove', move); on('touchend', end); on('touchcancel', end);
  return {
    sample() {
      const out = {
        mx: state.mx, my: state.my, fire: state.fire,
        throwPressed: state.throwPressed, active: state.active,
      };
      state.throwPressed = false;
      return out;
    },
    dispose() {},
  };
}
