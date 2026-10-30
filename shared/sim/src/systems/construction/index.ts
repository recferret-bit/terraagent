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
import {
  cancelTerraformOrder,
  enqueueTerraformOrder,
  getManualTerraformLaneCount,
  type TerraformOrder,
} from '../terraform-basic/queue';
import { buildLinkedPrepJobs, computeSitePrepBill, type SitePrepBill } from './prep';
import {
  findAliveColonyHqRow,
  getBuildingFootprintTiles,
  getHubFootprintTiles,
  hasColonyHub,
  isHubBuildingKind,
  resolveHubT1Row,
  validateBuildingPlacement,
  validateHubPlacement,
  type FootprintTileInfo,
  type ValidateHubPlacementOpts,
  type ValidateHubPlacementResult,
} from './validate';

export {
  buildLinkedPrepJobs,
  computeSitePrepBill,
  findAliveColonyHqRow,
  getBuildingFootprintTiles,
  getHubFootprintTiles,
  getManualTerraformLaneCount,
  hasColonyHub,
  isHubBuildingKind,
  resolveHubT1Row,
  validateBuildingPlacement,
  validateHubPlacement,
  type FootprintTileInfo,
  type SitePrepBill,
  type ValidateHubPlacementOpts,
  type ValidateHubPlacementResult,
};

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
  buildTimeS: number;
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
  const buildingKind =
    typeof obj.building === 'string'
      ? obj.building
      : typeof obj.buildingKind === 'string'
        ? obj.buildingKind
        : typeof obj.kind === 'string'
          ? obj.kind
          : typeof obj.archetype === 'string'
            ? obj.archetype
            : undefined;
  const q = typeof obj.q === 'number' ? obj.q : undefined;
  const r = typeof obj.r === 'number' ? obj.r : undefined;
  const tier = typeof obj.tier === 'number' ? obj.tier : undefined;
  const builderEntityId =
    typeof obj.builderEntityId === 'number'
      ? obj.builderEntityId
      : typeof obj.entityId === 'number'
        ? obj.entityId
        : typeof obj.unitId === 'number'
          ? obj.unitId
          : undefined;
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

/**
 * Validates and places a Command Hub (or structure) at `(opts.q, opts.r)` for `opts.colonyId`.
 * Spawns the pending Hub entity (`ENTITY_STATE.waiting` if tiles are unprepared, else `ENTITY_STATE.constructing`)
 * and auto-enqueues one linked site prep `TerraformOrder` covering all missing sub-jobs (`UO-TF-03`, `W01-15`).
 */
export function placeBuildingOrder(
  state: PlanetState,
  opts: ValidateHubPlacementOpts & { orderId?: string; tick?: number },
  ctx?: Partial<StepContext>,
): PlaceHubResult {
  const data = opts.data ?? ctx?.data;
  const validation = validateBuildingPlacement(state, { ...opts, data });
  if (!validation.ok) {
    return { ok: false, reason: validation.reason ?? 'site_blocked', validation };
  }

  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const hubRow = resolveHubT1Row(data);
  const isHub = isHubBuildingKind(opts.buildingKind);
  const entityId = ctx?.newEntityId ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, entityId, tick);
  const cols = state.entities.cols;
  const hp = Math.fround(Number(hubRow.hp ?? 1500));

  cols.kind[row] = isHub ? ENTITY_KIND.hub : ENTITY_KIND.hub;
  cols.owner[row] = opts.colonyId;
  cols.tier[row] = opts.tier ?? Number(hubRow.tier ?? 1);
  cols.q[row] = opts.q;
  cols.r[row] = opts.r;
  cols.x[row] = Math.fround(opts.q);
  cols.y[row] = Math.fround(opts.r);
  cols.rot[row] = 0;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = validation.unpreparedCount > 0 ? ENTITY_STATE.waiting : ENTITY_STATE.constructing;
  cols.progress[row] = 0;
  cols.targetQ[row] = opts.q;
  cols.targetR[row] = opts.r;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  const totalTiles = validation.tiles.length;
  const preparedTiles = validation.preparedCount;
  const existing = readConstructionOrders(state);
  const orderId = opts.orderId ?? `build_${opts.colonyId}_${tick}_${existing.length + 1}`;
  const prepJobs = buildLinkedPrepJobs(state, validation.tiles, data);
  let prepOrder: TerraformOrder | undefined;
  if (prepJobs.length > 0) {
    const prepRes = enqueueTerraformOrder(state, {
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
    });
    prepOrder = prepRes.order;
  }

  const statusText = `waiting(site: ${preparedTiles}/${totalTiles})`;
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
    ...(validation.unpreparedCount > 0 ? { waitingReason: statusText } : {}),
    statusText,
    preparedCount: preparedTiles,
    preparedTiles,
    totalTiles,
    ...(prepOrder ? { linkedPrepOrderId: prepOrder.orderId, linkedOrderId: prepOrder.orderId } : {}),
    progress: 0,
    buildTimeS: Number(hubRow.designBuildS ?? hubRow.buildTimeS ?? 30),
    createdAtTick: tick,
  };
  writeConstructionOrders(state, [...existing, order], tick);

  return { ok: true, entityId, order, prepOrder, validation };
}

