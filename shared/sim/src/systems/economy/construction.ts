import type { ResourceKey } from '@terra/contracts';
import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, removeRow, rowOf, setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { setTileOwner, setTilePrep } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, touchTile, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { checkCostAffordability, debitCost, ensureColonyLedger, recomputeFamilyCaps, refundCost } from './ledger';

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
  const idx = hexIndex(state.grid.radius);
  const indices: number[] = [];
  const coords: Array<{ q: number; r: number }> = [];

  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      const tq = q + dq;
      const tr = r + dr;
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

function claimHubTerritory(state: PlanetState, owner: number, centerQ: number, centerR: number, radius: number, tick: number): void {
  const idx = hexIndex(state.grid.radius);
  for (let i = 0; i < state.grid.count; i++) {
    if (hexDistance(centerQ, centerR, idx.q[i], idx.r[i]) <= radius) {
      if (state.grid.layers.owner[i] === -1) setTileOwner(state, i, owner, tick);
    }
  }
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

  const w = Number(row.footprintW ?? 2);
  const d = Number(row.footprintD ?? 2);
  const fp = getFootprintTileIndices(state, opts.q, opts.r, w, d, opts.rot ?? 0);
  if (!fp.valid) return { ok: false, code: 'invalid_args', detail: 'footprint out of bounds' };

  const layers = state.grid.layers;
  let hasMetalsDeposit = false;
  for (const tileIdx of fp.indices) {
    if (layers.terrain[tileIdx] === TERRAIN.deep || layers.prep[tileIdx] === PREP.ridge || layers.prep[tileIdx] === PREP.moat) {
      return { ok: false, code: 'site_blocked', detail: 'impassable terrain' };
    }
    if (layers.anchors[tileIdx] !== 0) {
      return { ok: false, code: 'site_blocked', detail: 'tile occupied' };
    }
    if (layers.deposit[tileIdx] === DEPOSIT.metals) hasMetalsDeposit = true;
  }
  if (row.requiresDeposit === 'metals' && !hasMetalsDeposit) {
    return { ok: false, code: 'site_blocked', detail: 'no deposit' };
  }

  const colony = ensureColony(state, opts.owner, tick);
  const cost = (opts.costOverride ?? row.cost ?? {}) as Partial<Record<ResourceKey, number>>;
  const totalStock = Object.values(colony.stock as Record<string, number>).reduce((a, b) => a + b, 0);
  if (totalStock > 0) {
    const afford = checkCostAffordability(colony, cost);
    if (!afford.ok) {
      const capExceeded = Object.keys(afford.exceedsCap).length > 0;
      return { ok: false, code: capExceeded ? 'storage_cap' : 'insufficient_resources' };
    }
    debitCost(colony, cost, tick);
  }

  // Linked prep: prepare footprint tiles and mark anchors
  for (const tileIdx of fp.indices) {
    setTilePrep(state, tileIdx, PREP.prepared, tick);
    layers.anchors[tileIdx] = 1;
    touchTile(state, tileIdx, tick);
  }

  const entityId = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const eRow = insertRow(state.entities, entityId, tick);
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

  const buildTicks = Math.max(1, Number(row.buildS ?? 50));
  const effectiveTicks = Math.round(buildTicks / workerCheck.workRate);

  if (!opts.instant) {
    const jobs = getJobsMap(state);
    jobs[entityId] = {
      entityId, building: String(row.building ?? opts.building), owner: opts.owner,
      q: opts.q, r: opts.r, rot: opts.rot ?? 0, footprintW: w, footprintD: d,
      buildTicks, elapsedWeightedTicks: 0, workRate: workerCheck.workRate,
      workerEntityId: opts.workerEntityId, cost, paid: true,
    };
    saveJobsMap(state, jobs, tick);
  } else if (entityKind === ENTITY_KIND.commandHub) {
    claimHubTerritory(state, opts.owner, opts.q, opts.r, Number(row.claimRadius ?? 10), tick);
    recomputeFamilyCaps(colony, true, 0, tick);
  }

  return { ok: true, entityId, buildTicks, effectiveTicks };
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
  if (colonyIndex !== undefined && colonyIndex !== null && owner !== colonyIndex) {
    return { ok: false, code: 'not_own_colony' };
  }
  const bName = buildingKindName(cols.kind[eRow]);
  const resolved = resolveBuildingRow(bName, data);
  if (!resolved) return { ok: false, code: 'invalid_args' };

  const w = cols.footprintW[eRow] || Number(resolved.row.footprintW ?? 2);
  const d = cols.footprintD[eRow] || Number(resolved.row.footprintD ?? 2);
  const fp = getFootprintTileIndices(state, cols.q[eRow], cols.r[eRow], w, d, cols.rot[eRow]);
  for (const tileIdx of fp.indices) {
    state.grid.layers.anchors[tileIdx] = 0;
    setTilePrep(state, tileIdx, PREP.prepared, tick);
  }

  const ratio = Number(resolved.row.demolishRefundRatio ?? 0.5);
  const cost = (resolved.row.cost ?? {}) as Partial<Record<ResourceKey, number>>;
  const colony = ensureColony(state, owner, tick);
  refundCost(colony, cost, ratio, tick);

  const refunded: Partial<Record<ResourceKey, number>> = {};
  for (const [k, v] of Object.entries(cost) as [ResourceKey, number][]) {
    if (v > 0) refunded[k] = v * ratio;
  }

  removeRow(state.entities, entityId, tick);
  const jobs = getJobsMap(state);
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
    const e = state.entities, cols = e.cols;
    let jobsChanged = false;

    for (let row = 0; row < e.count; row++) {
      if (cols.state[row] !== ENTITY_STATE.constructing || cols.hp[row] <= 0) continue;
      const id = cols.id[row];
      const bName = buildingKindName(cols.kind[row]);
      const resolved = resolveBuildingRow(bName, ctx.data);
      const buildTicks = jobs[id]?.buildTicks ?? Math.max(1, Number(resolved?.row.buildS ?? 50));
      const workRate = jobs[id]?.workRate ?? 1.5;

      const prevWeighted = jobs[id]?.elapsedWeightedTicks ?? cols.progress[row] * buildTicks;
      const nextWeighted = prevWeighted + ctx.dt * workRate;
      const progress = Math.min(1, nextWeighted / buildTicks);
      setField(e, row, 'progress', Math.fround(progress), ctx.tick);

      if (progress >= 1 - 1e-6) {
        setField(e, row, 'progress', 1, ctx.tick);
        setField(e, row, 'state', ENTITY_STATE.active, ctx.tick);
        const owner = cols.owner[row];
        const colony = ensureColony(state, owner, ctx.tick);
        if (cols.kind[row] === ENTITY_KIND.commandHub) {
          claimHubTerritory(state, owner, cols.q[row], cols.r[row], Number(resolved?.row.claimRadius ?? 10), ctx.tick);
          recomputeFamilyCaps(colony, true, 0, ctx.tick);
        }
        ctx.emit({
          kind: 'buildingCompleted',
          colonyIds: [owner],
          data: { entityId: id, building: bName, kind: bName, q: cols.q[row], r: cols.r[row], playerId: colony.id },
        });
        if (jobs[id]) { delete jobs[id]; jobsChanged = true; }
      } else if (jobs[id]) {
        jobs[id] = { ...jobs[id], elapsedWeightedTicks: nextWeighted };
        jobsChanged = true;
      }
    }
    if (jobsChanged) saveJobsMap(state, jobs, ctx.tick);
  },
});
