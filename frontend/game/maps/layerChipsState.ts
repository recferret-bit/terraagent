import {
  MAP_LAYER_IDS,
  MAP_LAYER_META,
  type MapLayerId,
} from '@terra/contracts';
import type { MapLayerRegistry } from './layerRegistry';
import type { MapLayer, MapLayerDrawView } from './types';

export const MAP_LAYERS_STORAGE_KEY = 'terra.mapLayers';

export type StoredLayerMap = Partial<Record<MapLayerId, boolean>>;

export function readStoredMapLayers(
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof globalThis !== 'undefined'
    ? globalThis.localStorage
    : undefined,
): StoredLayerMap {
  try {
    const raw = storage?.getItem(MAP_LAYERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: StoredLayerMap = {};
    for (const id of MAP_LAYER_IDS) {
      if (typeof parsed[id] === 'boolean') {
        out[id] = parsed[id] as boolean;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeStoredMapLayers(
  state: StoredLayerMap,
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof globalThis !== 'undefined'
    ? globalThis.localStorage
    : undefined,
): void {
  try {
    storage?.setItem(MAP_LAYERS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked or quota exceeded: state remains in memory for session
  }
}

export function registerAllCatalogMapLayers(
  registry: MapLayerRegistry,
  drawers: Partial<Record<MapLayerId, (ctx: CanvasRenderingContext2D, view: MapLayerDrawView) => void>> = {},
): () => void {
  const cleanups: Array<() => void> = [];
  for (const id of MAP_LAYER_IDS) {
    const meta = MAP_LAYER_META[id];
    const draw = drawers[id] ?? (() => {});
    cleanups.push(
      registry.register({
        id: meta.id,
        label: meta.label,
        wave: meta.wave,
        defaultOn: meta.defaultOn,
        order: meta.order,
        draw,
      }),
    );
  }
  return () => {
    for (const fn of cleanups) fn();
  };
}

export interface MapLayerChipControllerOptions {
  readonly registry: MapLayerRegistry;
  readonly getFlags: () => ReadonlySet<string>;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly onChange?: (activeLayers: MapLayerId[]) => void;
}

export class MapLayerChipController {
  private readonly registry: MapLayerRegistry;
  private readonly getFlags: () => ReadonlySet<string>;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly onChange?: (activeLayers: MapLayerId[]) => void;
  private readonly state: StoredLayerMap;

  constructor(opts: MapLayerChipControllerOptions) {
    this.registry = opts.registry;
    this.getFlags = opts.getFlags;
    this.storage = opts.storage;
    this.onChange = opts.onChange;
    this.state = readStoredMapLayers(this.storage);
  }

  getVisibleLayers(): MapLayer[] {
    return this.registry.forFlags(this.getFlags());
  }

  isLayerActive(id: MapLayerId): boolean {
    const visible = this.getVisibleLayers();
    const layer = visible.find((l) => l.id === id);
    if (!layer) return false;
    if (typeof this.state[id] === 'boolean') {
      return Boolean(this.state[id]);
    }
    return layer.defaultOn ?? MAP_LAYER_META[id]?.defaultOn ?? false;
  }

  getActiveSet(): Set<MapLayerId> {
    const out = new Set<MapLayerId>();
    for (const layer of this.getVisibleLayers()) {
      if (this.isLayerActive(layer.id)) {
        out.add(layer.id);
      }
    }
    return out;
  }

  getActiveLayerIds(): MapLayerId[] {
    return [...this.getActiveSet()];
  }

  setLayerActive(id: MapLayerId, active: boolean): boolean {
    const next = Boolean(active);
    this.state[id] = next;
    writeStoredMapLayers(this.state, this.storage);
    this.onChange?.(this.getActiveLayerIds());
    return next;
  }

  toggleLayer(id: MapLayerId, force?: boolean): boolean {
    const next = force !== undefined ? Boolean(force) : !this.isLayerActive(id);
    return this.setLayerActive(id, next);
  }
}
