import { defineFeature } from '../../core/registry/types';
import { CombatTuningPanel } from './CombatTuningPanel';
import './combat-tuning.css';

export default defineFeature({
  id: 'combat-tuning', wave: 'W07',
  hud: [{ id: 'combat-tuning', slot: 'top-right', order: 14, mount: (el, ctx) => new CombatTuningPanel(el, ctx) }],
});
