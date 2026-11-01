import type { RejectCode } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow, removeRow, rowOf, setField } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { isBuildablePrepared } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState, type SimState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { syncHqView } from '../hq';
import {
  cancelTerraformOrder,
  enqueueTerraformOrder,
  findColonyHqSlot,
  getManualTerraformLaneCount,
  type TerraformOrder,
} from '../terraform-basic/queue';
import {
  advanceConstructionProgress,
  payConstructionCost,
  refundCancelledConstruction,
  resolveHubBuildTimeS,
  resolveHubCost,
} from './build';
import { buildLinkedPrepJobs } from './prep';
import {
  checkBuildingAffordability,
  getBuildingFootprintTiles,
  isHubBuildingKind,
  resolveHubT1Row,
  validateBuildingPlacement,
  type ValidateHubPlacementOpts,
  type ValidateHubPlacementResult,
} from './validate';

export { getManualTerraformLaneCount };
export * from './build';
export * from './prep';
export * from './validate';

export interface ConstructionOrder {
  orderId: string;
  colonyId: number;
  building: string;
  tier: number;
  entityId: number;
  q: number;
  r: number;
  footprint: number;
  status: 'waiting_site' | 'waiting_resources' | 'in_progress' | 'completed' | 'cancelled';
  waitingReason?: string;
  statusText: string;
  preparedCount: number;
  preparedTiles: number;
  totalTiles: number;
  linkedPrepOrderId?: string;
  linkedOrderId?: string;
  progress: number;
  buildProgress?: number;
  buildTimeS: number;
  cost?: Record<string, number>;
  costPaid?: boolean;
  paidAmounts?: Record<string, number>;
  createdAtTick: number;
}

export interface PlaceBuildingArgs {
  building?: string;
  buildingKind?: string;
  kind?: string;
  archetype?: string;
  q?: number;
  r?: number;
  tier?: number;
  builderEntityId?: number;
  entityId?: number;
  unitId?: number;
}

function parsePlaceBuildingArgs(raw: unknown): {
  buildingKind?: string;
  q?: number;
  r?: number;
  tier?: number;
  builderEntityId?: number;
} {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as PlaceBuildingArgs;
  const buildingKind = [obj.building, obj.buildingKind, obj.kind, obj.archetype].find((v) => typeof v === 'string');
  const q = typeof obj.q === 'number' ? obj.q : undefined;
  const r = typeof obj.r === 'number' ? obj.r : undefined;
  const tier = typeof obj.tier === 'number' ? obj.tier : undefined;
  const builderEntityId = [obj.builderEntityId, obj.entityId, obj.unitId].find((v) => typeof v === 'number');
  return { buildingKind, q, r, tier, builderEntityId };
}

function readConstructionOrders(state: SimState): ConstructionOrder[] {
  const raw = state.blobs.constructionQueue?.value ?? state.blobs.constructionQueue;
  if (Array.isArray(raw)) return (raw as ConstructionOrder[]).map((o) => ({ ...o }));
  if (raw && typeof raw === 'object' && Array.isArray((raw as { orders?: unknown }).orders)) {
    return (raw as { orders: ConstructionOrder[] }).orders.map((o) => ({ ...o }));
  }
  return [];
}

function writeConstructionOrders(state: SimState, orders: ConstructionOrder[], tick: number): void {
  const byColony: Record<number, ConstructionOrder[]> = {};
  for (const o of orders) {
    const list = byColony[o.colonyId] ?? (byColony[o.colonyId] = []);
    list.push(o);
  }
  setBlob(state, 'constructionQueue', { orders, byColony }, tick);
}

/** Returns all queued/active construction orders for `colonyId` (or all colonies when omitted). */
export function getConstructionOrders(state: SimState, colonyId?: number): ConstructionOrder[] {
  const all = readConstructionOrders(state);
  return colonyId === undefined ? all : all.filter((o) => o.colonyId === colonyId);
}

export interface PlaceHubResult {
  ok: boolean;
  reason?: RejectCode;
  entityId?: number;
  order?: ConstructionOrder;
  prepOrder?: TerraformOrder;
  validation: ValidateHubPlacementResult;
}

