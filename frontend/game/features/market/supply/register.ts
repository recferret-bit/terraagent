import type { MarketSnapshotResponse, ResourceKey } from '@terra/contracts';
import type { ViewColony } from '@terra/sim';
import type { FeatureContext, HudPanelInstance } from '../../../core/registry/types';
import { ownColonyIndex, viewColony } from '../../shared/colony';
import { tradePageUrl } from '../tab/quickModel';
import { SupplyPanel } from './SupplyPanel';

/** The Supply & trade HUD panel: reads `colony.supplyTrade` of the player's colony; its buttons only prefill / open the market tab. */
export function mountSupplyPanel(el: HTMLElement, ctx: FeatureContext): HudPanelInstance & { panel: SupplyPanel } {
  const svc = ctx.services;
  const go = (side: 'buy' | 'sell') => (resource: ResourceKey, amount: number): void => {
    if (svc.prefillMarketOrder) svc.prefillMarketOrder({ base: resource, quote: 'USDC', side, amount });
    else svc.openMarketPair?.(resource, 'USDC');
  };
  const panel = new SupplyPanel({
    buy: go('buy'), sell: go('sell'),
    openBoard: () => { window.open(tradePageUrl(svc.session?.planetId() ?? null, 'board'), '_blank', 'noopener'); },
    openContracts: () => svc.contracts?.toggle(),
    snapshot: async (): Promise<MarketSnapshotResponse | null> => {
      const id = ctx.services.session?.planetId() ?? null;
      return id && ctx.services.marketSnapshot ? ctx.services.marketSnapshot(id) : null;
    },
  });
  el.append(panel.el);
  return {
    panel,
    update(view) {
      const col = viewColony(view, ownColonyIndex(ctx.services)) as (ViewColony & { supplyTrade?: Parameters<SupplyPanel['update']>[0] }) | undefined;
      panel.update(col?.supplyTrade);
    },
    dispose() { panel.el.remove(); },
  };
}
