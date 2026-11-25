import type * as THREE from 'three';
import type { ViewEntity } from '@terra/sim';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import { defineFeature, type Feature, type FeatureContext, type GameView } from '../../core/registry/types';
import type { SendCommand } from '../../net/commandBus';
import { isReadOnlySpectator, ownColonyIndex } from '../shared/colony';
import { isHotkeyPress, isTypingTarget } from '../shared/hotkeys';
import { HqPanel, type SelectionCombatHost, type SelectionCombatSummary } from './HqPanel';
import { MarqueeSelectionController, type MarqueeSelectionOptions } from './parts/marqueeSelection';
import {
  extractHqFromView,
  extractSelectableEntities,
  hqJobFromStateCode,
  inspectDepositAt,
  isTileNearHq,
  LandfallController,
  resolveEntityActivityProgress,
  type HqStatusView,
  type LandfallControllerOptions,
  type SelectedDepositView,
  type SelectedEntityView,
  type StoreLike,
  type TilePicker,
  type UnitFailureView,
  unitFailureFromView,
} from './selection';
import './landfall.css';

export {
  extractHqFromView,
  extractSelectableEntities,
  hqJobFromStateCode,
  HqPanel,
  MarqueeSelectionController,
  type MarqueeSelectionOptions,
  type SelectionCombatHost,
  type SelectionCombatSummary,
  inspectDepositAt,
  isTileNearHq,
  LandfallController,
  resolveEntityActivityProgress,
  type HqStatusView,
  type LandfallControllerOptions,
  type SelectedDepositView,
  type SelectedEntityView,
  type StoreLike,
  type TilePicker,
  type UnitFailureView,
  unitFailureFromView,
};

declare module '../../core/registry/types' {
  interface GameView {
    entities?: Float32Array | ViewEntity[] | Array<Partial<ViewEntity> & { [key: string]: unknown }>;
    count?: number;
    blobs?: Record<string, unknown>;
  }
  interface FeatureServices {
    landfall?: LandfallController;
    selectionCombatHost?: SelectionCombatHost;
    canvas?: HTMLElement | null;
    camera?: THREE.PerspectiveCamera | null;
  }
}

export interface MountLandfallCtx {
  hudRoot?: HTMLElement;
  el?: HTMLElement;
  store?: StoreLike;
  sendCommand?: SendCommand;
  pickTile?: TilePicker;
  canvas?: HTMLElement | null;
  surface?: HTMLElement | null;
  projectEntityClientPoint?: (entity: SelectedEntityView) => { x: number; y: number } | null;
  ownerColonyIndex?: number;
  autoSelect?: boolean;
  onTargetMove?: (q: number, r: number) => void;
  services?: FeatureContext['services'];
}

export interface MountedLandfall {
  readonly controller: LandfallController;
  readonly panel: HqPanel;
  readonly marquee: MarqueeSelectionController | null;
  selectHq(): number | null;
  selectEntity(entityId: number | null): number | null;
  selectEntities(entityIds: readonly number[]): number[];
  toggleSelectHq(): number | null;
  deselect(): void;
  getSelectedEntityId(): number | null;
  getSelectedEntityIds(): number[];
  getSelectedEntity(): SelectedEntityView | null;
  getSelectedDeposit(): SelectedDepositView | null;
  getHq(): HqStatusView | null;
  orderMove(q: number, r: number): boolean;
  cancelSelected(): boolean;
  clickTile(q: number, r: number, shiftKey?: boolean): boolean;
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
      ownerColonyIndex: ctx.ownerColonyIndex ?? (typeof ctx.services?.colonyId === 'number' ? ctx.services.colonyId : undefined),
      autoSelect: ctx.autoSelect,
      onTargetMove: ctx.onTargetMove,
    });
  if (ctx.services && !ctx.services.landfall) {
    ctx.services.landfall = controller;
  }
  const panel = new HqPanel(hostEl, controller);
  if (ctx.services) {
    ctx.services.selectionDetails = panel.details;
    ctx.services.selectionCombatHost = panel;
  }

  const surface = ctx.surface ?? ctx.services?.surface ?? ctx.canvas ?? ctx.services?.canvas ?? null;
  const services = ctx.services;
  const marquee = surface
    ? new MarqueeSelectionController({
        surface,
        overlayParent: surface.ownerDocument?.body ?? document.body,
        landfall: () => services?.landfall ?? controller,
        armyOrders: () => services?.armyOrders,
        mouseCursor: () => services?.mouseCursor,
        getView: () => services?.getView?.() ?? (ctx.store ?? services?.store)?.latest,
        getColonyId: () => ownColonyIndex(services, ctx.ownerColonyIndex),
        getCamera: () => services?.camera ?? null,
        scene3d: () => services?.scene3d,
        pickTile: ctx.pickTile ?? services?.pickTile,
        projectEntityClientPoint: ctx.projectEntityClientPoint,
        isSpectator: () => isReadOnlySpectator(services) || controller.isSpectator(),
        isInputBlocked: () =>
          isGameInputBlocked() ||
          controller.isDeployed() === false ||
          services?.hubPlacement?.isPlacementActive() === true ||
          (services?.getPlacementGhostState?.() ?? null) !== null ||
          services?.terraform?.isArmed() === true,
      })
    : null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (isGameInputBlocked() || isTypingTarget(e)) return;
    if ((e.code === 'KeyX' || e.key === 'x' || e.key === 'X') && isHotkeyPress(e)) {
      controller.stopSelected();
    }
  };
  const hasWin = Boolean(surface && typeof window !== 'undefined' && typeof window.addEventListener === 'function');
  if (hasWin) window.addEventListener('keydown', onKeyDown);

  return {
    controller,
    panel,
    marquee,
    selectHq: () => controller.selectHq(),
    selectEntity: (entityId) => controller.selectEntity(entityId),
    selectEntities: (entityIds) => controller.selectEntities(entityIds),
    toggleSelectHq: () => controller.toggleSelectHq(),
    deselect: () => controller.deselect(),
    getSelectedEntityId: () => controller.getSelectedEntityId(),
    getSelectedEntityIds: () => controller.getSelectedEntityIds(),
    getSelectedEntity: () => controller.getSelectedEntity(),
    getSelectedDeposit: () => controller.getSelectedDeposit(),
    getHq: () => controller.getHq(),
    orderMove: (q, r) => controller.orderMove(q, r),
    cancelSelected: () => controller.cancelSelected(),
    clickTile: (q, r, shiftKey) => controller.clickTile(q, r, shiftKey),
    handleLeftClick: (q, r, shiftKey) => controller.handleLeftClick(q, r, shiftKey),
    handleRightClick: (q, r) => controller.handleRightClick(q, r),
    update: (view) => controller.onView(view),
    dispose: () => {
      if (hasWin) window.removeEventListener('keydown', onKeyDown);
      marquee?.dispose();
      if (ctx.services?.selectionDetails === panel.details) ctx.services.selectionDetails = undefined;
      if (ctx.services?.selectionCombatHost === panel) ctx.services.selectionCombatHost = undefined;
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
