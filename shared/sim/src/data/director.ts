import { defineTable } from './_define';

/**
 * Director tunables (AI_ORCHESTRATOR §3, §4, §7). Numbers stay in design units: seconds, basis points, counts.
 * They are not listed in `units`, so `compileData` does not turn them into ticks.
 *
 * Conservative and risky ratios are the spec's proposed defaults. Calibration is still open
 * (docs/questions-and-limitations/ai-director.md AI-02). Player ceilings stay stricter than either profile.
 */
export default defineTable({
  name: 'director',
  summary: 'Director call cadence, conservative/risky commitment and global budget caps.',
  rows: [
    {
      id: 'cadence',
      wave: 'W16',
      normalIntervalS: 300,
      criticalIntervalS: 120,
      colonyRequestsPerDay: 150,
      debounceS: 60,
      cancelSuppressS: 600,
      deadlineS: 20,
      contextMaxAgeS: 60,
    },
    {
      id: 'conservative',
      wave: 'W16',
      reserveFloorBp: 4000,
      commitBp: 1500,
      combatThresholdMilli: 1500,
      maxCandidates: 2,
    },
    {
      id: 'risky',
      wave: 'W16',
      reserveFloorBp: 1500,
      commitBp: 3500,
      combatThresholdMilli: 900,
      maxCandidates: 4,
    },
    {
      id: 'budget',
      wave: 'W16',
      globalTokensPerDay: 20_000_000,
      pendingCap: 512,
      providerConcurrency: 4,
      providerConcurrencyHard: 8,
      circuitFailures: 5,
      circuitOpenS: 60,
      awayGuardBp: 1000,
    },
    {
      id: 'retention',
      wave: 'W16',
      rawDays: 14,
      decisionDays: 30,
    },
  ],
});
