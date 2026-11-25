import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { globalTileToSector } from '../../atlas/partition';
import { hexIndex, inHex } from '../../grid/hex';
import { defineUnitOccupancy, pathBlockersFor, type PathProfileId, type UnitHexOccupancy } from '../../grid/pathProfiles';
import { isGroundPassable } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { isUnitKind } from '../mobility';
import { ringCoords } from './slots';

interface StoredUnitMotionLike {
  goal: { q: number; r: number; minDist: number; maxDist: number };
  status: 'pending' | 'following' | 'arrived' | 'failed';
  path: number[];
  next: number;
}

interface StoredGroupMarchBlobLike {
  marches?: Record<string, { slots?: Record<string, { q: number; r: number }>; reserved?: number[] }>;
  memberOf?: Record<string, string>;
}

function readStoredMotions(state: PlanetState): Record<string, StoredUnitMotionLike> {
  const raw = state.blobs.unitMotion?.value as { byId?: Record<string, StoredUnitMotionLike> } | undefined;
  return raw?.byId ?? {};
}

function collectOtherReservedSlots(
  state: PlanetState,
  excludeEntityId: number,
  excludeIds?: ReadonlySet<number>,
): Set<number> {
  const out = new Set<number>();
  const blob = state.blobs.groupMarch?.value as StoredGroupMarchBlobLike | undefined;
  if (!blob?.marches) return out;
  const idx = hexIndex(state.grid.radius);
  for (const march of Object.values(blob.marches)) {
    if (!march.slots) continue;
    for (const [key, slot] of Object.entries(march.slots)) {
      const memberId = Number(key);
      if (memberId === excludeEntityId || excludeIds?.has(memberId)) continue;
      const ti = idx.indexOf(slot.q, slot.r);
      if (ti >= 0) out.add(ti);
    }
  }
  return out;
}

function isActiveMobileRow(state: PlanetState, row: number): boolean {
  const cols = state.entities.cols;
  if (cols.hp[row]! <= 0) return false;
  const st = cols.state[row]!;
  if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) return false;
  return isUnitKind(cols.kind[row]!);
}

function areUnitsHostile(ownerA: number, ownerB: number): boolean {
  if (ownerA < 0 || ownerB < 0) return ownerA !== ownerB;
  return ownerA !== ownerB;
}

function curRowTieBreak(selfId: number, otherId: number, selfWorking: boolean, otherWorking: boolean): boolean {
  if (selfId <= 0) return false;
  if (otherWorking && !selfWorking) return false;
  if (selfWorking && !otherWorking) return true;
  return otherId > selfId;
}

/**
 * Computes hex occupancy for `entityId` (or `-1` for general queries):
 * - `claimedGoals`: tiles claimed as destination or stationary hexes by other mobile units (no two units may stay on one hex).
 * - `hostileStationary`: tiles with stationary hostile units (blocks crossing).
 * - `alliedStationary`: tiles with stationary friendly units (penalized in A* so units route around parked allies when possible).
 */
