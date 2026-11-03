import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { revealVision } from '../hq';

export type HarvesterJob = 'idle' | 'moving' | 'harvesting' | 'working' | 'offlineBrownout';

export interface HarvesterUnitView {
  entityId: number;
  kind: number;
  unit: 'harvester';
  label: string;
  archetype: string;
  owner: number;
  tier: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  supply: number;
  powerDrainPerS: number;
  speedTilesPerS: number;
  designSpeedTilesPerS: number;
  viewRadius: number;
  radius: number;
  harvestRatePerS: number;
  workRate: number;
  maxBuildTier: number;
  cost: Record<string, number>;
  buildS: number;
  designBuildS: number;
  targetQ: number;
  targetR: number;
  state: number;
  currentJob: HarvesterJob;
  progress: number;
  task: HarvesterJob;
  carrying: number;
}

export interface SpawnHarvesterOpts {
  owner: number;
  q: number;
  r: number;
  tick?: number;
  data?: CompiledDataLike;
}

let cachedW02Data: CompiledDataLike | null = null;

export function defaultW02Data(): CompiledDataLike {
  if (!cachedW02Data) cachedW02Data = compileData(new Set(['W00', 'W01', 'W02']));
  return cachedW02Data;
}

export function resolveHarvesterRow(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables.unitsWorkersBasic as Record<string, CompiledRow> | undefined;
  if (table?.harvester) return table.harvester;
  return dataRow(defaultW02Data(), 'unitsWorkersBasic', 'harvester');
}

export function harvesterJobFromState(stateCode: number): HarvesterJob {
  if (stateCode === ENTITY_STATE.moving) return 'moving';
  if (stateCode === ENTITY_STATE.harvesting) return 'harvesting';
  if (stateCode === ENTITY_STATE.working) return 'working';
  if (stateCode === ENTITY_STATE.offlineBrownout) return 'offlineBrownout';
  return 'idle';
}

export function buildHarvesterView(
  state: PlanetState,
  row: number,
  data?: CompiledDataLike,
): HarvesterUnitView {
  const cols = state.entities.cols;
  const hRow = resolveHarvesterRow(data);
  const currentJob = harvesterJobFromState(cols.state[row]);
  const cost = (hRow.cost ?? {}) as Record<string, number>;
  const progress = Number(cols.progress?.[row] ?? 0);
  const carrying = Number(cols.cell?.[row] ?? 0);
  return {
    entityId: cols.id[row],
    kind: cols.kind[row],
    unit: 'harvester',
    label: String(hRow.label ?? 'Harvester Drone'),
    archetype: String(hRow.archetype ?? 'robot.miner'),
    owner: cols.owner[row],
    tier: cols.tier[row],
    q: cols.q[row],
    r: cols.r[row],
    x: cols.x[row],
    y: cols.y[row],
    hp: cols.hp[row],
    hpMax: cols.hpMax[row],
    supply: Number(hRow.supply ?? 1),
    powerDrainPerS: Number(hRow.powerDrainPerS ?? 1.5),
    speedTilesPerS: Number(hRow.designSpeedTilesPerS ?? 1.5),
    designSpeedTilesPerS: Number(hRow.designSpeedTilesPerS ?? 1.5),
    viewRadius: Number(hRow.viewRadius ?? 7),
    radius: Number(hRow.radius ?? 0.4),
    harvestRatePerS: Number(hRow.harvestRatePerS ?? 0.5),
    workRate: Number(cols.workRate?.[row] ?? 1.0),
    maxBuildTier: Number(hRow.maxBuildTier ?? 0),
    cost: { ...cost },
    buildS: Number(hRow.buildS ?? 50),
    designBuildS: Number(hRow.designBuildS ?? 10),
    targetQ: cols.targetQ[row],
    targetR: cols.targetR[row],
    state: cols.state[row],
    currentJob,
    progress,
    task: currentJob,
    carrying,
  };
}

