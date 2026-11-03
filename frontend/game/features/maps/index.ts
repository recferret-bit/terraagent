import {
  MAP_LAYER_META,
  type MapLayerId,
} from '@terra/contracts';
import {
  defineFeature,
  type FeatureContext,
  type HudPanelInstance,
} from '../../core/registry/types';
import {
  mapLayerRegistry,
  type MapLayer,
  type MapLayerRegistry,
} from '../../maps';

export interface MapsFeatureService {
  readonly layerRegistry: MapLayerRegistry;
  getRegisteredLayers(): MapLayer[];
  getVisibleLayers(): MapLayer[];
  isEnabled(): boolean;
}

declare module '../../core/registry/types' {
  interface FeatureServices {
    maps?: MapsFeatureService;
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

export function mountMapsFeature(
  _el: HTMLElement,
  ctx: FeatureContext,
  registry: MapLayerRegistry = mapLayerRegistry,
): HudPanelInstance {
  let cleanups: Array<() => void> = [];
  let registered = false;

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
    }
  };

  syncRegistration();

  const service: MapsFeatureService = {
    layerRegistry: registry,
    getRegisteredLayers: () => registry.all(),
    getVisibleLayers: () => registry.forFlags(ctx.flags),
    isEnabled: () => ctx.flags.has('W04'),
  };
  ctx.services.maps = service;

  return {
    update() {
      syncRegistration();
    },
    dispose() {
      for (const fn of cleanups) fn();
      cleanups = [];
      registered = false;
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
