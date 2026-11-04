import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { computeColonyThreatStage } from './threatStage';
import { countColonyEntities } from './triggers';
import { getColonyProgression } from './index';

/** Minimum time after reaching S3 before fauna raids are allowed (`5 min = 300 s = 1500 ticks`, `UO-T-01`). */
export const RAID_START_FLOOR_S = 5 * 60;
export const RAID_START_FLOOR_TICKS = RAID_START_FLOOR_S * TICKS_PER_SECOND;

/** Minimum time after reaching S2 before meteor impacts are allowed (`10 min = 600 s = 3000 ticks`, `UO-T-07`). */
export const METEOR_START_FLOOR_S = 10 * 60;
export const METEOR_START_FLOOR_TICKS = METEOR_START_FLOOR_S * TICKS_PER_SECOND;

/** Maximum newcomer PvP raid protection age (`6 h = 21 600 s = 108 000 ticks`, `UO-T-05`). */
export const NEWCOMER_SHIELD_MAX_AGE_S = 6 * 3600;
export const NEWCOMER_SHIELD_MAX_AGE_TICKS = NEWCOMER_SHIELD_MAX_AGE_S * TICKS_PER_SECOND;

/** Maximum fauna raid creature count (`UO-T-02`). */
export const MAX_RAID_SIZE = 12;

export type RaidCompositionTier = 'none' | 'skitters' | 'skitters_and_brutes' | 'drifter_flock';

export interface RaidComposition {
  tier: RaidCompositionTier;
  skitters: number;
  brutes: number;
  drifterFlocks: number;
}

export interface ColonyThreatInput {
  stage?: number;
  threatStage?: number;
  tick?: number;
  ageS?: number;
  ageTicks?: number;
  createdAtTick?: number;
  s2ReachedAtTick?: number | null;
  s3ReachedAtTick?: number | null;
  timeInS2S?: number;
  timeInS3S?: number;
  thermalGenerators?: number;
  startedRaid?: boolean;
  closedWallRing?: boolean;
}

export interface ColonyThreatSummary {
  threatStage: number;
  raidsAllowed: boolean;
  raidSize: number;
  size: number;
  composition: RaidComposition;
  meteorsAllowed: boolean;
  raidProtected: boolean;
  thermalGenerators: number;
}

function isPlanetState(input: PlanetState | ColonyThreatInput | ColonyState): input is PlanetState {
  return (
    typeof input === 'object' &&
    input !== null &&
    'meta' in input &&
    'colonies' in input &&
    'entities' in input
  );
}

/**
 * Computes the raid creature composition for a given `threatStage` and `raidSize` (`UO-T-03`, `UO-T-08`).
 * - S3–S5: Skitters only
 * - S6–S7: +1 Brute per 4 creatures
 * - S8+: adds 1 Drifter flock (+1 extra if the colony has a closed wall ring)
 */
export function computeRaidComposition(
  threatStage: number,
  raidSize: number,
  raidsAllowed: boolean,
  closedWallRing = false,
): RaidComposition {
  if (!raidsAllowed || threatStage < 3 || raidSize <= 0) {
    return {
      tier: 'none',
      skitters: 0,
      brutes: 0,
      drifterFlocks: 0,
    };
  }
  const brutes = threatStage >= 6 ? Math.floor(raidSize / 4) : 0;
  const skitters = Math.max(0, raidSize - brutes);
  const drifterFlocks = threatStage >= 8 ? 1 + (closedWallRing ? 1 : 0) : 0;
  const tier: RaidCompositionTier =
    threatStage >= 8
      ? 'drifter_flock'
      : threatStage >= 6
        ? 'skitters_and_brutes'
        : 'skitters';

  return {
    tier,
    skitters,
    brutes,
    drifterFlocks,
  };
}

