import { dismantleTargetRejectByName, ENTITY_KIND, ENTITY_STATE, isUnitKind, type CompiledDataLike, type PlanetState, type TerraformOpKind } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { REJECT_TEXT } from '../shared/rejectText';
import type { TileCoord } from '../shared/pointer';
import { colonyWorkJobs } from './workStatus';
import {
  calculateDismantleRefund,
  calculateRepairCost,
  DISMANTLE_REFUND_RATIO,
  findEntityAtTile,
  FULL_REPAIR_COST_RATIO,
  hasWorkerEntity,
  pct,
  planTerraformTiles,
  resolveEntityBaseCost,
  type InspectableEntity,
  type PlannedTileJob,
  type TerraformPrimaryOp,
} from './planner';

/** What a `work` order is for (REPAIR targets one damaged own entity). */
export type WorkIntent = 'terraform' | 'repair';

/**
 * The `terraform` member of `enqueueTask` the dock buttons send (one tile per click): TERRAFORM is `work` +
 * `intent: 'terraform'` (the chain), REPAIR `work` + `intent: 'repair'`, DISMANTLE `dismantle`.
 */
export interface TerraformWireArgs {
  op: TerraformOpKind;
  intent?: WorkIntent;
  tiles: TileCoord[];
  workerId?: number;
}

export interface BrushStrokeOutcome {
  ok: boolean;
  reason?: string;
  status?: string;
  op?: TerraformPrimaryOp;
  targetId?: number;
  repairCost?: Record<string, number>;
  refund?: Record<string, number>;
}

export interface PrimaryOpContext {
  view: GameView | null;
  hostState?: PlanetState | null;
  entities: readonly InspectableEntity[];
  colonyId: number;
  /** The selected own unit, preferred as the worker (the host picks one when absent). */
  workerId?: number;
  /** The host's balance data (`WorldStore.simData`): territory radius, footprints and costs as the host sees them. */
  data?: CompiledDataLike | null;
}

/** The client preview of one dock-button click: the command to send (`null`: nothing to do there) and the status. */
export interface PrimaryOpPlan {
  terraform: TerraformWireArgs | null;
  outcome: BrushStrokeOutcome;
  job?: PlannedTileJob;
}

const skip = (op: TerraformPrimaryOp, reason: string, status: string): PrimaryOpPlan => ({
  terraform: null,
  outcome: { ok: false, reason, op, status },
});

const NO_WORKER = 'No HQ Drone or Worker Drone to do the work';

/** A unit by kind name (drones): never a dismantle target. The HQ Drone is left to the HQ reject. */
const isUnitName = (kindName: string): boolean => {
  const kind = (ENTITY_KIND as Record<string, number>)[kindName];
  return kind !== undefined && kindName !== 'hq' && isUnitKind(kind);
};

const withWorker = (workerId: number | undefined) => (workerId === undefined ? {} : { workerId });

function planDismantle(ctx: PrimaryOpContext, q: number, r: number): PrimaryOpPlan {
  // The host's own rule (`dismantleTargetReject`): a unit / drone, the worker itself, HQ / Hub or a site never is a target.
  const target =
    findEntityAtTile(ctx.entities.filter((e) => !isUnitName(e.kindName)), q, r, ctx.colonyId, true) ??
    findEntityAtTile(ctx.entities, q, r, ctx.colonyId, true);
  if (!target) return skip('dismantle', 'no_target_to_dismantle', 'No building at target hex to dismantle');
  const reject = dismantleTargetRejectByName(target.kindName, target.state, { isSelf: ctx.workerId !== undefined && ctx.workerId === target.id });
  if (reject && reject !== 'cannot_dismantle_hq') return skip('dismantle', reject, REJECT_TEXT[reject]);
  if (target.kindName === 'pod') {
    const hubBuilt = ctx.entities.some((e) => e.owner === ctx.colonyId && (e.kindName === 'commandHub' || e.kindName === 'hub') && e.state === ENTITY_STATE.active);
    if (!hubBuilt) return skip('dismantle', 'pod_needed', 'Build the Command Hub first: the pod marks your landing site until then');
    return { terraform: { op: 'dismantle', tiles: [{ q, r }] }, outcome: { ok: true, op: 'dismantle', targetId: target.id, refund: {}, status: 'Dismantle ordered (pod wreck scrapped)' }, job: { q, r, op: 'dismantle' } };
  }
  if (target.kindName === 'commandHub' || target.kindName === 'hq') {
    return skip('dismantle', 'cannot_dismantle_hq', 'Cannot dismantle Command Hub or HQ Drone');
  }
  const refund = calculateDismantleRefund(resolveEntityBaseCost(target.kindName, target.cost, ctx.data ?? undefined));
  // Worker Drone or HQ takes it apart in half its build time (owner feedback W03 #6).
  const status = `Dismantle ordered: a Worker Drone takes it apart (+${pct(DISMANTLE_REFUND_RATIO)} refunded step by step)`;
  return {
    terraform: { op: 'dismantle', tiles: [{ q, r }] },
    outcome: { ok: true, op: 'dismantle', targetId: target.id, refund, status },
    job: { q, r, op: 'dismantle' },
  };
}

