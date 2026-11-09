import { readDirectorView } from '@terra/sim';
import { defineFeature } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import { DirectorPanel } from './DirectorPanel';
import { directorDevCommands } from './devCommands';
import './director.css';

export { DirectorPanel } from './DirectorPanel';
export type { DirectorActionRow } from './DirectorPanel';

declare module '../../core/registry/types' {
  interface FeatureServices {
    getDirectorPanel?: () => DirectorPanel | null;
  }
}

let activeDirectorPanel: DirectorPanel | null = null;

export default defineFeature({
  id: 'director',
  wave: 'W16',
  analytics: ['director.policy_changed'],
  hud: [{
    id: 'director-status',
    slot: 'top-right',
    order: 20,
    mount(el, ctx) {
      if (!ctx.flags.has('W16')) {
        el.hidden = true;
        return { dispose() {} };
      }
      el.hidden = false;
      const panel = new DirectorPanel(el, {
        onPolicyChange(patch) {
          const send = ctx.services.sendCommand ?? ctx.services.store?.sendCommand;
          if (send) void send('setDirectorPolicy', patch);
          ctx.services.track?.('director.policy_changed', {
            risk: patch.risk ?? 'conservative',
            preset: patch.preset ?? 'resources',
          });
        },
      });
      activeDirectorPanel = panel;
      ctx.services.getDirectorPanel = () => activeDirectorPanel;

      const sync = (view: unknown) => {
        if (!view) return;
        panel.syncPolicy(readDirectorView(view, ownColonyIndex(ctx.services)));
      };
      if (ctx.services.store?.latest) sync(ctx.services.store.latest);
      const offView = ctx.services.store?.onView?.((v) => sync(v));

      return {
        update(view) {
          sync(view);
        },
        dispose() {
          offView?.();
          if (activeDirectorPanel === panel) activeDirectorPanel = null;
          panel.dispose();
        },
      };
    },
  }],
  devCommands: directorDevCommands(import.meta.env.PROD ? 'production' : 'development'),
});