export function collectUnitOccupancy(
  state: PlanetState,
  excludeEntityId = -1,
  excludeIds?: ReadonlySet<number>,
  _data?: CompiledDataLike,
): UnitHexOccupancy {
  const cols = state.entities.cols;
  const idx = hexIndex(state.grid.radius);
  const motions = readStoredMotions(state);
  const claimedGoals = collectOtherReservedSlots(state, excludeEntityId, excludeIds);
  const inTransitGoals = new Set<number>();
  const hostileStationary = new Set<number>();
  const alliedStationary = new Set<number>();

  const selfRow = excludeEntityId > 0 ? rowOf(state.entities, excludeEntityId) : -1;
  const selfOwner = selfRow >= 0 ? cols.owner[selfRow]! : -999;
  const selfHere = selfRow >= 0 ? idx.indexOf(cols.q[selfRow]!, cols.r[selfRow]!) : -1;
  const selfWorking = selfRow >= 0 && cols.state[selfRow] === ENTITY_STATE.working;

  for (let row = 0; row < state.entities.count; row++) {
    const id = cols.id[row]!;
    if (id === excludeEntityId || excludeIds?.has(id)) continue;
    if (!isActiveMobileRow(state, row)) continue;
    const otherWorking = cols.state[row] === ENTITY_STATE.working;
    const selfWinsHere = curRowTieBreak(excludeEntityId, id, selfWorking, otherWorking);

    const curIdx = idx.indexOf(cols.q[row]!, cols.r[row]!);
    const m = motions[String(id)];
    const movingToOtherTile =
      Boolean(m && m.status === 'following' && m.path.length >= 2) &&
      (m!.path[m!.path.length - 2] !== cols.q[row] || m!.path[m!.path.length - 1] !== cols.r[row]);

    if (movingToOtherTile && m) {
      const destIdx = idx.indexOf(m.path[m.path.length - 2]!, m.path[m.path.length - 1]!);
      if (destIdx >= 0) inTransitGoals.add(destIdx);
    } else if (
      m &&
      m.status === 'pending' &&
      m.goal.minDist === 0 &&
      m.goal.maxDist === 0 &&
      selfRow >= 0 &&
      cols.owner[row] === selfOwner
    ) {
      if (excludeEntityId <= 0 || id < excludeEntityId) {
        const goalIdx = idx.indexOf(m.goal.q, m.goal.r);
        if (goalIdx >= 0) inTransitGoals.add(goalIdx);
      }
      if (curIdx >= 0 && !(curIdx === selfHere && selfWinsHere)) {
        claimedGoals.add(curIdx);
      }
    } else if (curIdx >= 0) {
      // Deterministic tie-break when two stationary units share `selfHere`: active worker wins, otherwise lowest entityId.
      if (!(curIdx === selfHere && selfWinsHere)) {
        claimedGoals.add(curIdx);
      }
      if (curIdx !== selfHere && selfRow >= 0) {
        if (!areUnitsHostile(selfOwner, cols.owner[row]!)) {
          alliedStationary.add(curIdx);
        } else {
          hostileStationary.add(curIdx);
        }
      }
    }
  }

  return { claimedGoals, inTransitGoals, hostileStationary, alliedStationary };
}

/** True when axial hex `(q, r)` is already claimed or occupied by another mobile unit. */
export function isHexClaimedByOtherUnit(
  state: PlanetState,
  q: number,
  r: number,
  excludeEntityId = -1,
  data?: CompiledDataLike,
  excludeIds?: ReadonlySet<number>,
): boolean {
  const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
  if (tileIdx < 0) return false;
  return collectUnitOccupancy(state, excludeEntityId, excludeIds, data).claimedGoals.has(tileIdx);
}

/** True when axial hex `(q, r)` is claimed OR actively targeted in-transit by another mobile unit. */
export function isHexClaimedOrTargetedByOtherUnit(
  state: PlanetState,
  q: number,
  r: number,
  excludeEntityId = -1,
  data?: CompiledDataLike,
  excludeIds?: ReadonlySet<number>,
): boolean {
  const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
  if (tileIdx < 0) return false;
  const occ = collectUnitOccupancy(state, excludeEntityId, excludeIds, data);
  return occ.claimedGoals.has(tileIdx) || occ.inTransitGoals.has(tileIdx);
}

