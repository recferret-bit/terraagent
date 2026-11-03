import {
  defineFeature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import { ENTITY_KIND } from '@terra/sim';
import '../../net/services';
import { ownColonyIndex } from '../shared/colony';
import type { InProcessHost } from '../shared/commandDispatch';
import type { TilePickerFn } from '../shared/pointer';
import {
  BrushController,
  type BrushCommandSink,
  type BrushStrokeOptions,
  type BrushStrokeOutcome,
  type BrushStrokeSummary,
  type TerraformButtonOp,
  type TerraformOpId,
  type TerraformPrimaryOp,
  type TerraformWireArgs,
  type TileCoord,
  type WorkIntent,
} from './BrushController';
import {
  calculateDismantleRefund,
  calculateRepairCost,
  DISMANTLE_REFUND_RATIO,
  FULL_REPAIR_COST_RATIO,
  planBrushStroke,
  type BrushOpSelection,
  type PlannedTileJob,
} from './planner';
import { bindResourceFoundToasts, resourceFoundText, type ResourceFoundSource } from './resourceFound';
import { incomeReferenceRows, resourceFindRow, timeReferenceRows, type ReferenceTableRow } from './referenceTables';
import { PRIMARY_OP_DEFS, TerraformMenu, type TerraformPrimaryOpDef } from './TerraformMenu';
import {
  computeOverlayState,
  extractColonyOrders,
  TileOverlay,
  type OverlayJobEntry,
  type OverlayOrderProgress,
  type OverlayTileEntry,
  type TileOverlayState,
  type TilePrepStateName,
} from './TileOverlay';
import './terraform-basic.css';

export {
  BrushController,
  calculateDismantleRefund,
  calculateRepairCost,
  computeOverlayState,
  DISMANTLE_REFUND_RATIO,
  extractColonyOrders,
  FULL_REPAIR_COST_RATIO,
  planBrushStroke,
  incomeReferenceRows,
  PRIMARY_OP_DEFS,
  resourceFoundText,
  resourceFindRow,
  TerraformMenu,
  timeReferenceRows,
  TileOverlay,
  type BrushCommandSink,
  type BrushOpSelection,
  type BrushStrokeOptions,
  type BrushStrokeOutcome,
  type BrushStrokeSummary,
  type OverlayJobEntry,
  type OverlayOrderProgress,
  type OverlayTileEntry,
  type PlannedTileJob,
  type ReferenceTableRow,
  type TerraformButtonOp,
  type TerraformOpId,
  type TerraformPrimaryOp,
  type TerraformPrimaryOpDef,
  type TerraformWireArgs,
  type TileCoord,
  type TileOverlayState,
  type TilePrepStateName,
  type WorkIntent,
};

export interface TerraformFeatureHandle extends HudPanelInstance {
  readonly el: HTMLElement;
  readonly overlayEl: HTMLElement;
  readonly menu: TerraformMenu;
  readonly brush: BrushController;
  readonly overlay: TileOverlay;
  selectOp(op: BrushOpSelection): void;
  getSelectedOp(): BrushOpSelection;
  strokeTile(q: number, r: number, opts?: BrushStrokeOptions): BrushStrokeSummary;
  /** Cancels the host order `orderId` (default: the active order in the view); false when there is none. */
  cancelOrder(orderId?: string): boolean;
  disarm(): void;
  isArmed(): boolean;
  hasWorkerAvailable(): boolean;
  toggleOverlay(on?: boolean): boolean;
  getOverlayState(): TileOverlayState;
  getLastStroke(): BrushStrokeSummary | null;
  getLastOutcome(): BrushStrokeOutcome | null;
  bindSurface(surface: HTMLElement, pickTile?: TilePickerFn): () => void;
  update(view: GameView): void;
}

declare module '../../core/registry/types' {
  interface GameView {
    colonyId?: number;
    planet?: { id: string; type: string; radius: number };
    tiles?: {
      count: number;
      terrain: Uint8Array;
      prep: Uint8Array;
      height?: Float32Array;
      owner: Int8Array;
      deposit?: Uint8Array;
      explored?: Uint8Array;
    };
    blobs?: Record<string, unknown>;
  }

  interface FeatureServices {
    colonyId?: number;
    /** The map element pointer input is read from (the WebGL canvas when absent). */
    surface?: HTMLElement | null;
    /** An in-process authoritative host (tests / tools); the online session talks through `sendCommand`. */
    host?: InProcessHost;
    terraform?: TerraformFeatureHandle;
  }
}

export interface MountTerraformOptions {
  flags?: ReadonlySet<string>;
  /** In-process authoritative host: commands are submitted to it, views read from it. */
  host?: InProcessHost;
  colonyId?: number;
  sendCommand?: (kind: string, args?: unknown) => unknown;
  enqueueTerraform?: BrushCommandSink['enqueueTerraform'];
  store?: BrushCommandSink['store'];
  surface?: HTMLElement | null;
  pickTile?: TilePickerFn;
  services?: Partial<FeatureContext['services']>;
}

/** Mounts the `terraform-basic` menu, brush controller, and tile-state overlay into `el`. */
export function mountTerraformBasic(el?: HTMLElement, opts?: MountTerraformOptions): TerraformFeatureHandle {
  const container = el ?? document.body;
  const services = opts?.services ?? {};
  const simHost = opts?.host ?? services.host;
  const store = opts?.store ?? services.store;
  const getColonyId = () => ownColonyIndex(services, opts?.colonyId);
  const isBlocked = () =>
    services.hubPlacement?.isPlacementActive() === true || (services.getPlacementGhostState?.() ?? null) !== null;
  /** The selected own alive worker (HQ Drone, Harvester) works the order; else (a building, a deposit, nothing) the host picks. */
  const getWorkerId = () => {
    const sel = services.landfall?.getSelectedEntity?.();
    const isWorker = sel?.isUnit && (sel.kind === ENTITY_KIND.hq || sel.kind === ENTITY_KIND.harvester) && !(sel.hp <= 0);
    return isWorker ? sel.entityId : undefined;
  };

  const overlay = new TileOverlay(container, getColonyId);
  let menu: TerraformMenu | null = null;
  let lastSyncedTick = -1;

  const syncView = (v?: GameView | null) => {
    const resolved = v ?? (simHost ? simHost.view() : store?.latest ?? null);
    if (resolved) {
      lastSyncedTick = typeof resolved.tick === 'number' ? resolved.tick : lastSyncedTick;
      brush.setView(resolved);
    }
    overlay.update(resolved);
    menu?.render();
  };

  const brush = new BrushController({
    sendCommand: opts?.sendCommand ?? services.sendCommand,
    enqueueTerraform: opts?.enqueueTerraform,
    store,
    host: simHost,
    getColonyId,
    getWorkerId,
    isBlocked,
    simData: () => store?.simData?.(),
    onChange: () => syncView(),
  });

  menu = new TerraformMenu(container, brush, overlay, { isBlocked, getColonyId, simData: () => store?.simData?.() });

  const surface = opts?.surface ?? services.surface ?? services.canvas;
  const pickTile = opts?.pickTile ?? services.pickTile;
  if (surface) brush.bindSurface(surface, pickTile);

  const offHostEvents = simHost?.onEvents ? simHost.onEvents(() => syncView(simHost.view())) : null;
  const offFound = bindResourceFoundToasts(store as ResourceFoundSource | undefined, getColonyId, (m) =>
    services.hudMin?.showToast(m, 'info', 6000, `found:${m}`),
  );
  syncView();

  const handle: TerraformFeatureHandle = {
    el: menu.el,
    overlayEl: overlay.el,
    menu,
    brush,
    overlay,
    selectOp: (op) => {
      brush.selectOp(op);
      menu?.render();
    },
    getSelectedOp: () => brush.getSelectedOp(),
    strokeTile: (q, r, strokeOpts) => brush.strokeTile(q, r, strokeOpts),
    cancelOrder: (orderId) => brush.cancelOrder(orderId ?? overlay.getActiveOrder()?.orderId),
    disarm: () => brush.disarm(),
    isArmed: () => brush.isArmed(),
    hasWorkerAvailable: () => brush.hasWorkerAvailable(),
    toggleOverlay: (on) => {
      const next = overlay.setVisible(on);
      menu?.render();
      return next;
    },
    getOverlayState: () => {
      if (simHost && (simHost.tick ?? -1) !== lastSyncedTick) {
        syncView(simHost.view());
      }
      return overlay.getState();
    },
    getLastStroke: () => brush.getLastStroke(),
    getLastOutcome: () => brush.getLastOutcome(),
    bindSurface: (surf, pick) => brush.bindSurface(surf, pick),
    update: (view) => syncView(view),
    dispose: () => {
      offHostEvents?.();
      offFound();
      brush.dispose();
      menu?.dispose();
      overlay.dispose();
    },
  };

  if (opts?.services) {
    opts.services.terraform = handle;
  }
  return handle;
}

export const terraformBasicFeature = defineFeature({
  id: 'terraform-basic',
  wave: 'W01',
  hud: [
    {
      id: 'terraform-menu',
      // Left column, above the HQ panel: the right column holds construction (+ its placement card) and dev panels,
      // which together would grow into the top-right stack on a 720 p screen.
      slot: 'bottom-left',
      order: 5,
      mount(el, ctx) {
        return mountTerraformBasic(el, { flags: ctx.flags, services: ctx.services });
      },
    },
  ],
  menus: [
    {
      id: 'terraform',
      label: 'Terraform',
      open(ctx) {
        ctx.services.terraform?.toggleOverlay(true);
      },
    },
  ],
});

export default terraformBasicFeature;
