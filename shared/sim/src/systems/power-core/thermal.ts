import type { ResourceKey } from '@terra/contracts';
import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { PlanetState } from '../../kernel/state';
import { ensureColonyLedger, type ColonyWithLedger } from '../economy/ledger';

export interface ThermalOutputBreakdown {
  grossOutputPerS: number;
  internalDrainPerS: number;
  netOutputPerS: number;
  fuelResource: ResourceKey;
  fuelPerS: number;
  pollutionPerPlant: number;
}

export interface ThermalPlantFuelStepResult {
  fueled: boolean;
  grossPerS: number;
  drainPerS: number;
  netPerS: number;
  fuelConsumedPerS: number;
}

let cachedW03Data: CompiledDataLike | null = null;
function defaultW03Data(): CompiledDataLike {
  if (!cachedW03Data) cachedW03Data = compileData(new Set(['W00', 'W01', 'W02', 'W03']));
  return cachedW03Data;
}

export function resolveThermalRow(data?: CompiledDataLike): CompiledRow {
  const row = (data?.tables?.grid as Record<string, CompiledRow> | undefined)?.thermal;
  if (row) return row;
  return dataRow(defaultW03Data(), 'grid', 'thermal');
}

export function evaluateThermalPlantOutput(data?: CompiledDataLike): ThermalOutputBreakdown {
  const row = resolveThermalRow(data);
  const grossOutputPerS = Number(row.grossOutputPerS ?? 28);
  const internalDrainPerS = Number(row.internalDrainPerS ?? 3);
  const netOutputPerS = Number(row.netOutputPerS ?? (grossOutputPerS - internalDrainPerS));
  const fuelResource = ((row.fuelResource as string) || 'bio.biomass') as ResourceKey;
  const fuelPerS = Number(row.fuelPerS ?? 0.375);
  const pollutionPerPlant = Number(row.pollutionPerPlant ?? 1);
  return {
    grossOutputPerS,
    internalDrainPerS,
    netOutputPerS,
    fuelResource,
    fuelPerS,
    pollutionPerPlant,
  };
}

/** Tracks which entity was fueled on a given tick, supporting read-only power queries within the same tick. */
const lastFueledTicks = new Map<number, number>();

export function resetThermalTracking(): void {
  lastFueledTicks.clear();
}

/**
 * Steps fuel consumption, entity state, and pollution accumulation for one Thermal Plant T1.
 * - Offline when fuel resource (default `bio.biomass`) is depleted (`<= 1e-6`).
 * - When online, drains `fuelPerS` scaled by `dtTicks` and adds pollution to `colony.pollution`.
 */
export function stepThermalPlantFuel(
  state: PlanetState,
  colonyIndex: number,
  row: number,
  dtTicks: number,
  tick: number,
  data?: CompiledDataLike,
): ThermalPlantFuelStepResult {
  const config = evaluateThermalPlantOutput(data);
  const { grossOutputPerS, internalDrainPerS, netOutputPerS, fuelResource, fuelPerS, pollutionPerPlant } = config;

  const rawColony = state.colonies[colonyIndex];
  if (!rawColony) {
    return { fueled: false, grossPerS: 0, drainPerS: 0, netPerS: 0, fuelConsumedPerS: 0 };
  }
  const colony: ColonyWithLedger = ensureColonyLedger(rawColony);
  colony.pollution = Number(colony.pollution ?? 0);

  const entityId = state.entities.cols.id[row];
  const curState = state.entities.cols.state[row];
  const currentStock = Number(colony.stock[fuelResource] ?? 0);

  // If dtTicks === 0 (read-only evaluation in evaluateColonyPower), check if fueled on this tick or has stock
  if (dtTicks === 0) {
    const wasFueledOnThisTick = lastFueledTicks.get(entityId) === tick;
    const hasFuel = wasFueledOnThisTick || currentStock > 1e-6;
    if (!hasFuel) {
      if (curState !== ENTITY_STATE.offlineNoFuel && curState !== ENTITY_STATE.offlineUnpowered) {
        setField(state.entities, row, 'state', ENTITY_STATE.offlineNoFuel, tick);
      }
      return { fueled: false, grossPerS: 0, drainPerS: 0, netPerS: 0, fuelConsumedPerS: 0 };
    }
    if (curState === ENTITY_STATE.offlineNoFuel) {
      setField(state.entities, row, 'state', ENTITY_STATE.active, tick);
    }
    return {
      fueled: true,
      grossPerS: grossOutputPerS,
      drainPerS: internalDrainPerS,
      netPerS: netOutputPerS,
      fuelConsumedPerS: fuelPerS,
    };
  }

  // Active step (dtTicks > 0)
  if (currentStock <= 1e-6) {
    lastFueledTicks.delete(entityId);
    if (curState !== ENTITY_STATE.offlineNoFuel && curState !== ENTITY_STATE.offlineUnpowered) {
      setField(state.entities, row, 'state', ENTITY_STATE.offlineNoFuel, tick);
    }
    return { fueled: false, grossPerS: 0, drainPerS: 0, netPerS: 0, fuelConsumedPerS: 0 };
  }

  // Plant has fuel for this step
  const neededFuel = (fuelPerS * TICK_MS * dtTicks) / 1000;
  const actualDeducted = Math.min(currentStock, neededFuel);
  const remaining = Number((currentStock - actualDeducted).toFixed(6));
  colony.stock[fuelResource] = remaining < 1e-6 ? 0 : remaining;
  colony.changedAt = tick;

  const pollutionDelta = (pollutionPerPlant * TICK_MS * dtTicks) / 1000;
  colony.pollution = Number(((Number(colony.pollution ?? 0)) + pollutionDelta).toFixed(4));
  lastFueledTicks.set(entityId, tick);

  if (curState === ENTITY_STATE.offlineNoFuel) {
    setField(state.entities, row, 'state', ENTITY_STATE.active, tick);
  }

  return {
    fueled: true,
    grossPerS: grossOutputPerS,
    drainPerS: internalDrainPerS,
    netPerS: netOutputPerS,
    fuelConsumedPerS: fuelPerS,
  };
}
