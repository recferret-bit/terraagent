import { STAGE_TABLE_ROWS, getItemUnlockStage } from '../../data';
import type { PlanetState } from '../../kernel/state';
import { computeColonyThreatStage } from './threatStage';

/**
 * Returns the effective `unlockStage` for `colonyIndex` (`UO-LC-04`, `UO-LC-09`):
 * the maximum stage reached across any of the player's colonies (carried into `spawnColony`
 * when landing on a second planet, or advanced locally as `stage` rises).
 */
export function getColonyUnlockStage(state: PlanetState, colonyIndex = 0): number {
  const col = state.colonies[colonyIndex];
  const colStage = typeof col?.stage === 'number' ? col.stage : 0;
  const colUnlock = typeof col?.unlockStage === 'number' ? col.unlockStage : 0;

  const rawBlob = state.blobs.progression?.value as Record<string, unknown> | undefined;
  const byColony =
    rawBlob && typeof rawBlob.byColony === 'object' && rawBlob.byColony !== null
      ? (rawBlob.byColony as Record<string, unknown>)
      : rawBlob;
  const progEntry = byColony?.[String(colonyIndex)] as { stage?: number; unlockStage?: number } | undefined;
  const progStage = typeof progEntry?.stage === 'number' ? progEntry.stage : 0;
  const progUnlock = typeof progEntry?.unlockStage === 'number' ? progEntry.unlockStage : 0;

  return Math.max(0, colStage, colUnlock, progStage, progUnlock);
}

/**
 * Checks whether `itemId` (building, unit, or order) is unlocked for `colonyIndex`
 * under its `unlockStage` (`UO-LC-04`).
 */
export function isItemUnlockedForColony(
  state: PlanetState,
  colonyIndex: number,
  itemId: string,
): boolean {
  const requiredStage = getItemUnlockStage(itemId);
  return getColonyUnlockStage(state, colonyIndex) >= requiredStage;
}

/**
 * Returns the cumulative unlocked `units`, `buildings`, and `orders` for `colonyIndex`
 * up through its `unlockStage`, alongside its local `threatStage` (`UO-LC-04`, `UO-LC-09`).
 */
export function getColonyUnlockAndThreatSnapshot(
  state: PlanetState,
  colonyIndex = 0,
): {
  stage: number;
  unlockStage: number;
  threatStage: number;
  units: string[];
  buildings: string[];
  orders: string[];
} {
  const col = state.colonies[colonyIndex];
  const stage = typeof col?.stage === 'number' ? col.stage : 0;
  const unlockStage = getColonyUnlockStage(state, colonyIndex);
  const threatStage = computeColonyThreatStage(state, colonyIndex, stage);

  const units: string[] = [];
  const buildings: string[] = [];
  const orders: string[] = [];

  for (const row of STAGE_TABLE_ROWS) {
    if (row.stage <= unlockStage) {
      for (const u of row.units) if (!units.includes(u)) units.push(u);
      for (const b of row.buildings) if (!buildings.includes(b)) buildings.push(b);
      for (const o of row.orders) if (!orders.includes(o)) orders.push(o);
    }
  }

  return {
    stage,
    unlockStage,
    threatStage,
    units,
    buildings,
    orders,
  };
}
