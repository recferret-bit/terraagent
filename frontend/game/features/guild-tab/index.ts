import { defineFeature } from '../../core/registry/types';
import { registerGuildTab } from './register';
import './guild-tab.css';

/** Trade Hub GUILD tab. Absent from the registry unless wave `W15` is on. */
export default defineFeature({
  id: 'guild-tab',
  wave: 'W15',
  hud: [{
    id: 'guild-tab',
    slot: 'bottom-right',
    order: 31,
    mount(el, ctx) {
      el.hidden = true;
      return registerGuildTab(ctx);
    },
  }],
});
