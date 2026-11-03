import {
  MAP_LAYER_IDS,
  MAP_LAYER_META,
  type MapLayerId,
  type MapLayerMeta,
} from '@terra/contracts';
import type { MapLayer } from './types';

export { MAP_LAYER_IDS, MAP_LAYER_META, type MapLayerId, type MapLayerMeta };

export class MapLayerRegistry {
  private readonly layers = new Map<MapLayerId, MapLayer>();

  register(layer: MapLayer): () => void {
    this.layers.set(layer.id, layer);
    return () => {
      if (this.layers.get(layer.id) === layer) {
        this.layers.delete(layer.id);
      }
    };
  }

  unregister(id: MapLayerId): void {
    this.layers.delete(id);
  }

  clear(): void {
    this.layers.clear();
  }

  get(id: MapLayerId): MapLayer | undefined {
    return this.layers.get(id);
  }

  has(id: MapLayerId): boolean {
    return this.layers.has(id);
  }

  all(): MapLayer[] {
    return [...this.layers.values()].sort((a, b) => {
      const oa = a.order ?? MAP_LAYER_META[a.id]?.order ?? 100;
      const ob = b.order ?? MAP_LAYER_META[b.id]?.order ?? 100;
      return oa - ob;
    });
  }

  /**
   * Returns registered layers whose `wave` flag is enabled in `flags`.
   * If `W04` is off in `flags`, returns `[]` so no map layer is active.
   */
  forFlags(flags: ReadonlySet<string>): MapLayer[] {
    if (!flags.has('W04')) return [];
    return this.all().filter((layer) => flags.has(layer.wave));
  }
}

export function createMapLayerRegistry(): MapLayerRegistry {
  return new MapLayerRegistry();
}

export const mapLayerRegistry = new MapLayerRegistry();
