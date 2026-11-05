import type { ExperimentManifest } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  compareExperiments, pairedStats, ratio, sensitivityManifests, ratioToDecimal,
  type ComparableExperiment, type ComparableMetric, type ComparableRun,
} from '../../src';

/** W13-48: paired-seed statistics, held-out confirmation, Pareto dimensions, explainable decisions, never cash approval. */

const HARD_PASS = ['hard.flow_reconciliation', 'hard.no_negative_stock', 'hard.mock_ledger_conservation'].map((gateId) => ({ gateId, gateVersion: 1, outcome: 'pass' }));
const m = (metricKey: string, value: string | null, resource: string | null = null): ComparableMetric => ({ metricKey, scope: 'global', resource, windowEndTick: 100, value });

interface Vals { volume?: number | null; fee?: number }
function run(seed: number, v: Vals, role: { heldOut?: boolean; stress?: boolean } = {}, gates = HARD_PASS): ComparableRun {
  const metrics = [
    ...(v.volume === undefined || v.volume === null ? [] : [m('market.volume', String(v.volume), 'bio.water')]),
    m('market.fee.platform', String(v.fee ?? 100)),
  ];
  return { scenarioId: 's', scenarioVersion: 1, seed, status: 'completed', ...role, gates, metrics };
}
const exp = (id: string, runs: ComparableRun[]): ComparableExperiment => ({ id, status: 'completed', runs });
const seeds = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i);
/** Baseline and candidate with per-seed values; held-out seeds are 100+. */
function pair(tuning: [number, number][], heldOut: [number, number][] = [], feeOf: (i: number) => [number, number] = () => [100, 100]) {
  const mk = (side: 0 | 1) => [
    ...tuning.map((t, i) => run(seeds(tuning.length)[i]!, { volume: t[side], fee: feeOf(i)[side] })),
    ...heldOut.map((t, i) => run(100 + i, { volume: t[side], fee: 100 }, { heldOut: true })),
  ];
  return [exp('base', mk(0)), exp('cand', mk(1))] as const;
}

describe('paired statistics are exact', () => {
  it('t interval of [1,2,3]: mean 2, var 1, se^2 1/3, t(2)=4.303', () => {
    const s = pairedStats([1n, 2n, 3n].map((n) => ratio(n)))!;
    expect(ratioToDecimal(s.mean)).toBe('2');
    expect(ratioToDecimal(s.ci!.lo, 3)).toBe('-0.484');
    expect(ratioToDecimal(s.ci!.hi, 3)).toBe('4.484');
    expect(pairedStats([ratio(5n)])!.ci).toBeNull(); // one pair: no interval, not a zero width
    expect(pairedStats([])).toBeNull();
  });
});