/**
 * Cancels a queued or active construction order for `colonyId`, cancels its linked site prep order,
 * and removes the pending building entity while preserving any tiles already prepared (`UO-TF-03`, `UO-Q-02`).
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
    targetIdx = all.findIndex((o) => o.colonyId === colonyId);
  } else {
    const key = String(idOrEntityId);
    targetIdx = all.findIndex(
      (o) =>
        o.colonyId === colonyId &&
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

  if (target.linkedPrepOrderId) {
    cancelTerraformOrder(state, colonyId, target.linkedPrepOrderId, tick, data);
  }
  cancelTerraformOrder(state, colonyId, target.orderId, tick, data);
  cancelTerraformOrder(state, colonyId, target.entityId, tick, data);

  removeRow(state.entities, target.entityId, tick);
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

/**
 * Steps building construction orders (`UO-TF-03`, `UO-Q-04`, `W01-15`):
 * recounts prepared footprint tiles (`waiting(site: n/m)`) and transitions the building entity
 * to `ENTITY_STATE.constructing` once all footprint tiles are `PREP.prepared` / `PREP.living`.
 */
export function stepConstruction(state: PlanetState, ctx?: Partial<StepContext>): void {
  const tick = ctx?.tick ?? state.meta.tick;
  const orders = readConstructionOrders(state);
  if (orders.length === 0) return;

  const hex = hexIndex(state.grid.radius);
  let changed = false;

  for (const order of orders) {
    if (order.status === 'completed' || order.status === 'cancelled') continue;
    const coords = getBuildingFootprintTiles(order.q, order.r, order.footprint);
    const totalTiles = coords.length;
    let preparedCount = 0;
    for (const pos of coords) {
      const tileIdx = hex.indexOf(pos.q, pos.r);
      if (tileIdx >= 0 && isBuildablePrepared(state.grid, tileIdx)) {
        preparedCount++;
      }
    }

    const statusText = `waiting(site: ${preparedCount}/${totalTiles})`;
    const nextStatus = preparedCount < totalTiles ? 'waiting_site' : 'in_progress';
    const nextWaitingReason = preparedCount < totalTiles ? statusText : undefined;

    if (
      order.preparedCount !== preparedCount ||
      order.preparedTiles !== preparedCount ||
      order.totalTiles !== totalTiles ||
      order.status !== nextStatus ||
      order.waitingReason !== nextWaitingReason ||
      order.statusText !== statusText
    ) {
      order.preparedCount = preparedCount;
      order.preparedTiles = preparedCount;
      order.totalTiles = totalTiles;
      order.status = nextStatus;
      order.statusText = statusText;
      if (nextWaitingReason !== undefined) {
        order.waitingReason = nextWaitingReason;
      } else {
        delete order.waitingReason;
      }
      changed = true;
    }

    const entityRow = rowOf(state.entities, order.entityId);
    if (entityRow >= 0) {
      const desiredState = preparedCount < totalTiles ? ENTITY_STATE.waiting : ENTITY_STATE.constructing;
      if (state.entities.cols.state[entityRow] !== desiredState) {
        setField(state.entities, entityRow, 'state', desiredState, tick);
      }
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
