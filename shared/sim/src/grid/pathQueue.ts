import type { CompiledDataLike } from '../kernel/config';
import { setBlob, type Blob, type PlanetState } from '../kernel/state';
import { dropFieldSearch, stepFieldSearch, type FieldRequestData } from './flowField';
import { hexIndex } from './hex';
import { rowOf } from '../ecs/store';
import { isGroundPassable } from './tileModel';
import {
  pathBlockersFor,
  resolveRegisteredUnitOccupancy,
  type PathProfileId,
  type UnitHexOccupancy,
} from './pathProfiles';
import {
  continueAStarSearch,
  createAStarSearch,
  type AStarSearchState,
  type AxialCoord,
  type HexPathResult,
  type PathGoalBand,
} from './pathSearch';

export type { FieldRequestData };

/**
 * The pathfinding service's work queue (`SIM-T-02`): a FIFO of path requests in `state.blobs.pathQueue`, solved with a
 * budget of 2 000 A* node expansions per planet per step. A long search pauses at the budget and resumes next step.
 *
 * Requests are plain data, so the queue survives snapshot, restore and the prediction clone. The live search objects
 * are a cache next to the state; when the cache misses (a restored or cloned state), the search is rebuilt by
 * replaying the `expansionsUsed` it had already spent, which reaches the identical search state (see
 * `continueAStarSearch`). The planet therefore resolves the same path on the same tick either way. When the ground
 * changes while a search is paused (`meta.pathEpoch`), or the step-cost data changes (a dev `tune`: the compiled
 * data hash moves), the search restarts from scratch on every host alike, so a resumed and a replayed search never see
 * different ground or different costs.
 */

/** Maximum A* node expansions allowed per planet per simulation step (`SIM-T-02`, 200 ms tick). */
export const PATH_EXPANSION_BUDGET_PER_STEP = 2000;

export interface PathRequestInput {
  id?: string | number;
  entityId?: number;
  from: AxialCoord;
  to: AxialCoord;
  radius?: number;
  /** Obstacle rule (default `none`). */
  profile?: PathProfileId;
  /** Stop anywhere in this distance band around `to` (default: exactly `to`). */
  band?: PathGoalBand;
  /** Shared reverse Dijkstra. `from` / `to` are the anchor; `targets` are tiles the field must reach. */
  field?: FieldRequestData;
}

export interface PathQueueEntry {
  id: string | number;
  entityId?: number;
  from: AxialCoord;
  to: AxialCoord;
  radius?: number;
  profile?: PathProfileId;
  band?: PathGoalBand;
  field?: FieldRequestData;
  enqueuedAtTick: number;
  expansionsUsed: number;
  /** `meta.pathEpoch` the search has explored under; a change restarts it (identically on every host). */
  epoch?: number;
  /** Hash of the compiled data the search has explored under; a change (dev `tune`) restarts it like `epoch`. */
  dataHash?: string;
  /** Plain-data unit occupancy snapshot persisted only when a search pauses mid-flight across ticks (replay parity). */
  unitOccSnap?: { goals: number[]; transit?: number[]; cross: number[]; avoid: number[] };
}

export interface PathQueueResult extends HexPathResult {
  id: string | number;
  entityId?: number;
  from: AxialCoord;
  to: AxialCoord;
  resolvedAtTick: number;
  /** Set when a shared field request finishes. `parents[i]` is the step back toward a seed, or `-1`. */
  fieldParents?: number[];
  fieldSeeds?: number[];
}

export interface PathStats {
  lastStepExpansions: number;
  totalResolved: number;
  queueLength: number;
  /** Last default request id handed out (`path_<n>`); only grows, so a cancel never makes two requests share an id. */
  lastSeq: number;
}

export interface StepPathQueueResult {
  expansionsUsed: number;
  resolvedCount: number;
  pendingCount: number;
  resolved: PathQueueResult[];
}

/** Live searches per grid object (a cloned or restored state has a new grid, so it starts with an empty cache). */
const searchCache = new WeakMap<object, Map<string | number, AStarSearchState>>();

function cacheOf(state: PlanetState): Map<string | number, AStarSearchState> {
  let m = searchCache.get(state.grid);
  if (!m) searchCache.set(state.grid, (m = new Map()));
  return m;
}

/** Returns the current FIFO `pathQueue` entries stored in `state.blobs.pathQueue`. */
export function getPathQueue(state: PlanetState): PathQueueEntry[] {
  const raw = state.blobs.pathQueue as (Blob & { value?: unknown }) | PathQueueEntry[] | undefined;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw.value) ? (raw.value as PathQueueEntry[]) : [];
}

