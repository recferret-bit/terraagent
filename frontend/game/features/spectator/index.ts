import { defineFeature } from '../../core/registry/types';
import { SpectatorPanel } from './SpectatorPanel';
import './spectator.css';

export { SpectatorPanel } from './SpectatorPanel';

export default defineFeature({
  id: 'spectator',
  wave: 'W00',
  hud: [
    {
      id: 'spectator-panel',
      slot: 'top-left',
      order: 50,
      mount(el, ctx) {
        return new SpectatorPanel(el, ctx);
      },
    },
  ],
});
