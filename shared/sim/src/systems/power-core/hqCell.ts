import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { PlanetState } from '../../kernel/state';
import { ENTITY_KIND } from '../../ecs/columns';
import { hexDistance } from '../../grid/hex';
import { perTickToPerSecond } from '../rows';
import { setHqCellEnergy } from '../hq/cell';
import { resolvePowerRow } from './index';
import { stepCapacitorsForComponent, type CapacitorStepResult } from './windAndCap';
import type { ColonyPowerSummary } from './types';

/**
 * The HQ power cell as the colony grid's first store (owner feedback "all dies at night", W03): while the colony has an
 * active Command Hub, the Hub's grid component covers a deficit from the HQ cell before its Capacitor Banks, and its
 * surplus refills the cell before the banks. The cell then stops recharging for free (`hq/cell.ts` `stepHq` skips it
 * while `ColonyPowerSummary.hqCellLinked`): every E it gains is grid surplus.
 * - Charge cap: `hq.t1.cellFastRechargePerS` while the HQ is within `cellFastRechargeRadius` of a Hub, else
 *   `cellSelfRechargePerS` (docking still recharges faster).
 * - Discharge cap: `hq.t1.cellGridDischargePerS`, wherever the HQ is (the Hub is linked to its commander).
 * `cols.cell` also holds Worker cargo, so rows are picked by `ENTITY_KIND.hq` only. With `dtTicks = 0` (a read-only
 * evaluation) the rates are reported and nothing is written.
 */
export interface HqCellStepResult {
  linked: boolean;
  storedE: number;
  capacityE: number;
  dischargePerS: number;
  chargePerS: number;
}

const UNLINKED: HqCellStepResult = { linked: false, storedE: 0, capacityE: 0, dischargePerS: 0, chargePerS: 0 };

interface HqCellRow {
  row: number;
  cell: number;
  room: number;
  chargeCapPerS: number;
}

function colonyHqCells(
  state: PlanetState,
  colonyIndex: number,
  hubAnchors: ReadonlyArray<{ q: number; r: number }>,
  data?: CompiledDataLike,
): { cells: HqCellRow[]; capacityE: number } {
  const hqRow = resolvePowerRow(data, 'hq', 't1');
  const defaultCap = Number(hqRow.cellCapacity ?? 0);
  const radius = Number(hqRow.cellFastRechargeRadius ?? 0);
  const fastPerS = perTickToPerSecond(Number(hqRow.cellFastRechargePerS ?? 0));
  const selfPerS = perTickToPerSecond(Number(hqRow.cellSelfRechargePerS ?? 0));
  const e = state.entities, cols = e.cols;
  const cells: HqCellRow[] = [];
  let capacityE = 0;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hq || cols.owner[row] !== colonyIndex) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    const maxE = cols.cellMax[row] > 0 ? cols.cellMax[row] : defaultCap;
    const cell = Math.max(0, Math.min(maxE, cols.cell[row]));
    const docked = hubAnchors.some((h) => hexDistance(cols.q[row], cols.r[row], h.q, h.r) <= radius);
    cells.push({ row, cell, room: Math.max(0, maxE - cell), chargeCapPerS: docked ? fastPerS : selfPerS });
    capacityE += maxE;
  }
  return { cells, capacityE };
}

