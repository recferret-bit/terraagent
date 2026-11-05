import { ratioToDecimal, subRatio, type Ratio } from '../flows/ratio';
import { parseDecimal } from './gates';

/**
 * Paired-seed comparison boundary (W13-46 minimal version; W13-48 replaces the statistics behind this same signature).
 * Pure: two completed experiments in, per-metric deltas and gate transitions out. No sampling theory here: deltas are
 * exact differences of the last sampled window of each metric series, one pair per (scenario, version, seed).
 */
export interface ComparableMetric {
  readonly metricKey: string;
  readonly scope: string;
  readonly resource?: string | null;
  readonly pair?: string | null;
  readonly cohort?: string | null;
  readonly windowEndTick: number;
  /** Exact decimal string, null when undefined. */
  readonly value: string | null;
}
export interface ComparableGate { readonly gateId: string; readonly gateVersion: number; readonly outcome: string }
export interface ComparableRun {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly seed: number;
  readonly status: string;
  readonly gates: readonly ComparableGate[];
  readonly metrics: readonly ComparableMetric[];
}
export interface ComparableExperiment { readonly id: string; readonly status: string; readonly runs: readonly ComparableRun[] }

export interface MetricDelta {
  readonly metricKey: string; readonly scope: string; readonly resource: string | null; readonly baseline: string | null; readonly candidate: string | null;
  /** `candidate - baseline`, exact; null when either side has no value. */
  readonly delta: string | null;
}
export interface GateTransition { readonly gateId: string; readonly baseline: string; readonly candidate: string }
export interface PairComparison {
  readonly scenarioId: string; readonly scenarioVersion: number; readonly seed: number;
  readonly deltas: MetricDelta[];
  readonly gates: GateTransition[];
}
export interface ComparisonResult {
  readonly ok: boolean;
  /** Why the two experiments cannot be compared (`not_completed`, `unpaired_runs`); empty when `ok`. */
  readonly errors: readonly { readonly code: string; readonly message: string }[];
  readonly baselineId: string;
  readonly candidateId: string;
  readonly pairs: PairComparison[];
  readonly regressions: readonly (GateTransition & { readonly scenarioId: string; readonly seed: number })[];
  readonly improvements: readonly (GateTransition & { readonly scenarioId: string; readonly seed: number })[];
  /** `regression` when a baseline-passing gate no longer passes, `improvement` when a failing one now passes, else `neutral`. */
  readonly verdict: 'regression' | 'improvement' | 'neutral' | 'incomparable';
}

const runKey = (r: ComparableRun): string => `${r.scenarioId}@${r.scenarioVersion}#${r.seed}`;
const seriesKey = (m: ComparableMetric): string => [m.metricKey, m.scope, m.resource ?? '', m.pair ?? '', m.cohort ?? ''].join('|');

/** Last sampled value of every series of a run. */
function lastValues(metrics: readonly ComparableMetric[]): Map<string, ComparableMetric> {
  const out = new Map<string, ComparableMetric>();
  for (const m of metrics) {
    const prev = out.get(seriesKey(m));
    if (!prev || m.windowEndTick >= prev.windowEndTick) out.set(seriesKey(m), m);
  }
  return out;
}

function deltaOf(a: string | null, b: string | null): string | null {
  const x = a === null ? null : parseDecimal(a);
  const y = b === null ? null : parseDecimal(b);
  return x && y ? ratioToDecimal(subRatio(y as Ratio, x as Ratio), 6) : null;
}

function comparePair(base: ComparableRun, cand: ComparableRun): PairComparison {
  const b = lastValues(base.metrics);
  const c = lastValues(cand.metrics);
  const keys = [...new Set([...b.keys(), ...c.keys()])].sort();
  const deltas = keys.map((k) => {
    const m = (b.get(k) ?? c.get(k))!;
    return { metricKey: m.metricKey, scope: m.scope, resource: m.resource ?? null, baseline: b.get(k)?.value ?? null, candidate: c.get(k)?.value ?? null, delta: deltaOf(b.get(k)?.value ?? null, c.get(k)?.value ?? null) };
  });
  const ids = [...new Set([...base.gates.map((g) => g.gateId), ...cand.gates.map((g) => g.gateId)])].sort();
  const gates = ids.map((gateId) => ({ gateId, baseline: base.gates.find((g) => g.gateId === gateId)?.outcome ?? 'missing', candidate: cand.gates.find((g) => g.gateId === gateId)?.outcome ?? 'missing' }));
  return { scenarioId: base.scenarioId, scenarioVersion: base.scenarioVersion, seed: base.seed, deltas, gates };
}

const fail = (baseline: ComparableExperiment, candidate: ComparableExperiment, errors: ComparisonResult['errors']): ComparisonResult =>
  ({ ok: false, errors, baselineId: baseline.id, candidateId: candidate.id, pairs: [], regressions: [], improvements: [], verdict: 'incomparable' });

/** Compares two completed experiments run on the same (scenario, version, seed) set. */
export function compareExperiments(baseline: ComparableExperiment, candidate: ComparableExperiment): ComparisonResult {
  const notDone = [baseline, candidate].filter((e) => e.status !== 'completed').map((e) => ({ code: 'not_completed', message: `experiment ${e.id} is ${e.status}, not completed` }));
  if (notDone.length > 0) return fail(baseline, candidate, notDone);
  const bk = new Map(baseline.runs.map((r) => [runKey(r), r]));
  const ck = new Map(candidate.runs.map((r) => [runKey(r), r]));
  const missing = [...bk.keys()].filter((k) => !ck.has(k)).concat([...ck.keys()].filter((k) => !bk.has(k)));
  if (missing.length > 0) return fail(baseline, candidate, [{ code: 'unpaired_runs', message: `runs without a pair: ${missing.sort().join(', ')}` }]);
  const pairs = [...bk.keys()].sort().map((k) => comparePair(bk.get(k)!, ck.get(k)!));
  const tag = (p: PairComparison, g: GateTransition) => ({ ...g, scenarioId: p.scenarioId, seed: p.seed });
  const regressions = pairs.flatMap((p) => p.gates.filter((g) => g.baseline === 'pass' && g.candidate !== 'pass').map((g) => tag(p, g)));
  const improvements = pairs.flatMap((p) => p.gates.filter((g) => g.baseline !== 'pass' && g.candidate === 'pass').map((g) => tag(p, g)));
  const verdict = regressions.length > 0 ? 'regression' : improvements.length > 0 ? 'improvement' : 'neutral';
  return { ok: true, errors: [], baselineId: baseline.id, candidateId: candidate.id, pairs, regressions, improvements, verdict };
}
