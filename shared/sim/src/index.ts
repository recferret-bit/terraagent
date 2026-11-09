/** @terra/sim: the one game engine (D-31). Pure and isomorphic: no Node, DOM, clock or randomness APIs (SIM-D-06). */
export * from './kernel/constants';
export * from './kernel/types';
export * from './kernel/rng';
export * from './kernel/state';
export * from './kernel/colonies';
export * from './kernel/events';
export * from './kernel/commands';
export * from './kernel/context';
export * from './kernel/config';
export * from './kernel/system';
export * from './kernel/step';
export { withLedgerSink } from './kernel/ledgerSink';
export * from './ecs/columns';
export * from './ecs/store';
export * from './grid/hex';
export * from './grid/layers';
export * from './grid/exploration';
export * from './grid/tileModel';
export * from './grid/path';
export * from './grid/geo';
export * from './grid/hexTile';
export * from './gen/generators';
export { createPlanet } from './gen/createPlanet';
export { DEV_PLANET_CAPACITY, DEV_PLANET_RADIUS, DEV_PLANET_SEED, DEV_PLANET_TYPE, DEV_PLANET_TYPES, devPlanetIdFor, devPlanetTypeOf, isDevPlanetType, type DevPlanetType } from './gen/flat';
export { buryWildDeposits, depositGroundMask } from './gen/depositGround';
export { getDepositRichnessBp } from './gen/temperate';
export {
  faunaHives,
  GEN_VERSION,
  generateWorld,
  generateWorld as generateTemperate,
  getWorldgenHiveSites,
  planWorldgenHiveSites,
  registerWorldStage,
  worldProfile,
  type PlanHiveSitesOptions,
  type WorldGenContext,
  type WorldStage,
} from './gen/world';
export * from './grid/sectors';
export * from './grid/subsurface';
export * from './atlas';
export * from './world/presence';
export * from './world/landingPlanner';
export * from './gen/spawnSlots';
export * from './gen/spawnGuarantee';
export * from './codec';
export * from './systems/define';
export * from './systems/registry';
export * from './ecs/placement';
export * from './systems/hq';
export { issueUnitCommand, moveUnit, stopUnit, UNIT_REGISTRY, units } from './systems/units';
export * from './units/types';
export { getUnitCommand, getUnitRecord, type UnitRecord } from './units/book';
export { isUnitKind, mobileStats, type MobileStats } from './units/mobility';
export { getMotion, type MoveGoal, type MotionStatus, type UnitMotion } from './units/movement/orchestrator';
export { advancePose } from './units/movement/locomotion';
export { assignSlots, ringCoords, type SlotUnit } from './units/movement/slots';
export type { IssueOpts } from './units/runner';
export * from './economy';
// Experiments import the host (SimHost → systems); exported from the root, not from `economy/index`, to avoid an import cycle.
export * from './economy/experiments';
export * from './systems/landing';
export * from './systems/terraform-basic';
export * from './systems/construction';
export * from './systems/territory-claim';
export * from './systems/time';
export * from './systems/harvest';
export * from './systems/economy/ledger';
export * from './systems/prestige';
export * from './systems/logistics';
export {
  BUILDING_KIND_BY_NAME,
  buildingKindName,
  cancelBuildingConstruction,
  constructionSystem,
  demolishBuilding,
  demolishHandler,
  getBuildingJobs,
  getFootprintTileIndices,
  isEconomyBuildingKind,
  startBuildingConstruction,
  type BuildingJobRecord,
  type StartConstructionOptions,
} from './systems/economy/construction';
export * from './systems/economy/events';
export * from './systems/environment';
export * from './systems/weather';
export * from './systems/power-core';
export * from './systems/production';
export * from './systems/factories-hub';
export * from './systems/supply';
export * from './systems/queue';
export * from './systems/dispatch';
export * from './systems/goals';
export * from './systems/progression';
export * from './systems/progression/validate';
export * from './systems/rule-engine';
export { DEFAULT_COLONY_PRIORITIES, type ColonyPriorities } from './systems/goals';
export * from './systems/cargo';
export * from './systems/trade';
export * from './systems/combat';
export * from './systems/fauna';
export * from './systems/fauna/directives';
export * from './systems/fauna/directivePayloads';
export * from './systems/fauna/checkpoints';
export * from './data';
export * from './host';