/** Returns the latest pathfinding telemetry stored in `state.blobs.pathStats`. */
export function getPathStats(state: PlanetState): PathStats {
  const raw = state.blobs.pathStats as (Blob & Partial<PathStats>) | undefined;
  const val = (raw?.value as Partial<PathStats> | undefined) ?? raw;
  const totalResolved = typeof val?.totalResolved === 'number' ? val.totalResolved : 0;
  const queueLength = typeof val?.queueLength === 'number' ? val.queueLength : getPathQueue(state).length;
  return {
    lastStepExpansions: typeof val?.lastStepExpansions === 'number' ? val.lastStepExpansions : 0,
    totalResolved,
    queueLength,
    lastSeq: typeof val?.lastSeq === 'number' ? val.lastSeq : totalResolved + queueLength,
  };
}

function writeQueue(state: PlanetState, queue: PathQueueEntry[], stats: PathStats, stamp: number): void {
  setBlob(state, 'pathQueue', queue, stamp);
  setBlob(state, 'pathStats', stats, stamp);
}

/** Enqueues a pathfinding request at the tail of the planet's FIFO `pathQueue` (`state.blobs.pathQueue`). */
export function enqueuePathRequest(state: PlanetState, req: PathRequestInput, tick?: number): PathQueueEntry {
  const stamp = tick ?? Math.max(1, state.meta.tick);
  const queue = getPathQueue(state).slice();
  const prevStats = getPathStats(state);
  const seq = req.id === undefined ? prevStats.lastSeq + 1 : prevStats.lastSeq;
  const entry: PathQueueEntry = {
    id: req.id ?? `path_${seq}`,
    ...(req.entityId !== undefined ? { entityId: req.entityId } : {}),
    from: { q: req.from.q, r: req.from.r },
    to: { q: req.to.q, r: req.to.r },
    ...(req.radius !== undefined ? { radius: req.radius } : {}),
    ...(req.profile !== undefined ? { profile: req.profile } : {}),
    ...(req.band !== undefined ? { band: { minDist: req.band.minDist, maxDist: req.band.maxDist } } : {}),
    ...(req.field ? { field: { anchorQ: req.field.anchorQ, anchorR: req.field.anchorR, targets: req.field.targets.map((t) => ({ q: t.q, r: t.r })) } } : {}),
    enqueuedAtTick: state.meta.tick,
    expansionsUsed: 0,
    epoch: state.meta.pathEpoch ?? 0,
  };
  queue.push(entry);
  writeQueue(state, queue, { ...prevStats, queueLength: queue.length, lastSeq: seq }, stamp);
  return entry;
}

/** Drops a pending request (e.g. its unit got a new order). Returns `true` if it was queued. */
export function cancelPathRequest(state: PlanetState, id: string | number, tick: number): boolean {
  const queue = getPathQueue(state);
  const at = queue.findIndex((e) => e.id === id);
  if (at < 0) return false;
  cacheOf(state).delete(id);
  unitOccCacheOf(state).delete(id);
  dropFieldSearch(state, id);
  const next = queue.slice(0, at).concat(queue.slice(at + 1));
  writeQueue(state, next, { ...getPathStats(state), queueLength: next.length }, tick);
  return true;
}

const liveUnitOccByReq = new WeakMap<object, Map<string | number, UnitHexOccupancy | null>>();

function unitOccCacheOf(state: PlanetState): Map<string | number, UnitHexOccupancy | null> {
  let m = liveUnitOccByReq.get(state.grid);
  if (!m) liveUnitOccByReq.set(state.grid, (m = new Map()));
  return m;
}

function hydrateUnitOcc(snap: PathQueueEntry['unitOccSnap']): UnitHexOccupancy | null {
  if (!snap) return null;
  return {
    claimedGoals: new Set(snap.goals),
    inTransitGoals: new Set(snap.transit ?? []),
    hostileStationary: new Set(snap.cross),
    alliedStationary: new Set(snap.avoid),
  };
}

function serializeUnitOcc(occ: UnitHexOccupancy | null): PathQueueEntry['unitOccSnap'] | undefined {
  if (!occ) return undefined;
  return {
    goals: [...occ.claimedGoals].sort((a, b) => a - b),
    ...(occ.inTransitGoals.size > 0 ? { transit: [...occ.inTransitGoals].sort((a, b) => a - b) } : {}),
    cross: [...occ.hostileStationary].sort((a, b) => a - b),
    avoid: [...occ.alliedStationary].sort((a, b) => a - b),
  };
}

