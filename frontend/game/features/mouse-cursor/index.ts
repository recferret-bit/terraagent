import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import {
  DEFAULT_MOUSE_CURSOR_CONTEXT,
  MouseCursorStateMachine,
  resolveMouseCursorState,
  type MouseCursorContext,
  type MouseCursorHoverTarget,
  type MouseCursorListener,
  type MouseCursorState,
} from '../../core/input/MouseCursorStateMachine';
import { buildCursorCssValue, resolveCursorPalette, SurfaceCursorApplier } from '../../core/input/cursorVisuals';
import { defineFeature, type Feature, type FeatureContext } from '../../core/registry/types';
import { isReadOnlySpectator, ownColonyIndex } from '../shared/colony';
import type { TilePickerFn } from '../shared/pointer';
import type { StoreLike } from '../landfall/selection';
import { MouseCursorOrchestrator, type MouseCursorOrchestratorOptions } from './MouseCursorOrchestrator';

export {
  DEFAULT_MOUSE_CURSOR_CONTEXT,
  MouseCursorOrchestrator,
  MouseCursorStateMachine,
  SurfaceCursorApplier,
  buildCursorCssValue,
  resolveCursorPalette,
  resolveMouseCursorState,
  type MouseCursorContext,
  type MouseCursorHoverTarget,
  type MouseCursorListener,
  type MouseCursorOrchestratorOptions,
  type MouseCursorState,
};

declare module '../../core/registry/types' {
  interface FeatureServices {
    mouseCursor?: MouseCursorOrchestrator;
    getSpawnCursorProbe?: () => { readonly valid: boolean } | null;
  }
}

export interface MountMouseCursorOptions {
  readonly surface?: HTMLElement | null;
  readonly canvas?: HTMLElement | null;
  readonly pickTile?: TilePickerFn;
  readonly store?: StoreLike;
  readonly ownerColonyIndex?: number;
  readonly flags?: ReadonlySet<string>;
  readonly services?: Partial<FeatureContext['services']>;
}

export function mountMouseCursor(opts: MountMouseCursorOptions = {}): MouseCursorOrchestrator {
  const services = opts.services;
  if (services?.mouseCursor) return services.mouseCursor;

  const hasSpawnProbe = () => (services?.getSpawnCursorProbe?.() ?? null) !== null;
  const isToolBlocked = () =>
    isGameInputBlocked(hasSpawnProbe() ? 'combat-test-spawn' : undefined) ||
    services?.landfall?.isDeployed() === false ||
    (services?.hubPlacement?.isPlacementActive() === true && (services?.getPlacementGhostState?.() ?? null) === null) ||
    (services?.terraform?.isArmed() === true && typeof services?.terraform?.canStrokeTile !== 'function');

  const orchestrator = new MouseCursorOrchestrator({
    surface: opts.surface ?? services?.surface ?? opts.canvas ?? services?.canvas ?? null,
    pickTile: opts.pickTile ?? services?.pickTile,
    store: opts.store ?? services?.store,
    getView: () => services?.getView?.() ?? services?.store?.latest,
    getFallbackTiles: () => services?.store?.latestTiles,
    landfall: () => services?.landfall,
    armyOrders: () => services?.armyOrders,
    getPlacementGhostState: () => services?.getPlacementGhostState?.() ?? null,
    getSpawnCursorProbe: () => services?.getSpawnCursorProbe?.() ?? null,
    terraform: () => services?.terraform,
    getColonyId: () => ownColonyIndex(services, opts.ownerColonyIndex),
    isSpectator: () => isReadOnlySpectator(services),
    isSpectatorVisionAll: () => Boolean(services?.isSpectatorVisionAll?.()),
    isFullVision: () => Boolean(services?.isFullVision?.()),
    isCombatEnabled: () => Boolean(opts.flags?.has('W07') || services?.armyOrders),
    isInputBlocked: isToolBlocked,
  });

  if (services) {
    services.mouseCursor = orchestrator;
  }
  return orchestrator;
}

export const mouseCursorFeature: Feature & { mount(opts?: MountMouseCursorOptions): MouseCursorOrchestrator } = {
  ...defineFeature({
    id: 'mouse-cursor',
    wave: 'W01',
    renderers: [
      {
        id: 'mouse-cursor',
        mount(ctx) {
          const orchestrator = mountMouseCursor({ flags: ctx.flags, services: ctx.services });
          return {
            update(view) {
              orchestrator.onView(view);
            },
            dispose() {
              if (ctx.services.mouseCursor === orchestrator) {
                ctx.services.mouseCursor = undefined;
              }
              orchestrator.dispose();
            },
          };
        },
      },
    ],
  }),
  mount: mountMouseCursor,
};

export default mouseCursorFeature;
