import type { ResourceKey } from '@terra/contracts';
import { owedAt, shareBp } from '@terra/ledger';
import {
  colonyActor,
  findShortfall,
  getColonyStock,
  reportTreasuryReject,
  treasury,
  treasuryCtx,
  type AddRequest,
  type Amounts,
  type MoveRequest,
  type TreasuryCtx,
} from '../../economy';
import { ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { colonyWho } from '../find';
import { resolveHqT1Row, resolveHubT1Row, rowNum, ticksToSeconds } from '../rows';
import { applyHubCompletionEffects } from '../territory-claim';
import { setOrderStatus, type ConstructionOrder } from './orders';
import { isHubBuildingKind, resolveBuildingRow } from './placement';

export interface CostCheckResult {
  ok: boolean;
  missingKey?: string;
  have?: number;
  need?: number;
  waitingReason?: string;
}

/** The resource cost of the Command Hub (`hub.t1.cost`, zero entries dropped). Throws when the row has no cost map. */
export function resolveHubCost(data?: CompiledDataLike): Record<string, number> {
  const raw = resolveHubT1Row(data).cost;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('data row hub.t1.cost is not a resource map');
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number' && v > 0) out[k] = v;
  return out;
}

/** The Command Hub's nominal build time in seconds at work rate 1.0 (`hub.t1.buildS`, compiled ticks converted back). */
export function resolveHubBuildTimeS(data?: CompiledDataLike): number {
  return ticksToSeconds(rowNum(resolveHubT1Row(data), 'buildS'));
}

/** Share of the paid cost refunded when an in-progress build is cancelled, in basis points (`hub.t1.cancelRefundBp`). */
export function resolveHubCancelRefundBp(data?: CompiledDataLike): number {
  return rowNum(resolveHubT1Row(data), 'cancelRefundBp');
}

function waitingFor(resource: string, have: number, need: number): CostCheckResult {
  return { ok: false, missingKey: resource, have, need, waitingReason: `waiting(resources: ${resource} ${have}/${need})` };
}

/** Checks whether `colonyId` currently has enough stock to pay `cost` (`UO-Q-01`, `UO-Q-03`). Whole units. */
export function checkBuildingCost(state: SimState, colonyId: number, cost: Record<string, number>): CostCheckResult {
  const short = findShortfall(getColonyStock(state, colonyId), cost as Amounts);
  return short ? waitingFor(short.resource, short.have, short.need) : { ok: true };
}

/**
 * The start gate of a construction order (`UO-Q-01`, `W01-16`): the full cost must be affordable when work starts.
 * Nothing is deducted here; it marks `order.costPaid = true` (payment started) with an empty `paidAmounts`, and the
 * cost is then spent gradually by {@link spendConstructionSlice} in proportion to build progress.
 */
export function payConstructionCost(state: SimState, order: ConstructionOrder): CostCheckResult {
  if (order.costPaid) return { ok: true };
  const check = checkBuildingCost(state, order.colonyId, order.cost);
  if (!check.ok) return check;
  order.costPaid = true;
  order.paidAmounts = {};
  return { ok: true };
}

/**
 * Spends the part of `order.cost` owed at build progress `targetProgress` (cumulative, 0..1) and not paid yet:
 * `owedAt(cost, progress) - paid` whole units per resource, as one `construction.spend` withdrawal. All-or-nothing:
 * when the colony lacks any resource the build pauses (returns the `waiting(resources: …)` reason) and nothing is
 * deducted. At `1.0` the paid total equals the cost exactly.
 */
export function spendConstructionSlice(
  state: SimState,
  order: ConstructionOrder,
  targetProgress: number,
  ledger: TreasuryCtx,
): CostCheckResult {
  const cost = order.cost;
  const paid = (order.paidAmounts ??= {});
  const slice: Amounts = {};
  for (const [k, total] of Object.entries(cost)) {
    const amt = owedAt(total, targetProgress) - (paid[k] ?? 0);
    if (amt > 0) slice[k as ResourceKey] = amt;
  }
  const req: MoveRequest = {
    colony: order.colonyId,
    amounts: slice,
    reason: 'construction.spend',
    actor: colonyActor(state, order.colonyId),
    ref: `order:${order.entityId}`,
  };
  const res = treasury(state, ledger).withdraw(req);
  if (!res.ok && res.code === 'insufficient_funds') return waitingFor(res.resource ?? res.code, res.have ?? 0, res.need ?? 0);
  if (!res.ok) {
    // Not a shortage (a corrupt cost): the build is blocked; warn once, when it first stops on it.
    const blocked = `blocked(${res.code}${res.resource ? `: ${res.resource}` : ''})`;
    if (order.waitingReason !== blocked) reportTreasuryReject(ledger, state, req, res);
    return { ok: false, waitingReason: blocked };
  }
  for (const [k, amt] of Object.entries(res.debited)) paid[k] = (paid[k] ?? 0) + amt;
  return { ok: true };
}

/**
 * Refunds `floor(paid × cancelRefundBp / 10000)` (75 % for `hub.t1`) of each resource in `order.paidAmounts` as one
 * `construction.refund` credit when an in-progress construction order is cancelled (`UO-Q-02`, `W01-16`). Returns
 * the refunded resource map (empty if nothing was paid).
 */
export function refundCancelledConstruction(
  state: SimState,
  order: ConstructionOrder,
  data: CompiledDataLike | undefined,
  ledger: TreasuryCtx,
): Record<string, number> {
  if (!order.costPaid || !order.paidAmounts || order.status === 'completed') return {};
  const bp = resolveHubCancelRefundBp(data);
  const refund: Record<string, number> = {};
  for (const [k, paid] of Object.entries(order.paidAmounts)) {
    const share = shareBp(paid, bp);
    if (share > 0) refund[k] = share;
  }
  // Uncapped: a refund returns part of what the colony paid, which already fitted in its storage.
  const req: AddRequest = {
    colony: order.colonyId,
    amounts: refund as Amounts,
    reason: 'construction.refund',
    actor: colonyActor(state, order.colonyId),
    ref: `order:${order.entityId}`,
  };
  const res = treasury(state, ledger).add(req);
  if (!res.ok) {
    reportTreasuryReject(ledger, state, req, res);
    return {};
  }
  return refund;
}

/** What one step of build work did: progress made, the build paused (shortage / blocked cost), or it completed. */
export type BuildStepResult = 'running' | 'paused' | 'completed';

/**
 * Advances an in-progress construction order by one step of work from builder `builderRow`, which the `build` unit
 * command has walked into reach (`UO-L-05`, `W01-16`, `UO-Q-01`), and spends the matching slice of the cost. A
 * shortage pauses the order (`waiting_resources` until stock covers the slice, GP-12); the builder's own state is the
 * unit command's business (GP-16), this only reports progress.
 */
export function advanceConstructionProgress(
  state: PlanetState,
  order: ConstructionOrder,
  entityRow: number,
  builderRow: number,
  tick: number,
  ctx?: Partial<StepContext>,
): BuildStepResult {
  const data = ctx?.data;
  const dtS = (TICK_MS / 1000) * (ctx?.dt ?? 1);
  const cols = state.entities.cols;
  const rate = cols.workRate[builderRow] > 0 ? cols.workRate[builderRow] : rowNum(resolveHqT1Row(data), 'workRate');
  const delta = order.buildTimeS > 0 ? (dtS * rate) / order.buildTimeS : 1;
  const rawProgress = Math.min(1, order.progress + delta);
  // Snap float drift (0.9999999…) to 1 so the last slice settles the cost exactly and the order completes.
  const nextProgress = rawProgress >= 1 - 1e-6 ? 1 : rawProgress;

  const spend = spendConstructionSlice(state, order, nextProgress, treasuryCtx(tick, ctx));
  if (!spend.ok) {
    setOrderStatus(order, 'waiting_resources', spend.waitingReason ?? 'waiting(resources)');
    if (spend.missingKey !== undefined) order.waitingFor = { resource: spend.missingKey, need: spend.need ?? 0 };
    return 'paused';
  }
  order.progress = nextProgress;
  setField(state.entities, builderRow, 'progress', nextProgress >= 1 ? 0 : Math.fround(nextProgress), tick);
  if (nextProgress >= 1) {
    completeConstruction(state, order, entityRow, tick, ctx);
    return 'completed';
  }
  setOrderStatus(order, 'in_progress');
  if (entityRow >= 0) {
    setField(state.entities, entityRow, 'state', ENTITY_STATE.constructing, tick);
    setField(state.entities, entityRow, 'progress', Math.fround(nextProgress), tick);
  }
  return 'running';
}

/** A finished order: the building becomes active with its row's HP, `buildingCompleted` is emitted, Hub effects apply. */
function completeConstruction(state: PlanetState, order: ConstructionOrder, entityRow: number, tick: number, ctx?: Partial<StepContext>): void {
  const row = resolveBuildingRow(order.building, ctx?.data);
  setOrderStatus(order, 'completed');
  if (entityRow >= 0 && row) {
    const hp = Math.fround(rowNum(row, 'hp'));
    setField(state.entities, entityRow, 'state', ENTITY_STATE.active, tick);
    setField(state.entities, entityRow, 'progress', 1, tick);
    setField(state.entities, entityRow, 'hp', hp, tick);
    setField(state.entities, entityRow, 'hpMax', hp, tick);
  }
  const { colonyIdStr, who } = colonyWho(state, order.colonyId);
  ctx?.emit?.({
    kind: 'buildingCompleted',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: { ...who, entityId: order.entityId, building: order.building, kind: order.building, tier: order.tier, q: order.q, r: order.r },
  });
  if (isHubBuildingKind(order.building, ctx?.data)) applyHubCompletionEffects(state, order, tick, ctx);
}
