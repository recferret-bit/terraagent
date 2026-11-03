import { ENTITY_KIND } from '../../ecs/columns';
import type { PlanetState } from '../../kernel/state';
import type { UnitCtx } from '../../units/types';

/** The kinds of worker jobs dispatch v1 knows (W02-16, `UO-D-03`). */
export type WorkKind = 'build' | 'terraform' | 'linkedPrep';

/** What eligibility looks at in a job: its kind, the terraform op and the building tier (default 1). */
export interface WorkEligibilitySpec {
  kind: WorkKind;
  op?: string;
  tier?: number;
}

/**
 * Whether a worker entity (`ENTITY_KIND.hq` or `ENTITY_KIND.harvester`) may take `job`: the HQ builds up to its tier
 * (`maxBuildTier`) and runs every terraform op and linked site prep; a Harvester (`maxBuildTier 0`) never builds or
 * prepares a site, it only takes Clear / Break / Work sub-jobs.
 */
export function isWorkerEligibleForJob(entityKind: number, workerTier: number, job: WorkEligibilitySpec): boolean {
  if (entityKind === ENTITY_KIND.hq) {
    const maxBuildTier = workerTier >= 1 ? workerTier : 1;
    if (job.kind === 'build') return maxBuildTier >= (job.tier ?? 1);
    return true;
  }
  if (entityKind === ENTITY_KIND.harvester) {
    if (job.kind === 'build' || job.kind === 'linkedPrep') return false;
    return job.op === 'clear' || job.op === 'break' || job.op === 'work';
  }
  return false;
}

/** Whether the unit a work provider is asked for may take a job of `kind` (eligibility above, by its kind and tier). */
export function canDoWork(u: UnitCtx, kind: WorkKind, tier = 1): boolean {
  const cols = u.state.entities.cols;
  return isWorkerEligibleForJob(cols.kind[u.row], cols.tier[u.row] || 1, { kind, tier });
}

/** Whether colony `owner` has an alive worker that may take `job` (a build with no builder at all waits on `worker`). */
export function colonyHasEligibleWorker(state: PlanetState, owner: number, job: WorkEligibilitySpec): boolean {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] === owner && cols.hp[row] > 0 && isWorkerEligibleForJob(cols.kind[row], cols.tier[row] || 1, job)) return true;
  }
  return false;
}
