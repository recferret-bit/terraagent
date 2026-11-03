import type { CargoStatusPayload } from '@terra/contracts';
import { defineFeature } from '../../core/registry/types';
import {
  computeTransferBounds,
  formatCargoCount,
  formatTransferPreview,
  ORBIT_FAMILY_GROUPS,
  resolveTradeHubCargoView,
  SUB_RESOURCE_LABELS,
  TradeHubForms,
  TradeHubPanel,
  type OrbitFamilyGroupDef,
  type OrbitSubResourceDef,
  type ResolvedTradeHubCargoView,
  type TradeHubTab,
  type TransferBounds,
} from './TradeHubPanel';
import './trade-hub.css';
import './cargo-ux.css';

export {
  computeTransferBounds,
  formatCargoCount,
  formatTransferPreview,
  ORBIT_FAMILY_GROUPS,
  resolveTradeHubCargoView,
  SUB_RESOURCE_LABELS,
  TradeHubForms,
  TradeHubPanel,
  type OrbitFamilyGroupDef,
  type OrbitSubResourceDef,
  type ResolvedTradeHubCargoView,
  type TradeHubTab,
  type TransferBounds,
};

export {
  CARGO_ERROR_MESSAGES,
  CargoToastController,
  buildOrbitBalancesSection,
  extractPendingTransfers,
  formatCargoErrorToast,
  formatCargoRefundToast,
  formatPendingExportChipText,
  formatPendingImportChipText,
  parseRetryInSeconds,
  type ExtractedPendingTransfers,
  type PendingTransferItem,
} from './cargoUx';

declare module '../../core/registry/types' {
  interface FeatureServices {
    cargoStatus?: CargoStatusPayload | null;
    setCargoStatus?: (status: CargoStatusPayload | null) => void;
    openTradeHubPanel?: (open?: boolean, tab?: TradeHubTab) => void;
    getTradeHubPanel?: () => TradeHubPanel | null;
  }

  interface GameView {
    cargoStatus?: CargoStatusPayload | null;
  }
}

let activePanel: TradeHubPanel | null = null;

export default defineFeature({
  id: 'trade-hub',
  wave: 'W10',
  hud: [
    {
      id: 'trade-hub-panel',
      slot: 'bottom-right',
      order: 25,
      mount(el, ctx) {
        const panel = new TradeHubPanel(el, ctx);
        activePanel = panel;
        ctx.services.getTradeHubPanel = () => activePanel;
        ctx.services.openTradeHubPanel = (open = true, tab?: TradeHubTab) => {
          if (tab) panel.setTab(tab);
          panel.setOpen(open);
        };
        ctx.services.setCargoStatus = (status: CargoStatusPayload | null) => {
          ctx.services.cargoStatus = status;
          panel.setCargoStatus(status);
        };
        return {
          update(view) {
            panel.update(view);
          },
          dispose() {
            if (activePanel === panel) activePanel = null;
            if (ctx.services.getTradeHubPanel) ctx.services.getTradeHubPanel = undefined;
            if (ctx.services.openTradeHubPanel) ctx.services.openTradeHubPanel = undefined;
            if (ctx.services.setCargoStatus) ctx.services.setCargoStatus = undefined;
            panel.dispose();
          },
        };
      },
    },
  ],
  menus: [
    {
      id: 'trade-hub',
      label: 'Trade Hub',
      open() {
        activePanel?.setOpen(true);
      },
    },
  ],
});
