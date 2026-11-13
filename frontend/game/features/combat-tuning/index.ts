import { isProductionBuild } from '../../core/buildEnv';
import { defineFeature } from '../../core/registry/types';
import { CombatTuningPanel } from './CombatTuningPanel';
import './combat-tuning.css';

export default defineFeature({
  id: 'combat-tuning', wave: 'W07',
  hud: [{
    id: 'combat-tuning',
    slot: 'top-right',
    order: 16,
    mount: (el, ctx) => {
      if (isProductionBuild()) {
        el.hidden = true;
        el.remove();
        return { dispose() {} };
      }
      return new CombatTuningPanel(el, ctx);
    },
  }],
});