function evaluateThreatFromInput(input: ColonyThreatInput): ColonyThreatSummary {
  const stage = Math.max(0, Math.floor(input.stage ?? input.threatStage ?? 0));
  const threatStage = Math.max(0, Math.floor(input.threatStage ?? stage));
  const effectiveStage = Math.max(stage, threatStage);
  const currentTick = typeof input.tick === 'number' ? input.tick : 0;
  const thermalGenerators = Math.max(0, Math.floor(input.thermalGenerators ?? 0));

  // S3 elapsed ticks for fauna raid floor (S3 + 5 min)
  let s3ElapsedTicks = 0;
  if (typeof input.timeInS3S === 'number') {
    s3ElapsedTicks = Math.round(input.timeInS3S * TICKS_PER_SECOND);
  } else if (typeof input.s3ReachedAtTick === 'number') {
    s3ElapsedTicks = Math.max(0, currentTick - input.s3ReachedAtTick);
  }

  // S2 elapsed ticks for meteor floor (S2 + 10 min)
  let s2ElapsedTicks = 0;
  if (typeof input.timeInS2S === 'number') {
    s2ElapsedTicks = Math.round(input.timeInS2S * TICKS_PER_SECOND);
  } else if (typeof input.s2ReachedAtTick === 'number') {
    s2ElapsedTicks = Math.max(0, currentTick - input.s2ReachedAtTick);
  }

  const raidsAllowed = threatStage >= 3 && effectiveStage >= 3 && s3ElapsedTicks >= RAID_START_FLOOR_TICKS;
  const raidSize = raidsAllowed ? Math.min(MAX_RAID_SIZE, 2 + threatStage + thermalGenerators) : 0;
  const composition = computeRaidComposition(threatStage, raidSize, raidsAllowed, Boolean(input.closedWallRing));
  const meteorsAllowed = effectiveStage >= 2 && s2ElapsedTicks >= METEOR_START_FLOOR_TICKS;

  const colonyAgeTicks =
    typeof input.ageTicks === 'number'
      ? input.ageTicks
      : typeof input.ageS === 'number'
        ? Math.round(input.ageS * TICKS_PER_SECOND)
        : Math.max(0, currentTick - (input.createdAtTick ?? 0));

  const raidProtected =
    threatStage < 6 &&
    colonyAgeTicks < NEWCOMER_SHIELD_MAX_AGE_TICKS &&
    !input.startedRaid;

  return {
    threatStage,
    raidsAllowed,
    raidSize,
    size: raidSize,
    composition,
    meteorsAllowed,
    raidProtected,
    thermalGenerators,
  };
}

/**
 * Evaluates threat scaling and protection rules (`UO-T-01`..`UO-T-07`) for a colony on `state`
 * or a direct `ColonyThreatInput` snapshot.
 */
export function threatOf(
  stateOrColony: PlanetState | ColonyThreatInput | ColonyState,
  colonyIndex = 0,
): ColonyThreatSummary {
  if (!isPlanetState(stateOrColony)) {
    return evaluateThreatFromInput(stateOrColony as ColonyThreatInput);
  }

  const state = stateOrColony;
  const col = state.colonies[colonyIndex];
  const prog = getColonyProgression(state, colonyIndex);
  const counts = countColonyEntities(state, colonyIndex);
  const computedThreatStage = computeColonyThreatStage(state, colonyIndex, prog.stage);

  // Use building-derived threatStage when buildings exist; allow explicit col.threatStage override in synthetic unit tests
  const threatStage =
    counts.completedBuildings > 0
      ? computedThreatStage
      : typeof col?.threatStage === 'number' && col.threatStage > 0
        ? col.threatStage
        : computedThreatStage;

  const thermalGenerators =
    (counts.buildingCountsByKind.thermalGenerator ?? 0) +
    (counts.buildingCountsByKind.thermal ?? 0);

  const s2ReachedAtTick =
    typeof col?.s2ReachedAtTick === 'number'
      ? col.s2ReachedAtTick
      : typeof prog.s2ReachedAtTick === 'number'
        ? prog.s2ReachedAtTick
        : prog.stage >= 2
          ? prog.stageEnteredAtTick
          : null;

  const s3ReachedAtTick =
    typeof col?.s3ReachedAtTick === 'number'
      ? col.s3ReachedAtTick
      : typeof prog.s3ReachedAtTick === 'number'
        ? prog.s3ReachedAtTick
        : prog.stage >= 3
          ? prog.stageEnteredAtTick
          : null;

  const createdAtTick =
    typeof col?.createdAtTick === 'number'
      ? col.createdAtTick
      : 0;

  return evaluateThreatFromInput({
    stage: prog.stage,
    threatStage,
    tick: state.meta.tick,
    createdAtTick,
    s2ReachedAtTick,
    s3ReachedAtTick,
    thermalGenerators,
    startedRaid: Boolean(col?.startedRaid),
    closedWallRing: Boolean(col?.closedWallRing),
  });
}
