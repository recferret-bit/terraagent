import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow, rowOf, setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, touchTile, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';

export type SimState = PlanetState;

export type HqJob = 'idle' | 'moving' | 'working' | 'constructing';

export interface HqUnitView {
  entityId: number;
  owner: number;
  tier: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  cell: number;
  cellMax: number;
  workRate: number;
  viewRadius: number;
  targetQ: number;
  targetR: number;
  currentJob: HqJob;
  queueCount: number;
}

export interface SpawnHqOpts {
  owner: number;
  q: number;
  r: number;
  tick?: number;
  data?: CompiledDataLike;
}

let cachedW01Data: CompiledDataLike | null = null;

export function defaultW01Data(): CompiledDataLike {
  if (!cachedW01Data) cachedW01Data = compileData(new Set(['W00', 'W01']));
  return cachedW01Data;
}

export function resolveHqT1Row(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables.hq as Record<string, CompiledRow> | undefined;
  if (table?.t1) return table.t1;
  return dataRow(defaultW01Data(), 'hq', 't1');
}

export function hqJobFromState(stateCode: number): HqJob {
  if (stateCode === ENTITY_STATE.moving) return 'moving';
  if (stateCode === ENTITY_STATE.working) return 'working';
  if (stateCode === ENTITY_STATE.constructing) return 'constructing';
  return 'idle';
}

/** Marks all tiles within `viewRadius` of `(centerQ, centerR)` as explored for `owner`. */
export function revealVision(
  state: PlanetState,
  owner: number,
  centerQ: number,
  centerR: number,
  viewRadius: number,
  tick: number,
): void {
  if (owner < 0 || owner >= 8) return;
  const mask = 1 << owner;
  const idx = hexIndex(state.grid.radius);
  const explored = state.grid.layers.explored as Uint8Array;
  for (let dr = -viewRadius; dr <= viewRadius; dr++) {
    const dqMin = Math.max(-viewRadius, -dr - viewRadius);
    const dqMax = Math.min(viewRadius, -dr + viewRadius);
    for (let dq = dqMin; dq <= dqMax; dq++) {
      const tileIdx = idx.indexOf(centerQ + dq, centerR + dr);
      if (tileIdx < 0) continue;
      const prev = explored[tileIdx];
      const next = prev | mask;
      if (next !== prev) {
        explored[tileIdx] = next;
        touchTile(state, tileIdx, tick);
      }
    }
  }
}

/** Resolves an HQ entity row index from either a store slot/row index or an entity id. */
export function resolveHqRow(state: PlanetState, hqSlotOrId: number): number {
  const e = state.entities;
  const cols = e.cols;
  if (hqSlotOrId >= 0 && hqSlotOrId < e.count && cols.kind[hqSlotOrId] === ENTITY_KIND.hq) {
    return hqSlotOrId;
  }
  const byId = rowOf(e, hqSlotOrId);
  if (byId >= 0 && cols.kind[byId] === ENTITY_KIND.hq) {
    return byId;
  }
  if (hqSlotOrId >= 0 && hqSlotOrId < e.count) return hqSlotOrId;
  return byId;
}

/** Updates `state.blobs.hq` and colony HQ panel fields for row `row`. */
export function syncHqView(
  state: PlanetState,
  row: number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): HqUnitView {
  const cols = state.entities.cols;
  let targetRow = row;
  let stampTick = tick;
  if (
    (targetRow < 0 || targetRow >= state.entities.count || cols.kind[targetRow] !== ENTITY_KIND.hq) &&
    tick >= 0 &&
    tick < state.entities.count &&
    cols.kind[tick] === ENTITY_KIND.hq
  ) {
    targetRow = tick;
    stampTick = state.meta.tick;
  }
  const hqRow = resolveHqT1Row(data);
  const owner = cols.owner[targetRow];
  const currentJob = hqJobFromState(cols.state[targetRow]);
  const queueCount = currentJob === 'idle' ? 0 : 1;
  const unitView: HqUnitView = {
    entityId: cols.id[targetRow],
    owner,
    tier: cols.tier[targetRow],
    q: cols.q[targetRow],
    r: cols.r[targetRow],
    x: cols.x[targetRow],
    y: cols.y[targetRow],
    hp: cols.hp[targetRow],
    hpMax: cols.hpMax[targetRow],
    cell: cols.cell[targetRow],
    cellMax: cols.cellMax[targetRow],
    workRate: cols.workRate[targetRow],
    viewRadius: Number(hqRow.viewRadius),
    targetQ: cols.targetQ[targetRow],
    targetR: cols.targetR[targetRow],
    currentJob,
    queueCount,
  };
  const prevBlob = (state.blobs.hq?.value as { byColony?: Record<number, HqUnitView> } | undefined)?.byColony ?? {};
  setBlob(state, 'hq', { ...unitView, byColony: { ...prevBlob, [owner]: unitView } }, stampTick);
  const col = state.colonies[owner];
  if (col) {
    col.hq = unitView;
    col.currentJob = currentJob;
    col.queueCount = queueCount;
    col.changedAt = stampTick;
  }
  return unitView;
}

