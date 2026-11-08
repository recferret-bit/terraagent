import type { Blob, Grid, PlanetMeta, PlanetState } from '../kernel/state';
import type { GridLike, TileLayersLike } from './tileModel';

export const COLONY_EXPLORED_BLOB = 'colonyExplored';

/** Persisted per-colony exploration bitsets in `state.blobs.colonyExplored` (`W11-39`). */
export interface ColonyExploredBlobValue {
  version: number;
  tileCount: number;
  byColony: Record<number, Uint8Array>;
}

/** Tile carrier shape accepted by `isColonyTileExplored` (sim `Grid`, `SimView['tiles']`, or client `ClientTiles`). */
export interface ExplorableTilesLike {
  count?: number;
  explored?: ArrayLike<number>;
  exploredByColony?: Record<number, Uint8Array>;
}

interface ExplorationBinding {
  count: number;
  layers: { explored?: Uint8Array };
  meta?: PlanetMeta;
  blobs?: Record<string, Blob>;
  byColony: Record<number, Uint8Array>;
  version: number;
}

const bindingMap = new WeakMap<object, ExplorationBinding>();

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Packed bitset byte length for `tileCount` tiles (`Math.ceil(tileCount / 8)`). */
export function colonyBitsetByteLength(tileCount: number): number {
  return Math.max(0, Math.ceil(tileCount / 8));
}

/** Reads bit `tileIdx & 7` of `bitset[tileIdx >> 3]`. */
export function getColonyExploredBit(bitset: Uint8Array | undefined, tileIdx: number): boolean {
  if (!bitset || !Number.isInteger(tileIdx) || tileIdx < 0) return false;
  const byteIdx = tileIdx >> 3;
  if (byteIdx >= bitset.length) return false;
  return (bitset[byteIdx]! & (1 << (tileIdx & 7))) !== 0;
}

/** Sets bit `tileIdx & 7` of `bitset[tileIdx >> 3]`. Returns `true` when the bit transitioned `0 -> 1`. */
export function setColonyExploredBit(bitset: Uint8Array, tileIdx: number): boolean {
  if (!Number.isInteger(tileIdx) || tileIdx < 0) return false;
  const byteIdx = tileIdx >> 3;
  if (byteIdx >= bitset.length) return false;
  const mask = 1 << (tileIdx & 7);
  const prev = bitset[byteIdx]!;
  if ((prev & mask) !== 0) return false;
  bitset[byteIdx] = prev | mask;
  return true;
}

/**
 * Pure exploration query across `tiles.exploredByColony` (for any `colonyIdx >= 0`) with legacy `tiles.explored` (`u8`)
 * fallback ONLY for `0 <= colonyIdx < 8`. Never reads `tiles.explored` when `colonyIdx >= 8`.
 */
export function isColonyTileExplored(
  tiles: ExplorableTilesLike | undefined,
  tileIdx: number,
  colonyIdx: number,
): boolean {
  if (!tiles || !Number.isInteger(tileIdx) || tileIdx < 0 || !Number.isInteger(colonyIdx) || colonyIdx < 0) {
    return false;
  }
  if (typeof tiles.count === 'number' && tileIdx >= tiles.count) return false;
  if (getColonyExploredBit(tiles.exploredByColony?.[colonyIdx], tileIdx)) return true;
  if (colonyIdx < 8 && tiles.explored) {
    return ((tiles.explored[tileIdx] ?? 0) & (1 << colonyIdx)) !== 0;
  }
  return false;
}

/** Hydrates per-colony bitsets for colonies `0..7` from a legacy `u8` `explored` bitmask layer. */
export function hydrateColonyBitsetsFromExploredLayer(
  explored: ArrayLike<number> | undefined,
  tileCount: number,
  target: Record<number, Uint8Array> = {},
): { byColony: Record<number, Uint8Array>; hadAnyBits: boolean } {
  let hadAnyBits = false;
  if (!explored || tileCount <= 0) return { byColony: target, hadAnyBits };
  const byteLen = colonyBitsetByteLength(tileCount);
  const limit = Math.min(tileCount, explored.length);
  for (let i = 0; i < limit; i++) {
    const mask = explored[i] ?? 0;
    if (mask === 0) continue;
    for (let col = 0; col < 8; col++) {
      if ((mask & (1 << col)) === 0) continue;
      const arr = target[col] ?? (target[col] = new Uint8Array(byteLen));
      setColonyExploredBit(arr, i);
      hadAnyBits = true;
    }
  }
  return { byColony: target, hadAnyBits };
}

function syncLegacyLayerFromBitsets(
  explored: Uint8Array | undefined,
  tileCount: number,
  byColony: Record<number, Uint8Array>,
): void {
  if (!explored || tileCount <= 0) return;
  const limit = Math.min(tileCount, explored.length);
  for (let col = 0; col < 8; col++) {
    const bits = byColony[col];
    if (!bits) continue;
    const bitMask = 1 << col;
    for (let b = 0; b < bits.length; b++) {
      const byte = bits[b]!;
      if (byte === 0) continue;
      const baseTile = b << 3;
      for (let k = 0; k < 8; k++) {
        const tileIdx = baseTile + k;
        if (tileIdx >= limit) break;
        if ((byte & (1 << k)) !== 0) explored[tileIdx] |= bitMask;
      }
    }
  }
}

