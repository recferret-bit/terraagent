import { defineTable } from './_define';

/** Design harvest rate of Worker Drone T1. T2 and T3 are multiples of this, not a separate economy. */
export const T1_HARVEST_PER_S = 2;
export const T2_HARVEST_PER_S = T1_HARVEST_PER_S * 1.25;
export const T3_HARVEST_PER_S = T1_HARVEST_PER_S * 1.5;

export const WORKER_LANES = ['harvest', 'construction', 'terraform'] as const;

/** Every terraform op a T1 drone may run. `deepReclaim` starts at T2. */
export const T1_TERRAFORM_OPS = [
  'grade', 'clear', 'break', 'level', 'fill', 'reclaim', 'irrigate', 'seed', 'work', 'repair', 'dismantle',
] as const;

export const T2_TERRAFORM_OPS = [...T1_TERRAFORM_OPS, 'deepReclaim'] as const;

/**
 * Worker drones (`units-orders-and-progression-spec.md` §5.1) and Hub production parameters.
 * One unit, `worker`, in three rows: `t1` (W02), `t2` (W03), `t3` (W05). Tier is the row, not a second unit id.
 */
export default defineTable({
  name: 'unitsWorkersBasic',
  summary: 'Worker Drone T1–T3 stats, standing harvest rates, and Hub worker production buffer.',
  units: {
    buildS: 'seconds',
    speedTilesPerS: 'perSecond',
    harvestRatePerS: 'resourceFlow',
  },
  rows: [
    {
      id: 't1',
      wave: 'W02',
      kind: 'unit',
      unit: 'worker',
      label: 'Worker Drone T1',
      archetype: 'robot.miner',
      tier: 1,
      unlockStage: 1,
      builtAt: 'commandHub',
      buildS: 10,
      designBuildS: 10,
      cost: {
        'metals.t1': 40,
        'minerals.t1': 15,
        'bio.biomass': 5,
        'bio.water': 0,
      },
      supply: 1,
      powerDrainPerS: 2,
      hp: 160,
      speedTilesPerS: 1.5,
      designSpeedTilesPerS: 1.5,
      viewRadius: 7,
      radius: 0.4,
      harvestRatePerS: T1_HARVEST_PER_S,
      designHarvestRatePerS: T1_HARVEST_PER_S,
      workRate: 1.0,
      maxBuildTier: 1,
      maxTerraformTier: 1,
      buildReachMin: 1,
      buildReachTiles: 1,
      terraformReachMin: 0,
      terraformReachTiles: 1,
      lanes: [...WORKER_LANES],
      allowedTerraformOps: [...T1_TERRAFORM_OPS],
    },
    {
      id: 't2',
      wave: 'W03',
      kind: 'unit',
      unit: 'worker',
      label: 'Worker Drone T2',
      archetype: 'robot.builder',
      tier: 2,
      unlockStage: 2,
      builtAt: 'commandHub',
      buildS: 12,
      designBuildS: 12,
      cost: {
        'metals.t1': 45,
        'minerals.t1': 25,
        'bio.biomass': 10,
        'bio.water': 0,
      },
      supply: 1,
      powerDrainPerS: 3,
      hp: 150,
      speedTilesPerS: 1.5,
      designSpeedTilesPerS: 1.5,
      viewRadius: 7,
      radius: 0.4,
      harvestRatePerS: T2_HARVEST_PER_S,
      designHarvestRatePerS: T2_HARVEST_PER_S,
      workRate: 1.0,
      repairRateMultiplier: 1.5,
      maxBuildTier: 2,
      maxTerraformTier: 2,
      maxRepairTier: 3,
      buildReachMin: 1,
      buildReachTiles: 1,
      terraformReachMin: 0,
      terraformReachTiles: 1,
      lanes: [...WORKER_LANES],
      allowedTerraformOps: [...T2_TERRAFORM_OPS],
    },
    {
      id: 't3',
      wave: 'W05',
      kind: 'unit',
      unit: 'worker',
      label: 'Worker Drone T3',
      archetype: 'robot.builder',
      tier: 3,
      unlockStage: 2,
      builtAt: 'commandHub',
      buildS: 12,
      designBuildS: 12,
      cost: {
        'metals.t1': 50,
        'minerals.t1': 30,
        'bio.biomass': 10,
        'bio.water': 0,
      },
      supply: 1,
      powerDrainPerS: 2.5,
      hp: 160,
      speedTilesPerS: 1.5,
      designSpeedTilesPerS: 1.5,
      viewRadius: 7,
      radius: 0.4,
      harvestRatePerS: T3_HARVEST_PER_S,
      designHarvestRatePerS: T3_HARVEST_PER_S,
      workRate: 1.0,
      maxBuildTier: 3,
      maxTerraformTier: 3,
      buildReachMin: 1,
      buildReachTiles: 1,
      terraformReachMin: 0,
      terraformReachTiles: 1,
      lanes: [...WORKER_LANES],
      allowedTerraformOps: [...T2_TERRAFORM_OPS],
    },
    {
      id: 'hubProduction',
      wave: 'W02',
      kind: 'producerConfig',
      producer: 'commandHub',
      bufferSlots: 5,
      productionRate: 1.0,
      constructionLaneLimit: 20,
      unitsLaneLimit: 10,
    },
  ],
});
