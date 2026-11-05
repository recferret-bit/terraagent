import { ratioToDecimal, subRatio } from '../flows/ratio';
import { dimensionsOf, type DimensionReport, type Mode } from './compare-assess';
import { ECONOMIC_GATES, GATE_CATALOG } from './gate-catalog';
import { evaluateOne, parseDecimal } from './gates';
import { assess } from './recommend-rules';

/**
 * Paired-seed comparison, held-out check, sensitivity and Pareto assessment (ECONOMY §6/§7, W13-48). Pure: completed
 * experiments in, a report out. Statistics are exact (see `stats.ts`). No scalar score exists: a candidate is judged on
 * the dimensions of `metric-dimensions.ts` together, and platform revenue alone can never make it a winner.
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
  /** The seed is one of the manifest's `heldOutSeeds`. */
  readonly heldOut?: boolean;
  /** The scenario is a stress-suite scenario (`assumptions.stress`). */
  readonly stress?: boolean;
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
  readonly role: 'tuning' | 'heldOut' | 'stress';
  readonly deltas: MetricDelta[];
  readonly gates: GateTransition[];
}
type Tagged = GateTransition & { readonly scenarioId: string; readonly seed: number };

export interface SensitivityCase { readonly label: string; readonly baseline: ComparableExperiment; readonly candidate: ComparableExperiment }
export interface ComparisonOptions {
  /** Same-scenario re-runs over the assumed-demand range (see `sensitivityManifests`). */
  readonly sensitivity?: readonly SensitivityCase[];
  /** Reference to the external limited real-player pilot record. The API never accepts one in W13, so `cashApproval` stays false. */
  readonly pilotEvidence?: string;
}

export interface SliceReport {
  readonly name: string;
  readonly mode: Mode;
  readonly pairs: number;
  readonly seeds: number[];
  readonly dimensions: DimensionReport[];
  /** Every hard gate passed on the candidate's runs of the slice (null: no runs). */
  readonly hardGatesPass: boolean | null;
  readonly gateRegressions: Tagged[];
}
export interface SensitivityReport { readonly label: string; readonly status: 'pass' | 'fail' | 'insufficient_data'; readonly reasons: string[]; readonly slice: SliceReport | null }

export interface Assessment {
  readonly decision: 'recommend' | 'do_not_recommend' | 'insufficient_evidence';
  readonly reasons: string[];
  readonly caveats: string[];
  readonly tuning: SliceReport;
  readonly heldOut: SliceReport | null;
  readonly stress: SliceReport | null;
  readonly sensitivity: { readonly status: 'pass' | 'fail' | 'insufficient_data'; readonly cases: SensitivityReport[] };
  /** Which gates moved and which metrics moved, on which seeds: the explanation of the decision. */
  readonly movedGates: Tagged[];
  readonly movedMetrics: { readonly slice: string; readonly dimension: string; readonly metricKey: string; readonly resource: string | null; readonly verdict: string; readonly mean: string | null; readonly ci: { lo: string; hi: string } | null; readonly seeds: number[]; readonly seedsBetter: number; readonly seedsWorse: number }[];
}

export interface ComparisonResult {
  readonly ok: boolean;
  /** Why the two experiments cannot be compared (`not_completed`, `unpaired_runs`); empty when `ok`. */
  readonly errors: readonly { readonly code: string; readonly message: string }[];
  readonly baselineId: string;
  readonly candidateId: string;
  readonly pairs: PairComparison[];
  readonly regressions: readonly Tagged[];
  readonly improvements: readonly Tagged[];
  /** Gate-level view: `regression` when a baseline-passing gate no longer passes, `improvement` when a failing one now passes, else `neutral`. */
  readonly verdict: 'regression' | 'improvement' | 'neutral' | 'incomparable';
  readonly assessment: Assessment | null;
  /** Always false in W13: needs every hard + economic gate approved and passing on tuning, held-out and stress runs AND external pilot evidence. */
  readonly cashApproval: boolean;
  readonly cashApprovalBlockers: string[];
  readonly gateCatalog: { readonly id: string; readonly version: number; readonly kind: string; readonly approved: boolean }[];
}

const runKey = (r: ComparableRun): string => `${r.scenarioId}@${r.scenarioVersion}#${r.seed}`;
const seriesKey = (m: ComparableMetric): string => [m.metricKey, m.scope, m.resource ?? '', m.pair ?? '', m.cohort ?? ''].join('|');
const roleOf = (r: ComparableRun): PairComparison['role'] => (r.stress ? 'stress' : r.heldOut ? 'heldOut' : 'tuning');

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
  return x && y ? ratioToDecimal(subRatio(y, x), 6) : null;
}

/** The run's stored gates plus the catalog's economic gates read from its last sampled window (never silently missing). */
function gatesOf(run: ComparableRun): ComparableGate[] {
  const last = [...lastValues(run.metrics).values()];
  const stored = new Set(run.gates.map((g) => g.gateId));
  const extra = ECONOMIC_GATES.filter((g) => !stored.has(g.gateId)).map((g) => evaluateOne(g, last, ''));
  return [...run.gates, ...extra.map((g) => ({ gateId: g.gateId, gateVersion: g.gateVersion, outcome: g.outcome }))];
}

