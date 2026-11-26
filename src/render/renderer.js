import { W, H, TILE, PAL16 } from '../core/defs.js';
import { drawHud } from '../ui/hud.js';
import { drawScreens } from '../ui/screens.js';

function blit(ctx, buf, dx, dy, flipX = false) {
  if (!buf) return;
  const { w, h, rgba } = buf;
  const img = ctx.createImageData(w, h);
  if (!flipX) {
    img.data.set(rgba);
    ctx.putImageData(img, dx | 0, dy | 0);
    return;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + (w - 1 - x)) * 4;
      const di = (y * w + x) * 4;
      img.data[di] = rgba[si];
      img.data[di + 1] = rgba[si + 1];
      img.data[di + 2] = rgba[si + 2];
      img.data[di + 3] = rgba[si + 3];
    }
  }
  ctx.putImageData(img, dx | 0, dy | 0);
}

function spriteName(e) {
  if (e.kind === 'player') {
    if (e.pose === 'down' || e.st?.downT > 0) return 'player_down';
    const moving = Math.abs(e.vx) + Math.abs(e.vy) > 4;
    return moving ? 'player_run' : 'player_idle';
  }
  if (e.kind === 'pickup') return e.st?.give === 'hp' ? 'pickup_hp' : 'pickup_bawlz';
  if (e.kind === 'register') return 'register';
  return e.kind;
}

function tileKey(legend, ch) {
  const k = legend[ch] ?? 'wall';
  return `tile_${k}`;
}

export function createRenderer(canvas, { art, bus, settings, particles } = {}) {
  let pack = art;
  const view = document.createElement('canvas');
  view.width = W;
  view.height = H;
  const vctx = view.getContext('2d');
  vctx.imageSmoothingEnabled = false;

  let lb = { ox: 0, oy: 0, scale: 1 };

  function setArt(next) {
    pack = next;
    vctx.imageSmoothingEnabled = false;
  }
  if (pack) setArt(pack);

  function drawTiles(game, ctx, camX, camY, scale) {
    const level = game.level;
    if (!level?.tiles) return;
    const cols = level.tiles[0].length;
    const ty0 = Math.max(0, Math.floor(camY / TILE));
    const ty1 = Math.min(level.tiles.length, Math.ceil((camY + H) / TILE) + 1);
    const tx0 = Math.max(0, Math.floor(camX / TILE));
    const tx1 = Math.min(cols, Math.ceil((camX + W) / TILE) + 1);
    for (let ty = ty0; ty < ty1; ty++) {
      const row = level.tiles[ty];
      for (let tx = tx0; tx < tx1; tx++) {
        const name = tileKey(level.legend, row[tx]);
        const pix = pack?.get(name, 0);
        const dx = (tx * TILE - camX) * scale;
        const dy = (ty * TILE - camY) * scale;
        if (pix) blit(ctx, pix, dx, dy);
        else {
          ctx.fillStyle = PAL16.floor;
          ctx.fillRect(dx, dy, TILE * scale, TILE * scale);
        }
      }
    }
  }

  function drawEntity(ctx, e, camX, camY, scale, t) {
    if (e.dead && e.kind !== 'register') return;
    const name = spriteName(e);
    if (!pack?.has(name)) return;
    const n = pack.frames(name);
    const fr = (e.frame ?? 0) % Math.max(1, n);
    const pix = pack.get(name, fr);
    if (!pix) return;
    const dx = (e.x - camX - pix.w * 0.5) * scale;
    const dy = (e.y - camY - pix.h * 0.5) * scale;
    const flip = e.face < 0;
    blit(ctx, pix, dx, dy, flip);
    if (e.kind === 'grenade' && e.st?.z) {
      const z = e.st.z * scale;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(dx + 2, dy + pix.h * scale - 2, pix.w * scale - 4, 2 + z * 0.2);
    }
    void t;
  }

  return {
    setArt,
    get letterbox() { return lb; },
    draw(game, alpha = 0, camera = null) {
      if (!pack) return;
      const artScale = pack.scale ?? 1;
      const camX = camera?.x ?? game._camX ?? 0;
      const camY = camera?.y ?? game._camY ?? 0;
      vctx.setTransform(1, 0, 0, 1, 0, 0);
      vctx.fillStyle = PAL16.bg;
      vctx.fillRect(0, 0, W, H);

      drawTiles(game, vctx, camX, camY, 1);
      const drawOrder = [...(game.ents ?? [])].sort((a, b) => a.y - b.y);
      for (const e of drawOrder) drawEntity(vctx, e, camX, camY, 1, alpha);

      if (particles) {
        vctx.save();
        vctx.translate(-camX, -camY);
        particles.particles.draw(vctx);
        vctx.restore();
      }

      const ctx = canvas.getContext('2d');
      const sc = Math.max(1, Math.floor(Math.min(canvas.width / W, canvas.height / H)));
      const dw = W * sc;
      const dh = H * sc;
      lb = { ox: (canvas.width - dw) * 0.5, oy: (canvas.height - dh) * 0.5, scale: sc / artScale };
      camera?.setLetterbox?.(lb.ox, lb.oy, lb.scale);

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(view, 0, 0, W, H, lb.ox, lb.oy, dw, dh);

      const ui = canvas.getContext('2d');
      ui.save();
      ui.setTransform(sc / artScale, 0, 0, sc / artScale, lb.ox, lb.oy);
      drawHud(ui, game, W, H);
      ui.restore();
      drawScreens(ctx, game, canvas.width, canvas.height);
      void settings;
      void bus;
    },
  };
}

/** Fallback art pack when registry.js is not present yet. */
export async function buildArtFallback({ mode = '16bit' } = {}) {
  const bit = mode === '32bit' ? '32' : '16';
  const [chars, store, fx] = await Promise.all([
    import(`../art/px${bit}/chars.js`),
    import(`../art/px${bit}/store.js`),
    import(`../art/px${bit}/fx.js`),
  ]);
  const sprites = { ...chars.build(), ...store.build(), ...fx.build() };
  const scale = mode === '32bit' ? 2 : 1;
  const scaled = new Map();
  return {
    mode: mode === '32bit' ? '32bit' : '16bit',
    scale,
    names: Object.keys(sprites),
    has: (n) => Object.hasOwn(sprites, n),
    frames: (n) => sprites[n]?.length ?? 0,
    get(name, frame = 0) {
      const arr = sprites[name];
      if (!arr?.length) return null;
      const pix = arr[Math.max(0, Math.min(frame | 0, arr.length - 1))];
      if (scale === 1) return pix;
      const key = `${name}:${frame}`;
      if (!scaled.has(key)) scaled.set(key, pix.scaled(2));
      return scaled.get(key);
    },
  };
}