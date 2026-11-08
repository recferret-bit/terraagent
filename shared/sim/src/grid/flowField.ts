import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { HEX_DIRS, hexIndex, type HexIndex } from './hex';
import { pathBlockersFor, type PathProfileId } from './pathProfiles';
import { tileStepCostBp } from './pathSearch';

export interface FieldRequestData {
  anchorQ: number;
  anchorR: number;
  targets: { q: number; r: number }[];
}

interface FieldEntry {
  id: string | number;
  radius?: number;
  profile?: PathProfileId;
  field?: FieldRequestData;
  expansionsUsed: number;
}

/**
 * One reverse Dijkstra shared by a group march (`SIM-T-02` budget). Parents point back toward the anchor, or toward
 * a standable neighbour when the anchor itself cannot be entered. The live search is a cache; a restored planet
 * replays `expansionsUsed` and reaches the same parents. Units are not obstacles.
 */

interface FieldSearch {
  idx: HexIndex;
  parents: Int16Array;
  cost: Int32Array;
  settled: Uint8Array;
  heap: number[];
  heapCost: number[];
  heapSize: number;
  expansions: number;
  pending: number;
  targets: Set<number>;
  seeds: number[];
  blocked: (tileIdx: number) => boolean;
  data?: CompiledDataLike;
  grid: PlanetState['grid'];
  done: boolean;
}

const fieldCache = new WeakMap<object, Map<string | number, FieldSearch>>();

function cacheOf(state: PlanetState): Map<string | number, FieldSearch> {
  let m = fieldCache.get(state.grid);
  if (!m) fieldCache.set(state.grid, (m = new Map()));
  return m;
}

export function dropFieldSearch(state: PlanetState, id: string | number): void {
  cacheOf(state).delete(id);
}

function standable(state: PlanetState, tileIdx: number, profile: PathProfileId | undefined, data?: CompiledDataLike): boolean {
  if (tileIdx < 0) return false;
  const blockers = pathBlockersFor(state, profile, -1, data);
  return blockers ? !blockers.goalBlocked(tileIdx) : tileStepCostBp(state, tileIdx, data) > 0;
}

/** Tiles the field is rooted on: the anchor when it can be stood on, otherwise its standable neighbours. */
export function fieldSeeds(
  state: PlanetState,
  anchorQ: number,
  anchorR: number,
  profile: PathProfileId | undefined,
  data?: CompiledDataLike,
): number[] {
  const idx = hexIndex(state.grid.radius);
  const anchor = idx.indexOf(anchorQ, anchorR);
  if (anchor >= 0 && standable(state, anchor, profile, data)) return [anchor];
  const seeds: number[] = [];
  for (let d = 0; d < 6; d++) {
    const i = idx.indexOf(anchorQ + HEX_DIRS[d][0], anchorR + HEX_DIRS[d][1]);
    if (standable(state, i, profile, data)) seeds.push(i);
  }
  return seeds;
}

function heapLess(tile: number, cost: number, otherTile: number, otherCost: number): boolean {
  if (cost !== otherCost) return cost < otherCost;
  return tile < otherTile;
}

function heapPush(s: FieldSearch, tile: number, cost: number): void {
  let i = s.heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!heapLess(tile, cost, s.heap[p], s.heapCost[p])) break;
    s.heap[i] = s.heap[p];
    s.heapCost[i] = s.heapCost[p];
    i = p;
  }
  s.heap[i] = tile;
  s.heapCost[i] = cost;
}

function heapPop(s: FieldSearch): { tile: number; cost: number } | null {
  if (s.heapSize === 0) return null;
  const topTile = s.heap[0];
  const topCost = s.heapCost[0];
  s.heapSize -= 1;
  if (s.heapSize === 0) return { tile: topTile, cost: topCost };
  const tile = s.heap[s.heapSize];
  const cost = s.heapCost[s.heapSize];
  let i = 0;
  while (true) {
    const l = i * 2 + 1;
    const r = l + 1;
    let best = i;
    let bestTile = tile;
    let bestCost = cost;
    if (l < s.heapSize && heapLess(s.heap[l], s.heapCost[l], bestTile, bestCost)) {
      best = l;
      bestTile = s.heap[l];
      bestCost = s.heapCost[l];
    }
    if (r < s.heapSize && heapLess(s.heap[r], s.heapCost[r], bestTile, bestCost)) {
      best = r;
      bestTile = s.heap[r];
      bestCost = s.heapCost[r];
    }
    if (best === i) break;
    s.heap[i] = bestTile;
    s.heapCost[i] = bestCost;
    i = best;
  }
  s.heap[i] = tile;
  s.heapCost[i] = cost;
  return { tile: topTile, cost: topCost };
}

