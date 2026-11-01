import type { ResourceKey } from '@terra/contracts';
import { owedAt, ratioToBp, shareBp } from '@terra/ledger';
import type { CompiledRow } from '../../data';
import {
  colonyActor,
  findShortfall,
  getColonyStock,
  treasury,
  treasuryCtx,
  type Amounts,
  type TreasuryCtx,
} from '../../economy';
import { ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { defaultW01Data, resolveHqT1Row, syncHqView } from '../hq';
import { applyHubCompletionEffects } from '../territory-claim';
import type { ConstructionOrder } from './index';
import { isHubBuildingKind, resolveHubT1Row } from './placement';

export interface CostCheckResult {
  ok: boolean;
  missingKey?: string;
  have?: number;
  need?: number;
  waitingReason?: string;
}

/** Resolves the resource cost map for Command Hub T1 (`hub.t1.cost`: `200/100/50/50`). */
export function resolveHubCost(data?: CompiledDataLike): Record<string, number> {
  const hubRow = resolveHubT1Row(data);
  const raw = hubRow.cost as Record<string, number> | undefined;
  if (raw && typeof raw === 'object') {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && v > 0) out[k] = v;
    }
    if (Object.keys(out).length > 0) return out;
  }
  return {
    'metals.t1': 200,
    'minerals.t1': 100,
    'bio.biomass': 50,
    'bio.water': 50,
  };
}

/** Resolves the nominal 1.0x construction duration in seconds for Command Hub T1 (`30 s`). */
export function resolveHubBuildTimeS(data?: CompiledDataLike): number {
  const hubRow: CompiledRow = resolveHubT1Row(data);
  if (typeof hubRow.buildTimeS === 'number' && hubRow.buildTimeS !== 30) return hubRow.buildTimeS;
  if (typeof hubRow.designBuildS === 'number' && hubRow.designBuildS !== 30) return hubRow.designBuildS;
  if (typeof hubRow.buildS === 'number' && hubRow.buildS !== 150) {
    return hubRow.buildS * (TICK_MS / 1000);
  }
  return Number(hubRow.buildTimeS ?? hubRow.designBuildS ?? 30);
}