/** Charges the colony's HQ cell(s) from `generatorSupply − demand` surplus, or discharges them on a deficit. */
export function stepHqCellForComponent(
  state: PlanetState,
  colonyIndex: number,
  hasHub: boolean,
  hubAnchors: ReadonlyArray<{ q: number; r: number }>,
  generatorSupply: number,
  demand: number,
  dtTicks: number,
  tick: number,
  data?: CompiledDataLike,
): HqCellStepResult {
  if (!hasHub) return UNLINKED;
  const { cells, capacityE } = colonyHqCells(state, colonyIndex, hubAnchors, data);
  if (cells.length === 0) return UNLINKED;
  const dischargeCapPerS = perTickToPerSecond(Number(resolvePowerRow(data, 'hq', 't1').cellGridDischargePerS ?? 0));
  const dtS = dtTicks > 0 ? (dtTicks * TICK_MS) / 1000 : TICK_MS / 1000;
  let storedE = cells.reduce((s, c) => s + c.cell, 0);
  const balance = Number((generatorSupply - demand).toFixed(4));
  let movedE = 0;

  if (balance > 0) {
    let leftE = balance * dtS;
    for (const c of cells) {
      const addE = Math.min(leftE, c.chargeCapPerS * dtS, c.room);
      if (addE <= 0) continue;
      leftE -= addE; movedE += addE;
      if (dtTicks > 0) setHqCellEnergy(state, c.row, c.cell + addE, tick, data);
    }
    storedE += movedE;
    return { linked: true, storedE: round4(storedE), capacityE: round4(capacityE), dischargePerS: 0, chargePerS: round4(movedE / dtS) };
  }
  if (balance < 0) {
    let needE = -balance * dtS;
    for (const c of cells) {
      const takeE = Math.min(needE, dischargeCapPerS * dtS, c.cell);
      if (takeE <= 0) continue;
      needE -= takeE; movedE += takeE;
      if (dtTicks > 0) setHqCellEnergy(state, c.row, c.cell - takeE, tick, data);
    }
    storedE -= movedE;
  }
  return { linked: true, storedE: round4(storedE), capacityE: round4(capacityE), dischargePerS: round4(movedE / dtS), chargePerS: 0 };
}

const round4 = (n: number): number => Number(Math.max(0, n).toFixed(4));

/**
 * Steps a component's stores in order: the HQ cell first (it takes the deficit / the surplus up to its caps), then the
 * Capacitor Banks with what is left. Returns the supply the shedding sees: generation plus both discharges.
 */
export function stepComponentStores(
  state: PlanetState,
  colonyIndex: number,
  hasHub: boolean,
  hubAnchors: ReadonlyArray<{ q: number; r: number }>,
  capRows: number[],
  generatorSupply: number,
  demand: number,
  dtTicks: number,
  tick: number,
  data?: CompiledDataLike,
): { hqCell: HqCellStepResult; capRes: CapacitorStepResult; effectiveSupply: number } {
  const hqCell = stepHqCellForComponent(state, colonyIndex, hasHub, hubAnchors, generatorSupply, demand, dtTicks, tick, data);
  const afterCell = Number((generatorSupply + hqCell.dischargePerS - hqCell.chargePerS).toFixed(4));
  const capRes = stepCapacitorsForComponent(state, capRows, afterCell, demand, dtTicks, tick, data);
  const effectiveSupply = Number((generatorSupply + hqCell.dischargePerS + capRes.dischargePerS).toFixed(4));
  return { hqCell, capRes, effectiveSupply };
}

/** Per-component store results, as `evaluateSingleComponent` returns them. */
interface ComponentStores {
  genSupply: number;
  capStoredE: number; capCapacityE: number; capDischargePerS: number; capChargePerS: number;
  hqCell: HqCellStepResult;
}

/** The colony summary's store fields: generation, Capacitor Banks summed over components, the (Hub's) HQ cell. */
export function summarizeComponentStores(results: readonly ComponentStores[]): Pick<
  ColonyPowerSummary,
  'capacitorStoredE' | 'capacitorCapacityE' | 'capacitorDischargePerS' | 'capacitorChargePerS' | 'generationPerS'
  | 'hqCellLinked' | 'hqCellStoredE' | 'hqCellCapacityE' | 'hqCellDischargePerS' | 'hqCellChargePerS'
> {
  const sum = (f: (r: ComponentStores) => number): number => results.reduce((s, r) => s + f(r), 0);
  const cell = results.find((r) => r.hqCell.linked)?.hqCell ?? UNLINKED;
  return {
    capacitorStoredE: sum((r) => r.capStoredE),
    capacitorCapacityE: sum((r) => r.capCapacityE),
    capacitorDischargePerS: sum((r) => r.capDischargePerS),
    capacitorChargePerS: sum((r) => r.capChargePerS),
    generationPerS: Number(sum((r) => r.genSupply).toFixed(4)),
    hqCellLinked: cell.linked,
    hqCellStoredE: cell.storedE,
    hqCellCapacityE: cell.capacityE,
    hqCellDischargePerS: cell.dischargePerS,
    hqCellChargePerS: cell.chargePerS,
  };
}