function planRepair(ctx: PrimaryOpContext, q: number, r: number): PrimaryOpPlan {
  const target = findEntityAtTile(ctx.entities, q, r, ctx.colonyId);
  const damaged =
    target && typeof target.hp === 'number' && typeof target.hpMax === 'number' && target.hp > 0 && target.hp < target.hpMax;
  if (!target || !damaged) return skip('repair', 'nothing_to_repair', 'Nothing to repair here');
  if (!hasWorkerEntity(ctx.entities, ctx.colonyId, ctx.view)) return skip('repair', 'no_worker', NO_WORKER);
  const repairCost = calculateRepairCost(resolveEntityBaseCost(target.kindName, target.cost, ctx.data ?? undefined), target.hp!, target.hpMax!);
  // A damaged unit cannot repair itself: the host picks another worker.
  const workerId = ctx.workerId === target.id ? undefined : ctx.workerId;
  // A worker on a TERRAFORM chain finishes its current hex, repairs, then the chain resumes (only TERRAFORM replaces it).
  const chaining = isChaining(ctx, workerId);
  const status = `Repair ordered (${pct(FULL_REPAIR_COST_RATIO)} base cost for full repair)${chaining ? ' · after the current hex; the terraform chain resumes after' : ''}`;
  return {
    terraform: { op: 'work', intent: 'repair', tiles: [{ q, r }], ...withWorker(workerId) },
    outcome: { ok: true, op: 'repair', targetId: target.id, repairCost, status },
    job: { q, r, op: 'repair' },
  };
}

const isChaining = (ctx: PrimaryOpContext, workerId: number | undefined): boolean =>
  workerId !== undefined && colonyWorkJobs(ctx.view, ctx.colonyId).some((j) => j.workerEntityId === workerId && j.chain);

const SKIP_STATUS: Readonly<Record<string, string>> = {
  not_own_territory: 'Outside your territory',
  invalid_args: 'Outside the map',
  already_terraformed: 'Already terraformed',
  already_queued: 'Already queued: a terraform job is waiting or running here',
  already_at_target: 'Already terraformed',
  site_blocked: 'Nothing to terraform here (already done, queued, or built on)',
  building_here: 'A building stands on this hex',
  deposit_here: 'Resource deposit here: harvest it instead',
  worker_tier_locked: 'Deep water needs a T2 worker',
};

/**
 * TERRAFORM on one hex: `work` + `intent: 'terraform'` (the chain). The preview is the sim's ground rule
 * (`planGroundWorkTiles`). Level flat that is already terraformed sends nothing. With no tile layers yet the host
 * judges the click alone.
 */
function planTerraform(ctx: PrimaryOpContext, q: number, r: number): PrimaryOpPlan {
  const data = ctx.data ?? undefined;
  const preview = planTerraformTiles(ctx.view, [{ q, r }], { colonyId: ctx.colonyId, data });
  const job = preview.jobs[0];
  if (!job && preview.firstReject) return skip('terraform', preview.firstReject, SKIP_STATUS[preview.firstReject] ?? `Cannot terraform: ${preview.firstReject.replace(/_/g, ' ')}`);
  if (job && !hasWorkerEntity(ctx.entities, ctx.colonyId, ctx.view)) return skip('terraform', 'no_worker', NO_WORKER);
  return {
    terraform: { op: 'work', intent: 'terraform', tiles: [{ q, r }], ...withWorker(ctx.workerId) },
    outcome: { ok: true, op: 'terraform', status: `Terraform ordered (${q},${r})` },
    job: { q, r, op: 'work' },
  };
}

/** Preview of one TERRAFORM / REPAIR / DISMANTLE click at `(q, r)`; the host stays the judge (it may still reject). */
export function planPrimaryOp(op: TerraformPrimaryOp, ctx: PrimaryOpContext, q: number, r: number): PrimaryOpPlan {
  if (op === 'dismantle') return planDismantle(ctx, q, r);
  if (op === 'repair') return planRepair(ctx, q, r);
  return planTerraform(ctx, q, r);
}