export function syncHarvesterView(
  state: PlanetState,
  row: number,
  tick: number,
  data?: CompiledDataLike,
): HarvesterUnitView {
  const unitView = buildHarvesterView(state, row, data);
  const prevObj = (state.blobs.units?.value as Record<string, unknown> | undefined) ?? {};
  const prevById = (prevObj.byId as Record<string, Record<string, unknown>> | undefined) ?? {};
  const idKey = String(unitView.entityId);
  const existingRec = prevById[idKey];
  if (existingRec && typeof existingRec === 'object') {
    existingRec.progress = unitView.progress;
    existingRec.task = unitView.task;
    existingRec.carrying = unitView.carrying;
  }
  prevObj.byId = prevById;
  prevObj[unitView.entityId] = unitView;
  setBlob(state, 'units', prevObj, tick);

  const owner = state.entities.cols.owner[row];
  if (owner >= 0 && state.colonies[owner]) {
    const col = state.colonies[owner];
    col.harvesters = [...withoutUnitView(col.harvesters, unitView.entityId), unitView];
    col.units = [...withoutUnitView(col.units, unitView.entityId), unitView];
    col.changedAt = tick;
  }
  return unitView;
}

/**
 * The views of `list` (`col.harvesters` / `col.units`) other than `entityId`'s. Dense arrays only: an index alias
 * (`list[entityId] = view`) made the array sparse, and the snapshot codec saves its holes as `null`, so a restored
 * planet crashed here (`reading 'entityId'` of null). Non-object entries are dropped, which heals such snapshots.
 */
export function withoutUnitView(list: unknown, entityId: number): HarvesterUnitView[] {
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).filter(
    (u): u is HarvesterUnitView => !!u && typeof u === 'object' && (u as HarvesterUnitView).entityId !== entityId,
  );
}

export function spawnHarvesterUnit(
  state: PlanetState,
  opts: SpawnHarvesterOpts,
  ctx?: StepContext,
): number {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const rowDef = resolveHarvesterRow(data);
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;

  cols.kind[row] = ENTITY_KIND.harvester;
  cols.owner[row] = opts.owner;
  cols.tier[row] = Number(rowDef.tier ?? 1);
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, tick);
  cols.rot[row] = 0;
  cols.hp[row] = Math.fround(Number(rowDef.hp ?? 160));
  cols.hpMax[row] = Math.fround(Number(rowDef.hp ?? 160));
  cols.state[row] = ENTITY_STATE.idle;
  cols.progress[row] = 0;
  cols.cell[row] = 0;
  cols.cellMax[row] = 0;
  cols.targetQ[row] = opts.q;
  cols.targetR[row] = opts.r;
  cols.workRate[row] = Math.fround(Number(rowDef.workRate ?? 1.0));
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  revealVision(state, opts.owner, opts.q, opts.r, Number(rowDef.viewRadius ?? 7), tick);
  syncHarvesterView(state, row, tick, data);
  return id;
}

export function getHarvesterView(
  state: PlanetState,
  entityId?: number,
  data?: CompiledDataLike,
): HarvesterUnitView | null {
  const e = state.entities;
  const cols = e.cols;
  if (entityId !== undefined) {
    const row = rowOf(e, entityId);
    if (row < 0 || cols.kind[row] !== ENTITY_KIND.harvester) return null;
    return buildHarvesterView(state, row, data);
  }
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] === ENTITY_KIND.harvester) {
      return buildHarvesterView(state, row, data);
    }
  }
  return null;
}

export function listHarvesterViews(
  state: PlanetState,
  owner?: number,
  data?: CompiledDataLike,
): HarvesterUnitView[] {
  const e = state.entities;
  const cols = e.cols;
  const out: HarvesterUnitView[] = [];
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.harvester) continue;
    if (owner !== undefined && cols.owner[row] !== owner) continue;
    out.push(buildHarvesterView(state, row, data));
  }
  return out;
}