function comparePair(base: ComparableRun, cand: ComparableRun): PairComparison {
  const b = lastValues(base.metrics);
  const c = lastValues(cand.metrics);
  const keys = [...new Set([...b.keys(), ...c.keys()])].sort();
  const deltas = keys.map((k) => {
    const m = (b.get(k) ?? c.get(k))!;
    return { metricKey: m.metricKey, scope: m.scope, resource: m.resource ?? null, baseline: b.get(k)?.value ?? null, candidate: c.get(k)?.value ?? null, delta: deltaOf(b.get(k)?.value ?? null, c.get(k)?.value ?? null) };
  });
  const bg = gatesOf(base);
  const cg = gatesOf(cand);
  const ids = [...new Set([...bg.map((g) => g.gateId), ...cg.map((g) => g.gateId)])].sort();
  const gates = ids.map((gateId) => ({ gateId, baseline: bg.find((g) => g.gateId === gateId)?.outcome ?? 'missing', candidate: cg.find((g) => g.gateId === gateId)?.outcome ?? 'missing' }));
  return { scenarioId: base.scenarioId, scenarioVersion: base.scenarioVersion, seed: base.seed, role: roleOf(cand), deltas, gates };
}

const fail = (baseline: ComparableExperiment, candidate: ComparableExperiment, errors: ComparisonResult['errors']): ComparisonResult => ({
  ok: false, errors, baselineId: baseline.id, candidateId: candidate.id, pairs: [], regressions: [], improvements: [], verdict: 'incomparable', assessment: null,
  cashApproval: false, cashApprovalBlockers: ['experiments are not comparable'], gateCatalog: catalogSummary(),
});
const catalogSummary = (): ComparisonResult['gateCatalog'] => GATE_CATALOG.map((g) => ({ id: g.gateId, version: g.gateVersion, kind: g.kind, approved: g.approved }));

/** Pairs two experiments by (scenario, version, seed); an error when they are unfinished or their run sets differ. */
export function pairExperiments(baseline: ComparableExperiment, candidate: ComparableExperiment): { pairs: PairComparison[] } | { errors: ComparisonResult['errors'] } {
  const notDone = [baseline, candidate].filter((e) => e.status !== 'completed').map((e) => ({ code: 'not_completed', message: `experiment ${e.id} is ${e.status}, not completed` }));
  if (notDone.length > 0) return { errors: notDone };
  const bk = new Map(baseline.runs.map((r) => [runKey(r), r]));
  const ck = new Map(candidate.runs.map((r) => [runKey(r), r]));
  const missing = [...bk.keys()].filter((k) => !ck.has(k)).concat([...ck.keys()].filter((k) => !bk.has(k)));
  if (missing.length > 0) return { errors: [{ code: 'unpaired_runs', message: `runs without a pair: ${missing.sort().join(', ')}` }] };
  return { pairs: [...bk.keys()].sort().map((k) => comparePair(bk.get(k)!, ck.get(k)!)) };
}

const hardOk = (runs: readonly ComparableRun[]): boolean | null => (runs.length === 0 ? null : runs.every((r) => gatesOf(r).filter((g) => g.gateId.startsWith('hard.')).every((g) => g.outcome === 'pass')));
const tag = (p: PairComparison, g: GateTransition): Tagged => ({ ...g, scenarioId: p.scenarioId, seed: p.seed });

export function sliceOf(name: string, pairs: readonly PairComparison[], candidateRuns: readonly ComparableRun[], mode: Mode): SliceReport {
  return {
    name, mode, pairs: pairs.length, seeds: [...new Set(pairs.map((p) => p.seed))].sort((a, b) => a - b), dimensions: dimensionsOf(pairs, mode),
    hardGatesPass: hardOk(candidateRuns), gateRegressions: pairs.flatMap((p) => p.gates.filter((g) => g.baseline === 'pass' && g.candidate !== 'pass').map((g) => tag(p, g))),
  };
}

/** Compares two completed experiments run on the same (scenario, version, seed) set. */
export function compareExperiments(baseline: ComparableExperiment, candidate: ComparableExperiment, opts: ComparisonOptions = {}): ComparisonResult {
  const paired = pairExperiments(baseline, candidate);
  if ('errors' in paired) return fail(baseline, candidate, paired.errors);
  const { pairs } = paired;
  const regressions = pairs.flatMap((p) => p.gates.filter((g) => g.baseline === 'pass' && g.candidate !== 'pass').map((g) => tag(p, g)));
  const improvements = pairs.flatMap((p) => p.gates.filter((g) => g.baseline !== 'pass' && g.candidate === 'pass').map((g) => tag(p, g)));
  const verdict = regressions.length > 0 ? 'regression' : improvements.length > 0 ? 'improvement' : 'neutral';
  const assessment = assess(pairs, candidate, opts);
  const blockers = cashBlockers(pairs, candidate, opts);
  return { ok: true, errors: [], baselineId: baseline.id, candidateId: candidate.id, pairs, regressions, improvements, verdict, assessment, cashApproval: blockers.length === 0, cashApprovalBlockers: blockers, gateCatalog: catalogSummary() };
}

function cashBlockers(pairs: readonly PairComparison[], candidate: ComparableExperiment, opts: ComparisonOptions): string[] {
  const out: string[] = [];
  for (const role of ['tuning', 'heldOut', 'stress'] as const) if (!pairs.some((p) => p.role === role)) out.push(`no ${role} runs`);
  const notPass = candidate.runs.flatMap((r) => gatesOf(r).filter((g) => g.outcome !== 'pass').map((g) => g.gateId));
  if (notPass.length > 0) out.push(`gates not passing: ${[...new Set(notPass)].sort().join(', ')}`);
  const unapproved = GATE_CATALOG.filter((g) => !g.approved).map((g) => g.gateId);
  if (unapproved.length > 0) out.push(`uncalibrated gates (thresholds are hypotheses): ${unapproved.join(', ')}`);
  if (!opts.pilotEvidence) out.push('no external pilot evidence (limited real-player pilot record)');
  return out;
}
