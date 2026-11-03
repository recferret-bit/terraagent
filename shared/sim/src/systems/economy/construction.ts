import type { ResourceKey } from '@terra/contracts';
import { CANCEL_REFUND_RATE, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, removeRow, rowOf, setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { bumpPathEpoch, setTilePrep } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { touchTile, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { requestMove } from '../../units/movement/orchestrator';
import { buildingFootprints } from '../construction/occupancy';
import { resolvePlacementRule } from '../construction/placement';
import { buildLinkedPrepJobs } from '../construction/prep';
import { enqueueTerraformOrder, removeTerraformOrder } from '../terraform-basic/queue';
import { buildingKindName, ensureColony, getFootprintTileIndices, resolveBuildingRow } from './buildingRows';
import { buildJobKey, getBuildingJobs, saveBuildingJobs, stepBuildingSites, type BuildingJobRecord } from './buildJob';
import { checkCostAffordability, debitCost, refundCost, syncColonyDepotCaps } from './ledger';
import { buildingSiteBlock } from './siteTerrain';
import { claimTerritoryRadius } from '../territory-claim';

export { buildingKindName, getBuildingJobs, getFootprintTileIndices, resolveBuildingRow, type BuildingJobRecord };

/** Whether building `entityId` is being dismantled (an open dismantle work job, `terraform-basic/dismantleJob.ts`). */
function isBeingDismantled(state: PlanetState, entityId: number): boolean {
  const byId = (state.blobs.workJobs?.value as { byId?: Record<string, { mode?: string; targetEntityId?: number; helpOf?: string }> } | undefined)?.byId ?? {};
  return Object.values(byId).some((j) => j.mode === 'dismantle' && j.targetEntityId === entityId && j.helpOf === undefined);
}

export interface StartConstructionOptions {
  owner: number;
  building: string;
  q: number;
  r: number;
  rot?: number;
  workRate?: number;
  workerEntityId?: number;
  instant?: boolean;
  tick?: number;
  data?: CompiledDataLike;
  costOverride?: Partial<Record<ResourceKey, number>>;
}

function resolveBuilderWorkRate(state: PlanetState, owner: number, workerEntityId?: number, explicitRate?: number): { ok: true; workRate: number } | { ok: false; code: string } {
  const e = state.entities, cols = e.cols;
  if (workerEntityId !== undefined) {
    const wRow = rowOf(e, workerEntityId);
    if (wRow < 0) return { ok: false, code: 'unknown_entity' };
    if (cols.kind[wRow] === ENTITY_KIND.harvester) return { ok: false, code: 'tier_locked' }; // Harvester maxBuildTier = 0
    return { ok: true, workRate: cols.workRate[wRow] > 0 ? cols.workRate[wRow] : 1.5 };
  }
  if (explicitRate !== undefined && explicitRate > 0) return { ok: true, workRate: explicitRate };
  for (let r = 0; r < e.count; r++) {
    if (cols.owner[r] === owner && cols.kind[r] === ENTITY_KIND.hq && cols.hp[r] > 0) {
      return { ok: true, workRate: cols.workRate[r] > 0 ? cols.workRate[r] : 1.5 };
    }
  }
  return { ok: true, workRate: 1.5 }; // Default HQ T1 workRate = 1.5x
}

/** The W02 Hub path claims territory through the one W01 rule (`claimTerritoryRadius`: owner + anchor count, frozen foreign borders). */
function claimHubTerritory(state: PlanetState, owner: number, centerQ: number, centerR: number, radius: number, tick: number): void {
  claimTerritoryRadius(state, { colonyId: owner, q: centerQ, r: centerR, radius, tick });
}

function findNearestExitTile(
  state: PlanetState,
  fromQ: number,
  fromR: number,
  blockedSet: ReadonlySet<number>,
): { q: number; r: number } | null {
  const idx = hexIndex(state.grid.radius);
  const { terrain, prep } = state.grid.layers;
  let best: { q: number; r: number; dist: number } | null = null;
  for (let dr = -4; dr <= 4; dr++) {
    for (let dq = -4; dq <= 4; dq++) {
      const dist = hexDistance(0, 0, dq, dr);
      if (dist === 0 || dist > 4) continue;
      const nq = fromQ + dq, nr = fromR + dr;
      const nIdx = idx.indexOf(nq, nr);
      if (nIdx < 0 || blockedSet.has(nIdx)) continue;
      const t = terrain[nIdx], p = prep[nIdx];
      if (t === TERRAIN.deep || t === TERRAIN.shallow || t === TERRAIN.hole || p === PREP.ridge || p === PREP.moat) continue;
      if (!best || dist < best.dist) best = { q: nq, r: nr, dist };
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

function evacuateUnitsFromFootprint(
  state: PlanetState,
  fpIndices: readonly number[],
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): void {
  const fpSet = new Set(fpIndices);
  const allBlocked = new Set<number>(fpIndices);
  for (const bFp of buildingFootprints(state, data)) {
    for (const i of bFp) allBlocked.add(i);
  }
  const idx = hexIndex(state.grid.radius);
  const e = state.entities, cols = e.cols;
  for (let uRow = 0; uRow < e.count; uRow++) {
    const k = cols.kind[uRow];
    if ((k !== ENTITY_KIND.hq && k !== ENTITY_KIND.harvester && k !== ENTITY_KIND.builder) || cols.hp[uRow] <= 0) continue;
    const uIdx = idx.indexOf(cols.q[uRow], cols.r[uRow]);
    if (!fpSet.has(uIdx)) continue;
    const exit = findNearestExitTile(state, cols.q[uRow], cols.r[uRow], allBlocked);
    if (!exit) continue;
    setField(e, uRow, 'targetQ', exit.q, tick);
    setField(e, uRow, 'targetR', exit.r, tick);
    setField(e, uRow, 'state', ENTITY_STATE.moving, tick);
    if (ctx) requestMove(state, uRow, { q: exit.q, r: exit.r, minDist: 0, maxDist: 0 }, ctx);
  }
}

function validateFootprintAndCost(
  state: PlanetState,
  colony: ColonyState,
  row: CompiledRow,
  q: number,
  r: number,
  fpIndices: readonly number[],
  cost: Partial<Record<ResourceKey, number>>,
  workRate: number,
  buildTicks: number,
  instant: boolean,
  tick: number,
  data?: CompiledDataLike,
): { ok: true } | { ok: false; code: string; detail?: string } {
  const site = buildingSiteBlock(state, { owner: colony.index, building: String(row.building ?? ''), q, r }, fpIndices, data);
  if (site) return { ok: false, ...site };

  const stock = colony.stock as Record<string, number>;
  const totalStock = Object.values(stock).reduce((a, b) => a + b, 0);
  if (totalStock > 0) {
    const afford = checkCostAffordability(colony, cost);
    if (Object.keys(afford.exceedsCap).length > 0) return { ok: false, code: 'storage_cap' };
    if (instant) {
      if (!afford.ok) return { ok: false, code: 'insufficient_resources' };
      debitCost(colony, cost, tick);
    } else {
      const firstSlice = Math.min(1, workRate / buildTicks);
      for (const [k, v] of Object.entries(cost) as [ResourceKey, number][]) {
        if (v > 0 && (stock[k] ?? 0) + 1e-6 < v * firstSlice) return { ok: false, code: 'insufficient_resources' };
      }
    }
  }
  return { ok: true };
}

/** The building's entity, `constructing` (or `active` when `instant`) with the row's stats. */
function spawnBuildingRow(state: PlanetState, entityId: number, entityKind: number, row: CompiledRow, opts: StartConstructionOptions, tick: number): void {
  const eRow = insertRow(state.entities, entityId, tick);
  bumpPathEpoch(state.meta);
  const cols = state.entities.cols;
  cols.kind[eRow] = entityKind;
  cols.owner[eRow] = opts.owner;
  cols.tier[eRow] = Number(row.tier ?? 1);
  placeSpawnedEntity(state.entities, eRow, opts.q, opts.r, tick);
  cols.rot[eRow] = opts.rot ?? 0;
  cols.footprintW[eRow] = Number(row.footprintW ?? row.footprint ?? 2);
  cols.footprintD[eRow] = Number(row.footprintD ?? row.footprint ?? 2);
  cols.shedGroup[eRow] = Number(row.shedGroup ?? 4);
  cols.hp[eRow] = Math.fround(Number(row.hp ?? 500));
  cols.hpMax[eRow] = Math.fround(Number(row.hp ?? 500));
  cols.state[eRow] = opts.instant ? ENTITY_STATE.active : ENTITY_STATE.constructing;
  cols.progress[eRow] = opts.instant ? 1 : 0;
  cols.createdAt[eRow] = tick;
  cols.changedAt[eRow] = tick;
}

/**
 * The linked site prep of a new building job (`UO-TF-03`, the W01 mechanism): one Grade order over the footprint tiles
 * that are not prepared yet, worked by a terraform-capable builder before it builds. Returns its order id, if any.
 */
function enqueueLinkedPrep(state: PlanetState, entityId: number, building: string, coords: ReadonlyArray<{ q: number; r: number }>, owner: number, tick: number, data?: CompiledDataLike): string | undefined {
  const jobs = buildLinkedPrepJobs(state, coords, data);
  if (jobs.length === 0) return undefined;
  const res = enqueueTerraformOrder(state, {
    colonyId: owner,
    jobs,
    orderId: `${buildJobKey(entityId)}/prep`,
    linkedOrderId: `building:${entityId}`, // `cancelTask` of the prep cancels the building (queue path)
    linkedBuildingEntityId: entityId,
    isLinkedPrep: true,
    allowUnclaimed: resolvePlacementRule(building, data)?.allowUnclaimed ?? true,
    tick,
    data,
  });
  return res.order?.orderId;
}

/**
 * Validates and starts (or completes if `instant`) a T1 building construction. An `instant` building (scenario setup)
 * has its footprint prepared and its cost debited at once. Otherwise it is a building job (`./buildJob.ts`): the
 * footprint gets linked prep, and a builder on site builds it and pays it progressively.
 */
export function startBuildingConstruction(
  state: PlanetState,
  opts: StartConstructionOptions,
  ctx?: StepContext,
): { ok: true; entityId: number; buildTicks: number; effectiveTicks: number } | { ok: false; code: string; detail?: string } {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const resolved = resolveBuildingRow(opts.building, data);
  if (!resolved) return { ok: false, code: 'invalid_args', detail: `unknown building ${opts.building}` };
  const { row, entityKind } = resolved;

  const workerCheck = resolveBuilderWorkRate(state, opts.owner, opts.workerEntityId, opts.workRate);
  if (!workerCheck.ok) return workerCheck;

  const w = Number(row.footprintW ?? row.footprint ?? 2);
  const d = Number(row.footprintD ?? row.footprint ?? 2);
  const fp = getFootprintTileIndices(state, opts.q, opts.r, w, d, opts.rot ?? 0);
  if (!fp.valid) return { ok: false, code: 'invalid_args', detail: 'footprint out of bounds' };

  const buildTicks = Math.max(1, Number(row.buildS ?? 50));
  const effectiveTicks = Math.round(buildTicks / workerCheck.workRate);
  const colony = ensureColony(state, opts.owner, tick);
  const cost = (opts.costOverride ?? row.cost ?? {}) as Partial<Record<ResourceKey, number>>;
  const check = validateFootprintAndCost(state, colony, row, opts.q, opts.r, fp.indices, cost, workerCheck.workRate, buildTicks, Boolean(opts.instant), tick, data);
  if (!check.ok) return check;

  const entityId = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  if (opts.instant) {
    for (const tileIdx of fp.indices) {
      if (state.grid.layers.height && Math.abs(state.grid.layers.height[tileIdx]) > 0.15) state.grid.layers.height[tileIdx] = 0.08;
      setTilePrep(state, tileIdx, PREP.prepared, tick);
      touchTile(state, tileIdx, tick);
    }
  }
  spawnBuildingRow(state, entityId, entityKind, row, opts, tick);
  evacuateUnitsFromFootprint(state, fp.indices, tick, data, ctx);

  if (!opts.instant) {
    const building = String(row.building ?? opts.building);
    const prepOrderId = enqueueLinkedPrep(state, entityId, building, fp.coords, opts.owner, tick, data);
    const jobs = getBuildingJobs(state);
    jobs[entityId] = {
      entityId, building, owner: opts.owner,
      q: opts.q, r: opts.r, rot: opts.rot ?? 0, footprintW: w, footprintD: d,
      buildTicks, elapsedWeightedTicks: 0, workRate: workerCheck.workRate,
      workerEntityId: opts.workerEntityId,
      cost: { ...cost }, totalCost: { ...cost }, spentCost: {}, paid: false,
      status: 'waiting', waitReason: prepOrderId ? 'site' : 'worker',
      ...(prepOrderId ? { prepOrderId } : {}),
    };
    saveBuildingJobs(state, jobs, tick);
  } else if (entityKind === ENTITY_KIND.commandHub) {
    claimHubTerritory(state, opts.owner, opts.q, opts.r, Number(row.claimRadius ?? 10), tick);
    syncColonyDepotCaps(state, opts.owner, tick);
  } else if (entityKind === ENTITY_KIND.supplyDepot) {
    syncColonyDepotCaps(state, opts.owner, tick);
  }

  return { ok: true, entityId, buildTicks, effectiveTicks };
}

/** Ends the job of building `entityId` (cancel, demolish) with its linked prep order, if any. */
function dropJob(state: PlanetState, jobs: Record<number, BuildingJobRecord>, entityId: number, owner: number, tick: number, data?: CompiledDataLike): void {
  const job = jobs[entityId];
  if (!job) return;
  if (job.prepOrderId) removeTerraformOrder(state, owner, job.prepOrderId, tick, data);
  delete jobs[entityId];
  saveBuildingJobs(state, jobs, tick);
}

function removeBuildingAndClearFootprint(
  state: PlanetState,
  entityId: number,
  eRow: number,
  tick: number,
  data?: CompiledDataLike,
  job?: BuildingJobRecord,
): void {
  const cols = state.entities.cols;
  const resolved = resolveBuildingRow(buildingKindName(cols.kind[eRow]), data);
  const w = cols.footprintW[eRow] || job?.footprintW || Number(resolved?.row.footprintW ?? resolved?.row.footprint ?? 2);
  const d = cols.footprintD[eRow] || job?.footprintD || Number(resolved?.row.footprintD ?? resolved?.row.footprint ?? 2);
  const fp = getFootprintTileIndices(state, cols.q[eRow], cols.r[eRow], w, d, cols.rot[eRow]);
  for (const tileIdx of fp.indices) setTilePrep(state, tileIdx, PREP.prepared, tick);
  removeRow(state.entities, entityId, tick);
  bumpPathEpoch(state.meta);
}

/**
 * Cancels an in-progress building construction, removing the entity and refunding `cancelRefundRatio` (50 %) of
 * `spentCost`. A finished building is never cancelled (`invalid_args`: demolish it instead), also not in the step
 * between its completion (slot 6) and its queue entry turning `done` (slot 4 of the next step).
 */
export function cancelBuildingConstruction(
  state: PlanetState,
  entityId: number,
  colonyIndex?: number | null,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): { ok: true; refunded: boolean; refundedAmounts: Partial<Record<ResourceKey, number>> } | { ok: false; code: string } {
  const eRow = rowOf(state.entities, entityId);
  const jobs = getBuildingJobs(state);
  const job = jobs[entityId];
  if (eRow < 0 && !job) return { ok: false, code: 'unknown_entity' };
  const owner = eRow >= 0 ? state.entities.cols.owner[eRow] : job!.owner;
  if (colonyIndex !== undefined && colonyIndex !== null && owner !== colonyIndex) return { ok: false, code: 'not_own_colony' };
  if (eRow >= 0 && state.entities.cols.state[eRow] !== ENTITY_STATE.constructing) return { ok: false, code: 'invalid_args' };
  if (!job && isBeingDismantled(state, entityId)) return { ok: false, code: 'invalid_args' }; // a dismantle site: cancel its job
  const ratio = Number(resolveBuildingRow(eRow >= 0 ? buildingKindName(state.entities.cols.kind[eRow]) : job!.building, data)?.row.cancelRefundRatio ?? CANCEL_REFUND_RATE);
  if (eRow >= 0) removeBuildingAndClearFootprint(state, entityId, eRow, tick, data, job);

  const colony = ensureColony(state, owner, tick);
  const spent = job?.spentCost && Object.keys(job.spentCost).length > 0 ? job.spentCost : job?.paid ? (job.cost ?? {}) : {};
  const refundedAmounts: Partial<Record<ResourceKey, number>> = {};
  let refunded = false;
  for (const [k, v] of Object.entries(spent) as [ResourceKey, number][]) {
    if (v > 0) { refundedAmounts[k] = v * ratio; refunded = true; }
  }
  if (refunded) refundCost(colony, spent, ratio, tick);
  dropJob(state, jobs, entityId, owner, tick, data);
  return { ok: true, refunded, refundedAmounts };
}

/**
 * Demolishes a building at once, refunding `refundRatio` (default: the row's `demolishRefundRatio`, 50 %) of its cost
 * and leaving its footprint tiles `PREP.prepared`. A finished dismantle job passes 0: it refunded step by step.
 */
export function demolishBuilding(
  state: PlanetState,
  entityId: number,
  colonyIndex?: number | null,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
  refundRatio?: number,
): { ok: true; refunded: Partial<Record<ResourceKey, number>> } | { ok: false; code: string } {
  const eRow = rowOf(state.entities, entityId);
  if (eRow < 0) return { ok: false, code: 'unknown_entity' };
  const cols = state.entities.cols;
  const owner = cols.owner[eRow];
  if (colonyIndex !== undefined && colonyIndex !== null && owner !== colonyIndex) return { ok: false, code: 'not_own_colony' };
  const resolved = resolveBuildingRow(buildingKindName(cols.kind[eRow]), data);
  if (!resolved) return { ok: false, code: 'invalid_args' };

  const jobs = getBuildingJobs(state);
  const job = jobs[entityId];
  const ratio = refundRatio ?? Number(resolved.row.demolishRefundRatio ?? 0.5);
  const cost =
    cols.state[eRow] === ENTITY_STATE.constructing && job?.spentCost
      ? job.spentCost
      : ((resolved.row.cost ?? {}) as Partial<Record<ResourceKey, number>>);
  const colony = ensureColony(state, owner, tick);
  refundCost(colony, cost, ratio, tick);
  const refunded: Partial<Record<ResourceKey, number>> = {};
  for (const [k, v] of Object.entries(cost) as [ResourceKey, number][]) {
    if (v > 0 && ratio > 0) refunded[k] = v * ratio;
  }
  const wasSupplyDepot = cols.kind[eRow] === ENTITY_KIND.supplyDepot;
  removeBuildingAndClearFootprint(state, entityId, eRow, tick, data, job);
  dropJob(state, jobs, entityId, owner, tick, data);
  if (wasSupplyDepot) syncColonyDepotCaps(state, owner, tick);
  return { ok: true, refunded };
}

export const demolishHandler = defineCommandHandler({
  kind: 'demolish',
  wave: 'W02',
  handle(state, cmd, ctx) {
    const { entityId } = (cmd.args ?? {}) as { entityId?: number };
    if (typeof entityId !== 'number') return 'invalid_args';
    if (isBeingDismantled(state, entityId)) return 'already_dismantling';
    const res = demolishBuilding(state, entityId, cmd.colonyIndex, ctx.tick, ctx.data);
    return res.ok ? undefined : res.code;
  },
});

/**
 * Site bookkeeping of the W02 building jobs (construction slot 6, after `constructionProgress`, where builders on site
 * advance them through the `build` unit command): prepared footprint tiles and why a job waits. Nothing builds here.
 */
export const constructionSystem = defineSystem({
  id: 'economy.construction',
  slot: 6,
  wave: 'W02',
  run(state, ctx) {
    stepBuildingSites(state, ctx);
  },
});
