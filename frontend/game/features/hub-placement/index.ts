import type { PlanetState, SimCommand } from '@terra/sim';
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
import { GhostRig3D } from './GhostRig3D';
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
  submit?(cmd: SimCommand): void;
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
    getColonyId: () => opts?.colonyId ?? services.landfall?.getOwnerColonyIndex() ?? services.colonyId ?? 0,
    requireHq: opts?.requireHq,
    onReject: (code, detail) => services.hudMin?.handleReject(code, detail, { kind: 'placeBuilding' }),
  });

  const surface = opts?.surface ?? opts?.canvas ?? services.surface ?? services.canvas;
  const pickTile = opts?.pickTile ?? services.pickTile;
  if (surface) {
    menu.bindSurface(surface, pickTile);
  }

  const offLandfall = services.landfall
    ? services.landfall.onChange(({ hq }) => {
        menu.el.hidden = !hq;
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
    cancelOrder: (taskId) => menu.cancelOrder(taskId),
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
          return mountHubPlacement(el, { flags: ctx.flags, services: ctx.services });
        },
      },
    ],
    renderers: [
      {
        id: 'hub-ghost-3d',
        mount(ctx) {
          const s3 = ctx.services.scene3d;
          if (!s3) return { update() {}, dispose() {} };
          const rig = new GhostRig3D(s3);
          const canvas = (ctx.services.canvas ?? ctx.services.surface) as HTMLElement | undefined;
          let last: { x: number; y: number; over: boolean } | null = null;
          const onMove = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY, over: !canvas || e.target === canvas }; };
          window.addEventListener('pointermove', onMove);
          let lastTile = '';
          const idle = { isPlacementActive: () => false, getGhostState: () => null as never };
          return {
            update(_view, dt) {
              const hp = ctx.services.hubPlacement;
              if (!hp) { rig.update(idle, dt); return; }
              if (hp.isPlacementActive() && last?.over && ctx.services.pickTile) {
                const t = ctx.services.pickTile(last.x, last.y, canvas);
                const key = t ? `${t.q},${t.r}` : '';
                if (t && key !== lastTile) { lastTile = key; hp.hoverTile(t.q, t.r); }
              } else if (!hp.isPlacementActive()) lastTile = '';
              rig.update({ isPlacementActive: () => hp.isPlacementActive(), getGhostState: () => hp.peekGhostState() }, dt);
            },
            dispose() { window.removeEventListener('pointermove', onMove); rig.dispose(); },
          };
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