function shouldRejectInsufficientOnPlace(
  state: PlanetState,
  colonyId: number,
  cost: Record<string, number> | undefined,
  unpreparedCount: number,
  forceCheck?: boolean,
): boolean {
  const colStock =
    state.colonies[colonyId]?.stock ??
    (state.blobs.colonyStock?.value as Record<number | string, Record<string, number>> | undefined)?.[colonyId];
  if (colStock === undefined && !forceCheck) return false;
  if (!cost) return false;
  const afford = checkBuildingAffordability(cost, colStock as Record<string, number> | undefined);
  if (afford.ok) return false;
  if (forceCheck) return true;
  return unpreparedCount > 0 && ((colStock as Record<string, number>)['metals.t1'] ?? 0) === 0;
}

function spawnPendingHubRow(
  state: PlanetState,
  opts: ValidateHubPlacementOpts,
  entityId: number,
  hp: number,
  initialState: number,
  tick: number,
): number {
  const row = insertRow(state.entities, entityId, tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.hub;
  cols.owner[row] = opts.colonyId;
  cols.tier[row] = opts.tier ?? 1;
  cols.q[row] = opts.q;
  cols.r[row] = opts.r;
  cols.x[row] = Math.fround(opts.q);
  cols.y[row] = Math.fround(opts.r);
  cols.rot[row] = 0;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = initialState;
  cols.progress[row] = 0;
  cols.targetQ[row] = opts.q;
  cols.targetR[row] = opts.r;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;
  return row;
}

/** Validates and places a Command Hub (or structure) at `(opts.q, opts.r)` for `opts.colonyId`. */
export function placeBuildingOrder(
  state: PlanetState,
  opts: ValidateHubPlacementOpts & { orderId?: string; tick?: number },
  ctx?: Partial<StepContext>,
): PlaceHubResult {
  const data = opts.data ?? ctx?.data;
  const validation = validateBuildingPlacement(state, { ...opts, data });
  if (!validation.ok) return { ok: false, reason: validation.reason ?? 'site_blocked', validation };

  const hubRow = resolveHubT1Row(data);
  if (
    shouldRejectInsufficientOnPlace(
      state,
      opts.colonyId,
      hubRow.cost as Record<string, number> | undefined,
      validation.unpreparedCount,
      opts.checkResources,
    )
  ) {
    return {
      ok: false,
      reason: 'insufficient_resources',
      validation: { ...validation, ok: false, reason: 'insufficient_resources' },
    };
  }
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const isHub = isHubBuildingKind(opts.buildingKind);
  const entityId = ctx?.newEntityId ? ctx.newEntityId() : state.meta.nextEntityId++;
  const hp = Math.fround(Number(hubRow.hp ?? 1500));
  const initState = validation.unpreparedCount > 0 ? ENTITY_STATE.waiting : ENTITY_STATE.constructing;
  const row = spawnPendingHubRow(state, opts, entityId, hp, initState, tick);

  const totalTiles = validation.tiles.length;
  const preparedTiles = validation.preparedCount;
  const existing = readConstructionOrders(state);
  const orderId = opts.orderId ?? `build_${opts.colonyId}_${tick}_${existing.length + 1}`;
  const prepJobs = buildLinkedPrepJobs(state, validation.tiles, data);
  const prepOrder =
    prepJobs.length > 0
      ? enqueueTerraformOrder(state, {
          colonyId: opts.colonyId,
          jobs: prepJobs,
          orderId: `${orderId}_prep`,
          linkedOrderId: orderId,
          linkedBuildingId: entityId,
          linkedBuildingEntityId: entityId,
          isLinkedPrep: true,
          countsTowardLaneLimit: false,
          allowUnclaimed: isHub,
          tick,
          data,
        }).order
      : undefined;

  const siteStatusText = `waiting(site: ${preparedTiles}/${totalTiles})`;
  const order: ConstructionOrder = {
    orderId,
    colonyId: opts.colonyId,
    building: opts.buildingKind ?? 'commandHub',
    tier: opts.tier ?? 1,
    entityId,
    q: opts.q,
    r: opts.r,
    footprint: isHub ? 3 : 1,
    status: validation.unpreparedCount > 0 ? 'waiting_site' : 'in_progress',
    ...(validation.unpreparedCount > 0 ? { waitingReason: siteStatusText } : {}),
    statusText: siteStatusText,
    preparedCount: preparedTiles,
    preparedTiles,
    totalTiles,
    ...(prepOrder ? { linkedPrepOrderId: prepOrder.orderId, linkedOrderId: prepOrder.orderId } : {}),
    progress: 0,
    buildProgress: 0,
    buildTimeS: resolveHubBuildTimeS(data),
    cost: resolveHubCost(data),
    costPaid: false,
    createdAtTick: tick,
  };

  if (validation.unpreparedCount === 0) {
    const payRes = payConstructionCost(state, order, data);
    if (!payRes.ok) {
      order.status = 'waiting_resources';
      order.waitingReason = payRes.waitingReason ?? 'waiting(resources)';
      order.statusText = order.waitingReason;
      state.entities.cols.state[row] = ENTITY_STATE.waiting;
    }
  }

  writeConstructionOrders(state, [...existing, order], tick);
  return { ok: true, entityId, order, prepOrder, validation };
}

/**
 * Cancels a queued or active construction order for `colonyId`, refunds 75 % of the paid cost when in progress,
 * cancels its linked site prep order, and removes the pending building entity while preserving any tiles already prepared
 * (`UO-TF-03`, `UO-Q-02`, `W01-16`).
 */
export function cancelConstructionOrder(
  state: SimState,
  colonyId: number,
  idOrEntityId?: string | number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): boolean {
  const all = readConstructionOrders(state);
  let targetIdx: number;
  if (
    idOrEntityId === undefined ||
    idOrEntityId === '' ||
    idOrEntityId === 'current' ||
    idOrEntityId === 'active'
  ) {
    targetIdx = all.findIndex(
      (o) => o.colonyId === colonyId && o.status !== 'completed' && o.status !== 'cancelled',
    );
  } else {
    const key = String(idOrEntityId);
    targetIdx = all.findIndex(
      (o) =>
        o.colonyId === colonyId &&
        o.status !== 'completed' &&
        o.status !== 'cancelled' &&
        (o.orderId === key ||
          String(o.entityId) === key ||
          o.linkedPrepOrderId === key ||
          o.linkedOrderId === key ||
          o.building === key),
    );
  }
  if (targetIdx < 0) return false;

  const target = all[targetIdx];
  all.splice(targetIdx, 1);
  writeConstructionOrders(state, all, tick);

  if (target.costPaid && target.status !== 'completed') {
    refundCancelledConstruction(state, target, data);
  }

  if (target.linkedPrepOrderId) {
    cancelTerraformOrder(state, colonyId, target.linkedPrepOrderId, tick, data);
  }
  cancelTerraformOrder(state, colonyId, target.orderId, tick, data);
  cancelTerraformOrder(state, colonyId, target.entityId, tick, data);

  removeRow(state.entities, target.entityId, tick);

  const hqSlot = findColonyHqSlot(state, colonyId);
  if (hqSlot >= 0) {
    if (state.entities.cols.state[hqSlot] === ENTITY_STATE.constructing) {
      setField(state.entities, hqSlot, 'state', ENTITY_STATE.idle, tick);
    }
    setField(state.entities, hqSlot, 'progress', 0, tick);
    syncHqView(state, hqSlot, tick, data);
  }
  return true;
}

export const placeBuilding = defineCommandHandler({
  kind: 'placeBuilding',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const colonyId = cmd.colonyIndex ?? (cmd as { colony?: number }).colony ?? 0;
    const parsed = parsePlaceBuildingArgs(cmd.args);
    if (typeof parsed.q !== 'number' || typeof parsed.r !== 'number') {
      return 'invalid_args';
    }
    const res = placeBuildingOrder(
      state,
      {
        colonyId,
        q: parsed.q,
        r: parsed.r,
        buildingKind: parsed.buildingKind ?? 'commandHub',
        tier: parsed.tier,
        builderEntityId: parsed.builderEntityId,
        orderId: cmd.commandId,
        tick: ctx.tick,
        data: ctx.data,
      },
      ctx,
    );
    if (!res.ok) return res.reason ?? 'site_blocked';
  },
});

