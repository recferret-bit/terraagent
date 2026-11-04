import { defineFeature } from '../../core/registry/types';
import { XpToastHost } from './toast';
import './xp.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    xpToasts?: XpToastHost;
  }
}

export default defineFeature({
  id: 'xp',
  wave: 'W12',
  hostOnly: 'server',
  hud: [
    {
      id: 'xp-toast',
      slot: 'bottom-right',
      order: 75,
      mount(el, ctx) {
        const store = ctx.services.store as { onServerEvents?: never } | undefined;
        const host = new XpToastHost(el, store);
        ctx.services.xpToasts = host;
        return {
          dispose() {
            if (ctx.services.xpToasts === host) ctx.services.xpToasts = undefined;
            host.dispose();
          },
        };
      },
    },
  ],
});
