import type { PlanetState } from '../kernel/state';
import { isGroundMoveBlocked } from './geo';

/**
 * Footprints (tile index lists) ground units cannot walk through (buildings). Registered by the module that owns the
 * entities (construction registers Hub footprints) at import time; the result must depend only on `state`. A unit that
 * stands inside a footprint (e.g. the HQ when a Hub is placed on top of it) may walk out of that one.
 */
export type GroundOccupancy = (state: PlanetState) => Iterable<readonly number[]>;
const occupancy: GroundOccupancy[] = [];

export function defineGroundOccupancy(fn: GroundOccupancy): void {
  if (!occupancy.includes(fn)) occupancy.push(fn);
}

function occupiedTiles(state: PlanetState, fromIdx: number): Set<number> {
  const out = new Set<number>();
  for (const fn of occupancy) {
    for (const footprint of fn(state)) {
      if (footprint.includes(fromIdx)) continue;
      for (const i of footprint) out.add(i);
    }
  }
  return out;
}

/**
 * Named movement profiles for path requests. A request in the path queue is plain data (it lives in a blob), so it
 * names its obstacle rule instead of carrying a function. `none` = terrain passability only (Deep, Ridge, Moat block).
 */
export type PathProfileId = 'none' | 'ground';

const PROFILES: Record<PathProfileId, ((state: PlanetState, fromIdx: number) => (tileIdx: number) => boolean) | null> = {
  none: null,
  /** Ground units: untouched forest and rock (until Clear / Break), resource deposits and building footprints block. */
  ground: (state, fromIdx) => {
    const { terrain, deposit } = state.grid.layers;
    const occupied = occupiedTiles(state, fromIdx);
    return (i) => isGroundMoveBlocked(terrain[i], deposit[i]) || occupied.has(i);
  },
};

/**
 * The extra-obstacle predicate of `profile` on `state` (undefined for `none`) for a unit at tile `fromIdx` (the
 * footprint it stands in, if any, does not block it).
 */
export function pathBlockedFor(state: PlanetState, profile: PathProfileId | undefined, fromIdx = -1): ((tileIdx: number) => boolean) | undefined {
  const make = PROFILES[profile ?? 'none'];
  return make ? make(state, fromIdx) : undefined;
}
