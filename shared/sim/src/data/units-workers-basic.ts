import { defineTable } from './_define';

/**
 * Harvester worker unit (`units-orders-and-progression-spec.md` §5.1) and Hub worker production parameters (W02-10, W02-11).
 */
export default defineTable({
  name: 'unitsWorkersBasic',
  summary: 'Harvester T1 worker unit stats, standing harvest rate, and Hub worker production buffer (W02).',
  units: {
    buildS: 'seconds',
    speedTilesPerS: 'perSecond',
  },
  rows: [
    {
      id: 'harvester',
      wave: 'W02',
      kind: 'unit',
      unit: 'harvester',
      label: 'Harvester Drone',
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
      powerDrainPerS: 1.5,
      hp: 160,
      speedTilesPerS: 1.5,
      designSpeedTilesPerS: 1.5,
      viewRadius: 7,
      radius: 0.4,
      harvestRatePerS: 2.0,
      designHarvestRatePerS: 2.0,
      workRate: 1.0,
      maxBuildTier: 0,
      lanes: ['harvest', 'terraform'],
      allowedTerraformOps: ['clear', 'break'],
    },
    {
      id: 'hubProduction',
      wave: 'W02',
      kind: 'producerConfig',
      producer: 'commandHub',
      bufferSlots: 5,
      productionRate: 1.0,
      baseSupplyCap: 10,
      constructionLaneLimit: 20,
      unitsLaneLimit: 10,
    },
  ],
});