function normalizeByColonyMap(rawByColony: unknown, tileCount: number): Record<number, Uint8Array> {
  const out: Record<number, Uint8Array> = {};
  if (!isRecord(rawByColony)) return out;
  const byteLen = colonyBitsetByteLength(tileCount);
  for (const [k, v] of Object.entries(rawByColony)) {
    const col = Number(k);
    if (!Number.isInteger(col) || col < 0) continue;
    if (v instanceof Uint8Array && v.length === byteLen) {
      out[col] = v;
    } else if (v && typeof (v as ArrayLike<number>).length === 'number') {
      const arr = new Uint8Array(byteLen);
      const src = v as ArrayLike<number>;
      const copyLen = Math.min(byteLen, src.length);
      for (let i = 0; i < copyLen; i++) arr[i] = src[i] ?? 0;
      out[col] = arr;
    }
  }
  return out;
}

function attachNonEnumerableExploredGetter(target: object, getMap: () => Record<number, Uint8Array>): void {
  Object.defineProperty(target, 'exploredByColony', {
    get: getMap,
    enumerable: false,
    configurable: true,
  });
}

/** Links `grid` and `grid.layers` with per-colony exploration bitsets and `blobs.colonyExplored`. */
export function linkGridExploration(
  grid: Grid,
  meta: PlanetMeta,
  blobs?: Record<string, Blob>,
  opts?: { persistHydratedBlob?: boolean },
): void {
  const count = grid.count;
  const rawBlob = blobs?.[COLONY_EXPLORED_BLOB];
  const rawVal = isRecord(rawBlob?.value) ? rawBlob.value : undefined;
  let byColony: Record<number, Uint8Array>;
  let version: number;

  if (rawVal && isRecord(rawVal.byColony)) {
    byColony = normalizeByColonyMap(rawVal.byColony, count);
    version = typeof rawVal.version === 'number' && rawVal.version > 0 ? rawVal.version : 1;
    hydrateColonyBitsetsFromExploredLayer(grid.layers.explored, count, byColony);
    syncLegacyExploredLayer(grid, byColony);
    rawBlob!.value = { version, tileCount: count, byColony } satisfies ColonyExploredBlobValue;
  } else {
    const hydrated = hydrateColonyBitsetsFromExploredLayer(grid.layers.explored, count);
    byColony = hydrated.byColony;
    version = hydrated.hadAnyBits ? 1 : 0;
    if (opts?.persistHydratedBlob && hydrated.hadAnyBits && blobs) {
      blobs[COLONY_EXPLORED_BLOB] = {
        changedAt: meta.tick ?? 0,
        value: { version: 1, tileCount: count, byColony } satisfies ColonyExploredBlobValue,
      };
    }
  }

  const binding: ExplorationBinding = {
    count,
    layers: grid.layers as { explored?: Uint8Array },
    meta,
    blobs,
    byColony,
    version,
  };
  bindingMap.set(grid, binding);
  bindingMap.set(grid.layers, binding);
  attachNonEnumerableExploredGetter(grid, () => syncAndReadByColony(binding));
  attachNonEnumerableExploredGetter(grid.layers, () => syncAndReadByColony(binding));
}

function syncLegacyExploredLayer(grid: Grid, byColony: Record<number, Uint8Array>): void {
  syncLegacyLayerFromBitsets(grid.layers.explored as Uint8Array | undefined, grid.count, byColony);
}

function syncAndReadByColony(binding: ExplorationBinding): Record<number, Uint8Array> {
  hydrateColonyBitsetsFromExploredLayer(binding.layers.explored, binding.count, binding.byColony);
  return binding.byColony;
}

function ensureBindingForLayers(
  layers: TileLayersLike,
  count: number,
  meta?: PlanetMeta,
  blobs?: Record<string, Blob>,
): ExplorationBinding {
  let binding = bindingMap.get(layers);
  if (!binding) {
    const hydrated = hydrateColonyBitsetsFromExploredLayer(layers.explored, count);
    binding = {
      count,
      layers,
      meta,
      blobs,
      byColony: hydrated.byColony,
      version: hydrated.hadAnyBits ? 1 : 0,
    };
    bindingMap.set(layers, binding);
    attachNonEnumerableExploredGetter(layers, () => syncAndReadByColony(binding!));
  } else {
    if (meta && !binding.meta) binding.meta = meta;
    if (blobs && !binding.blobs) binding.blobs = blobs;
  }
  return binding;
}

/**
 * Hydrates `state.blobs.colonyExplored` from `state.grid.layers.explored` when the blob is absent and any tile has
 * non-zero exploration bits, and links `state.grid` with `state.blobs`.
 */
