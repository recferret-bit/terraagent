import { defineFeature } from '../../core/registry/types';
import { DirectorPanel } from './DirectorPanel';
import './director.css';

export { DirectorPanel } from './DirectorPanel';
export type { DirectorActionRow } from './DirectorPanel';

export default defineFeature({
  id: 'director',
  wave: 'W16',
  hud: [{
    id: 'director-status',
    slot: 'top-right',
    order: 20,
    mount(el, ctx) {
      if (!ctx.flags.has('W16')) {
        el.hidden = true;
        return { dispose() {} };
      }
      const panel = new DirectorPanel(el);
      return { dispose() { panel.dispose(); } };
    },
  }],
});