function widenUnitCrowdedBand(
  state: PlanetState,
  entry: PathQueueEntry,
  unitOcc: UnitHexOccupancy | null,
  effectiveGoalBlocked: ((ti: number) => boolean) | undefined,
  data?: CompiledDataLike,
): { minDist: number; maxDist: number } | undefined {
  const band = entry.band;
  const entRow = entry.entityId !== undefined && entry.entityId > 0 ? rowOf(state.entities, entry.entityId) : -1;
  const isColonyWorker = entry.profile === 'worker' && (entRow < 0 || state.entities.cols.owner[entRow]! >= 0);
  if (!band || band.maxDist <= 0 || !unitOcc || isColonyWorker || entry.profile === 'hover') {
    return band;
  }
  const idx = hexIndex(entry.radius ?? state.grid.radius);
  const fromIdx = idx.indexOf(entry.from.q, entry.from.r);
  const terrainOnly = pathBlockersFor(state, entry.profile, fromIdx, data, entry.entityId, null);
  const ringHas = (minD: number, maxD: number, pred: ((ti: number) => boolean) | undefined): boolean => {
    for (let dr = -maxD; dr <= maxD; dr++) {
      for (let dq = Math.max(-maxD, -dr - maxD); dq <= Math.min(maxD, -dr + maxD); dq++) {
        const d = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
        if (d < minD || d > maxD) continue;
        const ti = idx.indexOf(entry.to.q + dq, entry.to.r + dr);
        if (ti < 0 || !isGroundPassable(state.grid, ti, data)) continue;
        if (!(pred?.(ti) ?? false)) return true;
      }
    }
    return false;
  };
  if (!ringHas(band.minDist, band.maxDist, terrainOnly?.goalBlocked)) return band;
  if (ringHas(band.minDist, band.maxDist, effectiveGoalBlocked)) return band;
  for (let extra = 1; extra <= 3; extra++) {
    const cand = band.maxDist + extra;
    if (ringHas(cand, cand, effectiveGoalBlocked)) return { minDist: band.minDist, maxDist: cand };
  }
  return band;
}

function searchFor(
  state: PlanetState,
  entry: PathQueueEntry,
  data?: CompiledDataLike,
  batchTransit?: ReadonlySet<number>,
): AStarSearchState {
  const cache = cacheOf(state);
  let search = cache.get(entry.id);
  if (!search) {
    const occCache = unitOccCacheOf(state);
    let unitOcc =
      entry.unitOccSnap !== undefined
        ? hydrateUnitOcc(entry.unitOccSnap)
        : entry.entityId !== undefined && entry.entityId > 0
          ? resolveRegisteredUnitOccupancy(state, entry.entityId, data)
          : null;
    if (unitOcc && batchTransit && batchTransit.size > 0) {
      const merged = new Set(unitOcc.inTransitGoals);
      for (const ti of batchTransit) merged.add(ti);
      unitOcc = { ...unitOcc, inTransitGoals: merged };
    }
    occCache.set(entry.id, unitOcc);
    const blockers = pathBlockersFor(
      state,
      entry.profile,
      hexIndex(entry.radius ?? state.grid.radius).indexOf(entry.from.q, entry.from.r),
      data,
      entry.entityId,
      unitOcc,
    );
    const effectiveGoalBlocked = entry.band
      ? (blockers?.bandGoalBlocked ?? blockers?.goalBlocked)
      : blockers?.goalBlocked;
    const effectiveBand = widenUnitCrowdedBand(state, entry, unitOcc, effectiveGoalBlocked, data);
    search = createAStarSearch(state, entry.from, entry.to, {
      radius: entry.radius,
      data,
      ...(blockers
        ? {
            blocked: blockers.blocked,
            goalBlocked: effectiveGoalBlocked,
            ...(blockers.avoidPenaltyBp ? { avoidPenaltyBp: blockers.avoidPenaltyBp } : {}),
          }
        : {}),
      band: effectiveBand,
    });
    // Cache miss on a half-done search (restored / cloned state): replay the expansions already paid for.
    if (entry.expansionsUsed > 0) continueAStarSearch(search, entry.expansionsUsed, true);
    cache.set(entry.id, search);
  }
  return search;
}

/**
 * Processes queued path requests in FIFO order within `budgetExpansions` (default `2000`, `SIM-T-02`).
 * Guarantees `expansionsUsed <= budgetExpansions` in every step and updates `state.blobs.pathStats`.
 * A budget below `MAX_POCKET_NODES` (64) never lets a search past 32 expansions: the sealed-pocket check needs 64
 * nodes of budget left in one call and is deferred otherwise (WE-28). The game always passes 2 000.
 */
