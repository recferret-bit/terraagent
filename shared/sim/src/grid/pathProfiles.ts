import { globalTileToSector } from '../atlas/partition';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { isGroundMoveBlocked, isTileUneven } from './geo';
import { hexIndex } from './hex';
import { DEPOSIT, PREP, TERRAIN } from './layers';
import { isPassableTerrain } from './tileModel';

/**
 * Footprints (tile index lists) ground units cannot walk through (buildings). Registered by the module that owns the
 * entities (construction registers Hub footprints) at import time; the result must depend only on `state` and the
 * step's compiled `data` (a tuned footprint size, GP-38). A unit that stands inside a footprint (e.g. the HQ when a Hub
 * is placed on top of it) may walk out of that one.
 */
export type GroundOccupancy = (state: PlanetState, data?: CompiledDataLike) => Iterable<readonly number[]>;
const occupancy: GroundOccupancy[] = [];

export function defineGroundOccupancy(fn: GroundOccupancy): void {
  if (!occupancy.includes(fn)) occupancy.push(fn);
}

/** Footprint tiles split into those of the footprints containing `fromIdx` (`own`) and all the others. */
function occupiedTiles(state: PlanetState, fromIdx: number, data?: CompiledDataLike): { own: Set<number>; others: Set<number> } {
  const own = new Set<number>();
  const others = new Set<number>();
  for (const fn of occupancy) {
    for (const footprint of fn(state, data)) {
      const into = footprint.includes(fromIdx) ? own : others;
      for (const i of footprint) into.add(i);
    }
  }
  return { own, others };
}

type Predicate = (tileIdx: number) => boolean;
interface Blockers { blocked: Predicate; goalBlocked: Predicate }

/**
 * Named movement profiles for path requests. A request in the path queue is plain data (it lives in a blob), so it
 * names its obstacle rule instead of carrying a function. `none` = terrain passability only (Deep, Ridge, Moat block).
 */
export type PathProfileId = 'none' | 'ground' | 'worker' | 'hover';

const PROFILES: Record<PathProfileId, ((state: PlanetState, fromIdx: number, data?: CompiledDataLike) => Blockers) | null> = {
  none: null,
  /** Ground units: non-flat terrain (forest, rock, dunes/slope, holes, water), uneven tiles, deposits and footprints block. */
  ground: (state, fromIdx, data) => {
    const { terrain, prep, deposit, height } = state.grid.layers;
    const { own, others } = occupiedTiles(state, fromIdx, data);
    const blocked: Predicate = (i) =>
      (i !== fromIdx &&
        (!isPassableTerrain(terrain[i], prep[i]) ||
          isGroundMoveBlocked(terrain[i], deposit[i]) ||
          isTileUneven(state.grid.radius, i, terrain, height))) ||
      others.has(i);
    return { blocked, goalBlocked: (i) => blocked(i) || own.has(i) || !isPassableTerrain(terrain[i], prep[i]) };
  },
  /** Workers: cross flat, slope, forest and rock tiles freely, but never step inside resource deposits, water, holes, ridges, moats or buildings. */
  worker: (state, fromIdx, data) => {
    const { terrain, prep, deposit } = state.grid.layers;
    const { own, others } = occupiedTiles(state, fromIdx, data);
    const blocked: Predicate = (i) =>
      (i !== fromIdx &&
        (!isPassableTerrain(terrain[i], prep[i]) ||
          terrain[i] === TERRAIN.shallow ||
          deposit[i] !== DEPOSIT.none)) ||
      others.has(i);
    return { blocked, goalBlocked: (i) => blocked(i) || own.has(i) || !isPassableTerrain(terrain[i], prep[i]) };
  },
  /** Hover units: cross flat, slope, forest, rock, resource deposits and shallow water freely; blocked only by deep water, holes, ridges, moats and buildings. */
  hover: (state, fromIdx, data) => {
    const { terrain, prep } = state.grid.layers;
    const { own, others } = occupiedTiles(state, fromIdx, data);
    const blocked: Predicate = (i) =>
      (i !== fromIdx &&
        (terrain[i] === TERRAIN.deep ||
          terrain[i] === TERRAIN.hole ||
          prep[i] === PREP.ridge ||
          prep[i] === PREP.moat)) ||
      others.has(i);
    return { blocked, goalBlocked: (i) => blocked(i) || own.has(i) };
  },
};

function crossSectorBlockerFor(state: PlanetState, fromIdx: number): Predicate | null {
  if (fromIdx < 0) return null;
  const rawAtlas = state.blobs.atlas as { value?: unknown } | undefined;
  const atlas = (rawAtlas && typeof rawAtlas === 'object' && 'value' in rawAtlas ? rawAtlas.value : rawAtlas) as
    | { sectorRadius?: number }
    | undefined;
  const sectorRadius = atlas?.sectorRadius;
  if (typeof sectorRadius !== 'number' || sectorRadius <= 0) return null;
  const hx = hexIndex(state.grid.radius);
  if (fromIdx >= hx.count) return null;
  const startSectorId = globalTileToSector(hx.q[fromIdx]!, hx.r[fromIdx]!, sectorRadius).sectorId;
  return (i: number) => i >= 0 && i < hx.count && globalTileToSector(hx.q[i]!, hx.r[i]!, sectorRadius).sectorId !== startSectorId;
}

/**
 * The extra-obstacle predicate of `profile` on `state` (undefined for `none`) for a unit at tile `fromIdx` (the
 * footprint it stands in, if any, does not block it). `data`: the step's compiled data (footprint sizes).
 */
export function pathBlockedFor(state: PlanetState, profile: PathProfileId | undefined, fromIdx = -1, data?: CompiledDataLike): Predicate | undefined {
  return pathBlockersFor(state, profile, fromIdx, data)?.blocked;
}

/**
 * Both predicates a path search needs, from one pass over the footprints: `blocked` (crossing; the footprint the unit
 * stands in at `fromIdx` is exempt) and `goalBlocked` (ending; no footprint is exempt). Undefined for `none`.
 */
export function pathBlockersFor(state: PlanetState, profile: PathProfileId | undefined, fromIdx: number, data?: CompiledDataLike): Blockers | undefined {
  const base = PROFILES[profile ?? 'none']?.(state, fromIdx, data);
  const crossSec = crossSectorBlockerFor(state, fromIdx);
  if (!crossSec) return base;
  if (!base) return { blocked: crossSec, goalBlocked: crossSec };
  return {
    blocked: (i) => crossSec(i) || base.blocked(i),
    goalBlocked: (i) => crossSec(i) || base.goalBlocked(i),
  };
}
