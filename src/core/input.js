/** Browser input → sim Input. getCamera() may expose { x, y, lb: { ox, oy, scale } } for aim. */
export function createInput(canvas, getCamera, { onGfxToggle } = {}) {
  const keys = new Set();
  let ptrX = 0;
  let ptrY = 0;
  let inCanvas = false;
  let fire = false;
  let rmb = false;
  let throwEdge = false;
  let startEdge = false;
  let gDown = false;

  const onKey = (e, down) => {
    const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter'].includes(k) || k.length === 1) {
      if (down) keys.add(k);
      else keys.delete(k);
    }
    if (down && k === 'g') gDown = true;
    if (down && (k === 'enter' || k === ' ')) startEdge = true;
    if (down && !e.repeat && (k === 'f' || k === 'e')) throwEdge = true;
    if (e.code === 'Space' && down) e.preventDefault();
  };

  const onPtr = (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (canvas.width / r.width);
    const sy = (e.clientY - r.top) * (canvas.height / r.height);
    inCanvas = sx >= 0 && sy >= 0 && sx <= canvas.width && sy <= canvas.height;
    ptrX = sx;
    ptrY = sy;
  };

  const onBtn = (e, down) => {
    if (e.button === 0) fire = down;
    if (e.button === 2 && down) throwEdge = true;
    if (e.button === 2) rmb = down;
    if (down) e.preventDefault();
  };

  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  canvas.addEventListener('mousemove', onPtr);
  canvas.addEventListener('mousedown', (e) => onBtn(e, true));
  window.addEventListener('mouseup', (e) => onBtn(e, false));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mouseleave', () => { inCanvas = false; });

  function normMove() {
    let mx = 0;
    let my = 0;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    const L = Math.hypot(mx, my);
    if (L > 1) { mx /= L; my /= L; }
    return { mx, my };
  }

  function aimWorld() {
    const cam = getCamera?.() ?? { x: 0, y: 0, lb: { ox: 0, oy: 0, scale: 1 } };
    const lb = cam.lb ?? { ox: 0, oy: 0, scale: 1 };
    const wx = cam.x + (ptrX - lb.ox) / lb.scale;
    const wy = cam.y + (ptrY - lb.oy) / lb.scale;
    return { ax: wx, ay: wy };
  }

  return {
    sample(player) {
      const { mx, my } = normMove();
      let ax = 0;
      let ay = 0;
      if (inCanvas) {
        const a = aimWorld();
        ax = a.ax;
        ay = a.ay;
        if (player && Number.isFinite(player.x)) {
          ax -= player.x;
          ay -= player.y;
        }
      }
      const L = Math.hypot(ax, ay);
      if (L < 0.5) { ax = 0; ay = 0; }
      const out = {
        mx, my, ax, ay,
        fire: fire || keys.has(' '),
        throwPressed: throwEdge,
        startPressed: startEdge,
      };
      throwEdge = false;
      startEdge = false;
      if (gDown) { gDown = false; onGfxToggle?.(); }
      return out;
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    },
  };
}