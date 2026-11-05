import type { FeatureContext, HudPanelInstance } from '../../../core/registry/types';
import { MarketTab } from './MarketTab';

/** Adds the MARKET tab to the Trade Hub panel; retries on each view update until the panel has mounted (HUD mount order). */
export function registerMarketTab(ctx: FeatureContext): HudPanelInstance {
  let off: (() => void) | null = null;
  const tryRegister = (): void => {
    if (off || !ctx.services.registerTradeHubTab) return;
    off = ctx.services.registerTradeHubTab({ id: 'market', label: 'MARKET', mount: (el, c) => new MarketTab(el, c) });
  };
  tryRegister();
  return { update: tryRegister, dispose: () => { off?.(); off = null; } };
}