/** Returns the current HQ panel view for `owner` (defaults to the first HQ found when `owner` is omitted). */
export function getHqView(state: PlanetState, owner?: number): HqUnitView | null {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hq) continue;
    if (owner !== undefined && cols.owner[row] !== owner) continue;
    const hqRow = resolveHqT1Row();
    const currentJob = hqJobFromState(cols.state[row]);
    return {
      entityId: cols.id[row],
      owner: cols.owner[row],
      tier: cols.tier[row],
      q: cols.q[row],
      r: cols.r[row],
      x: cols.x[row],
      y: cols.y[row],
      hp: cols.hp[row],
      hpMax: cols.hpMax[row],
      cell: cols.cell[row],
      cellMax: cols.cellMax[row],
      workRate: cols.workRate[row],
      viewRadius: Number(hqRow.viewRadius),
      targetQ: cols.targetQ[row],
      targetR: cols.targetR[row],
      currentJob,
      queueCount: currentJob === 'idle' ? 0 : 1,
    };
  }
  return null;
}

/**
 * Spawns an HQ T1 Commander Drone at `(opts.q, opts.r)` for `opts.owner`, initializes its stats from `hq.t1`,
 * reveals initial fog-of-war within `viewRadius` (9), and returns the spawned `entityId`.
 */
export function spawnHqUnit(state: PlanetState, opts: SpawnHqOpts, ctx?: StepContext): number {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const hqRow = resolveHqT1Row(data);
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;

  cols.kind[row] = ENTITY_KIND.hq;
  cols.owner[row] = opts.owner;
  cols.tier[row] = Number(hqRow.tier);
  cols.q[row] = opts.q;
  cols.r[row] = opts.r;
  cols.x[row] = Math.fround(opts.q);
  cols.y[row] = Math.fround(opts.r);
  cols.rot[row] = 0;
  cols.hp[row] = Math.fround(Number(hqRow.hp));
  cols.hpMax[row] = Math.fround(Number(hqRow.hp));
  cols.state[row] = ENTITY_STATE.idle;
  cols.progress[row] = 0;
  cols.cell[row] = Math.fround(Number(hqRow.cellCapacity));
  cols.cellMax[row] = Math.fround(Number(hqRow.cellCapacity));
  cols.targetQ[row] = opts.q;
  cols.targetR[row] = opts.r;
  cols.workRate[row] = Math.fround(Number(hqRow.workRate));
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  revealVision(state, opts.owner, opts.q, opts.r, Number(hqRow.viewRadius), tick);
  syncHqView(state, row, tick, data);
  return id;
}

/**
 * Returns the HQ power cell recharge rate in E/s (`20` if within `hubRechargeRadius` (6) hexes of an active/powered
 * own Command Hub, else `3` self-recharge).
 */
export function getHqRechargeRateEPerS(state: SimState, hqSlot: number, data?: CompiledDataLike): number {
  const row = resolveHqRow(state, hqSlot);
  if (row < 0) return 0;
  const hqRow = resolveHqT1Row(data);
  const selfRate = Number(hqRow.designCellSelfRechargePerS ?? hqRow.selfRechargeEPerS ?? 3);
  const fastRate = Number(hqRow.designCellFastRechargePerS ?? hqRow.hubRechargeEPerS ?? 20);
  const fastRadius = Number(hqRow.cellFastRechargeRadius ?? hqRow.hubRechargeRadius ?? 6);
  const e = state.entities;
  const cols = e.cols;
  const owner = cols.owner[row];
  const hqQ = cols.q[row];
  const hqR = cols.r[row];

  for (let h = 0; h < e.count; h++) {
    if (cols.kind[h] !== ENTITY_KIND.hub) continue;
    if (cols.owner[h] !== owner) continue;
    if (
      cols.state[h] === ENTITY_STATE.constructing ||
      cols.state[h] === ENTITY_STATE.waiting ||
      cols.state[h] === ENTITY_STATE.descending ||
      cols.state[h] === ENTITY_STATE.inert
    ) {
      continue;
    }
    if (cols.hpMax[h] > 0 && cols.hp[h] <= 0) continue;
    if (hexDistance(hqQ, hqR, cols.q[h], cols.r[h]) <= fastRadius) {
      return fastRate;
    }
  }
  return selfRate;
}

