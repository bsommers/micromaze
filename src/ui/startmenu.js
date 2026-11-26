// Start / pause menu (DOM overlay). Views: main, levels, controls, options, scores.
import { LEVELS } from '../levels/level.js';
import { loadScores, clearScores } from '../core/scores.js';

export const LEVEL_TITLES = {
  store01: 'Front Checkout',
  blackfriday: 'Black Friday',
  gtadrop: 'GTA Drop Day',
  backtoschool: 'Back to School',
  gpuscalper: 'GPU Scalper Panic',
};

const CONTROLS = [
  ['W A S D / Arrows', 'Move'],
  ['Mouse', 'Aim'],
  ['Left click (hold) / Space', 'Fire SCANNER — the default weapon, always active, infinite ammo'],
  ['Right click / F / E', 'Throw BAWLZ grenade — area damage, limited ammo (see HUD)'],
  ['Walk over pickups', 'Grab more Bawlz / health'],
  ['Enter', 'Skip intro'],
  ['G', 'Toggle 16-bit / 32-bit art'],
  ['Esc / P', 'Pause / resume'],
  ['Touch', 'Left stick move, right side fire'],
];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n[k] = v;
  }
  n.append(...kids.filter((x) => x != null));
  return n;
}

/**
 * opts: { currentId, getSettings, onSettings(settings), onPlay(levelId), onResume(), canResume() }
 */
export function createStartMenu(opts) {
  const root = el('div', { id: 'startmenu', hidden: true, role: 'dialog', 'aria-label': 'MicroMaze menu' });
  document.body.appendChild(root);
  let view = 'main';
  let open = false;

  const btn = (label, fn, cls = '') => el('button', { class: 'mbtn ' + cls, type: 'button', textContent: label, onclick: fn });
  const back = () => btn('« Back', () => go('main'), 'sub');

  function slider(label, key) {
    const s = opts.getSettings();
    const out = el('span', { class: 'val', textContent: Math.round(s[key] * 100) + '%' });
    const inp = el('input', {
      type: 'range', min: 0, max: 100, step: 5, value: Math.round(s[key] * 100),
      oninput: (e) => {
        const v = Number(e.target.value) / 100;
        out.textContent = Math.round(v * 100) + '%';
        opts.onSettings({ ...opts.getSettings(), [key]: v });
      },
    });
    return el('label', { class: 'row' }, el('span', { textContent: label }), inp, out);
  }
  function toggle(label, key, on, off) {
    const b = el('button', { class: 'mbtn small', type: 'button' });
    const paint = () => { b.textContent = opts.getSettings()[key] === on ? 'ON' : 'OFF'; };
    paint();
    b.onclick = () => {
      const s = opts.getSettings();
      opts.onSettings({ ...s, [key]: s[key] === on ? off : on });
      paint();
    };
    return el('div', { class: 'row' }, el('span', { textContent: label }), b);
  }
  function gfxRow() {
    const b = el('button', { class: 'mbtn small', type: 'button' });
    const paint = () => { b.textContent = opts.getSettings().gfx === '32bit' ? '32-bit' : '16-bit'; };
    paint();
    b.onclick = () => {
      const s = opts.getSettings();
      opts.onSettings({ ...s, gfx: s.gfx === '16bit' ? '32bit' : '16bit' });
      paint();
    };
    return el('div', { class: 'row' }, el('span', { textContent: 'Graphics' }), b);
  }

  function render() {
    const kids = [];
    if (view === 'main') {
      kids.push(el('h1', { textContent: opts.canResume() ? 'PAUSED' : 'MICRO MAZE' }), el('p', { class: 'tag', textContent: 'Defend the registers. Scanner + Bawlz.' }));
      if (opts.canResume()) kids.push(btn('Resume', () => close(true), 'primary'));
      kids.push(
        btn(opts.canResume() ? 'Restart / Levels' : 'Play', () => go('levels'), opts.canResume() ? '' : 'primary'),
        btn('Controls', () => go('controls')),
        btn('Options', () => go('options')),
        btn('Top Scores', () => go('scores')),
      );
    } else if (view === 'levels') {
      kids.push(el('h2', { textContent: 'Choose a level' }));
      const best = loadScores();
      for (const id of LEVELS) {
        const top = best[id]?.[0];
        kids.push(btn(`${LEVEL_TITLES[id] ?? id}${top ? `  — best ${top.score}` : ''}`, () => opts.onPlay(id), id === opts.currentId ? 'primary' : ''));
      }
      kids.push(back());
    } else if (view === 'controls') {
      kids.push(el('h2', { textContent: 'Controls' }));
      const t = el('table', { class: 'ctl' });
      for (const [k, v] of CONTROLS) t.append(el('tr', {}, el('th', { textContent: k }), el('td', { textContent: v })));
      kids.push(t, back());
    } else if (view === 'options') {
      kids.push(
        el('h2', { textContent: 'Options' }),
        toggle('Mute all', 'mute', true, false),
        slider('Master volume', 'master'),
        slider('SFX volume', 'sfx'),
        slider('Music volume', 'music'),
        gfxRow(),
        toggle('CRT filter', 'crt', true, false),
        back(),
      );
    } else if (view === 'scores') {
      kids.push(el('h2', { textContent: 'Top Scores (this browser)' }));
      const all = loadScores();
      let any = false;
      for (const id of LEVELS) {
        const list = all[id];
        if (!list?.length) continue;
        any = true;
        const ol = el('ol', { class: 'scores' });
        for (const e of list.slice(0, 5)) {
          ol.append(el('li', { textContent: `${String(e.score).padStart(6, ' ')}  ${e.win ? 'WIN ' : 'LOSS'}  ${e.date}` }));
        }
        kids.push(el('h3', { textContent: LEVEL_TITLES[id] ?? id }), ol);
      }
      if (!any) kids.push(el('p', { class: 'tag', textContent: 'No runs yet. Go defend a store.' }));
      kids.push(btn('Clear scores', () => { clearScores(); render(); }, 'sub'), back());
    }
    root.replaceChildren(el('div', { class: 'panel' }, ...kids));
    root.querySelector('button')?.focus();
  }

  function go(v) { view = v; render(); }
  function openMenu(v = 'main') { open = true; view = v; root.hidden = false; render(); }
  function close(resumed) { open = false; root.hidden = true; if (resumed) opts.onResume(); }

  return { open: openMenu, close, get isOpen() { return open; }, toggle() { open ? (opts.canResume() && close(true)) : openMenu('main'); } };
}
