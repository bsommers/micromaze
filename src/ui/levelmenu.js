// DOM level picker + end-of-level overlay. No sim access beyond a read-only outcome.
import { LEVELS } from '../levels/level.js';

import { LEVEL_TITLES as TITLES } from './startmenu.js';

function href(id) {
  const u = new URL(globalThis.location.href);
  u.searchParams.set('level', id);
  u.searchParams.set('autostart', '1');
  return u.pathname + u.search;
}

export function createLevelMenu(currentId) {
  const ov = document.createElement('div');
  ov.id = 'endcard';
  ov.hidden = true;
  document.body.appendChild(ov);

  let shown = false;
  return {
    update(outcome) {
      if (!outcome || shown) return;
      shown = true;
      const i = LEVELS.indexOf(currentId);
      const next = LEVELS[i + 1];
      const h = document.createElement('h2');
      h.textContent = outcome.win ? 'LEVEL CLEARED' : 'STORE OVERRUN';
      const row = document.createElement('p');
      const retry = Object.assign(document.createElement('a'), { href: href(currentId), textContent: 'Retry' });
      row.appendChild(retry);
      if (outcome.win && next) {
        row.appendChild(Object.assign(document.createElement('a'), { href: href(next), textContent: `Next: ${TITLES[next] ?? next}` }));
      }
      ov.replaceChildren(h, row);
      ov.hidden = false;
    },
  };
}
