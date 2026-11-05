import { describe, expect, it } from 'vitest';
import { compareExperiments, type ComparableExperiment, type ComparableRun } from '../../src';

const run = (seed: number, fee: string, gate: string, status = 'completed'): ComparableRun => ({
  scenarioId: 's', scenarioVersion: 1, seed, status,
  gates: [{ gateId: 'g', gateVersion: 1, outcome: gate }],
  metrics: [
    { metricKey: 'fee', scope: 'global', windowEndTick: 100, value: '1.5' },
    { metricKey: 'fee', scope: 'global', windowEndTick: 200, value: fee },
    { metricKey: 'vwap', scope: 'global', resource: 'bio.water', windowEndTick: 200, value: null },
  ],
});
const exp = (id: string, runs: ComparableRun[], status = 'completed'): ComparableExperiment => ({ id, status, runs });

describe('compareExperiments (paired seeds, exact deltas)', () => {
  it('pairs by scenario and seed, takes the last window, and exact decimal deltas', () => {
    const r = compareExperiments(exp('a', [run(1, '2.25', 'pass')]), exp('b', [run(1, '3.5', 'pass')]));
    expect(r.ok).toBe(true);
    expect(r.pairs[0]!.deltas.find((d) => d.metricKey === 'fee')).toMatchObject({ baseline: '2.25', candidate: '3.5', delta: '1.25' });
    expect(r.pairs[0]!.deltas.find((d) => d.metricKey === 'vwap')!.delta).toBeNull();
    expect(r.verdict).toBe('neutral');
  });
  it('reports regressions and improvements, refuses unpaired or unfinished experiments', () => {
    expect(compareExperiments(exp('a', [run(1, '1', 'pass')]), exp('b', [run(1, '1', 'insufficient_data')])).verdict).toBe('regression');
    expect(compareExperiments(exp('a', [run(1, '1', 'fail')]), exp('b', [run(1, '1', 'pass')])).verdict).toBe('improvement');
    expect(compareExperiments(exp('a', [run(1, '1', 'pass')]), exp('b', [run(2, '1', 'pass')])).errors[0]!.code).toBe('unpaired_runs');
    expect(compareExperiments(exp('a', [], 'incomplete'), exp('b', [])).errors[0]!.code).toBe('not_completed');
  });
});
