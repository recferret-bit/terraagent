import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { revealVision } from '../hq';

export type WorkerTier = 1 | 2 | 3;

export type WorkerJob = 'idle' | 'moving' | 'harvesting' | 'working' | 'constructing' | 'repairing' | 'offlineBrownout';

export interface WorkerUnitView {
  entityId: number;
  kind: number;
  unit: 'worker';
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
  maxTerraformTier: number;
  cost: Record<string, number>;
  buildS: number;
  designBuildS: number;
  targetQ: number;
  targetR: number;
  state: number;
  currentJob: WorkerJob;
  progress: number;
  task: WorkerJob;
  carrying: number;
}

export interface SpawnWorkerOpts {
  owner: number;
  q: number;
  r: number;
  /** 1, 2, or 3. Missing means tier 1. */
  tier?: WorkerTier;
  tick?: number;
  data?: CompiledDataLike;
}

let cachedW02Data: CompiledDataLike | null = null;
let cachedAllWorkerData: CompiledDataLike | null = null;

export function defaultW02Data(): CompiledDataLike {
  if (!cachedW02Data) cachedW02Data = compileData(new Set(['W00', 'W01', 'W02']));
  return cachedW02Data;
}

/** Compiled rows for every worker tier (direct spawns when the caller passes no data). */
export function defaultWorkerData(): CompiledDataLike {
  if (!cachedAllWorkerData) cachedAllWorkerData = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W05']));
  return cachedAllWorkerData;
}

/** The Worker Drone (`ENTITY_KIND.worker`): harvests, builds and terraforms (W05-02). The HQ is not one. */
export function isWorker(kind: number): boolean {
  return kind === ENTITY_KIND.worker;
}

/** A unit that takes colony work (build, terraform, repair, dismantle): the HQ or a Worker Drone. */
export function isCrewKind(kind: number): boolean {
  return kind === ENTITY_KIND.hq || kind === ENTITY_KIND.worker;
}

export function workerTierOf(tier: number | undefined): WorkerTier {
  if (tier === 2 || tier === 3) return tier;
  return 1;
}

export function workerRowId(tier: number | undefined): 't1' | 't2' | 't3' {
  const t = workerTierOf(tier);
  return t === 1 ? 't1' : t === 2 ? 't2' : 't3';
}

function workersTable(data?: CompiledDataLike): Record<string, CompiledRow> | undefined {
  return data?.tables?.unitsWorkersBasic as Record<string, CompiledRow> | undefined;
}

/** The tier's balance row. Falls back to the default compile when `data` omits that wave. */
export function resolveWorkerRow(data: CompiledDataLike | undefined, tier: number | undefined = 1): CompiledRow {
  const id = workerRowId(tier);
  const row = workersTable(data)?.[id];
  if (row) return row;
  if (id === 't1') return dataRow(defaultW02Data(), 'unitsWorkersBasic', 't1');
  return dataRow(defaultWorkerData(), 'unitsWorkersBasic', id);
}

/**
 * The tier's row in the active compile. `null` when that wave is off.
 * Omitted `data` uses {@link defaultWorkerData} (every tier present).
 */
export function resolveProducedWorkerRow(data: CompiledDataLike | undefined, tier: number | undefined): CompiledRow | null {
  if (!data?.tables?.unitsWorkersBasic) return resolveWorkerRow(undefined, tier);
  return workersTable(data)?.[workerRowId(tier)] ?? null;
}

export function workerJobFromState(stateCode: number): WorkerJob {
  if (stateCode === ENTITY_STATE.moving) return 'moving';
  if (stateCode === ENTITY_STATE.harvesting) return 'harvesting';
  if (stateCode === ENTITY_STATE.working) return 'working';
  if (stateCode === ENTITY_STATE.constructing) return 'constructing';
  if (stateCode === ENTITY_STATE.repairing) return 'repairing';
  if (stateCode === ENTITY_STATE.offlineBrownout) return 'offlineBrownout';
  return 'idle';
}

