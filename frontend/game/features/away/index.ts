import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { AwayPanel, type AwayPanelOptions } from './AwayPanel';
import './away.css';

export { AwayPanel } from './AwayPanel';
export { AWAY_STORAGE_KEY } from './storage';

declare module '../../core/registry/types' {
  interface FeatureServices {
    getAwayPanel?: () => AwayPanel | null;
  }
}

let active: AwayPanel | null = null;

function optionsFrom(ctx: FeatureContext): AwayPanelOptions {
  const { services } = ctx;
  return {
    sendCommand: services.sendCommand,
    store: services.store,
    flags: ctx.flags,
    mercenary: ctx.flags.has('W22'),
    colonyId: () => services.session?.colonyId?.() ?? null,
    accessToken: () => services.pilot?.view().accessToken || null,
    track: services.track,
    subscribeDirector: (fn) => services.store?.onDirectorStatus?.(fn) ?? (() => {}),
  };
}

export default defineFeature({
  id: 'away',
  wave: 'W09',
  hud: [{
    id: 'away-settings',
    slot: 'top-left',
    order: 21,
    mount(el, ctx) {
      if (!ctx.flags.has('W09')) {
        el.hidden = true;
        return { dispose() {} };
      }
      el.hidden = false;
      const panel = new AwayPanel(el, optionsFrom(ctx));
      active = panel;
      ctx.services.getAwayPanel = () => active;
      return {
        dispose() {
          if (active === panel) active = null;
          panel.dispose();
        },
      };
    },
  }],
});
