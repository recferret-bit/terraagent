import { hexCount } from '@terra/sim/grid/hex';
import type { PoolThresholdSpec } from './ObjectPool';

export type CellPoolSpec = PoolThresholdSpec & { readonly instanceCapacity: number };

/**
 * Smart domain-calibrated pool thresholds for all building & hive archetypes.
 * Singleton/landmark capital structures (`Command Hub`, `Trade Hub`, `Rocket`) keep small pools (`threshold: 6..10`),
 * whereas repeatable colony infrastructure (`pylon`, `solar`, `wind`, `mine`, `turret`) holds larger pools.
 */
export const BUILDING_POOL_THRESHOLDS: Readonly<Record<string, PoolThresholdSpec>> = {
  'building.commandHub': { initialSize: 2, threshold: 10 },
  'building.tradeHub': { initialSize: 1, threshold: 10 },
  'building.rocket': { initialSize: 1, threshold: 6 },
  'building.claimBeacon': { initialSize: 2, threshold: 24 },
  'building.roboticsFactory': { initialSize: 2, threshold: 16 },
  'building.droneArray': { initialSize: 2, threshold: 16 },
  'building.pylon': { initialSize: 8, threshold: 120 },
  'building.solar': { initialSize: 6, threshold: 96 },
  'building.wind': { initialSize: 6, threshold: 80 },
  'building.mine': { initialSize: 4, threshold: 64 },
  'building.turret': { initialSize: 4, threshold: 64 },
  'building.laserTower': { initialSize: 3, threshold: 48 },
  'building.capacitor': { initialSize: 3, threshold: 48 },
  'building.supplyDepot': { initialSize: 3, threshold: 48 },
  'building.waterPump': { initialSize: 2, threshold: 36 },
  'building.coalGen': { initialSize: 2, threshold: 36 },
  'fauna.hive.blackAnt': { initialSize: 2, threshold: 16 },
  'fauna.hive.blueBeetle': { initialSize: 2, threshold: 16 },
  'fauna.hive.greenSpitter': { initialSize: 2, threshold: 16 },
};

/**
 * Smart domain-calibrated pool thresholds for all registered unit (robot & ship) archetypes.
 * Explicitly budgets `10` HQ units (`robot.hero` & `ship.dropPod`) vs `100` worker drones (`robot.miner` & `robot.builder`).
 */
export const UNIT_POOL_THRESHOLDS: Readonly<Record<string, PoolThresholdSpec>> = {
  'robot.hero': { initialSize: 2, threshold: 10 },
  'robot.miner': { initialSize: 10, threshold: 100 },
  'robot.builder': { initialSize: 8, threshold: 100 },
  'robot.recon': { initialSize: 4, threshold: 48 },
  'robot.combat': { initialSize: 6, threshold: 64 },
  'robot.tank': { initialSize: 4, threshold: 48 },
  'robot.artillery': { initialSize: 4, threshold: 48 },
  'ship.dropPod': { initialSize: 2, threshold: 10 },
  'ship.dropPodShell': { initialSize: 1, threshold: 6 },
  'ship.carrier': { initialSize: 1, threshold: 6 },
  'ship.guildTrader': { initialSize: 1, threshold: 8 },
  'ship.flagshipCarrier': { initialSize: 1, threshold: 2 },
};

/**
 * Pool thresholds for insect combat/hive fauna (`BugsOrchestrator`).
 */
export const BUG_POOL_THRESHOLDS: Readonly<Record<string, PoolThresholdSpec>> = {
  'fauna.blackAnt': { initialSize: 4, threshold: 128 },
  'fauna.blueBeetle': { initialSize: 2, threshold: 64 },
  'fauna.greenSpitter': { initialSize: 2, threshold: 64 },
};

/**
 * Base spatial cell-bucket pool specs for `TreesOrchestrator`, `GroundObjectsOrchestrator`, and `ResourcesOrchestrator`.
 */
export const BIOME_CELL_POOL_THRESHOLDS: Readonly<Record<string, CellPoolSpec>> = {
  pine: { initialSize: 16, threshold: 160, instanceCapacity: 256 },
  duneTree: { initialSize: 12, threshold: 144, instanceCapacity: 128 },
  boulder: { initialSize: 8, threshold: 64, instanceCapacity: 96 },
  spire: { initialSize: 8, threshold: 64, instanceCapacity: 64 },
  metals: { initialSize: 6, threshold: 64, instanceCapacity: 48 },
  minerals: { initialSize: 6, threshold: 64, instanceCapacity: 48 },
  oil: { initialSize: 6, threshold: 64, instanceCapacity: 48 },
  grassTuft: { initialSize: 16, threshold: 160, instanceCapacity: 256 },
  wildflower: { initialSize: 12, threshold: 160, instanceCapacity: 160 },
  bush: { initialSize: 12, threshold: 160, instanceCapacity: 128 },
  saguaro: { initialSize: 12, threshold: 144, instanceCapacity: 96 },
  barrelCactus: { initialSize: 12, threshold: 144, instanceCapacity: 96 },
  reeds: { initialSize: 8, threshold: 144, instanceCapacity: 128 },
};

const DEFAULT_BUILDING_SPEC: PoolThresholdSpec = { initialSize: 2, threshold: 24 };
const DEFAULT_UNIT_SPEC: PoolThresholdSpec = { initialSize: 4, threshold: 48 };
const DEFAULT_BUG_SPEC: PoolThresholdSpec = { initialSize: 4, threshold: 64 };

export function scaleCellPoolForRadius(kind: string, radius: number, cellSizeM = 32): CellPoolSpec {
  const base = BIOME_CELL_POOL_THRESHOLDS[kind] ?? { initialSize: 8, threshold: 96, instanceCapacity: 96 };
  const r = Math.max(1, radius);
  const approxSpanM = r * 7.2 + cellSizeM;
  const approxCellsOnAxis = Math.max(1, Math.ceil(approxSpanM / Math.max(16, cellSizeM)));
  const maxActiveCells = Math.ceil(approxCellsOnAxis * approxCellsOnAxis * 0.9 + 8);
  const threshold = Math.max(base.threshold, maxActiveCells);
  const initialSize = Math.min(base.initialSize, Math.max(2, Math.ceil(maxActiveCells * 0.25)));
  return { initialSize, threshold, instanceCapacity: base.instanceCapacity };
}

export function resolveResourceNodePoolThreshold(radius: number): number {
  return Math.max(1024, Math.ceil(hexCount(Math.max(1, radius)) * 1.65));
}

export function resolveRockNodePoolThreshold(radius: number): number {
  return Math.max(1024, Math.ceil(hexCount(Math.max(1, radius)) * 3.1));
}

export function resolveTreeNodePoolThreshold(radius: number): number {
  return Math.max(2048, Math.ceil(hexCount(Math.max(1, radius)) * 3.4));
}

export function resolveBuildingPoolThreshold(archetypeId: string): PoolThresholdSpec {
  return BUILDING_POOL_THRESHOLDS[archetypeId] ?? DEFAULT_BUILDING_SPEC;
}

export function resolveUnitPoolThreshold(archetypeId: string): PoolThresholdSpec {
  return UNIT_POOL_THRESHOLDS[archetypeId] ?? DEFAULT_UNIT_SPEC;
}

export function resolveBugPoolThreshold(archetypeId: string): PoolThresholdSpec {
  return BUG_POOL_THRESHOLDS[archetypeId] ?? DEFAULT_BUG_SPEC;
}