export function hydrateStateColonyExplored(state: PlanetState): void {
  linkGridExploration(state.grid, state.meta, state.blobs, { persistHydratedBlob: true });
}

/** Upgrades a raw snapshot state object during `migrate()` so legacy `explored` bitmasks populate `blobs.colonyExplored`. */
export function hydrateLegacyExplorationOnSnapshotObject(snapshotState: Record<string, unknown>): void {
  if (!isRecord(snapshotState.grid) || !isRecord(snapshotState.grid.layers)) return;
  if (!isRecord(snapshotState.blobs)) snapshotState.blobs = {};
  const blobs = snapshotState.blobs as Record<string, Blob>;
  if (blobs[COLONY_EXPLORED_BLOB]) return;
  const explored = snapshotState.grid.layers.explored as ArrayLike<number> | undefined;
  const count = typeof snapshotState.grid.count === 'number' ? snapshotState.grid.count : (explored?.length ?? 0);
  const { byColony, hadAnyBits } = hydrateColonyBitsetsFromExploredLayer(explored, count);
  if (!hadAnyBits) return;
  const tick = isRecord(snapshotState.meta) && typeof snapshotState.meta.tick === 'number' ? snapshotState.meta.tick : 0;
  blobs[COLONY_EXPLORED_BLOB] = {
    changedAt: tick,
    value: { version: 1, tileCount: count, byColony } satisfies ColonyExploredBlobValue,
  };
}

/** Clears all per-colony exploration bitsets on `state` (used by `dev.seed` before re-revealing active HQs/pods). */
export function clearColonyExploration(state: PlanetState): void {
  delete state.blobs[COLONY_EXPLORED_BLOB];
  linkGridExploration(state.grid, state.meta, state.blobs);
}

/** Returns the per-colony exploration bitset map for `grid` (syncing any legacy `0..7` bits from `layers.explored`). */
export function getExploredByColony(
  grid: GridLike,
  resolved?: { layers: TileLayersLike; count: number; meta?: PlanetMeta; blobs?: Record<string, Blob> },
): Record<number, Uint8Array> {
  if (resolved) {
    const b = ensureBindingForLayers(resolved.layers, resolved.count, resolved.meta, resolved.blobs);
    return syncAndReadByColony(b);
  }
  if ('grid' in grid && 'meta' in grid) {
    const s = grid as PlanetState;
    const b = ensureBindingForLayers(s.grid.layers as unknown as TileLayersLike, s.grid.count, s.meta, s.blobs);
    return syncAndReadByColony(b);
  }
  const target = ('layers' in grid ? grid.layers : grid) as TileLayersLike;
  const count = 'count' in grid && typeof grid.count === 'number' ? grid.count : target.terrain.length;
  const b = ensureBindingForLayers(target, count);
  return syncAndReadByColony(b);
}

/** Marks `tileIdx` explored for `colonyIdx >= 0` in the linked bitset, legacy `u8` layer (`0..7`), and `colonyExplored` blob. */
export function recordColonyTileExplored(
  layers: TileLayersLike,
  count: number,
  tileIdx: number,
  colonyIdx: number,
  stampTick: number,
  meta?: PlanetMeta,
  blobs?: Record<string, Blob>,
): void {
  if (colonyIdx < 8 && layers.explored) {
    layers.explored[tileIdx] |= 1 << colonyIdx;
  }
  const binding = ensureBindingForLayers(layers, count, meta, blobs);
  hydrateColonyBitsetsFromExploredLayer(layers.explored, count, binding.byColony);
  const byteLen = colonyBitsetByteLength(count);
  const bitset = binding.byColony[colonyIdx] ?? (binding.byColony[colonyIdx] = new Uint8Array(byteLen));
  setColonyExploredBit(bitset, tileIdx);
  binding.version += 1;
  if (binding.blobs) {
    const prevChangedAt = binding.blobs[COLONY_EXPLORED_BLOB]?.changedAt ?? 0;
    binding.blobs[COLONY_EXPLORED_BLOB] = {
      changedAt: Math.max(prevChangedAt, stampTick),
      value: {
        version: binding.version,
        tileCount: count,
        byColony: binding.byColony,
      } satisfies ColonyExploredBlobValue,
    };
  }
}

/** Checks whether `colonyIdx >= 0` has explored `tileIdx` on `layers` (never reads `layers.explored` for `colonyIdx >= 8`). */
export function checkGridTileExplored(
  layers: TileLayersLike,
  count: number,
  tileIdx: number,
  colonyIdx: number,
): boolean {
  const binding = bindingMap.get(layers);
  if (binding && getColonyExploredBit(binding.byColony[colonyIdx], tileIdx)) {
    return true;
  }
  if (colonyIdx < 8 && layers.explored) {
    return ((layers.explored[tileIdx] ?? 0) & (1 << colonyIdx)) !== 0;
  }
  return false;
}
