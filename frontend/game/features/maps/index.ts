import type * as THREE from 'three';
import {
  MAP_LAYER_META,
  type MapLayerId,
} from '@terra/contracts';
import type { RTSCamera } from '../../app/RTSCamera';
import {
  defineFeature,
  type FeatureContext,
  type HudPanelInstance,
} from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';
import {
  mapLayerRegistry,
  MapsController,
  PlanetRasterCache,
  resolveTileColorFromTokens,
  type MapLayer,
  type MapLayerRegistry,
  type MinimapStats,
} from '../../maps';

export interface MapsFeatureService {
  readonly controller: MapsController;
  readonly layerRegistry: MapLayerRegistry;
  readonly rasterCache: PlanetRasterCache;
  readonly stats: MinimapStats;
  getRegisteredLayers(): MapLayer[];
  getVisibleLayers(): MapLayer[];
  isEnabled(): boolean;
  updateTiles(tiles: ClientTiles, opts?: { planetId?: string; radius?: number; changedIndices?: readonly number[] }): number;
  openGlobalMap(): void;
  closeGlobalMap(): void;
  toggleLayer(id: MapLayerId, force?: boolean): boolean;
  panToTile(q: number, r: number): void;
}

declare module '../../core/registry/types' {
  interface FeatureServices {
    maps?: MapsFeatureService;
    camera?: THREE.PerspectiveCamera | null;
    rtsCamera?: RTSCamera | null;
    focusTile?: (q: number, r: number, snap?: boolean) => void;
  }
}

const BUILTIN_W04_LAYER_IDS: readonly MapLayerId[] = ['territory', 'terrain', 'units'];

export function createBuiltinMapLayers(): MapLayer[] {
  return BUILTIN_W04_LAYER_IDS.map((id) => {
    const meta = MAP_LAYER_META[id];
    return {
      id: meta.id,
      label: meta.label,
      wave: meta.wave,
      defaultOn: meta.defaultOn,
      order: meta.order,
      draw: () => {},
    };
  });
}

export function mountMapsFeature(
  el: HTMLElement,
  ctx: FeatureContext,
  registry: MapLayerRegistry = mapLayerRegistry,
  rasterCache: PlanetRasterCache = new PlanetRasterCache(resolveTileColorFromTokens),
): HudPanelInstance {
  const controller = new MapsController({
    el,
    ctx,
    registry,
    rasterCache,
  });

  const service: MapsFeatureService = {
    controller,
    layerRegistry: registry,
    rasterCache,
    stats: controller.stats,
    getRegisteredLayers: () => registry.all(),
    getVisibleLayers: () => controller.chipController.getVisibleLayers(),
    isEnabled: () => ctx.flags.has('W04'),
    updateTiles: (tiles, opts) => rasterCache.update(tiles, opts).repainted,
    openGlobalMap: () => controller.openClose.open(),
    closeGlobalMap: () => controller.openClose.close(),
    toggleLayer: (id, force) => controller.chipController.toggleLayer(id, force),
    panToTile: (q, r) => controller.panToTile(q, r),
  };
  ctx.services.maps = service;

  return {
    update(view) {
      controller.updateFromView(view);
    },
    dispose() {
      controller.dispose();
      if (ctx.services.maps === service) {
        delete ctx.services.maps;
      }
    },
  };
}

export const mapsFeature = defineFeature({
  id: 'maps',
  wave: 'W04',
  hud: [
    {
      id: 'minimap',
      slot: 'bottom-left',
      order: 5,
      mount(el, ctx) {
        return mountMapsFeature(el, ctx);
      },
    },
  ],
  renderers: [
    {
      id: 'maps-camera-sync',
      mount(ctx) {
        return {
          update(view) {
            ctx.services.maps?.controller.updateFromView(view);
            ctx.services.maps?.controller.syncCameraFrame();
          },
          dispose() {},
        };
      },
    },
  ],
});

export default mapsFeature;
