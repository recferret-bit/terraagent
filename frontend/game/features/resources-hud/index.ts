import { defineFeature } from '../../core/registry/types';
import { ResourcesHud } from './ResourcesHud';
import './resources-hud.css';

export default defineFeature({
  id: 'resources-hud',
  wave: 'W02',
  hud: [
    {
      id: 'resources-hud',
      slot: 'top-center',
      order: 10,
      mount(el, ctx) {
        const hud = new ResourcesHud(el, ctx);
        return {
          update(view) {
            hud.update(view);
          },
          dispose() {
            hud.dispose();
          },
        };
      },
    },
  ],
});
