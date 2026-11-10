import {
  defineFeature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import { ENTITY_KIND } from '@terra/sim';
import '../../net/services';
import { isDockPaneShown } from '../../core/hud/CommandDock';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import { ownColonyIndex } from '../shared/colony';
import type { InProcessHost } from '../shared/commandDispatch';
import type { TilePickerFn } from '../shared/pointer';
import {
  BrushController,
  type BrushCommandSink,
  type BrushStrokeOptions,
  type BrushStrokeOutcome,
  type BrushStrokeSummary,
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
  planTerraformTiles,
  type PlannedTileJob,
} from './planner';
import { bindResourceFoundToasts, resourceFoundText, type ResourceFoundSource } from './resourceFound';
import { TargetHighlight3D } from './TargetHighlight3D';
import { terraformTargetIdsAt, terraformTargetTiles } from './targets';
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
  planTerraformTiles,
  PRIMARY_OP_DEFS,
  resourceFoundText,
  TargetHighlight3D,
  TerraformMenu,
  terraformTargetIdsAt,
  terraformTargetTiles,
  TileOverlay,
  type BrushCommandSink,
  type BrushStrokeOptions,
  type BrushStrokeOutcome,
  type BrushStrokeSummary,
  type OverlayJobEntry,
  type OverlayOrderProgress,
  type OverlayTileEntry,
  type PlannedTileJob,
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
  selectOp(op: TerraformPrimaryOp): void;
  getSelectedOp(): TerraformPrimaryOp;
  strokeTile(q: number, r: number, opts?: BrushStrokeOptions): BrushStrokeSummary;
  /** Cancels the host order `orderId` (default: the active order in the view); false when there is none. */
  cancelOrder(orderId?: string): boolean;
  /** The hexes lit as terraform targets now (the colony's open terraform jobs); empty without a 3D scene. */
  getTargetTiles(): readonly TileCoord[];
  /** The hex the armed brush previews under the pointer, or `null`. */
  getHoverTile(): TileCoord | null;
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
      owner: Int16Array | Int8Array;
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

function resolveSelectedWorkerId(services: Partial<FeatureContext['services']>): number | undefined {
  const sel = services.landfall?.getSelectedEntity?.();
  const isWorker =
    sel?.isUnit &&
    (sel.kind === ENTITY_KIND.hq || sel.kind === ENTITY_KIND.worker) &&
    !(sel.hp <= 0);
  return isWorker ? sel.entityId : undefined;
}

function bindHoverHighlight(
  surface: HTMLElement | null | undefined,
  pickTile: TilePickerFn | undefined,
  brush: BrushController,
  getTargets: () => TargetHighlight3D | null,
): () => void {
  if (!surface) return () => {};
  let hoverAt = 0;
  const onMove = (e: PointerEvent) => {
    const targets = getTargets();
    if (!pickTile || !brush.isPointerActive()) return targets?.setHover(null);
    const t = performance.now();
    if (t - hoverAt < 50) return;
    hoverAt = t;
    targets?.setHover(pickTile(e.clientX, e.clientY));
  };
  const onLeave = () => getTargets()?.setHover(null);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerleave', onLeave);
  return () => {
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerleave', onLeave);
  };
}

function buildTerraformHandle(params: {
  menu: TerraformMenu;
  brush: BrushController;
  overlay: TileOverlay;
  getTargets: () => TargetHighlight3D | null;
  syncView: (v?: GameView | null) => void;
  ensureLatestHostSync: () => void;
  disposeAll: () => void;
}): TerraformFeatureHandle {
  const { menu, brush, overlay, getTargets, syncView, ensureLatestHostSync, disposeAll } = params;
  return {
    el: menu.el,
    overlayEl: overlay.el,
    menu,
    brush,
    overlay,
    selectOp: (op) => { brush.selectOp(op); menu.render(); },
    getSelectedOp: () => brush.getSelectedOp(),
    strokeTile: (q, r, strokeOpts) => brush.strokeTile(q, r, strokeOpts),
    cancelOrder: (orderId) => brush.cancelOrder(orderId ?? overlay.getActiveOrder()?.orderId),
    getTargetTiles: () => getTargets()?.getTiles() ?? [],
    getHoverTile: () => getTargets()?.getHover() ?? null,
    disarm: () => brush.disarm(),
    isArmed: () => brush.isArmed(),
    hasWorkerAvailable: () => brush.hasWorkerAvailable(),
    toggleOverlay: (on) => { const next = overlay.setVisible(on); menu.render(); return next; },
    getOverlayState: () => { ensureLatestHostSync(); return overlay.getState(); },
    getLastStroke: () => brush.getLastStroke(),
    getLastOutcome: () => brush.getLastOutcome(),
    bindSurface: (surf, pick) => brush.bindSurface(surf, pick),
    update: (view) => syncView(view),
    dispose: disposeAll,
  };
}

/** Mounts the `terraform-basic` menu, brush controller, and tile-state overlay into `el`. */
export function mountTerraformBasic(el?: HTMLElement, opts?: MountTerraformOptions): TerraformFeatureHandle {
  const container = el ?? document.body;
  const services = opts?.services ?? {};
  const simHost = opts?.host ?? services.host;
  const store = opts?.store ?? services.store;
  const getColonyId = () => ownColonyIndex(services, opts?.colonyId);
  const isBlocked = () =>
    isGameInputBlocked() ||
    services.hubPlacement?.isPlacementActive() === true || (services.getPlacementGhostState?.() ?? null) !== null;
  const getWorkerId = () => resolveSelectedWorkerId(services);

  const overlay = new TileOverlay(container, getColonyId);
  let menu: TerraformMenu | null = null;
  let targets: TargetHighlight3D | null = null;
  let lastSyncedTick = -1;

  const syncView = (v?: GameView | null) => {
    const resolved = v ?? (simHost ? simHost.view() : store?.latest ?? null);
    if (resolved) {
      lastSyncedTick = typeof resolved.tick === 'number' ? resolved.tick : lastSyncedTick;
      brush.setView(resolved);
    }
    overlay.update(resolved);
    if (!targets && services.scene3d) targets = new TargetHighlight3D(services.scene3d);
    targets?.update(resolved, getColonyId());
    if (!brush.isPointerActive()) targets?.setHover(null);
    menu?.render();
  };

  const brush = new BrushController({
    sendCommand: opts?.sendCommand ?? services.sendCommand,
    enqueueTerraform: opts?.enqueueTerraform,
    store,
    host: simHost,
    getColonyId,
    getWorkerId,
    isBlocked: () => isBlocked() || (menu !== null && !isDockPaneShown(menu.el)),
    simData: () => store?.simData?.(),
    onChange: () => syncView(),
  });

  menu = new TerraformMenu(container, brush, overlay, { isBlocked, getColonyId, flags: opts?.flags });

  const surface = opts?.surface ?? services.surface ?? services.canvas;
  const pickTile = opts?.pickTile ?? services.pickTile;
  if (surface) brush.bindSurface(surface, pickTile);
  const offHover = bindHoverHighlight(surface, pickTile, brush, () => targets);

  const offHostEvents = simHost?.onEvents ? simHost.onEvents(() => syncView(simHost.view())) : null;
  const offFound = bindResourceFoundToasts(store as ResourceFoundSource | undefined, getColonyId, (m) =>
    services.hudMin?.showToast(m, 'info', 6000, `found:${m}`),
  );
  syncView();
  const offCloser = services.registerHudCloser?.(() => brush.disarm());

  const handle = buildTerraformHandle({
    menu,
    brush,
    overlay,
    getTargets: () => targets,
    syncView,
    ensureLatestHostSync: () => {
      if (simHost && (simHost.tick ?? -1) !== lastSyncedTick) syncView(simHost.view());
    },
    disposeAll: () => { offCloser?.(); offHover(); offHostEvents?.(); offFound(); brush.dispose(); menu?.dispose(); overlay.dispose(); targets?.dispose(); },
  });

  if (opts?.services) opts.services.terraform = handle;
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
