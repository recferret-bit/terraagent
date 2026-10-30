import { defineFeature } from '../../core/registry/types';
import './tick.css';

declare module '../../core/registry/types' {
  interface GameView {
    /** Server tick of the newest replica view (set by the online flow from `WorldStore`). */
    tick?: number;
  }
}

/** `TICK 12345` chip: updates from `HudRoot.update(view)`; shows a dash until a view with a tick arrives. */
export default defineFeature({
  id: 'tick',
  wave: 'W00',
  hud: [{
    id: 'tick', slot: 'top-left',
    mount(el) {
      const root = document.createElement('div');
      root.className = 'ta-tick plate-sm';
      const n = document.createElement('span');
      n.className = 'ta-tick__n';
      n.textContent = '-';
      root.append('TICK ', n);
      el.appendChild(root);
      return {
        update(view) { if (view.tick !== undefined) n.textContent = String(view.tick); },
        dispose: () => root.remove(),
      };
    },
  }],
});
