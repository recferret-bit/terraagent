import { ENTITY_STATE, type CompiledDataLike, type PlanetState, type TerraformOpKind } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { viewPlacementWorld } from '../shared/placementWorld';
import type { TileCoord } from '../shared/pointer';
import { groundWorkLabel, groundYields, previewGroundWork, type GroundKey } from './groundPreview';
import { pct } from './referenceTables';
import { colonyWorkJobs } from './workStatus';
import {
  calculateDismantleRefund,
  calculateRepairCost,
  DISMANTLE_REFUND_RATIO,
  findEntityAtTile,
  FULL_REPAIR_COST_RATIO,
  hasWorkerEntity,
  resolveEntityBaseCost,
  type InspectableEntity,
  type PlannedTileJob,
  type TerraformButtonOp,
  type TerraformPrimaryOp,
} from './planner';

/** What a `work` order is for: the sim chains TERRAFORM hex by hex, REPAIR targets one damaged own entity. */
export type WorkIntent = 'terraform' | 'repair';

/** The `terraform` member of `enqueueTask` the dock buttons send (one tile per click). */
export interface TerraformWireArgs {
  op: 'work' | 'dismantle';
  intent?: WorkIntent;
  tiles: TileCoord[];
  workerId?: number;
}

export interface BrushStrokeOutcome {
  ok: boolean;
  reason?: string;
  status?: string;
  op?: TerraformButtonOp;
  targetId?: number;
  repairCost?: Record<string, number>;
  refund?: Record<string, number>;
  yields?: Record<string, number>;
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

const NO_WORKER = 'No HQ Drone or Harvester to do the work';

const withWorker = (workerId: number | undefined) => (workerId === undefined ? {} : { workerId });

function planDismantle(ctx: PrimaryOpContext, q: number, r: number): PrimaryOpPlan {
  const target = findEntityAtTile(ctx.entities, q, r, ctx.colonyId, true);
  if (!target) return skip('dismantle', 'no_target_to_dismantle', 'No unit or building at target hex to dismantle');
  if (target.kindName === 'pod') {
    const hubBuilt = ctx.entities.some((e) => e.owner === ctx.colonyId && (e.kindName === 'commandHub' || e.kindName === 'hub') && e.state === ENTITY_STATE.active);
    if (!hubBuilt) return skip('dismantle', 'pod_needed', 'Build the Command Hub first: the pod marks your landing site until then');
    return { terraform: { op: 'dismantle', tiles: [{ q, r }] }, outcome: { ok: true, op: 'dismantle', targetId: target.id, refund: {}, status: 'Dismantle ordered (pod wreck scrapped)' }, job: { q, r, op: 'dismantle' } };
  }
  if (target.kindName === 'commandHub' || target.kindName === 'hq') {
    return skip('dismantle', 'cannot_dismantle_hq', 'Cannot dismantle Command Hub or HQ Drone');
  }
  const refund = calculateDismantleRefund(resolveEntityBaseCost(target.kindName, target.cost, ctx.data ?? undefined));
  const status = `Dismantle ordered (+${pct(DISMANTLE_REFUND_RATIO)} spent resources refunded)`;
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

const CONCRETE_OP: Readonly<Record<GroundKey, TerraformOpKind>> = { forest: 'clear', rock: 'break', slope: 'grade', hole: 'grade', flat: 'grade' };

function planTerraform(ctx: PrimaryOpContext, q: number, r: number): PrimaryOpPlan {
  const world = viewPlacementWorld(ctx.view);
  const ground = previewGroundWork(world.tileCount > 0 || !ctx.hostState ? world : viewPlacementWorld(ctx.hostState), ctx.colonyId, q, r, ctx.data ?? undefined);
  if (ground && !ground.ok) return skip('terraform', ground.reason, ground.status);
  if (ground && !hasWorkerEntity(ctx.entities, ctx.colonyId, ctx.view)) return skip('terraform', 'no_worker', NO_WORKER);
  // No tile layers in the view yet: the host judges alone.
  const key = ground?.key;
  const data = ctx.data ?? undefined;
  const yields = key ? groundYields(key, data) : undefined;
  const what = key ? groundWorkLabel(key, data) : 'Terraform';
  return {
    terraform: { op: 'work', intent: 'terraform', tiles: [{ q, r }], ...withWorker(ctx.workerId) },
    outcome: {
      ok: true,
      op: 'terraform',
      status: `Terraform ordered: ${what} · continues hex by hex${isChaining(ctx, ctx.workerId) ? ' (replaces the worker\'s chain)' : ''}`,
      ...(yields ? { yields } : {}),
    },
    job: { q, r, op: key ? CONCRETE_OP[key] : 'terraform' },
  };
}

/** Preview of one TERRAFORM / REPAIR / DISMANTLE click at `(q, r)`; the host stays the judge (it may still reject). */
export function planPrimaryOp(op: TerraformPrimaryOp, ctx: PrimaryOpContext, q: number, r: number): PrimaryOpPlan {
  if (op === 'dismantle') return planDismantle(ctx, q, r);
  if (op === 'repair') return planRepair(ctx, q, r);
  return planTerraform(ctx, q, r);
}
