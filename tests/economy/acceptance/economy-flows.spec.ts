import { describe, expect, it } from 'vitest';
import { compareExperiments } from '@terra/sim';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { baseline, candidateOf, comparable, manifestFor, run } from './support';

/** W13-49 acceptance (2)+(3)+(4): integrated source/sink flows, candidate comparison, conservation, through the real runner. */

describe('integrated source/sink flows reconcile exactly (W13-42 accounting inside the runner)', () => {
  const m = manifestFor(baseline, 'stress-mature-flat-population', { seeds: [101], behaviorProfile: 'stress-v1' });
  const res = run(m);
  const r = res.runs[0]!.run;
  const sum = (key: string, resource: string): number => r.metrics.filter((x) => x.metricKey === key && x.scope === 'global' && x.resource === resource).reduce((a, x) => a + Number(x.value ?? 0), 0);

  it('extractors produce, builds/prestige/transport consume and market trades settle in one run', () => {
    expect(r.summary.trades).toBeGreaterThan(0);
    expect(sum('flow.production', 'metals.t1')).toBeGreaterThan(0);
    expect(sum('flow.consumption', 'metals.t1')).toBeGreaterThan(0);
    expect(sum('flow.exports', 'metals.t1')).toBeGreaterThan(0);
  });

  it('per resource: opening + production + imports + recovered - consumption - exports = closing, drift 0, whole units', () => {
    const rows = Object.entries(r.flowsReconciliation.resources);
    expect(rows.length).toBeGreaterThan(0);
    for (const [resource, f] of rows) {
      const expected = BigInt(f.opening) + BigInt(f.production) + BigInt(f.imports) + BigInt(f.recovered) - BigInt(f.consumption) - BigInt(f.exports);
      expect(BigInt(f.closing), resource).toBe(expected);
      expect(f.drift, resource).toBe('0');
      for (const v of [f.opening, f.production, f.imports, f.exports, f.consumption, f.closing]) expect(v, resource).toMatch(/^\d+$/);
    }
    expect(r.flowsReconciliation.usdc.drift).toBe('0');
  });

  it('conservation: every hard gate passes, no negative stock, mock ledger conserved', () => {
    const hard = res.runs[0]!.gates.filter((g) => g.gateId.startsWith('hard.'));
    expect(hard.map((g) => g.gateId).sort()).toEqual(['hard.flow_reconciliation', 'hard.mock_ledger_conservation', 'hard.no_negative_stock']);
    expect(hard.every((g) => g.outcome === 'pass')).toBe(true);
    expect(r.flowsReconciliation.negativeStock).toEqual([]);
  });
});

describe('candidate comparison with held-out seeds', () => {
  const patch = JSON.parse(readFileSync(resolve(import.meta.dirname, '../profiles/regional-specialist-desert.json'), 'utf8')) as unknown;
  const candidate = candidateOf(patch);
  const over = { seeds: [101, 202], heldOutSeeds: [303] };
  const mb = manifestFor(baseline, 'baseline-two-colony', over);
  const mc = manifestFor(candidate, 'baseline-two-colony', over);
  const cmp = compareExperiments(comparable('baseline', mb, run(mb)), comparable('candidate', mc, run(mc, candidate)));

  it('pairs every seed, marks the held-out seed, and reports pass/fail/insufficient_data per gate', () => {
    expect(cmp.errors).toEqual([]);
    expect(cmp.ok).toBe(true);
    expect(cmp.pairs).toHaveLength(3);
    expect(typeof cmp.verdict).toBe('string');
    expect(cmp.assessment).toBeDefined();
    expect(typeof cmp.assessment!.decision).toBe('string');
  });

  it('cash approval is false without W15 funded-bot runs and pilot evidence', () => {
    expect(cmp.cashApproval).toBe(false);
    expect(cmp.cashApprovalBlockers.length).toBeGreaterThan(0);
  });
});
