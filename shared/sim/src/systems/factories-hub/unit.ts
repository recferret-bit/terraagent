import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { withoutUnitView } from '../harvest/unit';
import { revealVision } from '../hq';

export type BuilderJob = 'idle' | 'moving' | 'working' | 'constructing' | 'repairing' | 'offlineBrownout';

export interface BuilderUnitView {
  entityId: number;
  kind: number;
  unit: 'builder';
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
  workRate: number;
  maxBuildTier: number;
  cost: Record<string, number>;
  buildS: number;
  designBuildS: number;
  targetQ: number;
  targetR: number;
  state: number;
  currentJob: BuilderJob;
  progress: number;
  task: BuilderJob;
}

export interface SpawnBuilderOpts {
  owner: number;
  q: number;
  r: number;
  tick?: number;
  data?: CompiledDataLike;
}

let cachedData: CompiledDataLike | null = null;

export function defaultHubData(): CompiledDataLike {
  if (!cachedData) cachedData = compileData(new Set(['W00', 'W01', 'W02', 'W03']));
  return cachedData;
}

export function resolveHubProducerRows(data?: CompiledDataLike): {
  harvester: CompiledRow;
  builder: CompiledRow | undefined;
  hubProd: CompiledRow;
  hub: CompiledRow;
} {
  const d = data?.tables?.unitsWorkersBasic ? data : defaultHubData();
  const gridTable = d.tables.grid as Record<string, CompiledRow> | undefined;
  const workersTable = d.tables.unitsWorkersBasic as Record<string, CompiledRow> | undefined;
  return {
    harvester: dataRow(d, 'unitsWorkersBasic', 'harvester'),
    builder: gridTable?.builder ?? workersTable?.builder,
    hubProd: dataRow(d, 'unitsWorkersBasic', 'hubProduction'),
    hub: dataRow(d, 'hub', 't1'),
  };
}

export function resolveBuilderRow(data?: CompiledDataLike): CompiledRow {
  const { builder } = resolveHubProducerRows(data);
  if (builder) return builder;
  return dataRow(defaultHubData(), 'grid', 'builder');
}

export function resolveUnitRowForHub(unit: string, data?: CompiledDataLike): CompiledRow | null {
  const { harvester, builder } = resolveHubProducerRows(data);
  if (unit === 'harvester') return harvester;
  if (unit === 'builder') return builder ?? null;
  return null;
}

export function builderJobFromState(stateCode: number): BuilderJob {
  if (stateCode === ENTITY_STATE.moving) return 'moving';
  if (stateCode === ENTITY_STATE.working) return 'working';
  if (stateCode === ENTITY_STATE.constructing) return 'constructing';
  if (stateCode === ENTITY_STATE.repairing) return 'repairing';
  if (stateCode === ENTITY_STATE.offlineBrownout) return 'offlineBrownout';
  return 'idle';
}

export function buildBuilderView(
  state: PlanetState,
  row: number,
  data?: CompiledDataLike,
): BuilderUnitView {
  const cols = state.entities.cols;
  const bRow = resolveBuilderRow(data);
  const currentJob = builderJobFromState(cols.state[row]);
  const cost = (bRow.cost ?? {}) as Record<string, number>;
  const progress = Number(cols.progress?.[row] ?? 0);
  return {
    entityId: cols.id[row],
    kind: cols.kind[row],
    unit: 'builder',
    label: String(bRow.label ?? 'Builder Drone'),
    archetype: String(bRow.archetype ?? 'robot.builder'),
    owner: cols.owner[row],
    tier: cols.tier[row],
    q: cols.q[row],
    r: cols.r[row],
    x: cols.x[row],
    y: cols.y[row],
    hp: cols.hp[row],
    hpMax: cols.hpMax[row],
    supply: Number(bRow.supply ?? 1),
    powerDrainPerS: Number(bRow.powerDrainPerS ?? 2.0),
    speedTilesPerS: Number(bRow.designSpeedTilesPerS ?? 1.5),
    designSpeedTilesPerS: Number(bRow.designSpeedTilesPerS ?? 1.5),
    viewRadius: Number(bRow.viewRadius ?? 7),
    radius: Number(bRow.radius ?? 0.4),
    workRate: Number(cols.workRate?.[row] || 1.0),
    maxBuildTier: Number(bRow.maxBuildTier ?? 1),
    cost: { ...cost },
    buildS: Number(bRow.buildS ?? 60),
    designBuildS: Number(bRow.designBuildS ?? 12),
    targetQ: cols.targetQ[row],
    targetR: cols.targetR[row],
    state: cols.state[row],
    currentJob,
    progress,
    task: currentJob,
  };
}

export function syncBuilderView(
  state: PlanetState,
  row: number,
  tick: number,
  data?: CompiledDataLike,
): BuilderUnitView {
  const unitView = buildBuilderView(state, row, data);
  const prevObj = (state.blobs.units?.value as Record<string, unknown> | undefined) ?? {};
  const prevById = (prevObj.byId as Record<string, Record<string, unknown>> | undefined) ?? {};
  const idKey = String(unitView.entityId);
  const existingRec = prevById[idKey];
  if (existingRec && typeof existingRec === 'object') {
    existingRec.progress = unitView.progress;
    existingRec.task = unitView.task;
  }
  prevObj.byId = prevById;
  prevObj[unitView.entityId] = unitView;
  setBlob(state, 'units', prevObj, tick);

  const owner = state.entities.cols.owner[row];
  if (owner >= 0 && state.colonies[owner]) {
    const col = state.colonies[owner];
    col.builders = [...withoutUnitView(col.builders, unitView.entityId), unitView];
    col.units = [...withoutUnitView(col.units, unitView.entityId), unitView];
    col.changedAt = tick;
  }
  return unitView;
}

export function spawnBuilderUnit(
  state: PlanetState,
  opts: SpawnBuilderOpts,
  ctx?: StepContext,
): number {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const rowDef = resolveBuilderRow(data);
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;

  cols.kind[row] = ENTITY_KIND.builder;
  cols.owner[row] = opts.owner;
  cols.tier[row] = Number(rowDef.tier ?? 1);
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, tick);
  cols.rot[row] = 0;
  cols.hp[row] = Math.fround(Number(rowDef.hp ?? 150));
  cols.hpMax[row] = Math.fround(Number(rowDef.hp ?? 150));
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
  syncBuilderView(state, row, tick, data);
  return id;
}
