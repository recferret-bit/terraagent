import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { PlanetState } from '../../kernel/state';
import { setField } from '../../ecs/store';
import { resolvePowerRow } from './index';

export interface WindOutput {
  windFactor: number;
  grossPerS: number;
  internalDrainPerS: number;
  netPerS: number;
}

export interface CapacitorStepResult {
  storedE: number;
  capacityE: number;
  dischargePerS: number;
  chargePerS: number;
}

/** Computes Wind Turbine T1 output (E/s) at low (25%), medium (100%) or high (150%) wind. */
export function evaluateWindOutput(
  state: PlanetState,
  colonyIndex: number,
  tick: number,
  data?: CompiledDataLike,
): WindOutput {
  const windRow = resolvePowerRow(data, 'grid', 'wind');
  const baseGross = Number(windRow.grossOutputPerS ?? 16);
  const internalDrain = Number(windRow.internalDrainPerS ?? 1);

  const colony = state.colonies[colonyIndex];
  const override = (colony as { windFactorOverride?: number } | undefined)?.windFactorOverride;

  let windFactor: number;
  if (typeof override === 'number' && Number.isFinite(override)) {
    windFactor = override;
  } else {
    const windowTicks = Number(windRow.windResampleTicks ?? 900);
    const period = Math.floor(tick / windowTicks);
    // Planet-wide deterministic weather, stable across replicas and colonies.
    let hash = Math.imul(period + 1, 0x45d9f3b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    windFactor = [0.25, 1, 1.5][((hash ^ (hash >>> 16)) >>> 0) % 3];
  }

  if (colony) {
    (colony as { windFactor?: number }).windFactor = windFactor;
  }

  const net = Number(((baseGross - internalDrain) * windFactor).toFixed(4));
  const gross = Number((net + internalDrain).toFixed(4));

  return {
    windFactor,
    grossPerS: gross,
    internalDrainPerS: internalDrain,
    netPerS: net,
  };
}

/** Steps capacitor charging on surplus or discharging up to 30 E/s per bank on deficit for a component. */
export function stepCapacitorsForComponent(
  state: PlanetState,
  capacitorRows: number[],
  generatorSupply: number,
  demand: number,
  dtTicks: number,
  tick: number,
  data?: CompiledDataLike,
): CapacitorStepResult {
  const capRow = resolvePowerRow(data, 'grid', 'capacitor');
  const maxDischargePerS = Number(capRow.maxDischargePerS ?? 30);
  const defaultCapacity = Number(capRow.capacityE ?? 1500);

  const e = state.entities, cols = e.cols;
  let storedE = 0;
  let capacityE = 0;

  for (const r of capacitorRows) {
    if ((cols.cellMax?.[r] ?? 0) <= 0) {
      setField(e, r, 'cellMax', defaultCapacity, tick);
    }
    const current = cols.cell?.[r] ?? 0;
    const maxCap = cols.cellMax?.[r] ?? defaultCapacity;
    storedE += current;
    capacityE += maxCap;
  }

  storedE = Number(storedE.toFixed(4));
  capacityE = Number(capacityE.toFixed(4));

  if (capacitorRows.length === 0) {
    return { storedE: 0, capacityE: 0, dischargePerS: 0, chargePerS: 0 };
  }

  const dtSeconds = dtTicks > 0 ? (dtTicks * TICK_MS) / 1000 : 0.2;
  const balance = Number((generatorSupply - demand).toFixed(4));

  if (balance > 0) {
    // Net surplus -> Charge capacitors
    const availableSurplusE = balance * dtSeconds;
    let totalRoom = 0;
    for (const r of capacitorRows) {
      const room = (cols.cellMax?.[r] ?? defaultCapacity) - (cols.cell?.[r] ?? 0);
      if (room > 0) totalRoom += room;
    }

    const chargedE = Math.min(availableSurplusE, totalRoom);
    const chargePerS = Number((chargedE / dtSeconds).toFixed(4));

    if (dtTicks > 0 && chargedE > 0 && totalRoom > 0) {
      for (const r of capacitorRows) {
        const room = (cols.cellMax?.[r] ?? defaultCapacity) - (cols.cell?.[r] ?? 0);
        if (room <= 0) continue;
        const addE = chargedE * (room / totalRoom);
        const newCell = Number((Math.min(cols.cellMax[r], (cols.cell?.[r] ?? 0) + addE)).toFixed(4));
        setField(e, r, 'cell', newCell, tick);
      }
      storedE = Number((storedE + chargedE).toFixed(4));
    }
    return { storedE, capacityE, dischargePerS: 0, chargePerS };
  }

  if (balance < 0 && storedE > 0) {
    // Net deficit -> Discharge capacitors up to 30 E/s each
    const neededE = Math.abs(balance) * dtSeconds;
    let totalMaxDischargeE = 0;
    for (const r of capacitorRows) {
      const current = cols.cell?.[r] ?? 0;
      if (current > 0) {
        totalMaxDischargeE += Math.min(maxDischargePerS * dtSeconds, current);
      }
    }

    const dischargeE = Math.min(neededE, totalMaxDischargeE);
    const dischargePerS = Number((dischargeE / dtSeconds).toFixed(4));

    if (dtTicks > 0 && dischargeE > 0 && totalMaxDischargeE > 0) {
      for (const r of capacitorRows) {
        const current = cols.cell?.[r] ?? 0;
        if (current <= 0) continue;
        const maxForThis = Math.min(maxDischargePerS * dtSeconds, current);
        const share = dischargeE * (maxForThis / totalMaxDischargeE);
        const newCell = Number((Math.max(0, current - share)).toFixed(4));
        setField(e, r, 'cell', newCell, tick);
      }
      storedE = Number((storedE - dischargeE).toFixed(4));
    }
    return { storedE, capacityE, dischargePerS, chargePerS: 0 };
  }

  return { storedE, capacityE, dischargePerS: 0, chargePerS: 0 };
}