export function buildWorkerView(state: PlanetState, row: number, data?: CompiledDataLike): WorkerUnitView {
  const cols = state.entities.cols;
  const spec = resolveWorkerRow(data, cols.tier[row] || 1);
  const currentJob = workerJobFromState(cols.state[row]);
  const cost = (spec.cost ?? {}) as Record<string, number>;
  return {
    entityId: cols.id[row],
    kind: cols.kind[row],
    unit: 'worker',
    label: String(spec.label ?? 'Worker Drone T1'),
    archetype: String(spec.archetype ?? 'robot.miner'),
    owner: cols.owner[row],
    tier: cols.tier[row],
    q: cols.q[row],
    r: cols.r[row],
    x: cols.x[row],
    y: cols.y[row],
    hp: cols.hp[row],
    hpMax: cols.hpMax[row],
    supply: Number(spec.supply ?? 1),
    powerDrainPerS: Number(spec.powerDrainPerS ?? 2),
    speedTilesPerS: Number(spec.designSpeedTilesPerS ?? 1.5),
    designSpeedTilesPerS: Number(spec.designSpeedTilesPerS ?? 1.5),
    viewRadius: Number(spec.viewRadius ?? 7),
    radius: Number(spec.radius ?? 0.4),
    harvestRatePerS: Number(spec.harvestRatePerS ?? 0.5),
    workRate: Number(cols.workRate?.[row] ?? spec.workRate ?? 1),
    maxBuildTier: Number(spec.maxBuildTier ?? cols.tier[row] ?? 1),
    maxTerraformTier: Number(spec.maxTerraformTier ?? cols.tier[row] ?? 1),
    cost: { ...cost },
    buildS: Number(spec.buildS ?? 50),
    designBuildS: Number(spec.designBuildS ?? 10),
    targetQ: cols.targetQ[row],
    targetR: cols.targetR[row],
    state: cols.state[row],
    currentJob,
    progress: Number(cols.progress?.[row] ?? 0),
    task: currentJob,
    carrying: Number(cols.cell?.[row] ?? 0),
  };
}

export function syncWorkerView(state: PlanetState, row: number, tick: number, data?: CompiledDataLike): WorkerUnitView {
  const unitView = buildWorkerView(state, row, data);
  const prevObj = (state.blobs.units?.value as Record<string, unknown> | undefined) ?? {};
  const prevById = (prevObj.byId as Record<string, Record<string, unknown>> | undefined) ?? {};
  const existingRec = prevById[String(unitView.entityId)];
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
    col.workers = [...withoutUnitView(col.workers, unitView.entityId), unitView];
    col.units = [...withoutUnitView(col.units, unitView.entityId), unitView];
    col.changedAt = tick;
  }
  return unitView;
}

/**
 * The views of `list` (`col.workers` / `col.units`) other than `entityId`'s. Dense arrays only: an index alias
 * (`list[entityId] = view`) made the array sparse, and the snapshot codec saves its holes as `null`, so a restored
 * planet crashed here (`reading 'entityId'` of null). Non-object entries are dropped, which heals such snapshots.
 */
export function withoutUnitView(list: unknown, entityId: number): WorkerUnitView[] {
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).filter(
    (u): u is WorkerUnitView => !!u && typeof u === 'object' && (u as WorkerUnitView).entityId !== entityId,
  );
}

/** Spawns one Worker Drone. `tier` is 1, 2, or 3 (default 1). Stats come from that tier's row. */
export function spawnWorkerUnit(state: PlanetState, opts: SpawnWorkerOpts, ctx?: StepContext): number {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const tier = workerTierOf(opts.tier);
  const rowDef = resolveWorkerRow(data, tier);
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;

  cols.kind[row] = ENTITY_KIND.worker;
  cols.owner[row] = opts.owner;
  cols.tier[row] = tier;
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
  syncWorkerView(state, row, tick, data);
  return id;
}

export function getWorkerView(state: PlanetState, entityId?: number, data?: CompiledDataLike): WorkerUnitView | null {
  const e = state.entities;
  const cols = e.cols;
  if (entityId !== undefined) {
    const row = rowOf(e, entityId);
    if (row < 0 || cols.kind[row] !== ENTITY_KIND.worker) return null;
    return buildWorkerView(state, row, data);
  }
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] === ENTITY_KIND.worker) return buildWorkerView(state, row, data);
  }
  return null;
}

export function listWorkerViews(state: PlanetState, owner?: number, data?: CompiledDataLike): WorkerUnitView[] {
  const e = state.entities;
  const cols = e.cols;
  const out: WorkerUnitView[] = [];
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.worker) continue;
    if (owner !== undefined && cols.owner[row] !== owner) continue;
    out.push(buildWorkerView(state, row, data));
  }
  return out;
}
