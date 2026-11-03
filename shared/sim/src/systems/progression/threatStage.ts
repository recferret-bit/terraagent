import { STAGE_TABLE_ROWS, getStageSpec } from '../../data';
import { ensureColonyRecord } from '../../kernel/colonies';
import { setBlob, type PlanetState } from '../../kernel/state';
import { countColonyEntities } from './triggers';
import type { ColonyEntityCounts, ColonyProgressionState } from './types';

function resolveColonyReachedStage(
  state: PlanetState,
  colonyIndex: number,
  colonyStageOverride?: number,
): number {
  if (typeof colonyStageOverride === 'number') return colonyStageOverride;
  const col = state.colonies[colonyIndex];
  const colStage = typeof col?.stage === 'number' ? col.stage : 0;
  const rawBlob = state.blobs.progression?.value as Record<string, unknown> | undefined;
  const byColony =
    rawBlob && typeof rawBlob.byColony === 'object' && rawBlob.byColony !== null
      ? (rawBlob.byColony as Record<string, unknown>)
      : rawBlob;
  const progEntry = byColony?.[String(colonyIndex)] as { stage?: number } | undefined;
  const progStage = typeof progEntry?.stage === 'number' ? progEntry.stage : 0;
  return Math.max(colStage, progStage);
}

/**
 * Checks whether `colonyIndex` currently owns an alive, completed gating building for `stage` (`UO-T-06`).
 */
export function ownsStageGatingBuilding(
  state: PlanetState,
  colonyIndex: number,
  stage: number,
  counts: ColonyEntityCounts = countColonyEntities(state, colonyIndex),
  colonyStage: number = resolveColonyReachedStage(state, colonyIndex),
): boolean {
  if (stage <= 0) return true;
  const col = state.colonies[colonyIndex];

  switch (stage) {
    case 1:
      return (counts.buildingCountsByKind.commandHub ?? 0) >= 1;
    case 2:
      return counts.completedExtractors >= 1 && counts.completedGenerators >= 1;
    case 3:
      return (counts.buildingCountsByKind.roboticsFactory ?? 0) >= 1;
    case 4: {
      const hasFactory = (counts.buildingCountsByKind.roboticsFactory ?? 0) >= 1;
      if (!hasFactory) return false;
      return (
        colonyStage >= 4 ||
        (counts.buildingCountsByKind.outpostBeacon ?? 0) >= 1 ||
        (counts.buildingCountsByKind.tradeHub ?? 0) >= 1
      );
    }
    case 5:
      return (
        (counts.buildingCountsByKind.smelter ?? 0) >= 1 ||
        (counts.buildingCountsByKind.commandHub_t2 ?? 0) >= 1 ||
        (counts.maxBuildingTierByKind.commandHub ?? 0) >= 2 ||
        Number(col?.hubTier ?? 0) >= 2
      );
    case 6:
      return (
        (counts.buildingCountsByKind.roboticsFactory_t2 ?? 0) >= 1 ||
        (counts.maxBuildingTierByKind.roboticsFactory ?? 0) >= 2
      );
    case 7:
      return (counts.buildingCountsByKind.heavyFoundry ?? 0) >= 1;
    case 8:
      return (
        (counts.buildingCountsByKind.commandHub_t3 ?? 0) >= 1 ||
        (counts.maxBuildingTierByKind.commandHub ?? 0) >= 3 ||
        Number(col?.hubTier ?? 0) >= 3
      );
    case 9:
      return (counts.buildingCountsByKind.orbitalUplink ?? 0) >= 1;
    case 10:
      return (counts.buildingCountsByKind.launchPad ?? 0) >= 1;
    default: {
      const spec = getStageSpec(stage);
      if (!spec || !spec.gatingBuilding) return false;
      return (counts.buildingCountsByKind[spec.gatingBuilding] ?? 0) >= 1;
    }
  }
}

/**
 * Computes `threatStage` for `colonyIndex` (`UO-T-06`): the highest stage (`0..10`) whose gating building
 * the colony currently owns (alive and completed). Losing a gating building immediately lowers `threatStage`.
 */
export function computeColonyThreatStage(
  state: PlanetState,
  colonyIndex: number,
  colonyStageOverride?: number,
): number {
  const counts = countColonyEntities(state, colonyIndex);
  const colStage = resolveColonyReachedStage(state, colonyIndex, colonyStageOverride);
  let highest = 0;
  for (const row of STAGE_TABLE_ROWS) {
    if (row.stage <= 0) continue;
    if (ownsStageGatingBuilding(state, colonyIndex, row.stage, counts, colStage)) {
      if (row.stage > highest) highest = row.stage;
    }
  }
  return highest;
}

/**
 * Recomputes `threatStage` for `colonyIndex` and synchronizes it onto `state.colonies[colonyIndex]`
 * and `state.blobs.progression` (`UO-T-06`).
 */
export function syncColonyThreatStage(
  state: PlanetState,
  colonyIndex: number,
  tick: number = state.meta.tick,
): number {
  const threatStage = computeColonyThreatStage(state, colonyIndex);
  if (state.colonies[colonyIndex]) {
    const colony = ensureColonyRecord(state, colonyIndex, tick);
    if (colony.threatStage !== threatStage) {
      colony.threatStage = threatStage;
      colony.changedAt = tick;
    }
  }

  const raw = state.blobs.progression?.value;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const source =
      obj.byColony && typeof obj.byColony === 'object'
        ? (obj.byColony as Record<string, unknown>)
        : obj;
    const rec = source[String(colonyIndex)] as ColonyProgressionState | undefined;
    if (rec && typeof rec === 'object' && rec.threatStage !== threatStage) {
      const nextMap: Record<string, unknown> = {
        ...source,
        [String(colonyIndex)]: { ...rec, threatStage },
      };
      setBlob(state, 'progression', nextMap, tick);
    }
  }
  return threatStage;
}
