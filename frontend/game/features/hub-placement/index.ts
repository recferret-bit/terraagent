import type { CompiledDataLike, PlanetState } from '@terra/sim';
import {
  defineFeature,
  type Feature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import '../../net/services';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { ownColonyIndex } from '../shared/colony';
import type { InProcessHost } from '../shared/commandDispatch';
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
import { createHubGhostRenderer } from './ghostRenderer';
import './hub-placement.css';

export {
  computeGhostPrepBill,
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

export interface HubPlacementFeatureHandle extends HudPanelInstance {
  readonly el: HTMLElement;
  readonly ghostEl: HTMLElement;
  readonly menu: HubPlacementMenu;
  startPlacement(q?: number, r?: number): HubGhostState;
  hoverTile(q: number, r: number): HubGhostState;
  confirmPlacement(q?: number, r?: number): boolean;
  cancelPlacement(): void;
  /** Cancels the host order `orderId` (default: the open Hub order); false when there is none. */
  cancelOrder(orderId?: string): boolean;
  isPlacementActive(): boolean;
  getGhostState(): HubGhostState;
  peekGhostState(): HubGhostState;
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
  /** The host's live compiled balance data (`WorldStore.simData`): the ghost evaluates with the same numbers. */
  simData?(): CompiledDataLike | null;
  onView?(fn: (v: GameView) => void): () => void;
  sendCommand?(cmdOrKind: unknown, args?: unknown): unknown;
}

export interface MountHubPlacementOptions {
  el?: HTMLElement;
  hudRoot?: HTMLElement;
  flags?: ReadonlySet<string>;
  /** An in-process authoritative host, or a browser `LocalHost` (`{ sim, store }`). */
  host?: InProcessHost | { readonly sim: InProcessHost; readonly store?: HubStoreLike; readonly state: PlanetState };
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

function resolveSimHost(opts?: MountHubPlacementOptions): InProcessHost | undefined {
  const h = opts?.host;
  if (h && 'sim' in h && h.sim) return h.sim;
  if (h && 'state' in h && 'view' in h) return h as InProcessHost;
  return opts?.services?.host;
}

/** Mounts the `hub-placement` Construction menu v0 and 3×3 Hub placement ghost controller. */
export function mountHubPlacement(
  elOrOpts?: HTMLElement | MountHubPlacementOptions,
  maybeOpts?: MountHubPlacementOptions,
): HubPlacementFeatureHandle {
  const opts: MountHubPlacementOptions | undefined = isElementLike(elOrOpts) ? maybeOpts : elOrOpts;
  const container: HTMLElement = isElementLike(elOrOpts)
    ? elOrOpts
    : (opts?.el ?? opts?.hudRoot ?? document.body);

  const services = opts?.services ?? {};
  const simHost = resolveSimHost(opts);
  const hostStore = opts?.host && 'store' in opts.host ? opts.host.store : undefined;
  const store = opts?.store ?? hostStore ?? services.store;

  const menu = new HubPlacementMenu(container, {
    sendCommand: opts?.sendCommand ?? services.sendCommand,
    store,
    host: simHost,
    getColonyId: () => ownColonyIndex(services, opts?.colonyId),
    requireHq: opts?.requireHq,
    onReject: (code, detail) => services.hudMin?.handleReject(code, detail, { kind: 'placeBuilding' }),
  });

  const surface = opts?.surface ?? opts?.canvas ?? services.surface ?? services.canvas;
  const pickTile = opts?.pickTile ?? services.pickTile;
  if (surface) menu.bindSurface(surface, pickTile);

  const hiddenByW02 = Boolean(opts?.flags?.has('W02'));
  if (hiddenByW02) menu.el.hidden = true;
  const offLandfall = services.landfall
    ? services.landfall.onChange(({ hq }) => {
        menu.el.hidden = hiddenByW02 || !hq;
        if (!hq && menu.isPlacementActive()) menu.cancelPlacement();
      })
    : null;
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
    cancelOrder: (orderId) => menu.cancelOrder(orderId),
    isPlacementActive: () => menu.isPlacementActive(),
    getGhostState: () => menu.getGhostState(),
    peekGhostState: () => menu.peekGhostState(),
    bindSurface: (surf, pick) => menu.bindSurface(surf, pick),
    update: (view) => menu.setView(view),
    dispose: () => {
      offLandfall?.();
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
          if (ctx.flags.has('W02')) el.hidden = true;
          return mountHubPlacement(el, { flags: ctx.flags, services: ctx.services });
        },
      },
    ],
    renderers: [{ id: 'hub-ghost-3d', mount: createHubGhostRenderer }],
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
