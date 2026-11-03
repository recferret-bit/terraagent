import type { RejectCode } from '@terra/contracts';
import type { WorkIntent } from '@terra/contracts/commands/enqueue-task';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState, SimState } from '../../kernel/state';
import { enqueueWorkAtTile } from './dismantleAndWork';
import { cancelWorkerJobs, getWorkJobsMap, hasWorkJob, type WorkJobRecord } from './workJobs';
import { primeWorkerForWorkJob } from './workTile';

export interface WorkOrderArgs {
  tiles: ReadonlyArray<{ q: number; r: number }>;
  workerId?: number;
  entityId?: number;
  intent?: WorkIntent;
}

/**
 * A player's `work` order, the one entry point of every `op: 'work'` form (`enqueueTask { terraform: { op: 'work' } }`,
 * the direct `task` form, `enqueueTerraformOrder`): one work job per tile (job id = the command id, or
 * `${commandId}:${i}` for several tiles, whose jobs all carry `chainRootId: commandId` so `cancelTask` by the command id
 * ends the whole order). Terraform jobs chain (`chain.ts`). A terraform order naming its worker replaces that worker's
 * running chain; a repair order queues behind it (the chain goes on after the repair). A command id that already names
 * an open job is rejected (`invalid_args`). Returns the first reject when no tile was accepted.
 */
export function enqueueWorkOrder(
  state: SimState,
  colonyId: number,
  args: WorkOrderArgs,
  commandId: string,
  tick: number,
  data?: CompiledDataLike,
): RejectCode | undefined {
  const { tiles, workerId, entityId, intent } = args;
  if (tiles.length === 0) return 'invalid_args';
  if (hasWorkJob(state, commandId)) return 'invalid_args';
  const multi = tiles.length > 1;
  const created: WorkJobRecord[] = [];
  let firstReject: RejectCode | undefined;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    const taskId = multi ? `${commandId}:${i}` : commandId;
    const res = enqueueWorkAtTile(state, colonyId, t.q, t.r, {
      workerId, entityId, taskId, tick, data, intent, chain: true, ...(multi ? { chainRootId: commandId } : {}),
    });
    if (res.ok) created.push(res.job);
    else firstReject ??= res.reason;
  }
  if (created.length === 0) return firstReject ?? 'site_blocked';
  if (workerId !== undefined) replaceRunningChains(state, created, tick, data);
  return undefined;
}

/** Ends the running chains of the workers of `created`'s terraform jobs and points each worker at its first job. */
function replaceRunningChains(state: SimState, created: readonly WorkJobRecord[], tick: number, data?: CompiledDataLike): void {
  const keep = new Set(created.map((j) => j.jobId));
  const workers = new Set(created.filter((j) => j.mode === 'terraform').map((j) => j.workerEntityId));
  for (const w of workers) {
    if (cancelWorkerJobs(state, w, tick, { onlyChain: true, keep }) === 0) continue;
    const first = Object.values(getWorkJobsMap(state)).find((j) => j.workerEntityId === w);
    if (first) primeWorkerForWorkJob(state as PlanetState, w, first.q, first.r, tick, data);
  }
}
