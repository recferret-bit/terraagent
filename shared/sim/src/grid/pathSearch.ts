import type { CompiledDataLike } from '../kernel/config';
import type { Grid, PlanetState } from '../kernel/state';
import { HEX_DIRS, hexDistance, hexIndex, type HexIndex } from './hex';
import { groundMoveMultiplierBp, isGroundPassable, type GridLike, type TileLayersLike } from './tileModel';

/**
 * The resumable A* state machine behind `findHexPath` and the path queue (`SIM-T-02`). Internal to `grid/`: callers
 * use `findHexPath` (one-shot) or the movement orchestrator (budgeted, via `pathQueue.ts`).
 *
 * Every step of a search is a pure function of (grid, request, expansions done so far). That is what lets the path
 * queue rebuild a half-finished search after a snapshot restore by replaying it, so a restored planet resolves the
 * same path on the same tick as the original.
 */

/** Admissible heuristic weight per hex distance (`900 <= 909`, the minimum step cost on Living ground). */
export const HEURISTIC_WEIGHT_BP = 900;

const NEAR_HEURISTIC_DIST = 6;
const FAR_HEURISTIC_WEIGHT_BP = 1450;
const POCKET_CHECK_TRIGGER = 32;
/** Nodes the sealed-goal-pocket check may visit; a search defers the check until this much budget is left. */
export const MAX_POCKET_NODES = 64;

export interface AxialCoord {
  q: number;
  r: number;
}

/** A goal band: any tile whose hex distance to `to` lies in `[minDist, maxDist]` ends the search. */
export interface PathGoalBand {
  minDist: number;
  maxDist: number;
}

export interface FindHexPathOptions {
  radius?: number;
  maxExpansions?: number;
  data?: CompiledDataLike;
  /** Extra impassable tiles (e.g. obstacles a unit cannot cross). The start tile is exempt; a blocked goal fails. */
  blocked?: (tileIdx: number) => boolean;
  /**
   * Stop on the first tile within this distance band of `to` instead of on `to` itself (e.g. "stand 1–2 tiles from
   * the tile you terraform"). `to` may then be impassable. Omitted = exact goal.
   */
  band?: PathGoalBand;
  /** Tiles a band goal may not end on although they can be crossed (the footprint the unit is leaving). Default `blocked`. */
  goalBlocked?: (tileIdx: number) => boolean;
}

export interface HexPathResult {
  ok: boolean;
  /** Waypoints from `from` (inclusive at index `0`) to the goal tile (inclusive at `path.length - 1`), or `[]` when `ok` is `false`. */
  path: AxialCoord[];
  expansions: number;
  totalCostBp: number;
}

export interface AStarSearchState {
  readonly grid: GridLike;
  readonly idx: HexIndex;
  readonly data?: CompiledDataLike;
  readonly blocked?: (tileIdx: number) => boolean;
  readonly goalBlocked?: (tileIdx: number) => boolean;
  readonly from: AxialCoord;
  readonly to: AxialCoord;
  readonly band: PathGoalBand | null;
  readonly startIdx: number;
  readonly goalIdx: number;
  readonly gScore: Float64Array;
  readonly fScore: Float64Array;
  readonly hScore: Int32Array;
  readonly cameFrom: Int32Array;
  readonly closed: Uint8Array;
  readonly heap: Int32Array;
  readonly heapPos: Int32Array;
  heapSize: number;
  expansions: number;
  pocketChecked: boolean;
  done: boolean;
  result: HexPathResult | null;
}

function heuristicCostBp(q: number, r: number, to: AxialCoord, slack: number): number {
  const d = Math.max(0, hexDistance(q, r, to.q, to.r) - slack);
  if (d <= NEAR_HEURISTIC_DIST) return d * HEURISTIC_WEIGHT_BP;
  return NEAR_HEURISTIC_DIST * HEURISTIC_WEIGHT_BP + (d - NEAR_HEURISTIC_DIST) * FAR_HEURISTIC_WEIGHT_BP;
}

function resolveGridRadius(grid: GridLike, explicitRadius?: number): number {
  if (typeof explicitRadius === 'number' && Number.isInteger(explicitRadius) && explicitRadius >= 0) {
    return explicitRadius;
  }
  if ('grid' in grid && typeof (grid as PlanetState).grid?.radius === 'number') {
    return (grid as PlanetState).grid.radius;
  }
  if ('radius' in grid && typeof (grid as Grid).radius === 'number') {
    return (grid as Grid).radius;
  }
  const layers = grid as TileLayersLike;
  const count = typeof layers.count === 'number' ? layers.count : layers.terrain.length;
  for (let r = 0; 3 * r * (r + 1) + 1 <= count; r++) {
    if (3 * r * (r + 1) + 1 === count) return r;
  }
  return 0;
}

/**
 * Step cost to enter `tileIdx`: `Math.round(10000 * 1000 / multBp)` (`Flat = 1000`, `Living = 909`,
 * `Slope = 1429`, `Forest = 1667`, `Rock/Hole/Shallow = 2000`), or `0` if impassable.
 */
