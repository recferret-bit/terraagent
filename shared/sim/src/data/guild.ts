import { defineTable } from './_define';

/**
 * Guild roster and quote policy (NEAR-71..73, W15-02). Numbers are calibration hypotheses (LED-32), not facts.
 * Seconds stay in seconds (not listed in `units`), matching `market.agent`, so the W13 quote library reads them as seconds.
 * Half-spreads and the other `AgentParams` fields start equal to `market.agent`, so `guildAgentParams` matches that library.
 * `thinHalfSpreadBp` is not an agent field: `quoteGuild` applies it to the ask below target and the bid above target.
 * Real cash bids stay off (`cashEnabled` 0). Float caps are stored and are not spent while cash is off.
 * Tier-1 pairs only. `route` is the one-planet loop token `loop-local` (planet ids are runtime; W11 off loops locally).
 */
export default defineTable({
  name: 'guild',
  summary: 'W15 Guild roster, visit clock, and versioned quote/funding policy. Real cash starts disabled.',
  amounts: ['inventoryCapUnits', 'targetMetalsT1', 'targetMineralsT1', 'targetWater', 'targetBiomass'],
  fixed: {
    fields: ['policyVersion', 'accountSlot'],
    why: 'policyVersion identifies the pinned Guild policy (a new version is a new profile); accountSlot names the NPC sub-account',
  },
  rows: [
    {
      id: 'policy',
      wave: 'W15',
      policyVersion: 'guild-mock-1',
      cashEnabled: 0,
      killSwitch: 0,
      npcNearFloatCap: 5,
      globalNearFloatCap: 10,
      dockWindowS: 720,
      visitGapS: 1800,
      scarcityExponentNum: 1,
      scarcityExponentDen: 2,
      epsilonUnits: 10,
      clampLowBp: 5000,
      clampHighBp: 20000,
      bidHalfSpreadBp: 200,
      askHalfSpreadBp: 200,
      thinHalfSpreadBp: 1500,
      minSavingBp: 200,
      reserveMarginBp: 500,
      maxOrderUnits: 100,
      maxOrderQuoteAtomic: '1000000000',
      perOrderExposureAtomic: '1000000000',
      globalExposureAtomic: '10000000000',
      dailyLossAtomic: '1000000000',
      dailySpendAtomic: '5000000000',
      referenceMaxAgeS: 3600,
      minReferenceVolume: 10,
      minEligibleTrades: 3,
      inventoryCapUnits: 5000,
    },
    {
      id: 'kestrel',
      wave: 'W15',
      displayName: 'Kestrel',
      accountSlot: 1,
      routeLoop: 1,
      route: ['loop-local'],
      pairs: ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'],
      targetMetalsT1: 2500,
      targetMineralsT1: 2500,
      targetWater: 2500,
      targetBiomass: 2500,
    },
    {
      id: 'vanguard',
      wave: 'W15',
      displayName: 'Vanguard',
      accountSlot: 2,
      routeLoop: 1,
      route: ['loop-local'],
      pairs: ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'],
      targetMetalsT1: 2500,
      targetMineralsT1: 2500,
      targetWater: 2500,
      targetBiomass: 2500,
    },
  ],
});
