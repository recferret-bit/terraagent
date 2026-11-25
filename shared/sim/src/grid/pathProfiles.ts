import { globalTileToSector } from '../atlas/partition';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { isGroundMoveBlocked, isPreparedGround, isTileUneven } from './geo';
import { hexIndex } from './hex';
import { DEPOSIT, PREP, TERRAIN } from './layers';
import { isPassableTerrain } from './tileModel';
import { getWreckTileSet } from '../systems/combat/wrecks';

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

export interface UnitHexOccupancy {
  readonly claimedGoals: ReadonlySet<number>;
  readonly inTransitGoals: ReadonlySet<number>;
  readonly hostileStationary: ReadonlySet<number>;
  readonly alliedStationary: ReadonlySet<number>;
}

export type UnitOccupancyResolver = (
  state: PlanetState,
  entityId: number,
  data?: CompiledDataLike,
) => UnitHexOccupancy | null;

export const ALLIED_UNIT_AVOID_COST_BP = 800;
let unitOccupancyResolver: UnitOccupancyResolver | null = null;

export function defineUnitOccupancy(fn: UnitOccupancyResolver): void {
  unitOccupancyResolver = fn;
}

export function resolveRegisteredUnitOccupancy(
  state: PlanetState,
  entityId: number,
  data?: CompiledDataLike,
): UnitHexOccupancy | null {
  if (entityId <= 0 || !unitOccupancyResolver) return null;
  return unitOccupancyResolver(state, entityId, data);
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
export interface Blockers {
  blocked: Predicate;
  goalBlocked: Predicate;
  bandGoalBlocked?: Predicate;
  avoidPenaltyBp?: (tileIdx: number) => number;
}

/**
 * Named movement profiles for path requests. A request in the path queue is plain data (it lives in a blob), so it
 * names its obstacle rule instead of carrying a function. `none` = terrain passability only (Deep, Ridge, Moat block).
 */
export type PathProfileId = 'none' | 'ground' | 'terraform' | 'worker' | 'hover';

const isMountainTile = (terrain: number, prep: number): boolean =>
  terrain === TERRAIN.rock && !isPreparedGround(prep);

const PROFILES: Record<PathProfileId, ((state: PlanetState, fromIdx: number, data?: CompiledDataLike) => Blockers) | null> = {
  none: null,
  /** Ground units: flat ground and non-terraformed dunes (`slope`) are passable; mountains (`rock`), forest, holes, water, deposits and footprints block. */
  ground: (state, fromIdx, data) => {
    const { terrain, prep, deposit } = state.grid.layers;
    const { own, others } = occupiedTiles(state, fromIdx, data);
    const wrecks = getWreckTileSet(state);
    const blocked: Predicate = (i) =>
      (i !== fromIdx &&
        (!isPassableTerrain(terrain[i], prep[i]) ||
          isMountainTile(terrain[i], prep[i]) ||
          isGroundMoveBlocked(terrain[i], deposit[i]) ||
          wrecks.has(i))) ||
      others.has(i);
    return {
      blocked,
      goalBlocked: (i) => blocked(i) || own.has(i) || wrecks.has(i) || !isPassableTerrain(terrain[i], prep[i]) || isMountainTile(terrain[i], prep[i]),
    };
  },
  /** HQ terraform stand (E1–E3): walks across flat and non-terraformed dunes, but only ends on a level Flat stand so dunes are cut from the edge inward. */
  terraform: (state, fromIdx, data) => {
    const { terrain, prep, deposit, height } = state.grid.layers;
    const { own, others } = occupiedTiles(state, fromIdx, data);
    const wrecks = getWreckTileSet(state);
    const blocked: Predicate = (i) =>
      (i !== fromIdx &&
        (!isPassableTerrain(terrain[i], prep[i]) ||
          isMountainTile(terrain[i], prep[i]) ||
          isGroundMoveBlocked(terrain[i], deposit[i]) ||
          wrecks.has(i))) ||
      others.has(i);
    return {
      blocked,
      goalBlocked: (i) =>
        blocked(i) ||
        own.has(i) ||
        wrecks.has(i) ||
        !isPassableTerrain(terrain[i], prep[i]) ||
        isMountainTile(terrain[i], prep[i]) ||
        terrain[i] !== TERRAIN.flat ||
        isTileUneven(state.grid.radius, i, terrain, height),
    };
  },
  /** Workers & insects: cross flat, non-terraformed dunes (`slope`) and forest freely, but never cross mountains (`rock`), deposits, wrecks, water, holes, ridges, moats or buildings. */
  worker: (state, fromIdx, data) => {
    const { terrain, prep, deposit } = state.grid.layers;
    const { own, others } = occupiedTiles(state, fromIdx, data);
    const wrecks = getWreckTileSet(state);
    const blocked: Predicate = (i) =>
      (i !== fromIdx &&
        (!isPassableTerrain(terrain[i], prep[i]) ||
          isMountainTile(terrain[i], prep[i]) ||
          terrain[i] === TERRAIN.shallow ||
          deposit[i] !== DEPOSIT.none ||
          wrecks.has(i))) ||
      others.has(i);
    return {
      blocked,
      goalBlocked: (i) => blocked(i) || own.has(i) || wrecks.has(i) || !isPassableTerrain(terrain[i], prep[i]) || isMountainTile(terrain[i], prep[i]),
    };
  },
  /** Hover units: cross flat, non-terraformed dunes (`slope`), forest, deposits and shallow water; blocked by mountains (`rock`), wrecks, deep water, holes, ridges, moats and buildings. */
  hover: (state, fromIdx, data) => {
    const { terrain, prep } = state.grid.layers;
    const { own, others } = occupiedTiles(state, fromIdx, data);
    const wrecks = getWreckTileSet(state);
    const blocked: Predicate = (i) =>
      (i !== fromIdx &&
        (terrain[i] === TERRAIN.deep ||
          terrain[i] === TERRAIN.hole ||
          isMountainTile(terrain[i], prep[i]) ||
          prep[i] === PREP.ridge ||
          prep[i] === PREP.moat ||
          wrecks.has(i))) ||
      others.has(i);
    return { blocked, goalBlocked: (i) => blocked(i) || own.has(i) || wrecks.has(i) || isMountainTile(terrain[i], prep[i]) };
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
export function pathBlockedFor(
  state: PlanetState,
  profile: PathProfileId | undefined,
  fromIdx = -1,
  data?: CompiledDataLike,
  entityId?: number,
): Predicate | undefined {
  return pathBlockersFor(state, profile, fromIdx, data, entityId)?.blocked;
}

function combineWithUnitOccupancy(
  base: Blockers | undefined,
  _fromIdx: number,
  unitOcc: UnitHexOccupancy | null,
): Blockers | undefined {
  if (!unitOcc) return base;
  const hasGoal = unitOcc.claimedGoals.size > 0;
  const hasTransit = unitOcc.inTransitGoals.size > 0;
  const hasAvoid = unitOcc.alliedStationary.size > 0 || unitOcc.hostileStationary.size > 0;
  if (!hasGoal && !hasTransit && !hasAvoid) return base;
  const goalUnit: Predicate = (i) => hasGoal && unitOcc.claimedGoals.has(i);
  const bandGoalUnit: Predicate = (i) => goalUnit(i) || (hasTransit && unitOcc.inTransitGoals.has(i));
  const avoidPenaltyBp = hasAvoid
    ? (i: number) =>
        unitOcc.hostileStationary.has(i)
          ? ALLIED_UNIT_AVOID_COST_BP * 2
          : unitOcc.alliedStationary.has(i)
            ? ALLIED_UNIT_AVOID_COST_BP
            : 0
    : undefined;
  if (!base) {
    return {
      blocked: () => false,
      goalBlocked: goalUnit,
      bandGoalBlocked: bandGoalUnit,
      ...(avoidPenaltyBp ? { avoidPenaltyBp } : {}),
    };
  }
  return {
    blocked: base.blocked,
    goalBlocked: (i) => base.goalBlocked(i) || goalUnit(i),
    bandGoalBlocked: (i) => base.goalBlocked(i) || bandGoalUnit(i),
    ...(avoidPenaltyBp ? { avoidPenaltyBp } : {}),
  };
}

/**
 * Both predicates a path search needs, from one pass over the footprints: `blocked` (crossing; the footprint the unit
 * stands in at `fromIdx` is exempt) and `goalBlocked` (ending; no footprint or claimed unit hex is exempt). Undefined for `none` without unit occupancy.
 */
export function pathBlockersFor(
  state: PlanetState,
  profile: PathProfileId | undefined,
  fromIdx: number,
  data?: CompiledDataLike,
  entityId?: number,
  unitOccOverride?: UnitHexOccupancy | null,
): Blockers | undefined {
  const unitOcc =
    unitOccOverride !== undefined
      ? unitOccOverride
      : entityId !== undefined && entityId > 0
        ? resolveRegisteredUnitOccupancy(state, entityId, data)
        : null;
  const base = combineWithUnitOccupancy(PROFILES[profile ?? 'none']?.(state, fromIdx, data), fromIdx, unitOcc);
  const crossSec = crossSectorBlockerFor(state, fromIdx);
  if (!crossSec) return base;
  if (!base) return { blocked: crossSec, goalBlocked: crossSec };
  return {
    blocked: (i) => crossSec(i) || base.blocked(i),
    goalBlocked: (i) => crossSec(i) || base.goalBlocked(i),
    ...(base.bandGoalBlocked ? { bandGoalBlocked: (i) => crossSec(i) || base.bandGoalBlocked!(i) } : {}),
    ...(base.avoidPenaltyBp ? { avoidPenaltyBp: base.avoidPenaltyBp } : {}),
  };
}