/** Share of the paid cost refunded when an in-progress build is cancelled, in basis points (`hub.t1.cancelRefundBp`). */
export function resolveHubCancelRefundBp(data?: CompiledDataLike): number {
  const hubRow = resolveHubT1Row(data);
  if (typeof hubRow.cancelRefundBp === 'number') return hubRow.cancelRefundBp;
  if (typeof hubRow.cancelRefundRatio === 'number') return ratioToBp(hubRow.cancelRefundRatio);
  return 7500;
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
 * Starts paying for a construction order (`UO-Q-01`, `W01-16`). The cost is NOT deducted up front: this is the start
 * gate (the full cost must be affordable; a colony only gets resources by landing, never here) and marks `order.costPaid = true` (payment started) with an empty `order.paidAmounts`. The cost is then spent gradually
 * by {@link spendConstructionSlice} in proportion to build progress.
 */
export function payConstructionCost(
  state: SimState,
  order: ConstructionOrder,
  data?: CompiledDataLike,
): CostCheckResult {
  if (order.costPaid) return { ok: true };
  const cost = order.cost ?? resolveHubCost(data);
  order.cost = { ...cost };

  const initialCheck = checkBuildingCost(state, order.colonyId, cost);
  if (!initialCheck.ok) return initialCheck;
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
  data: CompiledDataLike | undefined,
  ledger: TreasuryCtx,
): CostCheckResult {
  const cost = order.cost ?? resolveHubCost(data);
  const paid = (order.paidAmounts ??= {});
  const slice: Amounts = {};
  for (const [k, total] of Object.entries(cost)) {
    const amt = owedAt(total, targetProgress) - (paid[k] ?? 0);
    if (amt > 0) slice[k as ResourceKey] = amt;
  }
  const res = treasury(state, ledger).withdraw({
    colony: order.colonyId,
    amounts: slice,
    reason: 'construction.spend',
    actor: colonyActor(state, order.colonyId),
    ref: `order:${order.entityId}`,
  });
  if (!res.ok) return waitingFor(res.resource ?? res.code, res.have ?? 0, res.need ?? 0);
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
  if (!order.costPaid || !order.paidAmounts || order.status === 'completed') {
    return {};
  }
  const bp = resolveHubCancelRefundBp(data);
  const refund: Record<string, number> = {};
  for (const [k, paid] of Object.entries(order.paidAmounts)) {
    const share = shareBp(paid, bp);
    if (share > 0) refund[k] = share;
  }
  treasury(state, ledger).add({
    colony: order.colonyId,
    amounts: refund as Amounts,
    reason: 'construction.refund',
    actor: colonyActor(state, order.colonyId),
    ref: `order:${order.entityId}`,
  });
  return refund;
}

/**
 * Advances an in-progress construction order by one step of work from builder unit `hqSlot`, which the `build` unit
 * command has already walked into reach (`UO-L-05`, `W01-16`, `UO-Q-01`).
 */
export function advanceConstructionProgress(
  state: PlanetState,
  order: ConstructionOrder,
  entityRow: number,
  hqSlot: number,
  tick: number,
  ctx?: Partial<StepContext>,
): boolean {
  const data = ctx?.data;
  const dtTicks = ctx?.dt ?? 1;
  const dtS = (TICK_MS / 1000) * dtTicks;
  const cols = state.entities.cols;
  const hqRate =
    cols.workRate[hqSlot] > 0
      ? cols.workRate[hqSlot]
      : Number(resolveHqT1Row(data ?? defaultW01Data()).workRate || 1.5);
  const buildTimeS = order.buildTimeS > 0 ? order.buildTimeS : resolveHubBuildTimeS(data);
  const delta = buildTimeS > 0 ? (dtS * hqRate) / buildTimeS : 1;
  const rawProgress = Math.min(1, (order.progress ?? 0) + delta);
  // Snap float drift (0.9999999…) to 1 so the last slice settles the cost exactly and the order completes.
  const nextProgress = rawProgress >= 1 - 1e-6 ? 1 : rawProgress;

  const spend = spendConstructionSlice(state, order, nextProgress, data, treasuryCtx(tick, ctx));
  if (!spend.ok) {
    order.waitingReason = spend.waitingReason ?? 'waiting(resources)';
    order.statusText = order.waitingReason;
    setField(state.entities, hqSlot, 'state', ENTITY_STATE.idle, tick);
    syncHqView(state, hqSlot, tick, data);
    return true;
  }

  setField(state.entities, hqSlot, 'state', ENTITY_STATE.constructing, tick);
  setField(state.entities, hqSlot, 'targetQ', order.q, tick);
  setField(state.entities, hqSlot, 'targetR', order.r, tick);

  if (nextProgress >= 1 - 1e-6) {
    order.progress = 1;
    order.buildProgress = 1;
    order.status = 'completed';
    order.statusText = 'completed';
    delete order.waitingReason;

    if (entityRow >= 0) {
      const hubRow = resolveHubT1Row(data ?? defaultW01Data());
      const hp = Math.fround(Number(hubRow.hp ?? 1500));
      setField(state.entities, entityRow, 'state', ENTITY_STATE.active, tick);
      setField(state.entities, entityRow, 'progress', 1, tick);
      setField(state.entities, entityRow, 'hp', hp, tick);
      setField(state.entities, entityRow, 'hpMax', hp, tick);
    }

    setField(state.entities, hqSlot, 'state', ENTITY_STATE.idle, tick);
    setField(state.entities, hqSlot, 'progress', 0, tick);
    syncHqView(state, hqSlot, tick, data);

    const col = state.colonies[order.colonyId];
    const colonyIdStr = col?.id ?? `col_${order.colonyId}`;
    ctx?.emit?.({
      kind: 'buildingCompleted',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: {
        colonyId: colonyIdStr,
        entityId: order.entityId,
        building: order.building,
        tier: order.tier,
        q: order.q,
        r: order.r,
      },
    });
    if (isHubBuildingKind(order.building)) {
      applyHubCompletionEffects(state, order, tick, ctx);
    }
    return true;
  }

  order.progress = nextProgress;
  order.buildProgress = nextProgress;
  order.status = 'in_progress';
  delete order.waitingReason;
  order.statusText = 'in_progress';

  if (entityRow >= 0) {
    setField(state.entities, entityRow, 'state', ENTITY_STATE.constructing, tick);
    setField(state.entities, entityRow, 'progress', Math.fround(nextProgress), tick);
  }
  setField(state.entities, hqSlot, 'progress', Math.fround(nextProgress), tick);
  syncHqView(state, hqSlot, tick, data);
  return true;
}