export function tileStepCostBp(grid: GridLike, tileIdx: number, data?: CompiledDataLike): number {
  if (!isGroundPassable(grid, tileIdx, data)) return 0;
  const multBp = groundMoveMultiplierBp(grid, tileIdx, data);
  if (multBp <= 0) return 0;
  return Math.round((10000 * 1000) / multBp);
}

function isBetterNode(s: AStarSearchState, a: number, b: number): boolean {
  if (s.fScore[a] !== s.fScore[b]) return s.fScore[a] < s.fScore[b];
  if (s.hScore[a] !== s.hScore[b]) return s.hScore[a] < s.hScore[b];
  return a < b;
}

function heapSwap(s: AStarSearchState, i: number, j: number): void {
  const ai = s.heap[i];
  const aj = s.heap[j];
  s.heap[i] = aj;
  s.heap[j] = ai;
  s.heapPos[aj] = i;
  s.heapPos[ai] = j;
}

function heapSiftUp(s: AStarSearchState, pos: number): void {
  let cur = pos;
  while (cur > 0) {
    const parent = (cur - 1) >> 1;
    if (!isBetterNode(s, s.heap[cur], s.heap[parent])) break;
    heapSwap(s, cur, parent);
    cur = parent;
  }
}

function heapSiftDown(s: AStarSearchState, pos: number): void {
  let cur = pos;
  const n = s.heapSize;
  while (true) {
    const left = (cur << 1) + 1;
    if (left >= n) break;
    const right = left + 1;
    let best = cur;
    if (isBetterNode(s, s.heap[left], s.heap[best])) best = left;
    if (right < n && isBetterNode(s, s.heap[right], s.heap[best])) best = right;
    if (best === cur) break;
    heapSwap(s, cur, best);
    cur = best;
  }
}

function heapPushOrDecrease(s: AStarSearchState, tileIdx: number): void {
  const existing = s.heapPos[tileIdx];
  if (existing >= 0) {
    heapSiftUp(s, existing);
    return;
  }
  const pos = s.heapSize++;
  s.heap[pos] = tileIdx;
  s.heapPos[tileIdx] = pos;
  heapSiftUp(s, pos);
}

function heapPop(s: AStarSearchState): number {
  const top = s.heap[0];
  s.heapPos[top] = -1;
  const last = --s.heapSize;
  if (last > 0) {
    const moved = s.heap[last];
    s.heap[0] = moved;
    s.heapPos[moved] = 0;
    heapSiftDown(s, 0);
  }
  return top;
}

function reconstructPath(s: AStarSearchState, endIdx: number): AxialCoord[] {
  const rev: AxialCoord[] = [];
  for (let cur = endIdx; cur >= 0; cur = s.cameFrom[cur]) {
    rev.push({ q: s.idx.q[cur], r: s.idx.r[cur] });
    if (cur === s.startIdx) break;
  }
  rev.reverse();
  return rev;
}

function isGoalTile(s: AStarSearchState, tileIdx: number): boolean {
  if (!s.band) return tileIdx === s.goalIdx;
  if (s.goalBlocked?.(tileIdx) ?? false) return false; // never "arrive" on a tile the unit may not stand on
  const d = hexDistance(s.idx.q[tileIdx], s.idx.r[tileIdx], s.to.q, s.to.r);
  return d >= s.band.minDist && d <= s.band.maxDist;
}

function checkSealedGoalPocket(s: AStarSearchState): number {
  const visited = new Set<number>([s.goalIdx]);
  const queue: number[] = [s.goalIdx];
  let head = 0;
  while (head < queue.length && visited.size <= MAX_POCKET_NODES) {
    const cur = queue[head++];
    if (cur === s.startIdx || s.closed[cur] === 1 || s.heapPos[cur] >= 0) return 0;
    const cq = s.idx.q[cur];
    const cr = s.idx.r[cur];
    for (let d = 0; d < HEX_DIRS.length; d++) {
      const nIdx = s.idx.indexOf(cq + HEX_DIRS[d][0], cr + HEX_DIRS[d][1]);
      if (nIdx < 0 || visited.has(nIdx)) continue;
      if (nIdx === s.startIdx || s.closed[nIdx] === 1 || s.heapPos[nIdx] >= 0) return 0;
      if (!isGroundPassable(s.grid, nIdx, s.data) || s.blocked?.(nIdx)) continue;
      visited.add(nIdx);
      if (visited.size > MAX_POCKET_NODES) return 0;
      queue.push(nIdx);
    }
  }
  return head >= queue.length ? visited.size : 0;
}

function finish(s: AStarSearchState, result: HexPathResult): AStarSearchState {
  s.done = true;
  s.result = result;
  return s;
}

