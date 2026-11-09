import { ENTITY_KIND } from '../../ecs/columns';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { resolveWorkerRow, syncWorkerView } from './unit';

/** Idle and working power draw (E/s) of a Worker Drone of `tier` (its tier row, `resolveWorkerRow`). */
export function workerPowerDrain(tier: number, data?: CompiledDataLike): number {
  return Number(resolveWorkerRow(data, tier).powerDrainPerS ?? 2);
}

/** Compiled harvest rate (units/s) of a Worker Drone of `tier` (its tier row, `resolveWorkerRow`). */
export function harvestRateForWorker(tier: number, data?: CompiledDataLike): number {
  const n = Number(resolveWorkerRow(data, tier).harvestRatePerS);
  return Number.isFinite(n) && n > 0 ? n : Number(resolveWorkerRow(data, 1).harvestRatePerS ?? 0.5);
}

/** Writes the worker view after a harvest tick. */
export function syncHarvestWorkerView(state: PlanetState, row: number, tick: number, data?: CompiledDataLike): void {
  if (state.entities.cols.kind[row] === ENTITY_KIND.worker) syncWorkerView(state, row, tick, data);
}
