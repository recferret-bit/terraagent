import { parseExperimentManifest, parseWaves, type ExperimentManifest } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { loadStressScenarios } from '../../../../tests/economy/scenarios/stress';
import { compileProfile, replayCommand, resolveScenarios, runExperiment, type ExperimentResult } from '../../src';

/**
 * W13-47: the stress scenario suite (ECONOMY §7). Short runs (1 seed, ~800 ticks) of every versioned fixture through the
 * real runner; the full-length suite runs through `scripts/economy/run-experiment.ts` (see the W13-47 report).
 */
const WAVES = '..13';
const baseline = compileProfile({ parameters: {} }, [...parseWaves(WAVES).list]);
const all = loadStressScenarios();
const PROBE = 'stress-gate-probe';
const COUNTERFACTUAL = 'stress-guild-w15-counterfactual';

function manifestFor(ids: string[], over: Record<string, unknown> = {}): ExperimentManifest {
  const parsed = parseExperimentManifest({
    schemaVersion: 1, profile: { id: 'baseline', version: 1, hash: baseline.overridesHash }, engineCommit: 'workspace', waves: WAVES,
    scenarios: ids.map((id) => ({ id, version: 1 })), seeds: [101], warmupTicks: 50, measureTicks: 800, sampleEveryTicks: 200, ticksPerSecond: 5,
    budget: { maxRuns: 20, maxWallSeconds: 120, maxWorkers: 1 }, behaviorProfile: 'stress-v1',
    demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' }, output: { format: 'jsonl', trace: 'failures' }, ...over,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

const run = (m: ExperimentManifest, ports = {}, filter = {}): ExperimentResult => runExperiment(m, resolveScenarios(m, all), baseline, ports, filter);
const metric = (res: ExperimentResult, id: string, key: string, resource?: string) =>
  res.runs.find((r) => r.run.scenarioId === id)!.run.metrics.filter((m) => m.metricKey === key && m.scope === 'global' && (resource === undefined || m.resource === resource));

describe('stress suite fixtures are versioned, labelled and wave-enabled', () => {
  it('every scenario pins version, waves ..13, an assumed demand source and its own gates', () => {
    expect(all.map((s) => s.manifest.id)).toEqual(expect.arrayContaining([
      'stress-mature-flat-population', 'stress-double-output', 'stress-ten-x-colonies', 'stress-half-buyer-budget', 'stress-zero-subsidy',
      'stress-returning-inventory', 'stress-thin-market', 'stress-related-accounts', 'stress-external-venue-leakage', 'stress-desert-crystal-poor', COUNTERFACTUAL, PROBE,
    ]));
    for (const s of all) {
      expect(s.manifest.version).toBeGreaterThan(0);
      expect(s.manifest.waves).toBe(WAVES);
      expect(s.manifest.assumptions.demandSource).toBe('assumed');
      expect(s.manifest.assumptions.assumptionsVersion).toBe(1);
      expect(String(s.manifest.assumptions.label)).toMatch(/ASSUMPTIONS/);
      expect((s.manifest.assumptions.gates as unknown[]).length).toBeGreaterThan(0);
    }
  });
});

describe('every stress scenario runs briefly and holds the hard gates', () => {
  const ids = all.map((s) => s.manifest.id).filter((id) => id !== PROBE);
  const res = run(manifestFor(ids));

  it('conservation, no negative stock and zero-sum USDC pass; economic gates pass except the counterfactual', () => {
    expect(res.runs).toHaveLength(ids.length);
    for (const r of res.runs) {
      const hard = r.gates.filter((g) => g.gateId.startsWith('hard.') && g.gateId !== 'hard.counterfactual_not_evidence');
      expect(hard.map((g) => g.gateId).sort()).toEqual(['hard.flow_reconciliation', 'hard.mock_ledger_conservation', 'hard.no_negative_stock']);
      expect(hard.every((g) => g.outcome === 'pass'), `${r.run.scenarioId}: ${JSON.stringify(r.gates.filter((g) => g.outcome !== 'pass'))}`).toBe(true);
      if (r.run.scenarioId !== COUNTERFACTUAL) expect(r.gates.every((g) => g.outcome === 'pass'), `${r.run.scenarioId}: ${JSON.stringify(r.gates.filter((g) => g.outcome !== 'pass'))}`).toBe(true);
    }
  });

  it('a counterfactual (future-wave) scenario can never pass', () => {
    const cf = res.runs.find((r) => r.run.scenarioId === COUNTERFACTUAL)!;
    expect(cf.gates.find((g) => g.gateId === 'hard.counterfactual_not_evidence')!.outcome).toBe('insufficient_data');
    expect(res.outcome).toBe('fail');
    expect(res.failing.every((f) => f.scenarioId === COUNTERFACTUAL)).toBe(true);
  });

  it('colonies really produce, consume and trade', () => {
    const sum = (id: string, key: string, resource?: string) => metric(res, id, key, resource).reduce((a, m) => a + Number(m.value ?? 0), 0);
    for (const s of ['stress-double-output', 'stress-ten-x-colonies', 'stress-mature-flat-population']) {
      expect(sum(s, 'flow.production', 'metals.t1'), s).toBeGreaterThan(0);
    }
    expect(sum('stress-double-output', 'flow.production', 'metals.t1')).toBeGreaterThan(sum('stress-half-buyer-budget', 'flow.production', 'metals.t1') * 1.5);
    expect(sum('stress-mature-flat-population', 'flow.consumption', 'metals.t1')).toBeGreaterThan(0); // the recurring prestige project pays inputs
    expect(res.runs.find((r) => r.run.scenarioId === 'stress-ten-x-colonies')!.run.flowsReconciliation.resources['metals.t1']).toBeDefined();
  });

  it('shocks, budget and related-account exclusion take effect', () => {
    const imports = (id: string) => metric(res, id, 'flow.production', 'bio.water').reduce((a, m) => a + Number(m.value ?? 0), 0);
    expect(imports('stress-returning-inventory')).toBeGreaterThanOrEqual(800); // 2 colonies x 400 exogenous units, reported as inflow
    const rel = metric(res, 'stress-related-accounts', 'market.trades.related').length;
    expect(rel).toBeGreaterThan(0);
    expect(metric(res, 'stress-related-accounts', 'market.trades.organic').length).toBe(rel);
    expect(metric(res, 'stress-mature-flat-population', 'market.trades.related')).toHaveLength(0);
    const half = res.runs.find((r) => r.run.scenarioId === 'stress-half-buyer-budget')!.run;
    expect(half.flowsReconciliation.usdc.funded).toBe(String(4n * 15_000_000n));
  });
});

describe('a failing stress gate produces a replay command that reproduces it', () => {
  it('prints the replay command and the replayed seed gives the identical run', () => {
    const m = manifestFor([PROBE, 'stress-double-output'], { seeds: [101, 202] });
    const ports = { replay: { manifestPath: 'm.json', outDir: 'out' } };
    const first = run(m, ports);
    expect(first.outcome).toBe('fail');
    expect(first.failing.map((f) => `${f.scenarioId}:${f.seed}`)).toEqual([`${PROBE}:101`, `${PROBE}:202`]);
    const f = first.failing[1]!;
    expect(f.gateId).toBe('probe.impossible_trade_count');
    expect(f.replay).toBe(replayCommand({ manifestPath: 'm.json', scenarioId: PROBE, seed: 202, outDir: 'out' }));
    const again = run(m, ports, { scenarioId: f.scenarioId, seed: f.seed });
    expect(again.runs).toHaveLength(1);
    const orig = first.runs.find((r) => r.run.scenarioId === PROBE && r.run.seed === 202)!;
    expect(again.runs[0]!.run.hashes).toEqual(orig.run.hashes);
    expect(again.failing[0]!.gateId).toBe(f.gateId);
  });
});