describe('recommendation rules', () => {
  it('a revenue-only improvement is not recommended', () => {
    const [b, c] = pair(seeds(4).map(() => [10, 10]), seeds(2).map(() => [10, 10]), (i) => [100 + i, 150 + i]);
    const r = compareExperiments(b, c);
    expect(r.assessment!.decision).toBe('do_not_recommend');
    expect(r.assessment!.reasons.join(' ')).toMatch(/only improvement is platform revenue/);
    expect(r.assessment!.tuning.dimensions.find((d) => d.id === 'netContribution')!.verdict).toBe('improved');
  });

  it('a favourable subset of seeds is not recommended (significant mean, but not on every seed)', () => {
    const tuning = seeds(8).map((s): [number, number] => [10, s <= 5 ? 20 : 10]);
    const [b, c] = pair(tuning, [[10, 20], [10, 20]]);
    const r = compareExperiments(b, c);
    expect(r.assessment!.tuning.dimensions.find((d) => d.id === 'tradingDepth')!.subsetOnly).toBe(true);
    expect(r.assessment!.decision).toBe('do_not_recommend');
    expect(r.assessment!.reasons.join(' ')).toMatch(/subset of seeds/);
  });

  it('insufficient data stays insufficient_data: one seed, or a missing metric, never a pass', () => {
    const [b1, c1] = pair([[10, 20]], [[10, 20]]);
    const one = compareExperiments(b1, c1);
    expect(one.assessment!.decision).toBe('insufficient_evidence');
    expect(one.assessment!.tuning.dimensions.find((d) => d.id === 'tradingDepth')!.verdict).toBe('insufficient_data');
    const noMetric = compareExperiments(exp('b', seeds(3).map((s) => run(s, {}))), exp('c', seeds(3).map((s) => run(s, {}))));
    expect(noMetric.assessment!.tuning.dimensions.find((d) => d.id === 'tradingDepth')!.verdict).toBe('insufficient_data');
    expect(noMetric.pairs[0]!.gates.find((g) => g.gateId === 'econ.trade_depth.volume_water')).toMatchObject({ baseline: 'insufficient_data', candidate: 'insufficient_data' });
    expect(noMetric.assessment!.decision).not.toBe('recommend');
  });

  it('held-out disagreement is do_not_recommend; missing held-out seeds is insufficient_evidence', () => {
    const tuning = seeds(4).map((): [number, number] => [10, 20]);
    const [b, c] = pair(tuning, [[10, 5], [10, 5]]);
    const r = compareExperiments(b, c);
    expect(r.assessment!.decision).toBe('do_not_recommend');
    expect(r.assessment!.reasons.join(' ')).toMatch(/held-out seeds disagree on tradingDepth/);
    const [b2, c2] = pair(tuning);
    expect(compareExperiments(b2, c2).assessment!.decision).toBe('insufficient_evidence');
  });

  it('an improvement that holds on tuning and held-out seeds is recommended, with an explanation, and cashApproval stays false', () => {
    const tuning = seeds(4).map((): [number, number] => [10, 20]);
    const [b, c] = pair(tuning, [[10, 20], [10, 20]]);
    const r = compareExperiments(b, c);
    const a = r.assessment!;
    expect(a.decision).toBe('recommend');
    expect(a.movedMetrics.some((x) => x.slice === 'tuning' && x.dimension === 'tradingDepth' && x.verdict === 'better' && x.seedsBetter === 4)).toBe(true);
    expect(a.movedMetrics.some((x) => x.slice === 'heldOut')).toBe(true);
    expect(a.caveats.join(' ')).toMatch(/sensitivity/);
    expect(r.cashApproval).toBe(false);
    expect(r.cashApprovalBlockers.join(' ')).toMatch(/pilot evidence/);
    // even with a pilot reference, uncalibrated gates and missing stress runs keep it false
    const withPilot = compareExperiments(b, c, { pilotEvidence: 'pilot-2026-q4' });
    expect(withPilot.cashApproval).toBe(false);
    expect(withPilot.cashApprovalBlockers.join(' ')).toMatch(/uncalibrated gates/);
    expect(withPilot.cashApprovalBlockers.join(' ')).toMatch(/no stress runs/);
    expect(JSON.stringify(compareExperiments(b, c))).toBe(JSON.stringify(r)); // deterministic
  });

  it('a hard gate failure or a failing sensitivity case refuses; a gate regression is reported', () => {
    const tuning = seeds(4).map((): [number, number] => [10, 20]);
    const [b, c] = pair(tuning, [[10, 20], [10, 20]]);
    const broken = exp('cand', c.runs.map((r, i) => (i === 0 ? { ...r, gates: HARD_PASS.map((g) => (g.gateId === 'hard.no_negative_stock' ? { ...g, outcome: 'fail' } : g)) } : r)));
    const hard = compareExperiments(b, broken);
    expect(hard.assessment!.decision).toBe('do_not_recommend');
    expect(hard.regressions.map((g) => g.gateId)).toContain('hard.no_negative_stock');
    const [sb, sc] = pair(tuning, [], () => [100, 100]);
    const worse = pair(seeds(2).map((): [number, number] => [10, 2]), [], () => [100, 100]);
    const sens = compareExperiments(b, c, { sensitivity: [{ label: 'demand-5000bp', baseline: worse[0], candidate: worse[1] }, { label: 'ok', baseline: sb, candidate: sc }] });
    expect(sens.assessment!.sensitivity.status).toBe('fail');
    expect(sens.assessment!.decision).toBe('do_not_recommend');
  });

  it('refuses incomparable experiments', () => {
    const [b, c] = pair(seeds(2).map((): [number, number] => [1, 1]));
    expect(compareExperiments(b, exp('x', c.runs.slice(1))).errors[0]!.code).toBe('unpaired_runs');
    expect(compareExperiments({ ...b, status: 'incomplete' }, c).assessment).toBeNull();
  });
});

describe('sensitivity manifests', () => {
  it('scale the assumed demand budget exactly and relabel its source', () => {
    const base = { demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' } } as ExperimentManifest;
    const out = sensitivityManifests(base);
    expect(out.map((o) => o.manifest.demandModel.perPayingActorMonthlyBudgetUsdcAtomic)).toEqual(['15000000', '30000000', '60000000']);
    expect(out[0]!.manifest.demandModel.source).toBe('assumed-sensitivity');
  });
});
