import { rowOf } from '../../ecs/store';
import { isTileUneven } from '../../grid/geo';
import { hexDistance, hexIndex, hexRound } from '../../grid/hex';
import { TERRAIN } from '../../grid/layers';
import { pathBlockersFor } from '../../grid/pathProfiles';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { terraformWorldFromState } from './rules';
import { mobileStats } from '../../units/mobility';
import { workReach, type WorkJobRecord } from './workJobs';
import { classifyGroundWorkTile, createGroundWorkJob, primeWorkerForWorkJob, type GroundWork } from './workTile';

/**
 * Terraform chain ("infinite terraform"): a terraform `work` job the player orders (`chain: true`) does not end the
 * worker's work. When it finishes, the same worker takes the next obstacle (forest, rock, slope, hole, uneven Flat,
 * shallow water, and deep water when a T2+ worker exists; never level Flat that is already `flat` / prepared /
 * irrigated / living) the colony may terraform (`classifyGroundWorkTile`) that no
 * other work job targets, and so on until none is left. The next obstacle is the one **closest to the tile the player
 * clicked** (`chainOrigin`), so the worker clears the area around its order ring by ring instead of wandering off along
 * a line of trees; among equally close ones it takes the one closest to the tile it just finished (short walks), then
 * the lowest tile index. Follow-up job ids are `${rootId}~${n}`.
 *
 * WORKED FROM THE EDGE INWARD (owner rule, 2026-11-06): wild ground is worked from ground the worker can stand on.
 *   E1  The chain only takes an obstacle that has a STAND in reach: a tile within the worker's work reach
 *       (`workReach`: HQ 2, Worker Drone 1) where that worker may end a move (its path profile's `goalBlocked`; for the
 *       HQ's `ground` profile that is level, walkable ground, never a dune, tree or ramp tile).
 *   E2  A tile the player clicks that has no reachable stand is not a failure: it is where the chain is heading. Its job
 *       is skipped (`chainSkipped`) and the chain works the obstacle closest to it that has a stand, so a dune is cut
 *       from its edge (the cleared disc joins the level ground, `flattenDuneFootprint` R4, and is a stand for the next
 *       ring) and a forest is cleared from its edge, until the clicked tile itself is in reach.
 *   E3  Only when nothing the colony may work has a stand does the order end, reported once as the worker's `no_path`.
 * A follow-up with no path even so (a stand in reach that the worker cannot walk to: an island, a walled-in pocket) is
 * skipped silently and tried again after the chain next finishes a tile; when only such tiles are left the chain ends.
 * A tile still an obstacle after its own job is never picked again (no endless re-work).
 * The chain stops on a player order to the worker (`moveUnit`, `stopUnit`, another terraform `work` order naming it),
 * `cancelTask` (root id, any chain job id, `unit:<id>`) or the worker's death (its jobs are dropped). A repair order for
 * the worker queues behind the chain's current tile; the chain goes on after it.
 */

/**
 * Whether tile `i` is an obstacle a chain clears: forest, rock, slope, hole, shallow or deep water, or Flat that is
 * not level. Deep water stays in the set; {@link classifyGroundWorkTile} rejects it (`worker_tier_locked`) until a
 * T2+ worker exists, so a locked centre does not stop the shallow shore.
 */
export function isChainObstacle(radius: number, i: number, terrain: ArrayLike<number>, height?: ArrayLike<number> | null): boolean {
  const t = terrain[i];
  if (t === TERRAIN.forest || t === TERRAIN.rock || t === TERRAIN.slope || t === TERRAIN.hole) return true;
  if (t === TERRAIN.shallow || t === TERRAIN.deep) return true;
  return t === TERRAIN.flat && isTileUneven(radius, i, terrain, height);
}

/** Where the chain measures from: the clicked tile (`origin`, first key) and the tile it just finished (`last`, tie-break). */
export interface ChainAnchor {
  origin: { q: number; r: number };
  last: { q: number; r: number };
}

/** E1: whether tile `i` passes the stand rule (true for every tile when the chain has no worker to ask). */
export type ChainStandRule = (i: number) => boolean;

/**
 * E1, the stand rule of worker `workerEntityId`: tile `i` has a STAND, a tile at hex distance `1..workReach` of it where
 * this worker may end a move (`goalBlocked` of its path profile, from the tile it stands on). `null` when the worker is
 * gone or is not a unit (no rule: every tile passes).
 */
export function chainStandRule(state: PlanetState, workerEntityId: number, data?: CompiledDataLike): ChainStandRule | null {
  const row = rowOf(state.entities, workerEntityId);
  if (row < 0) return null;
  const cols = state.entities.cols;
  const stats = data ? mobileStats(cols.kind[row], data) : null;
  if (!stats) return null;
  const hx = hexIndex(state.grid.radius);
  const [wq, wr] = hexRound(cols.q[row], cols.r[row]);
  const blockers = pathBlockersFor(state, stats.profile, hx.indexOf(wq, wr), data);
  if (!blockers) return null;
  const reach = workReach(cols.kind[row]);
  return (i) => {
    const q = hx.q[i]!, r = hx.r[i]!;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dq = -reach; dq <= reach; dq++) {
        const d = hexDistance(0, 0, dq, dr);
        if (d < 1 || d > reach) continue;
        const j = hx.indexOf(q + dq, r + dr);
        if (j >= 0 && !blockers.goalBlocked(j)) return true;
      }
    }
    return false;
  };
}

/** The chain's next tile and what working it takes, or null (see {@link pickNextChainTile}). */
function findNextChainTile(
  state: SimState,
  colonyId: number,
  at: ChainAnchor,
  exclude: ReadonlySet<number>,
  data?: CompiledDataLike,
  stand?: ChainStandRule | null,
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
    if (stand && !stand(i)) continue; // E1: no stand in reach (yet)
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
 * `exclude` and, with `stand` ({@link chainStandRule}), every tile without a stand in reach (E1). One linear scan over
 * the tiles. `-1` = none left.
 */
export function pickNextChainTile(
  state: SimState,
  colonyId: number,
  at: ChainAnchor,
  exclude: ReadonlySet<number>,
  data?: CompiledDataLike,
  stand?: ChainStandRule | null,
): number {
  return findNextChainTile(state, colonyId, at, exclude, data, stand)?.tileIdx ?? -1;
}

/**
 * Continues the chain of `done` (a terraform job that just finished, was dropped on its completion re-check, or was
 * abandoned as `unreachable`, the player's own tile too: E2) in `jobs` (the work-jobs system's working copy; the caller
 * saves it). Returns the follow-up job, or null when the chain ends. While the worker still has another chain job (a further tile of a
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
  const stand = chainStandRule(state, done.workerEntityId, ctx.data);
  const next = findNextChainTile(state, done.colonyId, { origin, last: done }, exclude, ctx.data, stand);
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
