import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { ContractsController } from './contracts/ContractsController';
import { ContractsLog } from './contracts/contractsLog';
import { ContractsPanel } from './contracts/ContractsPanel';
import { MARKET_EVENTS } from './analytics/marketTracker';
import { isInHudBook } from './hudBook';
import { registerMarketTab } from './tab/register';
import './contracts/contracts.css';
import './tab/market-tab.css';
import './order/order.css';
import './stall/stall.css';
import './supply/supply.css';
import { mountSupplyPanel } from './supply/register';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** W13-24: the Contracts list; `toggle()` opens it from a menu or from the Trade Hub panel. */
    contracts?: ContractsPanel;
  }
}

let active: ContractsPanel | undefined;

/** W13 market client. Owns `features/market/**`; the Market tab (W13-20) and other parts add their folders beside `contracts/`. */
export default defineFeature({
  id: 'market',
  wave: 'W13',
  hostOnly: 'server',
  analytics: [...MARKET_EVENTS],
  hud: [
    // bottom-right, not bottom-left: an extra bar in the left stack pushed the command dock under the pilot chip (W02/W03/W08 e2e)
    { id: 'supply-trade', slot: 'bottom-right', order: 64, mount: mountSupplyPanel },
    { id: 'market-tab', slot: 'bottom-right', order: 30, mount: (_el, ctx: FeatureContext) => registerMarketTab(ctx) },
    {
      id: 'contracts',
      slot: 'bottom-left',
      order: 60,
      mount(el, ctx: FeatureContext) {
        const log = new ContractsLog();
        const s = ctx.services;
        // Inside a HUD tab book (Colony book → Trade) the tab shows and hides the list, so it starts open; any later
        // open (menu, Supply's CONTRACTS, Trade Hub) switches the book to that tab.
        const panel = new ContractsPanel(el, log, { reveal: (root) => s.revealHudPanel?.(root), open: isInHudBook(el) });
        const controller = new ContractsController(
          log,
          (msg, sev, ms, key) => s.hudMin?.showToast(msg, sev, ms, key),
          () => s.landfall?.getOwnerColonyIndex(),
          s.store as never,
        );
        s.contracts = panel;
        active = panel;
        return {
          dispose() {
            if (s.contracts === panel) s.contracts = undefined;
            if (active === panel) active = undefined;
            controller.dispose();
            panel.dispose();
          },
        };
      },
    },
  ],
  menus: [{ id: 'contracts', label: 'Contracts', open() { active?.setOpen(true); } }],
});
