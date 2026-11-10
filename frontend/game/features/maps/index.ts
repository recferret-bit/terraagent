import type * as THREE from 'three';
import {
  MAP_LAYER_META,
  type AtlasManifestV1,
  type MapLayerId,
  type PlanetSummaryV1,
  type SectorId,
} from '@terra/contracts';
import type { RTSCamera } from '../../app/RTSCamera';
import {
  defineFeature,
  type FeatureContext,
  type HudPanelInstance,
} from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';
import type { SectorIntentInput, SectorIntentV1 } from '../../ui/lobby';
import {
  mapLayerRegistry,
  MapsController,
  PlanetRasterCache,
  resolveTileColorFromTokens,
  type MapLayer,
  type MapLayerRegistry,
  type MinimapStats,
  type PlanetRasterUpdateOptions,
} from '../../maps';
import { NeighborHudStrip } from './NeighborHudStrip';

export * from './neighborMarkers';
export * from './NeighborHudStrip';

export interface MapsFeatureService {
  readonly controller: MapsController;
  readonly layerRegistry: MapLayerRegistry;
  readonly rasterCache: PlanetRasterCache;
  readonly stats: MinimapStats;
  getRegisteredLayers(): MapLayer[];
  getVisibleLayers(): MapLayer[];
  isEnabled(): boolean;
  updateTiles(tiles: ClientTiles, opts?: PlanetRasterUpdateOptions): number;
  openGlobalMap(): void;
  closeGlobalMap(): void;
  toggleLayer(id: MapLayerId, force?: boolean): boolean;
  panToTile(q: number, r: number): void;
  selectSector(sectorId: SectorId | 'auto' | null): SectorIntentV1;
  selectSectorAtTile(q: number, r: number): SectorIntentV1 | null;
  setSectorIntent(intent: SectorIntentInput): SectorIntentV1;
  getSectorIntent(): SectorIntentV1;
  getSelectedSectorId(): SectorId | null;
  setHomeContext(opts: {
    readonly homeSectorId?: SectorId | null;
    readonly homeTile?: { readonly q: number; readonly r: number } | null;
    readonly currentSectorId?: SectorId | null;
    readonly cameraTile?: { readonly q: number; readonly r: number } | null;
  }): void;
  setPlanetSummary(summary: PlanetSummaryV1 | null): void;
  setAtlasManifest(manifest: AtlasManifestV1 | null): void;
  bindSectorPicker(
    container: HTMLElement,
    summary: PlanetSummaryV1,
    onSelect?: (intent: SectorIntentV1) => void,
    queuePaused?: boolean,
  ): () => void;
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
    selectSector: (sectorId) => controller.selectSector(sectorId),
    selectSectorAtTile: (q, r) => controller.selectSectorAtTile(q, r),
    setSectorIntent: (intent) => controller.setSectorIntent(intent),
    getSectorIntent: () => controller.getSectorIntent(),
    getSelectedSectorId: () => controller.getSelectedSectorId(),
    setHomeContext: (opts) => controller.setHomeContext(opts),
    setPlanetSummary: (summary) => controller.setPlanetSummary(summary),
    setAtlasManifest: (manifest) => controller.setAtlasManifest(manifest),
    bindSectorPicker: (container, summary, onSelect, queuePaused) =>
      controller.bindSectorPicker(container, summary, onSelect, queuePaused),
  };
  ctx.services.maps = service;
  const offCloser = ctx.services.registerHudCloser?.(() => { if (controller.openClose.isOpen) controller.openClose.close(); });

  let neighborHud: NeighborHudStrip | null = null;
  const syncNeighborHud = (view?: unknown) => {
    if (ctx.flags.has('W18')) {
      if (!neighborHud) {
        neighborHud = new NeighborHudStrip({ container: el, ctx });
      }
      if (view !== undefined) {
        neighborHud.update(view);
      }
    } else if (neighborHud) {
      neighborHud.dispose();
      neighborHud = null;
    }
  };

  syncNeighborHud();

  return {
    update(view) {
      controller.updateFromView(view);
      syncNeighborHud(view);
    },
    dispose() {
      offCloser?.();
      controller.dispose();
      neighborHud?.dispose();
      neighborHud = null;
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
      slot: 'top-left',
      order: -100, // top-left corner, above the Colony book
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
