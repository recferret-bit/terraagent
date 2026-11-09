import { hexDistance, hexIndex } from '../../grid/hex';
import { PREP } from '../../grid/layers';
import type { PlanetState } from '../../kernel/state';

/** Irrigated / Living share of the tiles within `ringRadius` of an extractor footprint (D-34, W05-34). */
export interface ExtractorRingStats {
  ringRadius: number;
  totalTiles: number;
  terraformedTiles: number;
  livingTiles: number;
  terraformedRatio: number;
  livingRatio: number;
  terraformedPct: number;
  livingPct: number;
}

interface RingCacheEntry {
  version: number;
  lastPathEpoch: number;
  hits: number;
  misses: number;
  byKey: Map<string, ExtractorRingStats>;
}

/**
 * Ring stats are a pure function of the tile layers, so the cache lives beside the state (never in it): a restored or
 * cloned planet starts empty and recomputes the same numbers. It drops everything when the path epoch moves (terrain
 * changed) or when `invalidateExtractorRingCache` runs (every `tileStateChanged`).
 */
const ringCacheByState = new WeakMap<PlanetState, RingCacheEntry>();

function ensureRingCache(state: PlanetState): RingCacheEntry {
  const epoch = state.meta.pathEpoch ?? 0;
  let entry = ringCacheByState.get(state);
  if (!entry) {
    entry = { version: 1, lastPathEpoch: epoch, hits: 0, misses: 0, byKey: new Map() };
    ringCacheByState.set(state, entry);
    return entry;
  }
  if (entry.lastPathEpoch !== epoch) {
    entry.version++;
    entry.lastPathEpoch = epoch;
    entry.byKey.clear();
  }
  return entry;
}

/** Invalidates the cached extractor ring ratios for `state` (call it wherever `tileStateChanged` is emitted, `W05-34`). */
export function invalidateExtractorRingCache(state: PlanetState): void {
  const entry = ringCacheByState.get(state);
  if (!entry) return;
  entry.version++;
  entry.lastPathEpoch = state.meta.pathEpoch ?? 0;
  entry.byKey.clear();
}

/** Diagnostic helper for tests to verify ring ratio caching and invalidation on `tileStateChanged`. */
export function getExtractorRingCacheDiagnostics(state: PlanetState): { version: number; hits: number; misses: number; size: number } {
  const entry = ensureRingCache(state);
  return { version: entry.version, hits: entry.hits, misses: entry.misses, size: entry.byKey.size };
}

/** Axial cells of a `w × d` footprint at `(q, r)` turned by `rot` (odd rotations swap the sides). */
function footprintCells(q: number, r: number, w: number, d: number, rot: number): { fw: number; fd: number; cells: Array<[number, number]> } {
  const swap = rot % 2 !== 0;
  const fw = Math.max(1, swap ? d : w);
  const fd = Math.max(1, swap ? w : d);
  const cells: Array<[number, number]> = [];
  for (let dr = 0; dr < fd; dr++) for (let dq = 0; dq < fw; dq++) cells.push([q + dq, r + dr]);
  return { fw, fd, cells };
}

function ratio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function computeRingUncached(state: PlanetState, q: number, r: number, w: number, d: number, rot: number, ringRadius: number): ExtractorRingStats {
  const idx = hexIndex(state.grid.radius);
  const prepLayer = state.grid.layers.prep as Uint8Array;
  const { fw, fd, cells } = footprintCells(q, r, w, d, rot);
  const footprint = new Set<number>();
  for (const [fq, fr] of cells) {
    const i = idx.indexOf(fq, fr);
    if (i >= 0) footprint.add(i);
  }
  let totalTiles = 0, terraformedTiles = 0, livingTiles = 0;
  for (let tr = r - ringRadius; tr <= r + fd - 1 + ringRadius; tr++) {
    for (let tq = q - ringRadius; tq <= q + fw - 1 + ringRadius; tq++) {
      const tIdx = idx.indexOf(tq, tr);
      if (tIdx < 0 || footprint.has(tIdx)) continue;
      let minDist = Infinity;
      for (const [fq, fr] of cells) minDist = Math.min(minDist, hexDistance(tq, tr, fq, fr));
      if (minDist < 1 || minDist > ringRadius) continue;
      totalTiles++;
      const prep = prepLayer[tIdx];
      if (prep === PREP.irrigated || prep === PREP.living) terraformedTiles++;
      if (prep === PREP.living) livingTiles++;
    }
  }
  const terraformedRatio = ratio(terraformedTiles, totalTiles);
  const livingRatio = ratio(livingTiles, totalTiles);
  return {
    ringRadius,
    totalTiles,
    terraformedTiles,
    livingTiles,
    terraformedRatio,
    livingRatio,
    terraformedPct: Number((terraformedRatio * 100).toFixed(1)),
    livingPct: Number((livingRatio * 100).toFixed(1)),
  };
}

/**
 * Returns the cached ring ratio (`PREP.irrigated` / `PREP.living` within `ringRadius` of the footprint `(w, d)` at `(q, r)`).
 * Refreshed when `tileStateChanged` invalidates the cache (`W05-34`).
 */
export function getExtractorRingStats(state: PlanetState, q: number, r: number, w = 2, d = 2, rot = 0, ringRadius = 2): ExtractorRingStats {
  const cache = ensureRingCache(state);
  const key = `${q},${r},${w},${d},${rot},${ringRadius}`;
  const existing = cache.byKey.get(key);
  if (existing) {
    cache.hits++;
    return existing;
  }
  cache.misses++;
  const stats = computeRingUncached(state, q, r, w, d, rot, ringRadius);
  cache.byKey.set(key, stats);
  return stats;
}
