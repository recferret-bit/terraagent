import type { CompiledDataLike } from '../kernel/config';
import { setBlob, type Blob, type PlanetState } from '../kernel/state';
import { pathBlockedFor, type PathProfileId } from './pathProfiles';
import {
  continueAStarSearch,
  createAStarSearch,
  type AStarSearchState,
  type AxialCoord,
  type HexPathResult,
  type PathGoalBand,
} from './pathSearch';

/**
 * The pathfinding service's work queue (`SIM-T-02`): a FIFO of path requests in `state.blobs.pathQueue`, solved with a
 * budget of 2 000 A* node expansions per planet per step. A long search pauses at the budget and resumes next step.
 *
 * Requests are plain data, so the queue survives snapshot, restore and the prediction clone. The live search objects
 * are a cache next to the state; when the cache misses (a restored or cloned state), the search is rebuilt by
 * replaying the `expansionsUsed` it had already spent, which reaches the identical search state (see
 * `continueAStarSearch`). The planet therefore resolves the same path on the same tick either way. Known limit: if a
 * tile's passability changes while a search is paused, a resumed search keeps what it already explored and a replayed
 * one sees the new tile; the follower re-plans when its next waypoint turns out to be blocked.
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
}

export interface PathQueueEntry {
  id: string | number;
  entityId?: number;
  from: AxialCoord;
  to: AxialCoord;
  radius?: number;
  profile?: PathProfileId;
  band?: PathGoalBand;
  enqueuedAtTick: number;
  expansionsUsed: number;
}

export interface PathQueueResult extends HexPathResult {
  id: string | number;
  entityId?: number;
  from: AxialCoord;
  to: AxialCoord;
  resolvedAtTick: number;
}

export interface PathStats {
  lastStepExpansions: number;
  totalResolved: number;
  queueLength: number;
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
  return {
    lastStepExpansions: typeof val?.lastStepExpansions === 'number' ? val.lastStepExpansions : 0,
    totalResolved: typeof val?.totalResolved === 'number' ? val.totalResolved : 0,
    queueLength: typeof val?.queueLength === 'number' ? val.queueLength : getPathQueue(state).length,
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
  const seq = prevStats.totalResolved + queue.length + 1;
  const entry: PathQueueEntry = {
    id: req.id ?? `path_${seq}`,
    ...(req.entityId !== undefined ? { entityId: req.entityId } : {}),
    from: { q: req.from.q, r: req.from.r },
    to: { q: req.to.q, r: req.to.r },
    ...(req.radius !== undefined ? { radius: req.radius } : {}),
    ...(req.profile !== undefined ? { profile: req.profile } : {}),
    ...(req.band !== undefined ? { band: { minDist: req.band.minDist, maxDist: req.band.maxDist } } : {}),
    enqueuedAtTick: state.meta.tick,
    expansionsUsed: 0,
  };
  queue.push(entry);
  writeQueue(state, queue, { ...prevStats, queueLength: queue.length }, stamp);
  return entry;
}

/** Drops a pending request (e.g. its unit got a new order). Returns `true` if it was queued. */
export function cancelPathRequest(state: PlanetState, id: string | number, tick: number): boolean {
  const queue = getPathQueue(state);
  const at = queue.findIndex((e) => e.id === id);
  if (at < 0) return false;
  cacheOf(state).delete(id);
  const next = queue.slice(0, at).concat(queue.slice(at + 1));
  writeQueue(state, next, { ...getPathStats(state), queueLength: next.length }, tick);
  return true;
}

function searchFor(state: PlanetState, entry: PathQueueEntry, data?: CompiledDataLike): AStarSearchState {
  const cache = cacheOf(state);
  let search = cache.get(entry.id);
  if (!search) {
    search = createAStarSearch(state, entry.from, entry.to, {
      radius: entry.radius,
      data,
      blocked: pathBlockedFor(state, entry.profile),
      band: entry.band,
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
      setBlob(state, 'pathStats', { lastStepExpansions: 0, totalResolved: prevStats.totalResolved, queueLength: 0 }, stamp);
    }
    return { expansionsUsed: 0, resolvedCount: 0, pendingCount: 0, resolved: [] };
  }

  let expansionsUsed = 0;
  const resolved: PathQueueResult[] = [];

  while (pending.length > 0 && expansionsUsed < budget) {
    const entry = pending[0];
    const search = searchFor(state, entry, data);
    const stepRes = continueAStarSearch(search, budget - expansionsUsed);
    expansionsUsed += stepRes.used;
    entry.expansionsUsed = search.expansions;

    if (!stepRes.done || !search.result) break;
    pending.shift();
    cacheOf(state).delete(entry.id);
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
    { lastStepExpansions: expansionsUsed, totalResolved: prevStats.totalResolved + resolved.length, queueLength: pending.length },
    stamp,
  );
  return { expansionsUsed, resolvedCount: resolved.length, pendingCount: pending.length, resolved };
}
