import type { ViewColony, ViewEntity } from '@terra/sim';
import { defineFeature, type Feature, type FeatureContext, type GameView } from '../../core/registry/types';
import type { SendCommand } from '../../net/commandBus';
import { HqPanel } from './HqPanel';
import {
  extractHqFromView,
  hqJobFromStateCode,
  isTileNearHq,
  LandfallController,
  type HqStatusView,
  type LandfallControllerOptions,
  type StoreLike,
  type TilePicker,
} from './selection';
import './landfall.css';

export {
  extractHqFromView,
  hqJobFromStateCode,
  HqPanel,
  isTileNearHq,
  LandfallController,
  type HqStatusView,
  type LandfallControllerOptions,
  type StoreLike,
  type TilePicker,
};

declare module '../../core/registry/types' {
  interface GameView {
    entities?: Float32Array | ViewEntity[];
    count?: number;
    colonies?: ViewColony[];
    blobs?: Record<string, unknown>;
  }
  interface FeatureServices {
    store?: StoreLike;
    landfall?: LandfallController;
    pickTile?: TilePicker;
    canvas?: HTMLElement | null;
  }
}

export interface MountLandfallCtx {
  hudRoot?: HTMLElement;
  el?: HTMLElement;
  store?: StoreLike;
  sendCommand?: SendCommand;
  pickTile?: TilePicker;
  canvas?: HTMLElement | null;
  ownerColonyIndex?: number;
  autoSelect?: boolean;
  onTargetMove?: (q: number, r: number) => void;
  services?: FeatureContext['services'];
}

export interface MountedLandfall {
  readonly controller: LandfallController;
  readonly panel: HqPanel;
  selectHq(): number | null;
  toggleSelectHq(): number | null;
  deselect(): void;
  getSelectedEntityId(): number | null;
  getHq(): HqStatusView | null;
  orderMove(q: number, r: number): boolean;
  handleLeftClick(q: number, r: number, shiftKey?: boolean): boolean;
  handleRightClick(q: number, r: number): boolean;
  update(view: GameView): void;
  dispose(): void;
}

export function mountLandfall(ctx: MountLandfallCtx): MountedLandfall {
  const hostEl = ctx.el ?? ctx.hudRoot ?? document.body;
  const existingCtl = ctx.services?.landfall;
  const ownedCtl = !existingCtl;
  const controller =
    existingCtl ??
    new LandfallController({
      store: ctx.store ?? ctx.services?.store,
      sendCommand: ctx.sendCommand ?? ctx.services?.sendCommand,
      pickTile: ctx.pickTile ?? ctx.services?.pickTile,
      canvas: ctx.canvas ?? ctx.services?.canvas,
      ownerColonyIndex: ctx.ownerColonyIndex,
      autoSelect: ctx.autoSelect,
      onTargetMove: ctx.onTargetMove,
    });
  if (ctx.services && !ctx.services.landfall) {
    ctx.services.landfall = controller;
  }
  const panel = new HqPanel(hostEl, controller);

  return {
    controller,
    panel,
    selectHq: () => controller.selectHq(),
    toggleSelectHq: () => controller.toggleSelectHq(),
    deselect: () => controller.deselect(),
    getSelectedEntityId: () => controller.getSelectedEntityId(),
    getHq: () => controller.getHq(),
    orderMove: (q, r) => controller.orderMove(q, r),
    handleLeftClick: (q, r, shiftKey) => controller.handleLeftClick(q, r, shiftKey),
    handleRightClick: (q, r) => controller.handleRightClick(q, r),
    update: (view) => controller.onView(view),
    dispose: () => {
      panel.dispose();
      if (ownedCtl) controller.dispose();
    },
  };
}

export const landfallFeature: Feature & { mount(ctx: MountLandfallCtx): MountedLandfall } = {
  ...defineFeature({
    id: 'landfall',
    wave: 'W01',
    hud: [
      {
        id: 'hq-panel',
        slot: 'bottom-left',
        order: 10,
        mount(el, ctx) {
          return mountLandfall({ el, services: ctx.services });
        },
      },
    ],
  }),
  mount: mountLandfall,
};

export default landfallFeature;
