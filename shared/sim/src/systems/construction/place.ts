import type { RejectCode } from '@terra/contracts';
import { recordAtlasColonyFounding, syncAtlasColonySectorState } from '../../atlas/sectorMetrics';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { bumpPathEpoch } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { rowNum } from '../rows';
import { enqueueTerraformOrder } from '../terraform-basic/queue';
import type { TerraformOrder } from '../terraform-basic/orders';
import { nextOrderId } from '../terraform-basic/orders';
import { revertFootprintLivingTiles } from '../terraform-basic/rules';
import { payConstructionCost, resolveHubBuildTimeS, resolveHubCost } from './build';
import { readConstructionOrders, setOrderStatus, writeConstructionOrders, type ConstructionOrder } from './orders';
import { resolveBuildingRow } from './placement';
import { buildLinkedPrepJobs } from './prep';
import { validateBuildingPlacement, type ValidateHubPlacementOpts, type ValidateHubPlacementResult } from './validate';

export interface PlaceHubResult {
  ok: boolean;
  reason?: RejectCode;
  entityId?: number;
  order?: ConstructionOrder;
  prepOrder?: TerraformOrder;
  validation: ValidateHubPlacementResult;
}

function spawnPendingBuildingRow(state: PlanetState, opts: ValidateHubPlacementOpts, entityId: number, hp: number, initialState: number, tick: number): number {
  const row = insertRow(state.entities, entityId, tick);
  bumpPathEpoch(state.meta); // a new footprint blocks ground movement (./occupancy.ts)
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.hub;
  cols.owner[row] = opts.colonyId;
  cols.tier[row] = opts.tier ?? 1;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, tick);
  cols.rot[row] = 0;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = initialState;
  cols.progress[row] = 0;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;
  return row;
}

/**
 * Validates and places a building at `(opts.q, opts.r)` for `opts.colonyId`: the pending entity, the construction
 * order (waiting for its site, else for resources, else in progress) and, when the footprint is not prepared, one
 * linked Grade order (`UO-TF-03`). An unaffordable building is accepted and waits for resources (GP-30, `UO-Q-01`).
 * `taskId` is the client's id for the order (its command id); the order id is made by the sim (GP-09).
 */
export function placeBuildingOrder(
  state: PlanetState,
  opts: ValidateHubPlacementOpts & { taskId?: string; tick?: number },
  ctx?: Partial<StepContext>,
): PlaceHubResult {
  const data = opts.data ?? ctx?.data;
  const validation = validateBuildingPlacement(state, { ...opts, data });
  const row = resolveBuildingRow(opts.buildingKind, data);
  if (!validation.ok || !row) return { ok: false, reason: validation.reason ?? 'invalid_args', validation };

  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const entityId = ctx?.newEntityId ? ctx.newEntityId() : state.meta.nextEntityId++;
  const hp = Math.fround(rowNum(row, 'hp'));
  revertFootprintLivingTiles(
    state,
    opts.colonyId,
    validation.tiles.map((t) => t.tileIdx),
    tick,
    ctx?.emit && ctx.flags?.has('W05') ? (ev) => ctx.emit!(ev) : undefined,
  );
  const needsPrep = validation.unpreparedCount > 0;
  const entityRow = spawnPendingBuildingRow(state, opts, entityId, hp, needsPrep ? ENTITY_STATE.waiting : ENTITY_STATE.constructing, tick);

  const orderId = nextOrderId(state, 'build#', tick);
  const prepJobs = buildLinkedPrepJobs(state, validation.tiles, data);
  const prepOrder =
    prepJobs.length > 0
      ? enqueueTerraformOrder(state, {
          colonyId: opts.colonyId,
          jobs: prepJobs,
          orderId: `${orderId}/prep`,
          linkedOrderId: orderId,
          linkedBuildingEntityId: entityId,
          isLinkedPrep: true,
          allowUnclaimed: row.allowUnclaimedPlacement === true,
          tick,
          data,
        }).order
      : undefined;

  const order: ConstructionOrder = {
    orderId,
    taskId: opts.taskId ?? orderId,
    colonyId: opts.colonyId,
    building: String(row.building),
    tier: opts.tier ?? 1,
    entityId,
    q: opts.q,
    r: opts.r,
    footprint: rowNum(row, 'footprint'),
    status: 'waiting_site',
    statusText: '',
    preparedCount: validation.preparedCount,
    totalTiles: validation.tiles.length,
    ...(prepOrder ? { linkedPrepOrderId: prepOrder.orderId } : {}),
    progress: 0,
    buildTimeS: resolveHubBuildTimeS(data),
    cost: resolveHubCost(data),
    costPaid: false,
    createdAtTick: tick,
  };
  if (needsPrep) setOrderStatus(order, 'waiting_site', `waiting(site: ${validation.preparedCount}/${validation.tiles.length})`);
  else {
    const pay = payConstructionCost(state, order);
    if (pay.ok) setOrderStatus(order, 'in_progress');
    else {
      setOrderStatus(order, 'waiting_resources', pay.waitingReason ?? 'waiting(resources)');
      state.entities.cols.state[entityRow] = ENTITY_STATE.waiting;
    }
  }
  writeConstructionOrders(state, [...readConstructionOrders(state), order], tick);
  recordAtlasColonyFounding(state, opts.colonyId, opts.q, opts.r, tick);
  syncAtlasColonySectorState(state, tick);
  return { ok: true, entityId, order, prepOrder, validation };
}
