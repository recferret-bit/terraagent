import { defineTable } from './_define';

/**
 * Colony Command Hub T1 (`colony-economy-and-buildings-spec.md` §3.1, `SIMULATION.md` §7.1).
 */
export default defineTable({
  name: 'hub',
  summary: 'Colony Command Hub T1 balance row (footprint, cost, build time, territory claim, storage, supply, Founder Core).',
  units: { buildS: 'seconds' },
  rows: [
    {
      id: 't1',
      wave: 'W01',
      building: 'commandHub',
      archetype: 'building.commandHub',
      tier: 1,
      footprint: 3,
      footprintW: 3,
      footprintD: 3,
      footprintH: 3,
      buildS: 30,
      designBuildS: 30,
      buildTimeS: 30,
      cost: {
        'metals.t1': 200,
        'minerals.t1': 100,
        'bio.biomass': 50,
        'bio.water': 50,
      },
      powerDrainPerS: 5,
      founderCoreGenPerS: 8,
      founderCoreEPerS: 8,
      powerGen: 8,
      hp: 1500,
      claimRadius: 10,
      storageCapPerFamily: 500,
      supplyCap: 10,
      pylonSpan: 6,
      pylonMaxLoad: 150,
      cancelRefundRatio: 0.75,
      hqOnly: true,
      maxPerColony: 1,
      allowUnclaimedPlacement: true,
    },
  ],
});