export function stepPathQueue(
  state: PlanetState,
  budgetExpansions: number = PATH_EXPANSION_BUDGET_PER_STEP,
  data?: CompiledDataLike,
  tick?: number,
): StepPathQueueResult {
  const stamp = tick ?? Math.max(1, state.meta.tick);
  const budget = Math.max(0, Math.floor(budgetExpansions));
  const pending = getPathQueue(state).map((e) => ({ ...e }));
  const prevStats = getPathStats(state);

  if (pending.length === 0) {
    if (prevStats.lastStepExpansions !== 0 || prevStats.queueLength !== 0) {
      setBlob(state, 'pathStats', { ...prevStats, lastStepExpansions: 0, queueLength: 0 }, stamp);
    }
    return { expansionsUsed: 0, resolvedCount: 0, pendingCount: 0, resolved: [] };
  }

  let expansionsUsed = 0;
  const resolved: PathQueueResult[] = [];
  const batchTransit = new Set<number>();
  const gridIdx = hexIndex(state.grid.radius);

  while (pending.length > 0 && expansionsUsed < budget) {
    const entry = pending[0];
    const epoch = state.meta.pathEpoch ?? 0;
    const dataHash = data?.hash;
    const costsChanged = entry.expansionsUsed > 0 && entry.dataHash !== dataHash;
    if ((entry.epoch ?? 0) !== epoch || costsChanged) {
      // the ground or the step costs changed while this search was paused: start over (deterministic on every host)
      cacheOf(state).delete(entry.id);
      unitOccCacheOf(state).delete(entry.id);
      delete entry.unitOccSnap;
      dropFieldSearch(state, entry.id);
      entry.expansionsUsed = 0;
      entry.epoch = epoch;
    }
    if (dataHash === undefined) delete entry.dataHash;
    else entry.dataHash = dataHash;
    if (entry.field) {
      const stepped = stepFieldSearch(state, entry, budget - expansionsUsed, data);
      expansionsUsed += stepped.used;
      entry.expansionsUsed = stepped.expansions;
      if (!stepped.done) break;
      pending.shift();
      resolved.push({
        id: entry.id,
        ...(entry.entityId !== undefined ? { entityId: entry.entityId } : {}),
        from: { q: entry.from.q, r: entry.from.r },
        to: { q: entry.to.q, r: entry.to.r },
        ok: (stepped.seeds?.length ?? 0) > 0,
        path: [],
        expansions: stepped.expansions,
        totalCostBp: 0,
        resolvedAtTick: stamp,
        ...(stepped.parents ? { fieldParents: stepped.parents, fieldSeeds: stepped.seeds } : {}),
      });
      continue;
    }
    const search = searchFor(state, entry, data, batchTransit);
    const stepRes = continueAStarSearch(search, budget - expansionsUsed);
    expansionsUsed += stepRes.used;
    entry.expansionsUsed = search.expansions;

    if (!stepRes.done || !search.result) {
      if (entry.unitOccSnap === undefined && entry.entityId !== undefined) {
        const snap = serializeUnitOcc(unitOccCacheOf(state).get(entry.id) ?? null);
        if (snap) entry.unitOccSnap = snap;
      }
      break;
    }
    pending.shift();
    cacheOf(state).delete(entry.id);
    unitOccCacheOf(state).delete(entry.id);
    if (entry.entityId !== undefined && search.result.ok && search.result.path.length > 0) {
      const endPt = search.result.path[search.result.path.length - 1]!;
      const endIdx = gridIdx.indexOf(endPt.q, endPt.r);
      if (endIdx >= 0) batchTransit.add(endIdx);
    }
    resolved.push({
      id: entry.id,
      ...(entry.entityId !== undefined ? { entityId: entry.entityId } : {}),
      from: { q: entry.from.q, r: entry.from.r },
      to: { q: entry.to.q, r: entry.to.r },
      ok: search.result.ok,
      path: search.result.path,
      expansions: search.result.expansions,
      totalCostBp: search.result.totalCostBp,
      resolvedAtTick: stamp,
    });
  }

  writeQueue(
    state,
    pending,
    { ...prevStats, lastStepExpansions: expansionsUsed, totalResolved: prevStats.totalResolved + resolved.length, queueLength: pending.length },
    stamp,
  );
  return { expansionsUsed, resolvedCount: resolved.length, pendingCount: pending.length, resolved };
}
