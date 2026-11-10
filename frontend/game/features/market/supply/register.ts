import type { MarketSnapshotResponse, ResourceKey } from '@terra/contracts';
import type { ViewColony } from '@terra/sim';
import type { FeatureContext, HudPanelInstance } from '../../../core/registry/types';
import { ownColonyIndex, viewColony } from '../../shared/colony';
import { isInHudBook } from '../hudBook';
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
    // Opens (never toggles shut) the Contracts list; ContractsPanel reveals its book tab.
    openContracts: () => svc.contracts?.setOpen(true),
    snapshot: async (): Promise<MarketSnapshotResponse | null> => {
      const id = ctx.services.session?.planetId() ?? null;
      return id && ctx.services.marketSnapshot ? ctx.services.marketSnapshot(id) : null;
    },
  });
  el.append(panel.el);
  // In a tab book (Colony book → Supply) the tab is the show/hide: start open; the SHOW/HIDE toggle is hidden by CSS.
  const empty = isInHudBook(el) ? supplyEmptyState(el) : null;
  if (empty) panel.setOpen(true);
  return {
    panel,
    update(view) {
      const col = viewColony(view, ownColonyIndex(ctx.services)) as (ViewColony & { supplyTrade?: Parameters<SupplyPanel['update']>[0] }) | undefined;
      panel.update(col?.supplyTrade);
      if (empty) empty.hidden = !panel.el.hidden;
    },
    dispose() { panel.el.remove(); empty?.remove(); },
  };
}

/** Muted line shown in the Supply tab while the colony has no supply & trade view (the panel itself hides then). */
function supplyEmptyState(parent: HTMLElement): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'ta-supply-empty';
  empty.dataset.testid = 'supply-empty';
  empty.textContent = 'No supply & trade data for this colony yet.';
  empty.hidden = true;
  parent.append(empty);
  return empty;
}