/** True when another mobile unit is currently stationary (or holds lower-ID arrival priority) on `tileIdx`. */
export function isHexStationaryOccupied(
  state: PlanetState,
  tileIdx: number,
  excludeEntityId = -1,
  data?: CompiledDataLike,
  onlyLowerEntityId = false,
): boolean {
  if (tileIdx < 0) return false;
  const cols = state.entities.cols;
  const idx = hexIndex(state.grid.radius);
  const motions = readStoredMotions(state);
  const selfRow = excludeEntityId > 0 ? rowOf(state.entities, excludeEntityId) : -1;
  const selfWorking = selfRow >= 0 && cols.state[selfRow] === ENTITY_STATE.working;
  for (let row = 0; row < state.entities.count; row++) {
    const id = cols.id[row]!;
    if (id === excludeEntityId || !isActiveMobileRow(state, row)) continue;
    const otherWorking = cols.state[row] === ENTITY_STATE.working;
    if (onlyLowerEntityId && excludeEntityId > 0 && id > excludeEntityId && (!otherWorking || selfWorking)) continue;
    if (idx.indexOf(cols.q[row]!, cols.r[row]!) !== tileIdx) continue;
    const m = motions[String(id)];
    const walkingOut =
      Boolean(m && m.status === 'following' && m.path.length >= 2) &&
      (m!.path[m!.path.length - 2] !== cols.q[row] || m!.path[m!.path.length - 1] !== cols.r[row]);
    if (walkingOut) continue;
    const stillApproachingSameHex = Boolean(
      m &&
        m.status === 'following' &&
        (cols.x[row] !== cols.q[row] || cols.y[row] !== cols.r[row]),
    );
    if (stillApproachingSameHex && excludeEntityId > 0 && id > excludeEntityId) continue;
    return true;
  }
  return false;
}

function resolveSectorGuard(state: PlanetState, entityId: number, fallbackQ: number, fallbackR: number): ((q: number, r: number) => boolean) | null {
  const rawAtlas = state.blobs.atlas as { value?: unknown } | undefined;
  const atlas = (rawAtlas && typeof rawAtlas === 'object' && 'value' in rawAtlas ? rawAtlas.value : rawAtlas) as
    | { sectorRadius?: number }
    | undefined;
  const sr = typeof atlas?.sectorRadius === 'number' && atlas.sectorRadius > 0 ? atlas.sectorRadius : 0;
  if (sr <= 0) return null;
  const selfRow = entityId > 0 ? rowOf(state.entities, entityId) : -1;
  const sq = selfRow >= 0 ? state.entities.cols.q[selfRow]! : fallbackQ;
  const sr0 = selfRow >= 0 ? state.entities.cols.r[selfRow]! : fallbackR;
  const allowedSector = globalTileToSector(sq, sr0, sr).sectorId;
  return (q, r) => globalTileToSector(q, r, sr).sectorId === allowedSector;
}

/**
 * Finds the nearest passable, non-occupied standable hex around `(originQ, originR)` for `entityId`.
 * Returns `null` if every hex within `maxRing` is blocked or claimed.
 */
export function findNearestFreeStandTile(
  state: PlanetState,
  originQ: number,
  originR: number,
  profile: PathProfileId | undefined,
  excludeEntityId = -1,
  data?: CompiledDataLike,
  maxRing = 6,
  extraTaken?: ReadonlySet<number>,
): { q: number; r: number } | null {
  const idx = hexIndex(state.grid.radius);
  const selfRow = excludeEntityId > 0 ? rowOf(state.entities, excludeEntityId) : -1;
  const fromIdx = selfRow >= 0 ? idx.indexOf(state.entities.cols.q[selfRow]!, state.entities.cols.r[selfRow]!) : -1;
  const blockers = pathBlockersFor(state, profile ?? 'ground', fromIdx, data, excludeEntityId);
  const inSameSector = resolveSectorGuard(state, excludeEntityId, originQ, originR);

  for (let ring = 0; ring <= maxRing; ring++) {
    for (const [q, r] of ringCoords(originQ, originR, ring)) {
      if (!inHex(q, r, state.grid.radius)) continue;
      if (inSameSector && !inSameSector(q, r)) continue;
      const ti = idx.indexOf(q, r);
      if (ti < 0 || extraTaken?.has(ti)) continue;
      if ((profile ?? 'ground') !== 'hover' && !isGroundPassable(state.grid, ti, data)) continue;
      if (blockers?.bandGoalBlocked ? blockers.bandGoalBlocked(ti) : blockers?.goalBlocked(ti)) continue;
      return { q, r };
    }
  }
  return null;
}

defineUnitOccupancy((state, entityId, data) => collectUnitOccupancy(state, entityId, undefined, data));
