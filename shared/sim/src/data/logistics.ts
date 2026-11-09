import { defineTable } from './_define';

/**
 * W13 logistics coefficients (ECONOMY §2.3, W13-50): the initial **calibration fixture** (alpha 0.25, max multiplier 2.5,
 * beta 0.10, reference route 30 tiles, max distance ratio 3, readiness reserve 0 / ready 0.25 / moving 0.75 / combat 1.0,
 * minimum combat service 0.5). Awaiting calibration; not an economic promise. All coefficients are runtime-tunable
 * (a future supply window uses the new value); fractions are stored in bp (10000 = 1.0).
 */
export default defineTable({
  name: 'logistics',
  units: { windowS: 'seconds', activationDelayS: 'seconds' },
  amounts: ['consumption', 'activationCost'],
  summary: 'W13 logistics congestion/distance/readiness coefficients (calibration fixture, runtime-tunable).',
  rows: [
    // Supply window (ECON-LOG-02, W13-53): length in seconds (compiled to ticks; the sim tick is the only clock) and the
    // bounded local reserve each entity may hold, in bp of one full window's requirement.
    { id: 'service', wave: 'W13', windowS: 60, localReserveBp: 10000 },
    // Logistics load rows (ECON-LOG-01): weight in load units per window at full activity and the recipe in whole units per
    // window. Thermal plants are excluded on purpose: their fuel is already billed once by `production.consume`.
    // Reserve mode (ECON-LOG-02): leaving reserve takes a versioned deployment delay and costs the activation recipe, charged
    // through the treasury every time (toggling never skips it). Calibration fixture.
    { id: 'deploy.v1', wave: 'W13', version: 1, activationDelayS: 10, activationCost: { 'bio.water': 1, 'metals.t1': 1 } },
    { id: 'building.metalsExtractor', wave: 'W13', kind: 'metalsExtractor', weight: 20, consumption: { 'bio.water': 2 } },
    { id: 'building.mineralsQuarry', wave: 'W13', kind: 'mineralsQuarry', weight: 20, consumption: { 'bio.water': 2 } },
    { id: 'building.waterExtractor', wave: 'W13', kind: 'waterExtractor', weight: 10, consumption: { 'metals.t1': 1 } },
    { id: 'building.petroleumWell', wave: 'W13', kind: 'petroleumWell', weight: 20, consumption: { 'bio.water': 2 } },
    { id: 'unit.harvester', wave: 'W13', kind: 'harvester', weight: 10, consumption: { 'bio.water': 1 } },
    { id: 'unit.builder', wave: 'W13', kind: 'builder', weight: 10, consumption: { 'bio.water': 1 } },
    {
      id: 'coefficients',
      wave: 'W13',
      alphaBp: 2500,
      maxMultiplierBp: 25000,
      betaBp: 1000,
      referenceRouteTiles: 30,
      maxDistanceRatioBp: 30000,
      readinessReserveBp: 0,
      readinessReadyBp: 2500,
      readinessMovingBp: 7500,
      readinessCombatBp: 10000,
      minCombatServiceBp: 5000,
      graceWindows: 3,
    },
    // Supply nodes (ECON-LOG-01): logistics throughput per supply window (same load units as entity weights) and the
    // service reach in route tiles, by tier. Distinct from storage capacity and control slots. Calibration fixtures.
    { id: 'node.commandHub.t1', wave: 'W13', building: 'commandHub', tier: 1, throughputPerWindow: 100, reachTiles: 90 },
    { id: 'node.supplyDepot.t1', wave: 'W13', building: 'supplyDepot', tier: 1, throughputPerWindow: 60, reachTiles: 60 },
  ],
});
