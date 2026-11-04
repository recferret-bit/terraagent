import { defineTable } from './_define';

/**
 * W13 logistics coefficients (ECONOMY §2.3, W13-50): the initial **calibration fixture** (alpha 0.25, max multiplier 2.5,
 * beta 0.10, reference route 30 tiles, max distance ratio 3, readiness reserve 0 / ready 0.25 / moving 0.75 / combat 1.0,
 * minimum combat service 0.5). Awaiting calibration; not an economic promise. All coefficients are runtime-tunable
 * (a future supply window uses the new value); fractions are stored in bp (10000 = 1.0).
 */
export default defineTable({
  name: 'logistics',
  summary: 'W13 logistics congestion/distance/readiness coefficients (calibration fixture, runtime-tunable).',
  rows: [
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
  ],
});
