import type { MarketTokenKey, ResourceKey } from '@terra/contracts';
import type { FeatureContext, HudPanelInstance } from '../../../core/registry/types';
import { MarketTab } from './MarketTab';

declare module '../../../core/registry/types' {
  interface FeatureServices {
    /** Opens the Trade Hub panel's MARKET tab on a pair (no order is created). */
    openMarketPair?: (base: ResourceKey, quote: MarketTokenKey) => void;
    /** Opens the MARKET tab on the pair with side and amount prefilled in the order form. Never submits (W13-55). */
    prefillMarketOrder?: (o: { base: ResourceKey; quote: MarketTokenKey; side: 'buy' | 'sell'; amount: number }) => void;
  }
}

/** Adds the MARKET tab to the Trade Hub panel; retries on each view update until the panel has mounted (HUD mount order). */
export function registerMarketTab(ctx: FeatureContext): HudPanelInstance {
  let off: (() => void) | null = null;
  let tab: MarketTab | null = null;
  const tryRegister = (): void => {
    if (off || !ctx.services.registerTradeHubTab) return;
    off = ctx.services.registerTradeHubTab({ id: 'market', label: 'MARKET', mount: (el, c) => (tab = new MarketTab(el, c)) });
    ctx.services.prefillMarketOrder = (o) => {
      ctx.services.showTradeHubTab?.('market');
      tab?.prefill(o.base, o.quote, o.side, o.amount);
    };
    ctx.services.openMarketPair = (base, quote) => {
      ctx.services.showTradeHubTab?.('market');
      tab?.setPair(base, quote);
    };
  };
  tryRegister();
  return { update: tryRegister, dispose: () => { off?.(); off = null; ctx.services.openMarketPair = undefined; ctx.services.prefillMarketOrder = undefined; } };
}
