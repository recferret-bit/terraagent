import { defineFeature } from '../../core/registry/types';
import { devConsoleEnabled } from '../../dev/console';
import '../../net/services';
import './netstats.css';

const ROWS = [['mode', 'PREDICT'], ['pending', 'PENDING'], ['rollbacks', 'ROLLBACKS'], ['correction', 'CORRECTION'], ['p95', 'STEP P95']] as const;

/** Dev-only overlay: prediction mode, pending commands, rollbacks, last correction (tiles) and worker step p95. */
export default defineFeature({
  id: 'netstats',
  wave: 'W00',
  hud: [{
    id: 'netstats', slot: 'bottom-right',
    mount(el) {
      if (!devConsoleEnabled()) return { dispose() {} };
      const root = document.createElement('div');
      root.className = 'ta-netstats plate-sm';
      root.dataset.testid = 'netstats';
      const cells = new Map<string, HTMLElement>();
      for (const [key, label] of ROWS) {
        const row = document.createElement('div');
        const v = document.createElement('span');
        v.className = 'ta-netstats__v';
        v.dataset.k = key;
        v.textContent = '-';
        row.append(`${label} `, v);
        root.appendChild(row);
        cells.set(key, v);
      }
      el.appendChild(root);
      const set = (k: string, t: string) => { const c = cells.get(k); if (c && c.textContent !== t) c.textContent = t; };
      return {
        update(view) {
          const n = view.net;
          if (!n) return;
          set('mode', n.mode.toUpperCase());
          set('pending', String(n.pending));
          set('rollbacks', String(n.rollbacks));
          set('correction', `${n.correctionTiles.toFixed(2)} t`);
          set('p95', `${n.p95Ms.toFixed(2)} ms`);
        },
        dispose: () => root.remove(),
      };
    },
  }],
});
