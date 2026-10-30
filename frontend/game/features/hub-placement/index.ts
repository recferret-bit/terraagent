import type { PlanetState } from '@terra/sim';
import {
  defineFeature,
  type Feature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import '../../net/services';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { ensureDom } from './dom';
import {
  computeGhostPrepBill,
  evaluateHubGhost,
  extractColonyConstructionOrders,
  findValidHubSiteNearHq,
  type EvaluateHubGhostOptions,
  type GhostSource,
  type HubFootprintTileState,
  type HubGhostBill,
  type HubGhostState,
} from './GhostEvaluator';
import {
  formatGhostOps,
  formatGhostYields,
  HubPlacementMenu,
  type HubPlacementCommandSink,
  type TilePickerFn,
} from './HubPlacementMenu';
import './hub-placement.css';

export {
  computeGhostPrepBill,
  ensureDom,
  evaluateHubGhost,
  extractColonyConstructionOrders,
  findValidHubSiteNearHq,
  formatGhostOps,
  formatGhostYields,
  HubPlacementMenu,
  type EvaluateHubGhostOptions,
  type GhostSource,
  type HubFootprintTileState,
  type HubGhostBill,
  type HubGhostState,
  type HubPlacementCommandSink,
  type TilePickerFn,
};

export interface SimHostLike {
  readonly state: PlanetState;
  readonly tick?: number;
  readonly pending: number;
  view(): GameView;
  onEvents?: (cb: () => void) => () => void;
}

export interface HubPlacementFeatureHandle extends HudPanelInstance {
  readonly el: HTMLElement;
  readonly ghostEl: HTMLElement;
  readonly menu: HubPlacementMenu;
  startPlacement(q?: number, r?: number): HubGhostState;
  hoverTile(q: number, r: number): HubGhostState;
  confirmPlacement(q?: number, r?: number): boolean;
  cancelPlacement(): void;
  cancelOrder(taskId?: string): void;
  isPlacementActive(): boolean;
  getGhostState(): HubGhostState;
  bindSurface(surface: HTMLElement, pickTile?: TilePickerFn): () => void;
  update(view: GhostSource): void;
}

declare module '../../core/registry/types' {
  interface FeatureServices {
    hubPlacement?: HubPlacementFeatureHandle;
  }
}

export interface HubStoreLike {
  readonly latest?: GameView | null;
  readonly latestTiles?: ClientTiles | null;
  onView?(fn: (v: GameView) => void): () => void;
  sendCommand?(cmdOrKind: unknown, args?: unknown): unknown;
}

export interface MountHubPlacementOptions {
  el?: HTMLElement;
  hudRoot?: HTMLElement;
  flags?: ReadonlySet<string>;
  host?: SimHostLike | { readonly sim: SimHostLike; readonly store?: HubStoreLike; readonly state: PlanetState } | 'server' | 'local';
  simHost?: SimHostLike;
  state?: PlanetState;
  colonyId?: number;
  requireHq?: boolean;
  sendCommand?: (kind: string, args?: unknown) => unknown;
  store?: HubStoreLike;
  surface?: HTMLElement | null;
  canvas?: HTMLElement | null;
  pickTile?: TilePickerFn;
  services?: Partial<FeatureContext['services']>;
}

function isElementLike(v: unknown): v is HTMLElement {
  return Boolean(v && typeof v === 'object' && 'appendChild' in v && 'tagName' in v);
}

function resolveSimHost(opts?: MountHubPlacementOptions): SimHostLike | undefined {
  if (opts?.simHost) return opts.simHost;
  if (opts?.host && typeof opts.host === 'object') {
    if ('sim' in opts.host && opts.host.sim) return opts.host.sim;
    if ('state' in opts.host && 'view' in opts.host) return opts.host as SimHostLike;
  }
  return opts?.services?.host;
}

/** Mounts the `hub-placement` Construction menu v0 and 3×3 Hub placement ghost controller. */
export function mountHubPlacement(
  elOrOpts?: HTMLElement | MountHubPlacementOptions,
  maybeOpts?: MountHubPlacementOptions,
): HubPlacementFeatureHandle {
  ensureDom();
  const opts: MountHubPlacementOptions | undefined = isElementLike(elOrOpts) ? maybeOpts : elOrOpts;
  const container: HTMLElement = isElementLike(elOrOpts)
    ? elOrOpts
    : (opts?.el ?? opts?.hudRoot ?? document.body);

  const services = opts?.services ?? {};
  const simHost = resolveSimHost(opts);
  const hostStore =
    opts?.host && typeof opts.host === 'object' && 'store' in opts.host ? opts.host.store : undefined;
  const colonyId = opts?.colonyId ?? services.colonyId ?? 0;
  const sendCommand = opts?.sendCommand ?? services.sendCommand;
  const store = opts?.store ?? hostStore ?? services.store;
  const state = opts?.state ?? services.state ?? simHost?.state;

  const menu = new HubPlacementMenu(container, {
    sendCommand,
    store,
    host: simHost,
    state,
    colonyId,
    requireHq: opts?.requireHq,
  });

  const surface = opts?.surface ?? opts?.canvas ?? services.surface ?? services.canvas;
  const pickTile = opts?.pickTile ?? services.pickTile;
  if (surface) {
    menu.bindSurface(surface, pickTile);
  }

  const offStoreView = store?.onView ? store.onView((v) => menu.setView(v)) : null;
  const offHostEvents = simHost?.onEvents ? simHost.onEvents(() => menu.setView(simHost.view())) : null;
  if (store?.latest) {
    menu.setView(store.latest);
  } else if (simHost) {
    menu.setView(simHost.view());
  }

  const handle: HubPlacementFeatureHandle = {
    el: menu.el,
    ghostEl: menu.ghostEl,
    menu,
    startPlacement: (q, r) => menu.startPlacement(q, r),
    hoverTile: (q, r) => menu.hoverTile(q, r),
    confirmPlacement: (q, r) => menu.confirmPlacement(q, r),
    cancelPlacement: () => menu.cancelPlacement(),
    cancelOrder: (taskId) => menu.cancelOrder(taskId),
    isPlacementActive: () => menu.isPlacementActive(),
    getGhostState: () => menu.getGhostState(),
    bindSurface: (surf, pick) => menu.bindSurface(surf, pick),
    update: (view) => menu.setView(view),
    dispose: () => {
      offStoreView?.();
      offHostEvents?.();
      menu.dispose();
    },
  };

  if (opts?.services) {
    opts.services.hubPlacement = handle;
  }
  return handle;
}

export const hubPlacementFeature: Feature & {
  mount(elOrOpts?: HTMLElement | MountHubPlacementOptions, maybeOpts?: MountHubPlacementOptions): HubPlacementFeatureHandle;
} = {
  ...defineFeature({
    id: 'hub-placement',
    wave: 'W01',
    hud: [
      {
        id: 'construction-menu',
        slot: 'bottom-right',
        order: 20,
        mount(el, ctx) {
          return mountHubPlacement(el, { flags: ctx.flags, services: ctx.services });
        },
      },
    ],
    menus: [
      {
        id: 'construction',
        label: 'Construction',
        open(ctx) {
          ctx.services.hubPlacement?.startPlacement();
        },
      },
    ],
  }),
  mount: mountHubPlacement,
};

export default hubPlacementFeature;
