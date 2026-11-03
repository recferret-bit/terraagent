import { isTileUneven } from '../../grid/geo';
import { hexDistance, hexIndex } from '../../grid/hex';
import { TERRAIN } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { terraformWorldFromState } from './rules';
import type { WorkJobRecord } from './workJobs';
import { classifyGroundWorkTile, createGroundWorkJob, primeWorkerForWorkJob, type GroundWork } from './workTile';

/**
 * Terraform chain ("infinite terraform"): a terraform `work` job the player orders (`chain: true`) does not end the
 * worker's work. When it finishes, the same worker takes the next obstacle (forest, rock, slope, hole, uneven Flat;
 * never level wild Flat) the colony may terraform (`classifyGroundWorkTile` + the territory rule of `rules.ts`) that no
 * other work job targets, and so on until none is left. The next obstacle is the one **closest to the tile the player
 * clicked** (`chainOrigin`), so the worker clears the area around its order ring by ring instead of wandering off along
 * a line of trees; among equally close ones it takes the one closest to the tile it just finished (short walks), then
 * the lowest tile index. Follow-up job ids are `${rootId}~${n}`.
 * A follow-up with no path right now (e.g. inside a forest whose edge is not cleared yet) is skipped silently and tried
 * again after the chain next finishes a tile; when only such tiles are left the chain ends. A tile still an obstacle
 * after its own job is never picked again (no endless re-work). The player's own tile with no path ends the order (and
 * is reported as the unit's `no_path` failure).
 * The chain stops on a player order to the worker (`moveUnit`, `stopUnit`, another terraform `work` order naming it),
 * `cancelTask` (root id, any chain job id, `unit:<id>`) or the worker's death (its jobs are dropped). A repair order for
 * the worker queues behind the chain's current tile; the chain goes on after it.
 */

/** Whether tile `i` is an obstacle a chain clears: forest, rock, slope, hole, or Flat that is not level. */
export function isChainObstacle(radius: number, i: number, terrain: ArrayLike<number>, height?: ArrayLike<number> | null): boolean {
  const t = terrain[i];
  if (t === TERRAIN.forest || t === TERRAIN.rock || t === TERRAIN.slope || t === TERRAIN.hole) return true;
  return t === TERRAIN.flat && isTileUneven(radius, i, terrain, height);
}

/** Where the chain measures from: the clicked tile (`origin`, first key) and the tile it just finished (`last`, tie-break). */
export interface ChainAnchor {
  origin: { q: number; r: number };
  last: { q: number; r: number };
}

/** The chain's next tile and what working it takes, or null (see {@link pickNextChainTile}). */
function findNextChainTile(
  state: SimState,
  colonyId: number,
  at: ChainAnchor,
  exclude: ReadonlySet<number>,
  data?: CompiledDataLike,
): { tileIdx: number; ground: GroundWork } | null {
  const opts = { world: terraformWorldFromState(state, colonyId, data), occupied: occupiedGroundTiles(state, data), data };
  const { terrain, height } = state.grid.layers;
  const hx = hexIndex(state.grid.radius);
  let best: { tileIdx: number; ground: GroundWork } | null = null;
  let bestOrigin = Infinity, bestLast = Infinity;
  for (let i = 0; i < state.grid.count; i++) {
    if (exclude.has(i) || !isChainObstacle(state.grid.radius, i, terrain, height)) continue;
    const q = hx.q[i]!, r = hx.r[i]!;
    const dOrigin = hexDistance(at.origin.q, at.origin.r, q, r);
    if (dOrigin > bestOrigin) continue;
    const dLast = hexDistance(at.last.q, at.last.r, q, r);
    if (dOrigin === bestOrigin && dLast >= bestLast) continue; // ties on both keep the lower tile index
    const ground = classifyGroundWorkTile(state, colonyId, i, opts);
    if (!ground.ok) continue;
    best = { tileIdx: i, ground };
    bestOrigin = dOrigin;
    bestLast = dLast;
  }
  return best;
}

/**
 * The chain's next tile for `colonyId`: the eligible obstacle (the territory and ground rule of
 * `classifyGroundWorkTile`) closest to `at.origin`, then closest to `at.last`, then the lowest tile index, skipping
 * `exclude`. One linear scan over the tiles. `-1` = none left.
 */
export function pickNextChainTile(
  state: SimState,
  colonyId: number,
  at: ChainAnchor,
  exclude: ReadonlySet<number>,
  data?: CompiledDataLike,
): number {
  return findNextChainTile(state, colonyId, at, exclude, data)?.tileIdx ?? -1;
}

/**
 * Continues the chain of `done` (a terraform job that just finished, was dropped on its completion re-check, or was
 * abandoned as `unreachable`) in `jobs` (the work-jobs system's working copy; the caller saves it). Returns the
 * follow-up job, or null when the chain ends. While the worker still has another chain job (a further tile of a
 * multi-tile order, or a newer order) the chain is left to that one. Other jobs of the worker (a repair) do not end it:
 * the follow-up is queued behind them (jobs run in insertion order, one per worker).
 */
export function continueWorkChain(
  state: PlanetState,
  done: WorkJobRecord,
  jobs: Record<string, WorkJobRecord>,
  ctx: StepContext,
  unreachable = false,
): WorkJobRecord | null {
  if (!done.chain || done.mode !== 'terraform') return null;
  const seq = done.chainSeq ?? 0;
  if (unreachable && seq === 0) return null;
  const others = Object.values(jobs).filter((j) => j.workerEntityId === done.workerEntityId && j.jobId !== done.jobId);
  if (others.some((j) => j.chain)) return null;
  // A tile still an obstacle after its own job (levelled but still uneven because of a neighbour the chain cannot work,
  // or no longer workable) is never picked again: without that the chain would re-work it forever. A follow-up with no
  // path is only skipped until the chain finishes another tile (clearing a forest edge opens the way to its inside).
  const { terrain, height } = state.grid.layers;
  const stillObstacle = !unreachable && isChainObstacle(state.grid.radius, done.tileIdx, terrain, height);
  const giveUp = stillObstacle ? [...(done.chainGiveUp ?? []), done.tileIdx] : [...(done.chainGiveUp ?? [])];
  const skipped = unreachable ? [...(done.chainSkipped ?? []), done.tileIdx] : stillObstacle ? [...(done.chainSkipped ?? [])] : [];
  const exclude = new Set<number>([...giveUp, ...skipped, done.tileIdx]);
  for (const j of Object.values(jobs)) exclude.add(j.tileIdx);
  const origin = done.chainOrigin ?? { q: done.q, r: done.r };
  const next = findNextChainTile(state, done.colonyId, { origin, last: done }, exclude, ctx.data);
  if (!next) return null;
  const hx = hexIndex(state.grid.radius);
  const rootId = done.chainRootId ?? done.jobId;
  let n = seq + 1;
  while (jobs[`${rootId}~${n}`]) n++; // never overwrite a job (ids are the clients' command ids)
  const tile = { q: hx.q[next.tileIdx]!, r: hx.r[next.tileIdx]!, tileIdx: next.tileIdx };
  const job = createGroundWorkJob(`${rootId}~${n}`, done.colonyId, done.workerEntityId, tile, next.ground);
  Object.assign(job, { chain: true, chainRootId: rootId, chainSeq: n, chainOrigin: origin },
    skipped.length > 0 ? { chainSkipped: skipped } : {}, giveUp.length > 0 ? { chainGiveUp: giveUp } : {});
  jobs[job.jobId] = job;
  if (others.length === 0) primeWorkerForWorkJob(state, done.workerEntityId, job.q, job.r, ctx.tick, ctx.data);
  return job;
}
