import type { ResourceKey } from '@terra/contracts';
import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, removeRow, rowOf, setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { bumpPathEpoch, setTilePrep } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, touchTile, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { requestMove } from '../../units/movement/orchestrator';
import { buildingFootprints, occupiedGroundTiles } from '../construction/occupancy';
import { constructionOrdersOf } from '../construction/orders';
import {
  checkCostAffordability,
  debitCost,
  ensureColonyLedger,
  maxAffordableProgress,
  payProgressiveSlice,
  recomputeFamilyCaps,
  refundCost,
} from './ledger';
import { footprintTerrainBlock } from './siteTerrain';
import { claimTerritoryRadius } from '../territory-claim';

export interface BuildingJobRecord {
  entityId: number;
  building: string;
  owner: number;
  q: number;
  r: number;
  rot: number;
  footprintW: number;
  footprintD: number;
  buildTicks: number;
  elapsedWeightedTicks: number;
  workRate: number;
  workerEntityId?: number;
  cost: Partial<Record<ResourceKey, number>>;
  totalCost?: Partial<Record<ResourceKey, number>>;
  spentCost?: Partial<Record<ResourceKey, number>>;
  status?: 'in_progress' | 'waiting';
  waitReason?: string;
  paid: boolean;
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

let cachedData: CompiledDataLike | null = null;
function defaultData(): CompiledDataLike {
  if (!cachedData) cachedData = compileData(new Set(['W00', 'W01', 'W02']));
  return cachedData;
}

export function resolveBuildingRow(building: string, data?: CompiledDataLike): { row: CompiledRow; entityKind: number } | null {
  const d = data?.tables?.economyT1Basic ? data : defaultData();
  if (building === 'commandHub' || building === 'hub' || building === 't1') {
    return { row: dataRow(d, 'hub', 't1'), entityKind: ENTITY_KIND.commandHub };
  }
  if (building === 'metalsExtractor' || building === 'extractor') {
    return { row: dataRow(d, 'economyT1Basic', 'metalsExtractor'), entityKind: ENTITY_KIND.metalsExtractor };
  }
  if (building === 'solar' || building === 'solarCollector') {
    return { row: dataRow(d, 'economyT1Basic', 'solar'), entityKind: ENTITY_KIND.solar };
  }
  return null;
}

export function buildingKindName(entityKind: number): string {
  if (entityKind === ENTITY_KIND.commandHub) return 'commandHub';
  if (entityKind === ENTITY_KIND.metalsExtractor) return 'metalsExtractor';
  if (entityKind === ENTITY_KIND.solar) return 'solar';
  return 'building';
}

export function getFootprintTileIndices(
  state: PlanetState,
  q: number,
  r: number,
  w: number,
  d: number,
  rot = 0,
): { valid: boolean; indices: number[]; coords: Array<{ q: number; r: number }> } {
  const swap = rot % 2 !== 0;
  const fw = Math.max(1, swap ? d : w);
  const fd = Math.max(1, swap ? w : d);
  const minQ = -Math.floor((fw - 1) / 2);
  const minR = -Math.floor((fd - 1) / 2);
  const idx = hexIndex(state.grid.radius);
  const indices: number[] = [];
  const coords: Array<{ q: number; r: number }> = [];

  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      const tq = q + minQ + dq;
      const tr = r + minR + dr;
      const tileIdx = idx.indexOf(tq, tr);
      if (tileIdx < 0) return { valid: false, indices: [], coords: [] };
      indices.push(tileIdx);
      coords.push({ q: tq, r: tr });
    }
  }
  return { valid: true, indices, coords };
}

function ensureColony(state: PlanetState, owner: number, tick: number): ColonyState {
  let col = state.colonies[owner];
  if (!col) {
    col = { index: owner, id: `col-${owner}`, name: `Colony ${owner + 1}`, color: 0xff6b00, status: 'active', changedAt: tick };
    state.colonies[owner] = col;
  }
  return ensureColonyLedger(col);
}

