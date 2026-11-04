import type { DevStageArgs, StageOverride } from '@terra/contracts';
import { ENTITY_KIND } from '../../ecs/columns';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { ColonySuggestion } from '../goals/types';

export type { DevStageArgs, StageOverride };

/** Stage trigger evaluation interval in ticks (`1 Hz = 5` ticks at 5 TPS, `UO-LC-02`). */
export const STAGE_EVAL_INTERVAL_TICKS = TICKS_PER_SECOND;

/**
 * Extended building entity kind codes for progression trigger checks (`UO-LC-02`, `stages.ts`).
 * Extends `ENTITY_KIND` codes (`commandHub: 4`, `metalsExtractor: 5`, `solar: 6`).
 */
export const BUILDING_KIND = {
  commandHub: ENTITY_KIND.commandHub,
  hub: ENTITY_KIND.hub,
  metalsExtractor: ENTITY_KIND.metalsExtractor,
  solar: ENTITY_KIND.solar,
  // Live W03/W10 kinds share the authoritative entity registry; future kinds use preview codes.
  mineralsExtractor: ENTITY_KIND.mineralsQuarry,
  waterExtractor: ENTITY_KIND.waterExtractor,
  biomassExtractor: ENTITY_KIND.petroleumWell,
  wind: ENTITY_KIND.wind,
  thermalGenerator: ENTITY_KIND.thermal,
  pylon: ENTITY_KIND.pylon,
  depot: ENTITY_KIND.supplyDepot,
  storageDepot: ENTITY_KIND.supplyDepot,
  capacitor: ENTITY_KIND.capacitor,
  roboticsFactory: 40,
  robotics_factory: 40,
  turret: 17,
  pulseTurret: 18,
  wall: 19,
  radar: 20,
  outpostBeacon: ENTITY_KIND.territoryBeacon,
  territoryBeacon: ENTITY_KIND.territoryBeacon,
  tradeHub: ENTITY_KIND.tradeHub,
  road: 23,
  smelter: 24,
  chemicalPlant: 25,
  shieldDome: ENTITY_KIND.hazardShield,
  hazardShield: ENTITY_KIND.hazardShield,
  lightningRod: ENTITY_KIND.lightningRod,
  hydro: ENTITY_KIND.hydro,
  hydroGenerator: ENTITY_KIND.hydro,
  missileBattery: 27,
  researchLab: 28,
  heavyFoundry: 29,
  fusionReactor: 30,
  arcTower: 31,
  apexBay: 32,
  orbitalUplink: 33,
  planetaryShield: 34,
  launchPad: 35,
  fuelSynthesizer: 36,
  telemetryArray: 37,
  monument: 38,
} as const;

/**
 * Extended unit entity kind codes for progression trigger checks (`UO-LC-02`, `stages.ts`).
 * Extends `ENTITY_KIND` codes (`hq: 3`, `harvester: 7`).
 */
export const UNIT_KIND = {
  hq: ENTITY_KIND.hq,
  harvester: ENTITY_KIND.harvester,
  builder: ENTITY_KIND.builder,
  terraformer: ENTITY_KIND.terraformer,
  scout: 52,
  recon: 52,
  guard: 53,
  combatEngineer: 54,
  hauler: 55,
  multitask: 56,
  striker: 57,
  sapper: 58,
  envirobot: 59,
  tank: 60,
  artillery: 61,
  warden: 62,
  surveyDrone: 63,
  goliath: 64,
  valkyrie: 65,
  archon: 66,
  terraformingRig: 67,
} as const;

/** Canonical extractor building identifiers (`S2`, `S3` triggers). */
export const EXTRACTOR_BUILDING_IDS: readonly string[] = [
  'metalsExtractor',
  'mineralsExtractor',
  'waterExtractor',
  'biomassExtractor',
  'mineralsQuarry',
  'petroleumWell',
  'extractor',
];

/** Canonical generator building identifiers (`S2` trigger). */
export const GENERATOR_BUILDING_IDS: readonly string[] = [
  'solar',
  'wind',
  'thermalGenerator',
  'solarCollector',
  'thermal',
  'hydro',
  'fusionReactor',
  'generator',
];

/** Safety override target stages (`UO-LC-04`, `dev.stage` trigger). */
export const OVERRIDE_TARGET_STAGE: Readonly<Record<StageOverride, number>> = {
  storage: 2,
  fauna: 3,
  rival: 4,
  resource: 4,
  power: 5,
};

export interface ActiveStageSuggestion extends ColonySuggestion {
  kind: 'goal' | 'order';
  title: string;
  reason: string;
}

/** Per-colony progression record stored in `state.blobs.progression` and mirrored onto `colony`. */
export interface ColonyProgressionState {
  colonyIndex: number;
  stage: number;
  unlockStage: number;
  threatStage: number;
  stageEnteredAtTick: number;
  s2ReachedAtTick?: number | null;
  s3ReachedAtTick?: number | null;
  dwellRemainingTicks: number | null;
  dwellRemainingS: number | null;
  triggerSatisfiedForStage: number | null;
  nextStageConditionText: string;
  emittedStages: number[];
  offeredSuggestionStages: number[];
  lastEvaluatedTick: number | null;
  initialExploredCount?: number;
  stageOverride?: string;
}

/** Aggregated completed building and unit counts for a colony used by `evaluateStageTrigger`. */
export interface ColonyEntityCounts {
  completedBuildings: number;
  completedExtractors: number;
  completedGenerators: number;
  buildingCountsByKind: Record<string, number>;
  maxBuildingTierByKind: Record<string, number>;
  unitCountsByKind: Record<string, number>;
  totalUnits: number;
}
