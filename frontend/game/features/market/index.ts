import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { ContractsController } from './contracts/ContractsController';
import { ContractsLog } from './contracts/contractsLog';
import { ContractsPanel } from './contracts/ContractsPanel';
import { boardHud, boardMenu } from './board';
import { registerMarketTab } from './tab/register';
import './contracts/contracts.css';
import './tab/market-tab.css';
import './order/order.css';
import './stall/stall.css';

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
  hud: [
    boardHud,
    { id: 'market-tab', slot: 'bottom-right', order: 30, mount: (_el, ctx: FeatureContext) => registerMarketTab(ctx) },
    {
      id: 'contracts',
      slot: 'bottom-left',
      order: 60,
      mount(el, ctx: FeatureContext) {
        const log = new ContractsLog();
        const panel = new ContractsPanel(el, log);
        const s = ctx.services;
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
  menus: [boardMenu, { id: 'contracts', label: 'Contracts', open() { active?.setOpen(true); } }],
});
