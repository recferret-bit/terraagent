import {
  defineFeature,
  type Feature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import '../../net/services';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import type { SendCommand } from '../../net/commandBus';
import { ownColonyIndex } from '../shared/colony';
import type { TilePickerFn } from '../shared/pointer';
import type { Scene3dService } from '../shared/scene3d';
import type { LandfallController, StoreLike } from '../landfall/selection';
import {
  ArmyOrdersController,
  type ArmyOrdersControllerOptions,
  type ArmyOrdersListener,
  type ArmyOrdersSnapshot,
  type ArmyStance,
} from './ArmyOrdersController';
import { ArmyStancePanel } from './ArmyStancePanel';
import {
  ORDER_MARKER_TTL_MS,
  OrderMarkersRenderer,
  syncDomOrderMarkers,
  type OrderMarker,
  type OrderMarkerKind,
} from './OrderMarkersRenderer';
import './army.css';

export {
  ArmyOrdersController,
  ArmyStancePanel,
  ORDER_MARKER_TTL_MS,
  OrderMarkersRenderer,
  syncDomOrderMarkers,
  type ArmyOrdersControllerOptions,
  type ArmyOrdersListener,
  type ArmyOrdersSnapshot,
  type ArmyStance,
  type OrderMarker,
  type OrderMarkerKind,
};

declare module '../../core/registry/types' {
  interface FeatureServices {
    armyOrders?: ArmyOrdersController;
  }
}

export interface MountArmyOptions {
  el?: HTMLElement;
  hudRoot?: HTMLElement;
  store?: StoreLike;
  sendCommand?: SendCommand | ((kind: string, args?: unknown) => unknown);
  pickTile?: TilePickerFn;
  surface?: HTMLElement | null;
  canvas?: HTMLElement | null;
  landfall?: LandfallController;
  ownerColonyIndex?: number;
  scene3d?: Scene3dService | null;
  services?: Partial<FeatureContext['services']>;
}

export interface MountedArmy extends HudPanelInstance {
  readonly el: HTMLElement;
  readonly markersEl: HTMLElement;
  readonly controller: ArmyOrdersController;
  readonly panel: ArmyStancePanel;
  readonly renderer: OrderMarkersRenderer | null;
  selectUnits(ids: readonly number[]): number[];
  clickTile(q: number, r: number, shiftKey?: boolean): boolean;
  rightClickTile(q: number, r: number): boolean;
  setAttackMoveArmed(armed: boolean): boolean;
  isAttackMoveArmed(): boolean;
  setStance(stance: ArmyStance): boolean;
  getCurrentStance(): ArmyStance;
  getSelectedEntityIds(): number[];
  getOrderMarkers(): OrderMarker[];
  update(view: GameView): void;
  dispose(): void;
}

function ensureArmyController(opts: MountArmyOptions): { controller: ArmyOrdersController; owned: boolean } {
  const services = opts.services;
  if (services?.armyOrders) {
    return { controller: services.armyOrders, owned: false };
  }
  const isBlocked = () =>
    isGameInputBlocked() ||
    services?.hubPlacement?.isPlacementActive() === true ||
    (services?.getPlacementGhostState?.() ?? null) !== null ||
    services?.terraform?.isArmed() === true;

  const controller = new ArmyOrdersController({
    store: opts.store ?? services?.store,
    sendCommand: opts.sendCommand ?? services?.sendCommand,
    pickTile: opts.pickTile ?? services?.pickTile,
    surface: opts.surface ?? services?.surface ?? opts.canvas ?? services?.canvas,
    canvas: opts.canvas ?? services?.canvas,
    landfall: opts.landfall ?? services?.landfall,
    getColonyId: () => ownColonyIndex(services, opts.ownerColonyIndex),
    ownerColonyIndex: opts.ownerColonyIndex,
    getView: () => services?.getView?.() ?? services?.store?.latest,
    isInputBlocked: isBlocked,
  });
  if (services) {
    services.armyOrders = controller;
  }
  return { controller, owned: true };
}

export function mountArmy(opts: MountArmyOptions = {}): MountedArmy {
  const hostEl = opts.el ?? opts.hudRoot ?? (typeof document !== 'undefined' ? document.body : ({} as HTMLElement));
  const { controller, owned } = ensureArmyController(opts);
  const panel = new ArmyStancePanel(hostEl, controller);
  const scene3d = opts.scene3d ?? opts.services?.scene3d ?? null;
  const renderer = scene3d
    ? new OrderMarkersRenderer({
        scene3d,
        getMarkers: () => controller.getOrderMarkers(),
        pruneExpired: (now) => controller.pruneExpiredMarkers(now),
        domContainer: panel.markersEl,
      })
    : null;
  const offSync = renderer ? controller.onChange(() => renderer.sync()) : null;

  return {
    el: panel.el,
    markersEl: panel.markersEl,
    controller,
    panel,
    renderer,
    selectUnits: (ids) => controller.selectUnits(ids),
    clickTile: (q, r, shiftKey) => controller.clickTile(q, r, shiftKey),
    rightClickTile: (q, r) => controller.rightClickTile(q, r),
    setAttackMoveArmed: (armed) => controller.setAttackMoveArmed(armed),
    isAttackMoveArmed: () => controller.isAttackMoveArmed(),
    setStance: (stance) => controller.setStance(stance),
    getCurrentStance: () => controller.getCurrentStance(),
    getSelectedEntityIds: () => controller.getSelectedEntityIds(),
    getOrderMarkers: () => controller.getOrderMarkers(),
    update: (view) => {
      controller.onView(view);
      renderer?.sync();
    },
    dispose: () => {
      offSync?.();
      renderer?.dispose();
      panel.dispose();
      if (owned) {
        if (opts.services?.armyOrders === controller) {
          opts.services.armyOrders = undefined;
        }
        controller.dispose();
      }
    },
  };
}

export const armyFeature: Feature & { mount(opts?: MountArmyOptions): MountedArmy } = {
  ...defineFeature({
    id: 'army',
    wave: 'W07',
    hud: [
      {
        id: 'army-stance-panel',
        slot: 'bottom-left',
        order: 15,
        mount(el, ctx) {
          return mountArmy({ el, services: ctx.services });
        },
      },
    ],
    renderers: [
      {
        id: 'army-order-markers',
        mount(ctx) {
          const { controller } = ensureArmyController({ services: ctx.services });
          const renderer = new OrderMarkersRenderer({
            scene3d: ctx.services.scene3d,
            getMarkers: () => controller.getOrderMarkers(),
            pruneExpired: (now) => controller.pruneExpiredMarkers(now),
          });
          const off = controller.onChange(() => renderer.sync());
          return {
            update(view, dt) {
              controller.onView(view);
              renderer.update(view, dt);
            },
            dispose() {
              off();
              renderer.dispose();
            },
          };
        },
      },
    ],
  }),
  mount: mountArmy,
};

export default armyFeature;
