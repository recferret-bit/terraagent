import { CargoFlights } from './CargoFlights';
import type { CargoStatusPayload } from '@terra/contracts';
import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { TradeHubLauncher } from './hubLauncher';
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
/** Opens the active panel from code / the menu and switches its HUD tab book to it (selection-driven opens never do). */
let openActive: ((tab?: TradeHubTab) => void) | null = null;

export function mountTradeHubPanel(el: HTMLElement, ctx: FeatureContext): HudPanelInstance & { panel: TradeHubPanel } {
  const panel = new TradeHubPanel(el, ctx);
  const s = ctx.services;
  const offCloser = s.registerHudCloser?.(() => { if (panel.isOpenState()) panel.setOpen(false); });
  const launcher = new TradeHubLauncher(el, {
    openHub: () => open(),
    openContracts: () => s.contracts?.setOpen(true),
    hasContracts: () => Boolean(s.contracts) && !s.contracts?.isOpen,
  });
  const syncLauncher = (): void => launcher.sync(panel.isOpenState() && panel.root.parentElement === el);
  // Reveal after opening: a selected hub keeps the panel in the selection bar, where the reveal is a no-op.
  const open = (tab?: TradeHubTab, extId?: string): void => {
    if (tab) panel.setTab(tab);
    panel.setOpen(true);
    if (extId) panel.extensions.show(extId);
    s.revealHudPanel?.(panel.root);
    syncLauncher();
  };
  activePanel = panel;
  openActive = (tab) => open(tab);
  s.getTradeHubPanel = () => activePanel;
  s.openTradeHubPanel = (isOpen = true, tab?: TradeHubTab) => {
    if (isOpen) return open(tab);
    if (tab) panel.setTab(tab);
    panel.setOpen(false);
    syncLauncher();
  };
  s.registerTradeHubTab = (def) => panel.extensions.register(def);
  s.showTradeHubTab = (id) => open(undefined, id);
  s.setCargoStatus = (status: CargoStatusPayload | null) => {
    s.cargoStatus = status;
    panel.setCargoStatus(status);
  };
  return {
    panel,
    update(view) {
      panel.update(view);
      syncLauncher();
    },
    dispose() {
      offCloser?.();
      if (activePanel === panel) { activePanel = null; openActive = null; }
      if (s.getTradeHubPanel) s.getTradeHubPanel = undefined;
      if (s.openTradeHubPanel) s.openTradeHubPanel = undefined;
      if (s.setCargoStatus) s.setCargoStatus = undefined;
      s.registerTradeHubTab = undefined;
      s.showTradeHubTab = undefined;
      launcher.dispose();
      panel.dispose();
    },
  };
}

export default defineFeature({
  id: 'trade-hub',
  wave: 'W10',
  renderers: [{ id: 'cargo-flights', mount: (ctx) => new CargoFlights(ctx) }],
  hud: [{ id: 'trade-hub-panel', slot: 'bottom-right', order: 25, mount: mountTradeHubPanel }],
  menus: [
    {
      id: 'trade-hub',
      label: 'Trade Hub',
      open() {
        openActive?.();
      },
    },
  ],
});
