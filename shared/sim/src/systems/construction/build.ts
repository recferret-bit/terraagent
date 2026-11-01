import type { CompiledRow } from '../../data';
import { ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { defaultW01Data, resolveHqT1Row, syncHqView } from '../hq';
import { addColonyStock, getColonyStock, resolveStartingKitRow, setColonyStock } from '../landing';
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

/** Resolves the in-progress cancellation refund ratio (`0.75` = 75 % for `hub.t1`). */
export function resolveHubCancelRefundRatio(data?: CompiledDataLike): number {
  const hubRow = resolveHubT1Row(data);
  if (typeof hubRow.cancelRefundRatio === 'number') return hubRow.cancelRefundRatio;
  if (typeof hubRow.cancelRefundBp === 'number') return hubRow.cancelRefundBp / 10000;
  return 0.75;
}

/** Checks whether `colonyId` currently has enough stock to pay `cost` (`UO-Q-01`, `UO-Q-03`). */
export function checkBuildingCost(
  state: SimState,
  colonyId: number,
  cost: Record<string, number>,
): CostCheckResult {
  const stock = getColonyStock(state, colonyId);
  for (const [key, need] of Object.entries(cost)) {
    if (typeof need !== 'number' || need <= 0) continue;
    const have = stock[key] ?? 0;
    if (have + 1e-6 < need) {
      const waitingReason = `waiting(resources: ${key} ${Math.floor(have)}/${need})`;
      return { ok: false, missingKey: key, have, need, waitingReason };
    }
  }
  return { ok: true };
}

function hasExplicitColonyStock(state: SimState, colonyId: number): boolean {
  const col = state.colonies[colonyId];
  return Boolean(col && col.resources !== undefined);
}

function seedDefaultStartingStock(state: SimState, colonyId: number, data?: CompiledDataLike): void {
  const kit = resolveStartingKitRow(data ?? defaultW01Data());
  const rawCargo = (kit.cargo ?? {
    'metals.t1': 600,
    'minerals.t1': 350,
    'bio.biomass': 200,
    'bio.water': 200,
  }) as Record<string, number>;
  const initialStock: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawCargo)) {
    if (typeof v === 'number' && v > 0) initialStock[k] = v;
  }
  setColonyStock(state, colonyId, initialStock);
}

/**
 * Starts paying for a construction order (`UO-Q-01`, `W01-16`). The cost is NOT deducted up front: this is the start
 * gate (full cost must be affordable, or the colony has no explicit stock yet and is seeded with the starting kit) and
 * marks `order.costPaid = true` (payment started) with an empty `order.paidAmounts`. The cost is then spent gradually
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
  if (!initialCheck.ok) {
    if (hasExplicitColonyStock(state, order.colonyId)) return initialCheck;
    const currentStock = getColonyStock(state, order.colonyId);
    if (!Object.values(currentStock).some((v) => typeof v === 'number' && v > 0)) {
      seedDefaultStartingStock(state, order.colonyId, data);
    }
  }
  order.costPaid = true;
  order.paidAmounts = {};
  return { ok: true };
}

/**
 * Spends the part of `order.cost` that corresponds to build progress `targetProgress` (cumulative, 0..1) and has not
 * been paid yet. All-or-nothing per slice: when the colony lacks any resource the build pauses (returns the
 * `waiting(resources: …)` reason) and nothing is deducted. At `1.0` the paid total equals the cost exactly.
 */
export function spendConstructionSlice(
  state: SimState,
  order: ConstructionOrder,
  targetProgress: number,
  data?: CompiledDataLike,
): CostCheckResult {
  const cost = order.cost ?? resolveHubCost(data);
  const paid = (order.paidAmounts ??= {});
  const stock = getColonyStock(state, order.colonyId);
  const slice: Record<string, number> = {};
  for (const [k, total] of Object.entries(cost)) {
    // Whole units only: float slices would leave stock at e.g. 250.00000000000006 after the build.
    const owed = targetProgress >= 1 - 1e-9 ? total : Math.floor(total * targetProgress);
    const amt = Math.max(0, owed - (paid[k] ?? 0));
    if (amt <= 0) continue;
    const have = stock[k] ?? 0;
    if (have + 1e-6 < amt) {
      return { ok: false, missingKey: k, have, need: amt, waitingReason: `waiting(resources: ${k} ${Math.floor(have)}/${Math.ceil(amt)})` };
    }
    slice[k] = amt;
  }
  const deduction: Record<string, number> = {};
  for (const [k, amt] of Object.entries(slice)) {
    deduction[k] = -amt;
    paid[k] = (paid[k] ?? 0) + amt;
  }
  if (Object.keys(deduction).length > 0) addColonyStock(state, order.colonyId, deduction, false);
  return { ok: true };
}

/**
 * Refunds `75 %` (`cancelRefundRatio`) of `order.paidAmounts` when an in-progress construction order is cancelled
 * (`UO-Q-02`, `W01-16`). Returns the refunded resource map (empty if nothing was paid).
 */
export function refundCancelledConstruction(
  state: SimState,
  order: ConstructionOrder,
  data?: CompiledDataLike,
): Record<string, number> {
  if (!order.costPaid || !order.paidAmounts || order.status === 'completed') {
    return {};
  }
  const ratio = resolveHubCancelRefundRatio(data);
  const refund: Record<string, number> = {};
  for (const [k, paid] of Object.entries(order.paidAmounts)) {
    if (typeof paid === 'number' && paid > 0) {
      refund[k] = paid * ratio;
    }
  }
  if (Object.keys(refund).length > 0) {
    addColonyStock(state, order.colonyId, refund, false);
  }
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
  const nextProgress = Math.min(1, (order.progress ?? 0) + delta);

  const spend = spendConstructionSlice(state, order, nextProgress, data);
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