function countPreparedFootprintTiles(state: PlanetState, order: ConstructionOrder): {
  preparedCount: number;
  totalTiles: number;
} {
  const hex = hexIndex(state.grid.radius);
  const coords = getBuildingFootprintTiles(order.q, order.r, order.footprint);
  let preparedCount = 0;
  for (const pos of coords) {
    const tileIdx = hex.indexOf(pos.q, pos.r);
    if (tileIdx >= 0 && isBuildablePrepared(state.grid, tileIdx)) {
      preparedCount++;
    }
  }
  return { preparedCount, totalTiles: coords.length };
}

/**
 * Steps building construction orders (`UO-TF-03`, `UO-Q-01/02/04`, `UO-L-05`, `W01-15`, `W01-16`):
 * recounts prepared footprint tiles (`waiting(site: n/m)`), pays the construction cost on start once all
 * footprint tiles are `PREP.prepared` / `PREP.living`, advances construction progress by `(dtS * sumRate) / buildTimeS`,
 * and emits `buildingCompleted` when progress reaches `1.0`.
 */
export function stepConstruction(state: PlanetState, ctx?: Partial<StepContext>): void {
  const tick = ctx?.tick ?? state.meta.tick;
  const orders = readConstructionOrders(state);
  if (orders.length === 0) return;

  let changed = false;

  for (const order of orders) {
    if (order.status === 'completed' || order.status === 'cancelled') continue;
    const { preparedCount, totalTiles } = countPreparedFootprintTiles(state, order);
    const entityRow = rowOf(state.entities, order.entityId);

    if (preparedCount < totalTiles) {
      const siteText = `waiting(site: ${preparedCount}/${totalTiles})`;
      if (
        order.preparedCount !== preparedCount ||
        order.preparedTiles !== preparedCount ||
        order.totalTiles !== totalTiles ||
        order.status !== 'waiting_site' ||
        order.waitingReason !== siteText ||
        order.statusText !== siteText
      ) {
        order.preparedCount = preparedCount;
        order.preparedTiles = preparedCount;
        order.totalTiles = totalTiles;
        order.status = 'waiting_site';
        order.waitingReason = siteText;
        order.statusText = siteText;
        changed = true;
      }
      if (entityRow >= 0 && state.entities.cols.state[entityRow] !== ENTITY_STATE.waiting) {
        setField(state.entities, entityRow, 'state', ENTITY_STATE.waiting, tick);
      }
      continue;
    }

    const justFinishedSitePrep = order.preparedCount < totalTiles;
    if (
      order.preparedCount !== preparedCount ||
      order.preparedTiles !== preparedCount ||
      order.totalTiles !== totalTiles
    ) {
      order.preparedCount = preparedCount;
      order.preparedTiles = preparedCount;
      order.totalTiles = totalTiles;
      changed = true;
    }

    if (!order.costPaid) {
      const payRes = payConstructionCost(state, order, ctx?.data);
      changed = true;
      if (!payRes.ok) {
        const waitReason = payRes.waitingReason ?? 'waiting(resources)';
        order.status = 'waiting_resources';
        order.waitingReason = waitReason;
        order.statusText = waitReason;
        if (entityRow >= 0 && state.entities.cols.state[entityRow] !== ENTITY_STATE.waiting) {
          setField(state.entities, entityRow, 'state', ENTITY_STATE.waiting, tick);
        }
        continue;
      }
    }

    if (order.status !== 'in_progress') {
      order.status = 'in_progress';
      delete order.waitingReason;
      changed = true;
    }

    if (justFinishedSitePrep) {
      order.statusText = `waiting(site: ${preparedCount}/${totalTiles})`;
      if (entityRow >= 0 && state.entities.cols.state[entityRow] !== ENTITY_STATE.constructing) {
        setField(state.entities, entityRow, 'state', ENTITY_STATE.constructing, tick);
      }
      changed = true;
      continue;
    }

    if (advanceConstructionProgress(state, order, entityRow, tick, ctx)) {
      changed = true;
    }
  }

  if (changed) {
    writeConstructionOrders(state, orders, tick);
  }
}

export const construction = defineSystem({
  id: 'construction',
  slot: 12,
  wave: 'W01',
  run(state, ctx) {
    stepConstruction(state, ctx);
  },
});

export default defineSimModule({
  id: 'construction',
  wave: 'W01',
  systems: [construction],
  handlers: [placeBuilding],
});