function getJobsMap(state: PlanetState): Record<number, BuildingJobRecord> {
  const raw = (state.blobs.construction?.value as { jobs?: Record<number, BuildingJobRecord> } | undefined)?.jobs;
  return raw ? { ...raw } : {};
}

function saveJobsMap(state: PlanetState, jobs: Record<number, BuildingJobRecord>, tick: number): void {
  setBlob(state, 'construction', { jobs }, tick);
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
    if ((k !== ENTITY_KIND.hq && k !== ENTITY_KIND.harvester) || cols.hp[uRow] <= 0) continue;
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
  fpIndices: readonly number[],
  cost: Partial<Record<ResourceKey, number>>,
  workRate: number,
  buildTicks: number,
  instant: boolean,
  tick: number,
  data?: CompiledDataLike,
): { ok: true } | { ok: false; code: string; detail?: string } {
  const layers = state.grid.layers;
  const occupied = occupiedGroundTiles(state, data); // buildings, not `anchors` (territory claim count)
  let hasMetalsDeposit = false;
  for (const tileIdx of fpIndices) {
    const tb = footprintTerrainBlock(state, [tileIdx]);
    if (tb) return { ok: false, code: 'terrain_unbuildable', detail: tb.text };
    if (occupied.has(tileIdx)) return { ok: false, code: 'site_blocked', detail: 'tile occupied' };
    if (layers.deposit[tileIdx] === DEPOSIT.metals && Number(layers.richness?.[tileIdx] ?? 10000) > 0) hasMetalsDeposit = true;
  }
  if (row.requiresDeposit === 'metals' && !hasMetalsDeposit) return { ok: false, code: 'site_blocked', detail: 'no deposit' };

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

/** Validates and starts (or completes if `instant`) a T1 building construction, preparing footprint tiles and debiting cost. */
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
  const check = validateFootprintAndCost(state, colony, row, fp.indices, cost, workerCheck.workRate, buildTicks, Boolean(opts.instant), tick, data);
  if (!check.ok) return check;

  for (const tileIdx of fp.indices) {
    if (state.grid.layers.height && Math.abs(state.grid.layers.height[tileIdx]) > 0.15) {
      state.grid.layers.height[tileIdx] = 0.08;
    }
    setTilePrep(state, tileIdx, PREP.prepared, tick);
    touchTile(state, tileIdx, tick);
  }

  const entityId = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const eRow = insertRow(state.entities, entityId, tick);
  bumpPathEpoch(state.meta);
  const cols = state.entities.cols;
  cols.kind[eRow] = entityKind;
  cols.owner[eRow] = opts.owner;
  cols.tier[eRow] = Number(row.tier ?? 1);
  placeSpawnedEntity(state.entities, eRow, opts.q, opts.r, tick);
  cols.rot[eRow] = opts.rot ?? 0;
  cols.footprintW[eRow] = w;
  cols.footprintD[eRow] = d;
  cols.shedGroup[eRow] = Number(row.shedGroup ?? 4);
  cols.hp[eRow] = Math.fround(Number(row.hp ?? 500));
  cols.hpMax[eRow] = Math.fround(Number(row.hp ?? 500));
  cols.state[eRow] = opts.instant ? ENTITY_STATE.active : ENTITY_STATE.constructing;
  cols.progress[eRow] = opts.instant ? 1 : 0;
  cols.createdAt[eRow] = tick;
  cols.changedAt[eRow] = tick;
  evacuateUnitsFromFootprint(state, fp.indices, tick, data, ctx);

  if (!opts.instant) {
    const jobs = getJobsMap(state);
    jobs[entityId] = {
      entityId, building: String(row.building ?? opts.building), owner: opts.owner,
      q: opts.q, r: opts.r, rot: opts.rot ?? 0, footprintW: w, footprintD: d,
      buildTicks, elapsedWeightedTicks: 0, workRate: workerCheck.workRate,
      workerEntityId: opts.workerEntityId,
      cost: { ...cost }, totalCost: { ...cost }, spentCost: {}, status: 'in_progress', paid: false,
    };
    saveJobsMap(state, jobs, tick);
  } else if (entityKind === ENTITY_KIND.commandHub) {
    claimHubTerritory(state, opts.owner, opts.q, opts.r, Number(row.claimRadius ?? 10), tick);
    recomputeFamilyCaps(colony, true, 0, tick);
  }

  return { ok: true, entityId, buildTicks, effectiveTicks };
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

/** Cancels an in-progress building construction, removing the entity and refunding 50% of `spentCost`. */
export function cancelBuildingConstruction(
  state: PlanetState,
  entityId: number,
  colonyIndex?: number | null,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): { ok: true; refunded: boolean; refundedAmounts: Partial<Record<ResourceKey, number>> } | { ok: false; code: string } {
  const eRow = rowOf(state.entities, entityId);
  const jobs = getJobsMap(state);
  const job = jobs[entityId];
  if (eRow < 0 && !job) return { ok: false, code: 'unknown_entity' };
  const owner = eRow >= 0 ? state.entities.cols.owner[eRow] : job!.owner;
  if (colonyIndex !== undefined && colonyIndex !== null && owner !== colonyIndex) return { ok: false, code: 'not_own_colony' };
  if (eRow >= 0) removeBuildingAndClearFootprint(state, entityId, eRow, tick, data, job);

  const colony = ensureColony(state, owner, tick);
  const spent = job?.spentCost && Object.keys(job.spentCost).length > 0 ? job.spentCost : job?.paid ? (job.cost ?? {}) : {};
  const refundedAmounts: Partial<Record<ResourceKey, number>> = {};
  let refunded = false;
  for (const [k, v] of Object.entries(spent) as [ResourceKey, number][]) {
    if (v > 0) { refundedAmounts[k] = v * 0.5; refunded = true; }
  }
  if (refunded) refundCost(colony, spent, 0.5, tick);
  if (jobs[entityId]) { delete jobs[entityId]; saveJobsMap(state, jobs, tick); }
  return { ok: true, refunded, refundedAmounts };
}

/** Demolishes a completed building, refunding 50% of its cost and leaving its footprint tiles `PREP.prepared`. */
export function demolishBuilding(
  state: PlanetState,
  entityId: number,
  colonyIndex?: number | null,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): { ok: true; refunded: Partial<Record<ResourceKey, number>> } | { ok: false; code: string } {
  const eRow = rowOf(state.entities, entityId);
  if (eRow < 0) return { ok: false, code: 'unknown_entity' };
  const cols = state.entities.cols;
  const owner = cols.owner[eRow];
  if (colonyIndex !== undefined && colonyIndex !== null && owner !== colonyIndex) return { ok: false, code: 'not_own_colony' };
  const resolved = resolveBuildingRow(buildingKindName(cols.kind[eRow]), data);
  if (!resolved) return { ok: false, code: 'invalid_args' };

  const jobs = getJobsMap(state);
  const job = jobs[entityId];
  const ratio = Number(resolved.row.demolishRefundRatio ?? 0.5);
  const cost =
    cols.state[eRow] === ENTITY_STATE.constructing && job?.spentCost
      ? job.spentCost
      : ((resolved.row.cost ?? {}) as Partial<Record<ResourceKey, number>>);
  const colony = ensureColony(state, owner, tick);
  refundCost(colony, cost, ratio, tick);
  const refunded: Partial<Record<ResourceKey, number>> = {};
  for (const [k, v] of Object.entries(cost) as [ResourceKey, number][]) {
    if (v > 0) refunded[k] = v * ratio;
  }
  removeBuildingAndClearFootprint(state, entityId, eRow, tick, data, job);
  if (jobs[entityId]) { delete jobs[entityId]; saveJobsMap(state, jobs, tick); }
  return { ok: true, refunded };
}

export const demolishHandler = defineCommandHandler({
  kind: 'demolish',
  wave: 'W02',
  handle(state, cmd, ctx) {
    const { entityId } = (cmd.args ?? {}) as { entityId?: number };
    if (typeof entityId !== 'number') return 'invalid_args';
    const res = demolishBuilding(state, entityId, cmd.colonyIndex, ctx.tick, ctx.data);
    return res.ok ? undefined : res.code;
  },
});

export const constructionSystem = defineSystem({
  id: 'economy.construction',
  slot: 6,
  wave: 'W02',
  run(state, ctx) {
    const jobs = getJobsMap(state);
    const w01EntityIds = new Set(constructionOrdersOf(state.blobs.constructionQueue?.value).map((o) => o.entityId));
    const e = state.entities, cols = e.cols;
    let jobsChanged = false;

    for (let row = 0; row < e.count; row++) {
      if (cols.state[row] !== ENTITY_STATE.constructing || cols.hp[row] <= 0) continue;
      const id = cols.id[row];
      if (w01EntityIds.has(id)) continue;
      const bName = buildingKindName(cols.kind[row]);
      const resolved = resolveBuildingRow(bName, ctx.data);
      const buildTicks = jobs[id]?.buildTicks ?? Math.max(1, Number(resolved?.row.buildS ?? 50));
      const workRate = jobs[id]?.workRate ?? 1.5;

      const prevWeighted = jobs[id]?.elapsedWeightedTicks ?? cols.progress[row] * buildTicks;
      const nextWeighted = prevWeighted + ctx.dt * workRate;
      const progress = Math.min(1, nextWeighted / buildTicks);
      const owner = cols.owner[row];
      const colony = ensureColony(state, owner, ctx.tick);

      const job = jobs[id];
      const totalCost = job?.totalCost ?? job?.cost ?? {};
      const spentCost = { ...(job?.spentCost ?? {}) };
      const isLegacyPaidUpfront = Boolean(job?.paid && !job?.spentCost);
      if (!isLegacyPaidUpfront && Object.keys(totalCost).length > 0) {
        const pay = payProgressiveSlice(colony, totalCost, spentCost, progress, ctx.tick);
        if (!pay.ok) {
          const prevProg = prevWeighted / buildTicks;
          const capProg = maxAffordableProgress(colony, totalCost, spentCost, progress);
          if (capProg > prevProg + 1e-6) {
            payProgressiveSlice(colony, totalCost, spentCost, capProg, ctx.tick);
            setField(e, row, 'progress', Math.fround(capProg), ctx.tick);
            if (job) {
              jobs[id] = { ...job, elapsedWeightedTicks: capProg * buildTicks, spentCost, paid: true, status: 'waiting', waitReason: 'resources' };
              jobsChanged = true;
            }
          } else if (job) {
            jobs[id] = { ...job, status: 'waiting', waitReason: 'resources' };
            jobsChanged = true;
          }
          continue;
        }
      }

      setField(e, row, 'progress', Math.fround(progress), ctx.tick);

      if (progress >= 1 - 1e-6) {
        setField(e, row, 'progress', 1, ctx.tick);
        setField(e, row, 'state', ENTITY_STATE.active, ctx.tick);
        if (cols.kind[row] === ENTITY_KIND.commandHub) {
          claimHubTerritory(state, owner, cols.q[row], cols.r[row], Number(resolved?.row.claimRadius ?? 10), ctx.tick);
          recomputeFamilyCaps(colony, true, 0, ctx.tick);
        }
        ctx.emit({ kind: 'buildingCompleted', colonyIds: [owner], data: { entityId: id, building: bName, kind: bName, q: cols.q[row], r: cols.r[row], playerId: colony.id } });
        if (jobs[id]) { delete jobs[id]; jobsChanged = true; }
      } else if (jobs[id]) {
        const hasSpent = Object.values(spentCost).some((v) => (v ?? 0) > 0);
        jobs[id] = { ...jobs[id], elapsedWeightedTicks: nextWeighted, spentCost, paid: jobs[id].paid || hasSpent, status: 'in_progress', waitReason: undefined };
        jobsChanged = true;
      }
    }
    if (jobsChanged) saveJobsMap(state, jobs, ctx.tick);
  },
});
