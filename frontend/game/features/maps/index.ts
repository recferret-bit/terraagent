import type * as THREE from 'three';
import {
  MAP_LAYER_META,
  type MapLayerId,
} from '@terra/contracts';
import type { RTSCamera } from '../../app/RTSCamera';
import {
  defineFeature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import {
  mapLayerRegistry,
  PlanetRasterCache,
  type MapLayer,
  type MapLayerRegistry,
  type MinimapStats,
} from '../../maps';

export interface MapsFeatureService {
  readonly layerRegistry: MapLayerRegistry;
  readonly rasterCache: PlanetRasterCache;
  readonly stats: MinimapStats;
  getRegisteredLayers(): MapLayer[];
  getVisibleLayers(): MapLayer[];
  isEnabled(): boolean;
  updateTiles(tiles: ClientTiles, opts?: { planetId?: string; radius?: number; changedIndices?: readonly number[] }): number;
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
      draw: () => {
        // Built-in layer rendering is wired in W04-16.
      },
    };
  });
}

function createMinimapStats(
  registry: MapLayerRegistry,
  rasterCache: PlanetRasterCache,
): MinimapStats {
  return {
    get dirtyTiles() {
      return rasterCache.dirtyTiles;
    },
    set dirtyTiles(v: number) {
      rasterCache.dirtyTiles = v;
    },
    get totalRepaints() {
      return rasterCache.totalRepaints;
    },
    set totalRepaints(v: number) {
      rasterCache.totalRepaints = v;
    },
    get lastRadius() {
      return rasterCache.lastRadius;
    },
    set lastRadius(v: number) {
      rasterCache.lastRadius = v;
    },
    get lastPlanetId() {
      return rasterCache.lastPlanetKey;
    },
    set lastPlanetId(v: string | null) {
      rasterCache.lastPlanetKey = v;
    },
    minimapRedraws: 0,
    globalMapRedraws: 0,
    minimapHz: 0,
    globalMapHz: 0,
    entityDotCount: 0,
    globalMapOpen: false,
    activeLayers: ['territory', 'terrain', 'units'],
    get registeredLayers() {
      return registry.all().map((l) => l.id);
    },
    set registeredLayers(_v: MapLayerId[]) {
      // derived from registry
    },
  };
}

export function mountMapsFeature(
  _el: HTMLElement,
  ctx: FeatureContext,
  registry: MapLayerRegistry = mapLayerRegistry,
  rasterCache: PlanetRasterCache = new PlanetRasterCache(),
): HudPanelInstance {
  let cleanups: Array<() => void> = [];
  let registered = false;
  const stats = createMinimapStats(registry, rasterCache);

  const syncRegistration = () => {
    const enabled = ctx.flags.has('W04');
    if (enabled && !registered) {
      for (const layer of createBuiltinMapLayers()) {
        cleanups.push(registry.register(layer));
      }
      registered = true;
    } else if (!enabled && registered) {
      for (const fn of cleanups) fn();
      cleanups = [];
      registered = false;
      rasterCache.clear();
    }
  };

  syncRegistration();

  const updateFromView = (view: GameView) => {
    syncRegistration();
    if (!ctx.flags.has('W04')) return;
    const cv = (view.sim?.view ?? view) as Partial<ClientView>;
    const tiles = (view.tiles ?? cv.tiles) as ClientTiles | undefined;
    if (tiles && tiles.terrain && tiles.prep && tiles.owner) {
      const planetId = cv.planet?.id ?? view.planet?.id ?? ctx.services.session?.planetId?.() ?? 'default';
      const radius = cv.planet?.radius ?? view.planet?.radius;
      rasterCache.update(tiles, { planetId, radius });
    }
  };

  const service: MapsFeatureService = {
    layerRegistry: registry,
    rasterCache,
    stats,
    getRegisteredLayers: () => registry.all(),
    getVisibleLayers: () => registry.forFlags(ctx.flags),
    isEnabled: () => ctx.flags.has('W04'),
    updateTiles: (tiles, opts) => rasterCache.update(tiles, opts).repainted,
  };
  ctx.services.maps = service;

  return {
    update(view) {
      updateFromView(view);
    },
    dispose() {
      for (const fn of cleanups) fn();
      cleanups = [];
      registered = false;
      rasterCache.clear();
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
      order: 30,
      mount(el, ctx) {
        return mountMapsFeature(el, ctx);
      },
    },
  ],
});

export default mapsFeature;
