import type { PlanetState } from '@terra/sim';
import {
  defineFeature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import '../../net/services';
import {
  BrushController,
  computeBoxTiles,
  planBrushStroke,
  type BrushCommandSink,
  type BrushMode,
  type BrushOpSelection,
  type BrushStrokeOptions,
  type BrushStrokeSummary,
  type PlannedTileJob,
  type TileCoord,
} from './BrushController';
import { ensureDom } from './dom';
import { TerraformMenu } from './TerraformMenu';
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
  computeBoxTiles,
  computeOverlayState,
  ensureDom,
  extractColonyOrders,
  planBrushStroke,
  TerraformMenu,
  TileOverlay,
  type BrushCommandSink,
  type BrushMode,
  type BrushOpSelection,
  type BrushStrokeOptions,
  type BrushStrokeSummary,
  type OverlayJobEntry,
  type OverlayOrderProgress,
  type OverlayTileEntry,
  type PlannedTileJob,
  type TileCoord,
  type TileOverlayState,
  type TilePrepStateName,
};

export interface SimHostLike {
  readonly state: PlanetState;
  readonly tick?: number;
  readonly pending: number;
  submit(cmd: {
    colonyIndex: number | null;
    source: 'player';
    commandId: string;
    kind: string;
    args: unknown;
  }): void;
  view(): GameView;
  onEvents?: (cb: () => void) => () => void;
}

export interface TerraformFeatureHandle extends HudPanelInstance {
  readonly el: HTMLElement;
  readonly overlayEl: HTMLElement;
  readonly menu: TerraformMenu;
  readonly brush: BrushController;
  readonly overlay: TileOverlay;
  selectOp(op: BrushOpSelection): void;
  getSelectedOp(): BrushOpSelection;
  setBrushMode(mode: BrushMode): void;
  getBrushMode(): BrushMode;
  strokeTile(q: number, r: number, opts?: BrushStrokeOptions): BrushStrokeSummary;
  strokeArea(from: TileCoord, to: TileCoord, opts?: BrushStrokeOptions): BrushStrokeSummary;
  cancelOrder(taskId?: string): void;
  toggleOverlay(on?: boolean): boolean;
  getOverlayState(): TileOverlayState;
  getLastStroke(): BrushStrokeSummary | null;
  bindSurface(
    surface: HTMLElement,
    pickTile?: (clientX: number, clientY: number, target?: EventTarget | null) => TileCoord | null,
  ): () => void;
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
    surface?: HTMLElement | null;
    host?: SimHostLike;
    state?: PlanetState;
    terraform?: TerraformFeatureHandle;
  }
}

export interface MountTerraformOptions {
  flags?: ReadonlySet<string>;
  host?: SimHostLike | 'server' | 'local';
  simHost?: SimHostLike;
  state?: PlanetState;
  colonyId?: number;
  sendCommand?: (kind: string, args?: unknown) => unknown;
  store?: FeatureContext['services']['store'];
  surface?: HTMLElement | null;
  pickTile?: (clientX: number, clientY: number, target?: EventTarget | null) => TileCoord | null;
  services?: Partial<FeatureContext['services']>;
}

function resolveSimHost(opts?: MountTerraformOptions): SimHostLike | undefined {
  if (opts?.simHost) return opts.simHost;
  if (opts?.host && typeof opts.host === 'object' && 'state' in opts.host) return opts.host;
  return opts?.services?.host;
}

/** Mounts the `terraform-basic` menu, brush controller, and tile-state overlay into `el`. */
export function mountTerraformBasic(
  el?: HTMLElement,
  opts?: MountTerraformOptions,
): TerraformFeatureHandle {
  ensureDom();
  const container = el ?? document.body;
  const services = opts?.services ?? {};
  const simHost = resolveSimHost(opts);
  const colonyId = opts?.colonyId ?? services.colonyId ?? 0;
  const sendCommand = opts?.sendCommand ?? services.sendCommand;
  const store = opts?.store ?? services.store;
  const state = opts?.state ?? services.state ?? simHost?.state;

  const overlay = new TileOverlay(container, colonyId);
  let menu: TerraformMenu | null = null;
  let lastSyncedTick = -1;

  const syncView = (v?: GameView | null) => {
    const resolved = v ?? (simHost ? simHost.view() : store?.latest ?? null);
    if (resolved) {
      lastSyncedTick = typeof resolved.tick === 'number' ? resolved.tick : lastSyncedTick;
      brush.setView(resolved);
    }
    overlay.update(resolved, brush.getBrushedTiles());
    menu?.render();
  };

  const brush = new BrushController({
    sendCommand,
    store,
    host: simHost,
    state,
    colonyId,
    onChange: () => syncView(),
  });

  menu = new TerraformMenu(container, brush, overlay);

  const surface = opts?.surface ?? services.surface;
  const pickTile = opts?.pickTile ?? services.pickTile;
  if (surface) {
    brush.bindSurface(surface, pickTile);
  }

  const offHostEvents = simHost?.onEvents ? simHost.onEvents(() => syncView(simHost.view())) : null;
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
    setBrushMode: (mode) => {
      brush.setBrushMode(mode);
      menu?.render();
    },
    getBrushMode: () => brush.getBrushMode(),
    strokeTile: (q, r, strokeOpts) => brush.strokeTile(q, r, strokeOpts),
    strokeArea: (from, to, strokeOpts) => brush.strokeArea(from, to, strokeOpts),
    cancelOrder: (taskId) => brush.cancelOrder(taskId),
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
    bindSurface: (surf, pick) => brush.bindSurface(surf, pick),
    update: (view) => syncView(view),
    dispose: () => {
      offHostEvents?.();
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
      slot: 'bottom-right',
      order: 10,
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
