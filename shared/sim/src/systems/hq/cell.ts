import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { perTickToPerSecond, resolveHqT1Row, rowNum } from '../rows';
import { colonyTerraformOrders } from '../terraform-basic/orders';
import { resolveHqRow, syncHqView } from './view';

/**
 * The HQ power cell (`UO-HQ-06`, `UO-TF-02`): terraform work draws from it, and it recharges every step at the self
 * rate (`hq.t1.cellSelfRechargePerS`) or, within `cellFastRechargeRadius` of an active own Hub, at the fast rate
 * (`cellFastRechargePerS`). Rates are compiled per tick; the E/s getter converts back for the UI.
 */

/**
 * The progress one work step would make and the energy it needs, at the HQ's work rate (one formula for the draw and
 * for the recharge check, GP-28). `remaining` is the job's remaining progress; with `remainingEnergyE` a finishing
 * step draws exactly what the job still owes.
 */
function stepDemand(
  workRate: number,
  job: { baseTimeS: number; totalEnergyE: number },
  dtS: number,
  remaining?: number,
  remainingEnergyE?: number,
): { desiredProgress: number; neededE: number } | null {
  const nominalDurationS = job.baseTimeS / workRate;
  if (nominalDurationS <= 0) return null;
  const raw = dtS / nominalDurationS;
  const finishing = remaining !== undefined && remaining <= raw + 1e-6;
  const desiredProgress = remaining !== undefined ? Math.min(raw, Math.max(0, remaining)) : raw;
  const neededE = finishing && remainingEnergyE !== undefined ? Math.max(0, remainingEnergyE) : job.totalEnergyE * desiredProgress;
  return { desiredProgress, neededE };
}

const workRateOf = (state: PlanetState, row: number, data?: CompiledDataLike): number => {
  const rate = state.entities.cols.workRate[row];
  return rate > 0 ? rate : rowNum(resolveHqT1Row(data), 'workRate');
};

/** Whether HQ `row` is working a terraform tile this step and its cell covers the step's draw (then it does not recharge). */
function drawsFromCell(state: PlanetState, row: number, dtTicks: number, data?: CompiledDataLike): boolean {
  const cols = state.entities.cols;
  if (cols.state[row] !== ENTITY_STATE.working) return false;
  const job = colonyTerraformOrders(state, cols.owner[row])
    .map((o) => o.jobs[0])
    .find((j) => j && j.q === cols.targetQ[row] && j.r === cols.targetR[row]);
  if (!job) return false;
  const remaining = Math.max(0, 1 - (job.progress ?? 0));
  const d = stepDemand(workRateOf(state, row, data), job, (TICK_MS / 1000) * dtTicks, remaining);
  return d !== null && d.neededE > 0 && cols.cell[row] >= d.neededE - 1e-5;
}

/** Hub states that do not power the fast recharge (not built yet, or switched off). */
const NOT_POWERED: ReadonlySet<number> = new Set([ENTITY_STATE.constructing, ENTITY_STATE.waiting, ENTITY_STATE.descending, ENTITY_STATE.inert]);

/** Recharge of HQ `row` in E per tick: fast within `cellFastRechargeRadius` of an active own Hub, else self. */
function rechargePerTick(state: PlanetState, row: number, data?: CompiledDataLike): number {
  const hqRow = resolveHqT1Row(data);
  const fastRadius = rowNum(hqRow, 'cellFastRechargeRadius');
  const e = state.entities, cols = e.cols;
  const owner = cols.owner[row];
  for (let h = 0; h < e.count; h++) {
    if (cols.kind[h] !== ENTITY_KIND.hub || cols.owner[h] !== owner) continue;
    if (NOT_POWERED.has(cols.state[h])) continue;
    if (cols.hpMax[h] > 0 && cols.hp[h] <= 0) continue;
    if (hexDistance(cols.q[row], cols.r[row], cols.q[h], cols.r[h]) <= fastRadius) return rowNum(hqRow, 'cellFastRechargePerS');
  }
  return rowNum(hqRow, 'cellSelfRechargePerS');
}