/** Clamps `energyE` to `[0, ecs.cellMax[hqSlot]]`, updates `ecs.cell[hqSlot]`, and syncs the HQ view. */
export function setHqCellEnergy(
  state: SimState,
  hqSlot: number,
  energyE: number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): void {
  const row = resolveHqRow(state, hqSlot);
  if (row < 0) return;
  const cols = state.entities.cols;
  const maxE = cols.cellMax[row] > 0 ? cols.cellMax[row] : Math.fround(Number(resolveHqT1Row(data).cellCapacity));
  const clamped = Math.fround(Math.max(0, Math.min(maxE, energyE)));
  setField(state.entities, row, 'cell', clamped, tick);
  syncHqView(state, row, tick, data);
}

export interface StepTerraformWorkOpts {
  baseTimeS: number;
  totalEnergyE: number;
  dtS?: number;
}

export interface StepTerraformWorkResult {
  progressDelta: number;
  energyDrawnE: number;
}

/**
 * Advances a terraform operation by one step (`dtS`, default 0.2s) paying energy strictly from the HQ's power cell
 * (`UO-HQ-06`, `UO-TF-02`). When cell energy is below the nominal step draw, draws all available cell energy and
 * scales progress proportionally (so at 0 cell, work continues at the 3 E/s self-recharge trickle).
 */
export function stepTerraformWorkWithCell(
  state: SimState,
  hqSlot: number,
  opts: StepTerraformWorkOpts,
): StepTerraformWorkResult {
  const row = resolveHqRow(state, hqSlot);
  if (row < 0) return { progressDelta: 0, energyDrawnE: 0 };
  const cols = state.entities.cols;
  const dtS = opts.dtS ?? TICK_MS / 1000;
  const workRate = cols.workRate[row] > 0 ? cols.workRate[row] : Number(resolveHqT1Row().workRate);
  const nominalDurationS = opts.baseTimeS / workRate;
  if (nominalDurationS <= 0) return { progressDelta: 1, energyDrawnE: 0 };
  const desiredProgress = dtS / nominalDurationS;
  const neededE = opts.totalEnergyE * desiredProgress;
  if (neededE <= 0) return { progressDelta: desiredProgress, energyDrawnE: 0 };

  const availE = Math.max(0, cols.cell[row]);
  if (availE >= neededE) {
    const nextCell = Math.fround(availE - neededE);
    setField(state.entities, row, 'cell', nextCell, state.meta.tick);
    syncHqView(state, row, state.meta.tick);
    return { progressDelta: desiredProgress, energyDrawnE: neededE };
  }

  setField(state.entities, row, 'cell', 0, state.meta.tick);
  syncHqView(state, row, state.meta.tick);
  const progressDelta = desiredProgress * (availE / neededE);
  return { progressDelta, energyDrawnE: availE };
}

/** Steps HQ power cell recharge for all alive HQ units (`3 E/s` self-recharge or `20 E/s` within 6 hexes of an active Hub). */
export function stepHq(state: PlanetState, ctx?: Partial<StepContext>): void {
  const tick = ctx?.tick ?? state.meta.tick;
  const dtTicks = ctx?.dt ?? 1;
  const data = ctx?.data;
  const e = state.entities;
  const cols = e.cols;
  const defaultCap = Math.fround(Number(resolveHqT1Row(data).cellCapacity));

  for (let slot = 0; slot < e.count; slot++) {
    if (cols.kind[slot] !== ENTITY_KIND.hq) continue;
    if (cols.hpMax[slot] > 0 && cols.hp[slot] <= 0) continue;
    const rateEPerS = getHqRechargeRateEPerS(state, slot, data);
    const deltaE = Math.fround(rateEPerS * (TICK_MS / 1000) * dtTicks);
    const maxE = cols.cellMax[slot] > 0 ? cols.cellMax[slot] : defaultCap;
    const nextE = Math.fround(Math.min(maxE, cols.cell[slot] + deltaE));
    setField(e, slot, 'cell', nextE, tick);
    syncHqView(state, slot, tick, data);
  }
}

export const hq = defineSystem({
  id: 'hq',
  slot: 6,
  wave: 'W01',
  run(state, ctx) {
    stepHq(state, ctx);
  },
});

export default defineSimModule({ id: 'hq', wave: 'W01', systems: [hq] });
