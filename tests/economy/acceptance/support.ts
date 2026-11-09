import { parseExperimentManifest, parseWaves, type ExperimentManifest } from '@terra/contracts';
import { applyPatchOps, compileProfile, isHeldOutSeed, resolveScenarios, runExperiment, type ComparableExperiment, type CompiledProfile, type ExperimentResult } from '@terra/sim';
import { loadExperimentScenarios } from '../scenarios';

/** Shared helpers of the W13-49 acceptance pack: real runner, real profile compiler, no stand-ins. */
export const WAVES = '..13';
export const FLAGS = [...parseWaves(WAVES).list];
export const scenarios = loadExperimentScenarios();
export const baseline = compileProfile({ parameters: {} }, FLAGS);

export const candidateOf = (patch: unknown): CompiledProfile =>
  compileProfile({ parameters: applyPatchOps({ parameters: {} }, patch as never) }, FLAGS);

export function manifestFor(profile: CompiledProfile, scenarioId: string, over: Record<string, unknown> = {}): ExperimentManifest {
  const parsed = parseExperimentManifest({
    schemaVersion: 1, profile: { id: 'baseline', version: 1, hash: profile.overridesHash }, engineCommit: 'workspace', waves: WAVES,
    scenarios: [{ id: scenarioId, version: 1 }], seeds: [101], warmupTicks: 100, measureTicks: 800, sampleEveryTicks: 400, ticksPerSecond: 5,
    budget: { maxRuns: 12, maxWallSeconds: 300, maxWorkers: 1 }, behaviorProfile: 'specialists-v1',
    demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' }, output: { format: 'jsonl', trace: 'failures' }, ...over,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

export const run = (m: ExperimentManifest, profile: CompiledProfile = baseline): ExperimentResult => runExperiment(m, resolveScenarios(m, scenarios), profile);

/** The runner result in the shape `compareExperiments` takes (what the server's report service loads from the database). */
export function comparable(id: string, m: ExperimentManifest, res: ExperimentResult): ComparableExperiment {
  return {
    id, status: res.status,
    runs: res.runs.map((r) => ({
      scenarioId: r.run.scenarioId, scenarioVersion: r.run.scenarioVersion, seed: r.run.seed, status: 'completed', heldOut: isHeldOutSeed(m, r.run.seed),
      gates: r.gates.map((g) => ({ gateId: g.gateId, gateVersion: g.gateVersion, outcome: g.outcome })),
      metrics: r.run.metrics.map((x) => ({ metricKey: x.metricKey, scope: x.scope, resource: x.resource ?? null, pair: x.pair ?? null, cohort: x.cohort ?? null, windowEndTick: x.windowEndTick, value: x.value === null ? null : String(x.value) })),
    })),
  };
}