/** The HQ power cell recharge rate in E/s (fast near an active own Hub, else self); 0 when `hqRow` is not an HQ. */
export function getHqRechargeRateEPerS(state: SimState, hqRow: number, data?: CompiledDataLike): number {
  const row = resolveHqRow(state, hqRow);
  return row < 0 ? 0 : perTickToPerSecond(rechargePerTick(state, row, data));
}

/** Clamps `energyE` to `[0, cellMax]`, writes HQ `hqRow`'s cell and syncs its view. */
export function setHqCellEnergy(state: SimState, hqRow: number, energyE: number, tick: number = state.meta.tick, data?: CompiledDataLike): void {
  const row = resolveHqRow(state, hqRow);
  if (row < 0) return;
  const cols = state.entities.cols;
  const maxE = cols.cellMax[row] > 0 ? cols.cellMax[row] : Math.fround(rowNum(resolveHqT1Row(data), 'cellCapacity'));
  setField(state.entities, row, 'cell', Math.fround(Math.max(0, Math.min(maxE, energyE))), tick);
  syncHqView(state, row, tick, data);
}

export interface StepTerraformWorkOpts {
  baseTimeS: number;
  totalEnergyE: number;
  dtS?: number;
  remainingProgress?: number;
  remainingEnergyE?: number;
  tick?: number;
  data?: CompiledDataLike;
}

export interface StepTerraformWorkResult {
  progressDelta: number;
  energyDrawnE: number;
}

/**
 * Advances a terraform operation by one step (`dtS`, default one tick) paying energy strictly from HQ `hqRow`'s cell
 * (`UO-HQ-06`, `UO-TF-02`). When the cell holds less than the step's draw, it draws everything and scales progress
 * down (so at 0 cell, work continues at the self-recharge trickle).
 */
export function stepTerraformWorkWithCell(state: SimState, hqRow: number, opts: StepTerraformWorkOpts): StepTerraformWorkResult {
  const row = resolveHqRow(state, hqRow);
  if (row < 0) return { progressDelta: 0, energyDrawnE: 0 };
  const cols = state.entities.cols;
  const tick = opts.tick ?? state.meta.tick;
  const d = stepDemand(workRateOf(state, row, opts.data), opts, opts.dtS ?? TICK_MS / 1000, opts.remainingProgress, opts.remainingEnergyE);
  if (!d) return { progressDelta: 1, energyDrawnE: 0 };
  if (d.neededE <= 0) return { progressDelta: d.desiredProgress, energyDrawnE: 0 };
  const availE = Math.max(0, cols.cell[row]);
  if (availE >= d.neededE - 1e-6) {
    const nextCell = Math.fround(Math.max(0, availE - d.neededE));
    setField(state.entities, row, 'cell', nextCell, tick);
    syncHqView(state, row, tick, opts.data);
    return { progressDelta: d.desiredProgress, energyDrawnE: availE - nextCell };
  }
  setField(state.entities, row, 'cell', 0, tick);
  syncHqView(state, row, tick, opts.data);
  return { progressDelta: d.desiredProgress * (availE / d.neededE), energyDrawnE: availE };
}

/** Power slot: recharges every alive HQ's cell (unless it drew from the cell for terraform work this step). */
export function stepHq(state: PlanetState, ctx?: Partial<StepContext>): void {
  const tick = ctx?.tick ?? state.meta.tick;
  const dtTicks = ctx?.dt ?? 1;
  const data = ctx?.data;
  const e = state.entities, cols = e.cols;
  const defaultCap = Math.fround(rowNum(resolveHqT1Row(data), 'cellCapacity'));
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hq) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    if (drawsFromCell(state, row, dtTicks, data)) {
      syncHqView(state, row, tick, data);
      continue;
    }
    const deltaE = Math.fround(rechargePerTick(state, row, data) * dtTicks);
    const maxE = cols.cellMax[row] > 0 ? cols.cellMax[row] : defaultCap;
    const nextE = Math.fround(Math.min(maxE, cols.cell[row] + deltaE));
    if (nextE !== cols.cell[row]) setField(e, row, 'cell', nextE, tick);
    syncHqView(state, row, tick, data);
  }
}