/** A fresh search from `from` to `to` (or to the goal band around `to`). Resolves trivial cases immediately. */
export function createAStarSearch(grid: GridLike, from: AxialCoord, to: AxialCoord, opts?: FindHexPathOptions): AStarSearchState {
  const idx = hexIndex(resolveGridRadius(grid, opts?.radius));
  const valid = Number.isInteger(from.q) && Number.isInteger(from.r) && Number.isInteger(to.q) && Number.isInteger(to.r);
  const startIdx = valid ? idx.indexOf(from.q, from.r) : -1;
  const goalIdx = valid ? idx.indexOf(to.q, to.r) : -1;
  const band = opts?.band && opts.band.maxDist > 0 ? { minDist: Math.max(0, opts.band.minDist), maxDist: opts.band.maxDist } : null;

  const s: AStarSearchState = {
    grid,
    idx,
    data: opts?.data,
    blocked: opts?.blocked,
    goalBlocked: opts?.goalBlocked ?? opts?.blocked,
    from: { q: from.q, r: from.r },
    to: { q: to.q, r: to.r },
    band,
    startIdx,
    goalIdx,
    gScore: new Float64Array(idx.count),
    fScore: new Float64Array(idx.count),
    hScore: new Int32Array(idx.count),
    cameFrom: new Int32Array(idx.count),
    closed: new Uint8Array(idx.count),
    heap: new Int32Array(idx.count),
    heapPos: new Int32Array(idx.count),
    heapSize: 0,
    expansions: 0,
    // A band goal has many tiles, so the single-goal pocket shortcut does not apply.
    pocketChecked: band !== null,
    done: false,
    result: null,
  };

  const fail: HexPathResult = { ok: false, path: [], expansions: 0, totalCostBp: 0 };
  if (startIdx < 0 || goalIdx < 0 || !isGroundPassable(grid, startIdx, opts?.data)) return finish(s, fail);
  if (!band && (!isGroundPassable(grid, goalIdx, opts?.data) || (opts?.blocked?.(goalIdx) ?? false))) return finish(s, fail);
  if (isGoalTile(s, startIdx)) {
    return finish(s, { ok: true, path: [{ q: from.q, r: from.r }], expansions: 0, totalCostBp: 0 });
  }

  s.gScore.fill(Infinity);
  s.fScore.fill(Infinity);
  s.cameFrom.fill(-1);
  s.heapPos.fill(-1);

  const h0 = heuristicCostBp(from.q, from.r, to, band?.maxDist ?? 0);
  s.gScore[startIdx] = 0;
  s.hScore[startIdx] = h0;
  s.fScore[startIdx] = h0;
  heapPushOrDecrease(s, startIdx);
  return s;
}

function expandNeighbors(s: AStarSearchState, currIdx: number): void {
  const cq = s.idx.q[currIdx];
  const cr = s.idx.r[currIdx];
  const baseG = s.gScore[currIdx];
  const slack = s.band?.maxDist ?? 0;
  for (let d = 0; d < HEX_DIRS.length; d++) {
    const nq = cq + HEX_DIRS[d][0];
    const nr = cr + HEX_DIRS[d][1];
    const nIdx = s.idx.indexOf(nq, nr);
    if (nIdx < 0 || s.closed[nIdx] === 1) continue;
    const stepCost = tileStepCostBp(s.grid, nIdx, s.data);
    if (stepCost <= 0 || s.blocked?.(nIdx)) continue;
    const tentativeG = baseG + stepCost;
    if (tentativeG < s.gScore[nIdx]) {
      s.cameFrom[nIdx] = currIdx;
      s.gScore[nIdx] = tentativeG;
      const h = heuristicCostBp(nq, nr, s.to, slack);
      s.hScore[nIdx] = h;
      s.fScore[nIdx] = tentativeG + h;
      heapPushOrDecrease(s, nIdx);
    }
  }
}

/**
 * Advances `s` by at most `stepBudget` node expansions. The sequence of operations does not depend on how the work is
 * split across calls: the one-off sealed-pocket check runs right after expansion 32 and is deferred (not skipped) when
 * less than `MAX_POCKET_NODES` budget is left. So N calls with budgets summing to B reach the same state as one call
 * with budget B. `replay` rebuilds a search to a known expansion count (budget = that count) without deferring.
 */
export function continueAStarSearch(s: AStarSearchState, stepBudget: number, replay = false): { used: number; done: boolean } {
  if (s.done || stepBudget <= 0) return { used: 0, done: s.done };
  let used = 0;

  while (s.heapSize > 0 && used < stepBudget) {
    if (!s.pocketChecked && s.expansions >= POCKET_CHECK_TRIGGER) {
      if (!replay && stepBudget - used < MAX_POCKET_NODES) return { used, done: false };
      s.pocketChecked = true;
      const sealedCount = checkSealedGoalPocket(s);
      if (sealedCount > 0) {
        used += sealedCount;
        s.expansions += sealedCount;
        finish(s, { ok: false, path: [], expansions: s.expansions, totalCostBp: 0 });
        return { used, done: true };
      }
    }

    const currIdx = heapPop(s);
    used += 1;
    s.expansions += 1;
    s.closed[currIdx] = 1;

    if (isGoalTile(s, currIdx)) {
      finish(s, { ok: true, path: reconstructPath(s, currIdx), expansions: s.expansions, totalCostBp: s.gScore[currIdx] });
      return { used, done: true };
    }
    expandNeighbors(s, currIdx);
  }

  if (!s.done && s.heapSize === 0) {
    finish(s, { ok: false, path: [], expansions: s.expansions, totalCostBp: 0 });
  }
  return { used, done: s.done };
}
