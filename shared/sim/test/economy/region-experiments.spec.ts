import { parseExperimentManifest, parseWaves, type ExperimentManifest, type MetricRow } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { loadRegionScenarios, variant } from '../../../../tests/economy/scenarios/region';
import {
  checkCandidateMode, compileProfile, expandGrid, regionGrid, regionHashesOf, parseRegionSpec, runExperiment, resolveScenarios,
  type CompiledProfile, type ExperimentResult, type ExperimentScenarioDef,
} from '../../src';

/** W13-56: region / logistics experiment extension (ECONOMY §9). Short runs: 100 warmup + 900 measured ticks, 300-tick windows. */
const WAVES = '..13';
const FLAGS = [...parseWaves(WAVES).list];
const baseline = compileProfile({ parameters: {} }, FLAGS);
const fixtures = loadRegionScenarios();
const fx = (id: string): ExperimentScenarioDef => fixtures.find((s) => s.manifest.id === id)!;

function manifestFor(compiled: CompiledProfile, ids: string[], over: Record<string, unknown> = {}): ExperimentManifest {
  const parsed = parseExperimentManifest({
    schemaVersion: 1, profile: { id: 'baseline', version: 1, hash: compiled.overridesHash }, engineCommit: 'workspace', waves: WAVES,
    scenarios: ids.map((id) => ({ id, version: 1 })), seeds: [101], warmupTicks: 100, measureTicks: 900, sampleEveryTicks: 300, ticksPerSecond: 5,
    budget: { maxRuns: 16, maxWallSeconds: 120, maxWorkers: 1 }, behaviorProfile: 'specialists-v1',
    demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' }, output: { format: 'jsonl', trace: 'failures' }, ...over,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

const run = (defs: ExperimentScenarioDef[], compiled = baseline, over: Record<string, unknown> = {}): ExperimentResult => {
  const m = manifestFor(compiled, defs.map((d) => d.manifest.id), over);
  return runExperiment(m, resolveScenarios(m, defs), compiled);
};
const last = (rows: readonly MetricRow[], key: string, scope: string, resource?: string): string | null | undefined =>
  rows.filter((r) => r.metricKey === key && r.scope === scope && (resource === undefined || r.resource === resource)).at(-1)?.value;
const gate = (res: ExperimentResult, id: string): string | undefined => res.runs[0]!.gates.find((g) => g.gateId === id)?.outcome;

describe('per-sector flows and reasons to trade', () => {
  it('reports each sector with its own regional abundance, flows, logistics bill and trade reasons', () => {
    const res = run([fx('region-specialized-sectors')]);
    const rows = res.runs[0]!.run.metrics;
    const scopes = [...new Set(rows.map((r) => r.scope))].filter((s) => s.startsWith('sector:')).sort();
    expect(scopes).toEqual(['sector:s_desert', 'sector:s_ridge']);
    for (const key of ['flow.production', 'flow.imports', 'flow.exports', 'flow.logistics', 'region.occurrence_bp', 'trade.reason.scarce_resource', 'trade.reason.shortage_trade', 'trade.reason.local_production', 'trade.reason.logistics_investment', 'trade.reason.reserve_mode', 'logistics.load', 'logistics.capacity', 'logistics.utilization', 'logistics.multiplier', 'logistics.distance_mean', 'logistics.bill', 'logistics.shortage_entities']) {
      for (const s of scopes) expect(rows.some((r) => r.metricKey === key && r.scope === s), `${key} ${s}`).toBe(true);
    }
    // the reason to trade: crystal is scarce in the desert sector, abundant in the ridge sector
    expect(Number(last(rows, 'region.occurrence_bp', 'sector:s_desert', 'minerals.t3'))).toBeLessThan(Number(last(rows, 'region.occurrence_bp', 'sector:s_ridge', 'minerals.t3')));
    expect(last(rows, 'trade.reason.scarce_resource', 'sector:s_desert', 'minerals.t3')).toBe('1');
    expect(last(rows, 'trade.reason.scarce_resource', 'sector:s_ridge', 'minerals.t3')).toBe('0');
    expect(last(rows, 'logistics.capacity', 'sector:s_desert')).toBe('100');
    expect(res.runs[0]!.gates.filter((g) => g.gateId.startsWith('hard.')).every((g) => g.outcome === 'pass')).toBe(true);
  });

  it('is deterministic and the single-region planet reports one sector id', () => {
    const a = run([fx('region-route')]).runs[0]!.run;
    const b = run([fx('region-route')]).runs[0]!.run;
    expect(a.hashes).toEqual(b.hashes);
    expect([...new Set(a.metrics.map((r) => r.scope))].filter((s) => s.startsWith('sector:'))).toEqual(['sector:0']);
  });
});

describe('gates: small colony viability and adversarial logistics', () => {
  it('a small colony survives on its own basic stock without purchases (pass) and fails the gate when it has nothing', () => {
    const ok = run([fx('region-small-colony')]);
    expect(gate(ok, 'viability.basic_survival')).toBe('pass');
    expect(gate(ok, 'logistics.service_floor')).toBe('pass');
    const broke = run([variant(fx('region-small-colony'), 'broke', { stock: {} })]);
    expect(gate(broke, 'viability.basic_survival')).toBe('fail');
    expect(broke.outcome).toBe('fail');
  });

  it('a supply cut with depot loss fails the service floor gate; the healthy army fixture passes it', () => {
    const cut = run([fx('region-supply-cut')], baseline, { measureTicks: 1800 });
    expect(gate(cut, 'logistics.service_floor')).toBe('fail');
    expect(cut.failing.some((f) => f.gateId === 'logistics.service_floor')).toBe(true);
    expect(cut.runs[0]!.run.flowsReconciliation.negativeStock).toEqual([]);
    const healthy = run([fx('region-army-load')]);
    expect(gate(healthy, 'logistics.service_floor')).toBe('pass');
  });

  it('reserve toggling does not make an exhausted colony recover', () => {
    const res = run([fx('region-reserve-toggle')], baseline, { measureTicks: 2400 });
    const rows = res.runs[0]!.run.metrics;
    expect(last(rows, 'logistics.min_service_bp', 'sector:0')).not.toBe('10000');
    expect(rows.some((r) => r.metricKey === 'trade.reason.reserve_mode' && Number(r.value) > 0)).toBe(true);
  });
});

describe('comparison grids', () => {
  it('expands the required ECONOMY grids', () => {
    expect(regionGrid('desertCrystalWeightBp').map((p) => p.id)).toEqual(['crystalWeightBp=1500', 'crystalWeightBp=3000', 'crystalWeightBp=6000']);
    expect(regionGrid('armyLoadByDepots')).toHaveLength(8);
    expect(regionGrid('routeTiles').map((p) => p.values.routeTiles)).toEqual([0, 30, 60, 90]);
    expect(regionGrid('alphaBp').map((p) => p.values.alphaBp)).toEqual([0, 1000, 2500, 5000]);
    expect(expandGrid({ a: [1, 2], b: ['x', 'y'] }).map((p) => p.id)).toEqual(['a=1,b=x', 'a=1,b=y', 'a=2,b=x', 'a=2,b=y']);
  });

  it('army load 300 congests one Hub (x2.0) and expanded depots relieve it; alpha 0 removes congestion; routes cost distance', () => {
    const army = fx('region-army-load');
    const fixed = run([army]).runs[0]!.run.metrics;
    const expanded = run([variant(army, 'depots3', { depots: 3 })]).runs[0]!.run.metrics;
    expect(last(fixed, 'logistics.load', 'sector:0')).toBe('300');
    expect(last(fixed, 'logistics.multiplier', 'sector:0')).toBe('2');
    expect(Number(last(expanded, 'logistics.multiplier', 'sector:0'))).toBeLessThan(2);
    expect(Number(last(expanded, 'logistics.capacity', 'sector:0'))).toBeGreaterThan(100);
    const noAlpha = compileProfile({ parameters: { 'logistics.coefficients.alphaBp': 0 } }, FLAGS);
    expect(last(run([army], noAlpha).runs[0]!.run.metrics, 'logistics.multiplier', 'sector:0')).toBe('1');
    const near = run([variant(fx('region-route'), 'r0', { routeTiles: 0 })]).runs[0]!.run.metrics;
    const far = run([variant(fx('region-route'), 'r30', { routeTiles: 30 })]).runs[0]!.run.metrics;
    expect(Number(last(far, 'logistics.distance_mean', 'sector:0'))).toBeGreaterThan(Number(last(near, 'logistics.distance_mean', 'sector:0')));
  });
});

describe('endowment versus runtime candidates', () => {
  const spec = (weight: number) => parseRegionSpec({ region: { planetType: 'desert', regions: { profiles: [{ regionProfileId: 'p', resources: { 'minerals.t3': { occurrenceWeightBp: weight } } }], bindings: [{ scopeKind: 'planetType', planetType: 'desert', regionProfileId: 'p' }] } } })!;
  const pinned = (weight: number, mode?: 'endowment' | 'runtime'): ExperimentManifest => manifestFor(baseline, ['region-route'], { ...regionHashesOf(spec(weight)), ...(mode ? { candidateMode: mode } : {}) });

  it('changing the crystal weight changes the endowment hash only; a terrain change is never accepted as a runtime (yield-only) candidate', () => {
    const a = regionHashesOf(spec(1500)), b = regionHashesOf(spec(6000));
    expect(a.endowmentHash).not.toBe(b.endowmentHash);
    expect(a.runtimeEconomyHash).toBe(b.runtimeEconomyHash);
    expect(checkCandidateMode(pinned(1500), pinned(6000, 'runtime')).errors.map((e) => e.code)).toEqual(['terrain_changed_as_runtime']);
    expect(checkCandidateMode(pinned(1500), pinned(6000, 'endowment')).ok).toBe(true);
    expect(checkCandidateMode(pinned(1500), pinned(1500, 'endowment')).errors.map((e) => e.code)).toEqual(['endowment_unchanged']);
    expect(checkCandidateMode(pinned(1500), pinned(1500, 'runtime')).ok).toBe(true);
    expect(checkCandidateMode(pinned(1500), pinned(6000)).errors.map((e) => e.code)).toContain('candidate_mode_missing');
  });

  it('an endowment candidate regenerates different terrain; a manifest pinning a stale hash is refused', () => {
    const crystal = (w: number) => variant(fx('region-desert-crystal'), `w${w}`, { regions: { profiles: [{ regionProfileId: 'desert-crystal', resources: { 'minerals.t3': { occurrenceWeightBp: w } } }], bindings: [{ scopeKind: 'planetType', planetType: 'desert', regionProfileId: 'desert-crystal' }] } });
    const lo = run([crystal(1500)]).runs[0]!.run.hashes.stateHash;
    const hi = run([crystal(6000)]).runs[0]!.run.hashes.stateHash;
    expect(lo).not.toBe(hi);
    const def = crystal(1500);
    const stale = manifestFor(baseline, [def.manifest.id], { endowmentHash: 'sha256:stale' });
    expect(() => runExperiment(stale, resolveScenarios(stale, [def]), baseline)).toThrow(/endowmentHash/);
    const good = manifestFor(baseline, [def.manifest.id], regionHashesOf(parseRegionSpec(def.manifest.assumptions)!));
    expect(runExperiment(good, resolveScenarios(good, [def]), baseline).status).toBe('completed');
  });
});