function relax(s: FieldSearch, tile: number, dir: number): void {
  const nq = s.idx.q[tile] + HEX_DIRS[dir][0];
  const nr = s.idx.r[tile] + HEX_DIRS[dir][1];
  const ni = s.idx.indexOf(nq, nr);
  if (ni < 0 || s.settled[ni]) return;
  const step = tileStepCostBp(s.grid, ni, s.data);
  if (step <= 0 || s.blocked(ni)) return;
  const next = s.cost[tile] + step;
  const back = (dir + 3) % 6;
  if (s.cost[ni] < 0 || next < s.cost[ni]) {
    s.cost[ni] = next;
    s.parents[ni] = back;
    heapPush(s, ni, next);
  } else if (next === s.cost[ni] && s.cost[tile] < s.cost[ni] && back < s.parents[ni]) {
    s.parents[ni] = back;
  }
}

function createFieldSearch(state: PlanetState, entry: FieldEntry, data?: CompiledDataLike): FieldSearch {
  const idx = hexIndex(entry.radius ?? state.grid.radius);
  const field = entry.field as FieldRequestData;
  const profile = entry.profile;
  const blockers = pathBlockersFor(state, profile, -1, data);
  const seeds = fieldSeeds(state, field.anchorQ, field.anchorR, profile, data);
  const targets = new Set<number>();
  for (const t of field.targets) {
    const i = idx.indexOf(t.q, t.r);
    if (i >= 0) targets.add(i);
  }
  const search: FieldSearch = {
    idx,
    parents: new Int16Array(idx.count).fill(-1),
    cost: new Int32Array(idx.count).fill(-1),
    settled: new Uint8Array(idx.count),
    heap: [],
    heapCost: [],
    heapSize: 0,
    expansions: 0,
    pending: targets.size,
    targets,
    seeds,
    blocked: (i) => (blockers ? blockers.blocked(i) : false),
    data,
    grid: state.grid,
    done: seeds.length === 0,
  };
  for (const seed of seeds) {
    search.cost[seed] = 0;
    heapPush(search, seed, 0);
  }
  return search;
}

/** Expands at most `budget` settled nodes. Returns whether every target is settled or the frontier is empty. */
export function continueFieldSearch(s: FieldSearch, budget: number): boolean {
  let left = budget;
  while (left > 0 && !s.done) {
    const popped = heapPop(s);
    if (!popped) {
      s.done = true;
      break;
    }
    const { tile, cost } = popped;
    if (s.settled[tile] || cost !== s.cost[tile]) continue;
    s.settled[tile] = 1;
    s.expansions += 1;
    left -= 1;
    if (s.targets.has(tile)) s.pending -= 1;
    if (s.pending <= 0) {
      s.done = true;
      break;
    }
    for (let d = 0; d < 6; d++) relax(s, tile, d);
  }
  if (s.heapSize === 0) s.done = true;
  return s.done;
}

export interface FieldStep {
  used: number;
  expansions: number;
  done: boolean;
  parents?: number[];
  seeds?: number[];
}

/** One budgeted slice of the field request. A cache miss replays expansions already paid for. */
export function stepFieldSearch(state: PlanetState, entry: FieldEntry, budget: number, data?: CompiledDataLike): FieldStep {
  const cache = cacheOf(state);
  let search = cache.get(entry.id);
  if (!search) {
    search = createFieldSearch(state, entry, data);
    if (entry.expansionsUsed > 0) continueFieldSearch(search, entry.expansionsUsed);
    cache.set(entry.id, search);
  }
  const before = search.expansions;
  const done = continueFieldSearch(search, Math.max(0, budget));
  const step: FieldStep = { used: search.expansions - before, expansions: search.expansions, done };
  if (done) {
    cache.delete(entry.id);
    step.parents = Array.from(search.parents);
    step.seeds = search.seeds.slice();
  }
  return step;
}
