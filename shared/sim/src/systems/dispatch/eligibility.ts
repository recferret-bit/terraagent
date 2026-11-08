import { ENTITY_KIND } from '../../ecs/columns';
import type { PlanetState } from '../../kernel/state';
import type { UnitCtx } from '../../units/types';
import { isWorker } from '../harvest/unit';
import { getTerraformOpSpec, isTerraformOpKind } from '../terraform-basic/ops';

export { isWorker };

/** The kinds of worker jobs dispatch v1 knows (W02-16, `UO-D-03`). */
export type WorkKind = 'build' | 'terraform' | 'linkedPrep';

/** What eligibility looks at in a job: its kind, the terraform op and the building tier (default 1). */
export interface WorkEligibilitySpec {
  kind: WorkKind;
  op?: string;
  tier?: number;
}

/** Build cap is the worker's tier (T1 → 1, T2 → 2, T3 → 3). HQ keeps at least 1. */
function buildCap(entityKind: number, workerTier: number): number {
  if (entityKind === ENTITY_KIND.hq) return Math.max(1, workerTier);
  if (isWorker(entityKind)) return workerTier >= 1 ? workerTier : 0;
  return 0;
}

/**
 * Checks whether a worker (`entityKind`, `workerTier`) may construct a site of `siteTier`.
 * Returns `{ ok: false, code: 'worker_tier_locked' }` when `siteTier` exceeds that cap.
 */
export function checkWorkerBuildTier(
  entityKind: number,
  workerTier: number,
  siteTier = 1,
): { ok: true } | { ok: false; code: 'worker_tier_locked' } {
  const maxBuildTier = buildCap(entityKind, workerTier);
  if (maxBuildTier <= 0 || siteTier > maxBuildTier) return { ok: false, code: 'worker_tier_locked' };
  return { ok: true };
}

/** The worker tier an op needs: its `opsBasic.<op>.minWorkerTier` row (`deepReclaim` 2, the rest 1); non-ops 1. */
function opMinWorkerTier(op: string | undefined): number {
  return isTerraformOpKind(op) ? getTerraformOpSpec(op).minWorkerTier : 1;
}

/**
 * Whether a worker may take `job`.
 * - Builds: up to its build cap (`buildCap`: the HQ and a Worker Drone build up to their tier).
 * - Terraform ops: any op whose `minWorkerTier` row the worker's tier reaches (only `deepReclaim` needs T2+).
 * - Linked site prep: the HQ always; a Worker Drone up to its tier (the site's tier).
 * - Repair and dismantle: every tier, and the HQ.
 */
export function isWorkerEligibleForJob(entityKind: number, workerTier: number, job: WorkEligibilitySpec): boolean {
  const isHq = entityKind === ENTITY_KIND.hq;
  if (!isHq && !isWorker(entityKind)) return false;
  const cap = buildCap(entityKind, workerTier);
  if (job.kind === 'build') return cap > 0 && (job.tier ?? 1) <= cap;
  if (job.kind === 'linkedPrep' && !isHq && (job.tier ?? 1) > cap) return false;
  return Math.max(isHq ? 1 : 0, workerTier) >= opMinWorkerTier(job.op);
}

/** Whether the unit a work provider is asked for may take a job of `kind` (eligibility above, by its kind and tier). */
export function canDoWork(u: UnitCtx, kind: WorkKind, tier = 1): boolean {
  const cols = u.state.entities.cols;
  return isWorkerEligibleForJob(cols.kind[u.row], cols.tier[u.row] || 1, { kind, tier });
}

/** Whether colony `owner` has an alive worker that may take `job` (a build with no worker at all waits on `worker`). */
export function colonyHasEligibleWorker(state: PlanetState, owner: number, job: WorkEligibilitySpec): boolean {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] === owner && cols.hp[row] > 0 && isWorkerEligibleForJob(cols.kind[row], cols.tier[row] || 1, job)) return true;
  }
  return false;
}
