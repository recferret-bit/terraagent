import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { DeedToastHost } from './deedNotifications';
import { DeedPanel } from './deedPanel';
import { DEED_EVENTS } from './deedTracker';
import { DEED_DEV_COMMANDS } from './devCommands';
import { StakingPanel } from './stakingPanel';
import './deedCardArt.css';
import './deedNotifications.css';
import './deedPanel.css';
import './signerModal.css';
import './stakingPanel.css';

export { DeedPanel, type DeedPanelOptions } from './deedPanel';
export { StakingPanel, type StakingPanelOptions } from './stakingPanel';
export { REAL_NEAR_COPY } from './stakingPanelParts';
export { DeedToastHost, type DeedToastInput } from './deedNotifications';
export {
  createDeedCardArtElement,
  resolveDeedVisualVariant,
  type DeedCardArtOptions,
  type DeedVisualVariant,
} from './deedCardArt';
export {
  buildDeedImageUrl,
  buildDeedSharePath,
  buildDeedShareUrl,
  buildDeedTwitterIntentText,
  buildDeedTwitterIntentUrl,
  extractDeedTokenIdFromLocation,
} from './deedShare';
export { createDeedTracker, DeedTracker, DEED_EVENTS, type DeedEventName } from './deedTracker';
export { DEED_DEV_COMMANDS } from './devCommands';
export { openMockSignerModal, type SignerModalOptions, type SignerModalResult } from './signerModal';

declare module '../../core/registry/types' {
  interface FeatureServices {
    openDeedPanel?: (open?: boolean) => void;
    getDeedPanel?: () => DeedPanel | null;
    getStakingPanel?: () => StakingPanel | null;
    deedToasts?: DeedToastHost;
  }
}

let activeDeedPanel: DeedPanel | null = null;

function mountDeedPanel(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  if (!ctx.flags.has('W20') || ctx.host === 'local') {
    el.hidden = true;
    return { dispose() {} };
  }
  el.hidden = false;
  const panel = new DeedPanel(el, ctx);
  activeDeedPanel = panel;
  ctx.services.getDeedPanel = () => activeDeedPanel;
  ctx.services.getStakingPanel = () => activeDeedPanel?.stakingPanel ?? null;
  ctx.services.openDeedPanel = (open = true) => panel.setOpen(open);

  return {
    update(view) {
      panel.update(view);
    },
    dispose() {
      if (activeDeedPanel === panel) activeDeedPanel = null;
      if (ctx.services.getDeedPanel) ctx.services.getDeedPanel = undefined;
      if (ctx.services.getStakingPanel) ctx.services.getStakingPanel = undefined;
      if (ctx.services.openDeedPanel) ctx.services.openDeedPanel = undefined;
      panel.dispose();
    },
  };
}

function mountDeedToast(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  if (!ctx.flags.has('W20') || ctx.host === 'local') {
    el.hidden = true;
    return { dispose() {} };
  }
  const host = new DeedToastHost(el, ctx.services.store);
  ctx.services.deedToasts = host;
  return {
    dispose() {
      if (ctx.services.deedToasts === host) ctx.services.deedToasts = undefined;
      host.dispose();
    },
  };
}

export default defineFeature({
  id: 'deed',
  wave: 'W20',
  hostOnly: 'server',
  analytics: [...DEED_EVENTS],
  devCommands: [...DEED_DEV_COMMANDS],
  hud: [
    {
      id: 'colony-deed',
      slot: 'top-left',
      order: 22,
      mount: mountDeedPanel,
    },
    {
      id: 'deed-toast',
      slot: 'bottom-right',
      order: 72,
      mount: mountDeedToast,
    },
  ],
  menus: [
    {
      id: 'deed',
      label: 'Deed',
      open() {
        activeDeedPanel?.setOpen(true);
      },
    },
  ],
});
