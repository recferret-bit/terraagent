import type { Assessment, ComparableExperiment, ComparisonOptions, PairComparison, SensitivityReport, SliceReport } from './compare';
import { pairExperiments, sliceOf } from './compare';

/**
 * The recommendation rules (ECONOMY §6): never one scalar, never platform revenue alone, never a favourable subset of
 * seeds. Order of refusal: hard gates, gate regressions, a worse dimension, no non-revenue improvement, held-out
 * disagreement or absence, a failed sensitivity case. Missing data is `insufficient_evidence`, never a pass.
 */
const improvedNonRevenue = (s: SliceReport): string[] => s.dimensions.filter((d) => d.verdict === 'improved' && !d.revenue).map((d) => d.id);
const worseDims = (s: SliceReport): string[] => s.dimensions.filter((d) => d.verdict === 'worse').map((d) => d.id);

function sensitivityReport(c: { label: string; baseline: ComparableExperiment; candidate: ComparableExperiment }): SensitivityReport {
  const p = pairExperiments(c.baseline, c.candidate);
  if ('errors' in p) return { label: c.label, status: 'insufficient_data', reasons: p.errors.map((e) => e.message), slice: null };
  const slice = sliceOf(`sensitivity:${c.label}`, p.pairs, c.candidate.runs, 'sign');
  const reasons: string[] = [];
  if (slice.hardGatesPass === false) reasons.push('a hard gate fails');
  if (slice.gateRegressions.length > 0) reasons.push(`${slice.gateRegressions.length} gate(s) regress`);
  if (worseDims(slice).length > 0) reasons.push(`worse on ${worseDims(slice).join(', ')}`);
  return { label: c.label, status: reasons.length > 0 ? 'fail' : 'pass', reasons, slice };
}

function slicesOf(pairs: readonly PairComparison[], candidate: ComparableExperiment) {
  const of = (role: PairComparison['role'], mode: 'ci' | 'sign') => {
    const sel = pairs.filter((p) => p.role === role);
    const runs = candidate.runs.filter((r) => (r.stress ? 'stress' : r.heldOut ? 'heldOut' : 'tuning') === role);
    return { sel, slice: sliceOf(role, sel, runs, mode) };
  };
  return { tuning: of('tuning', 'ci'), heldOut: of('heldOut', 'sign'), stress: of('stress', 'sign') };
}

export function assess(pairs: readonly PairComparison[], candidate: ComparableExperiment, opts: ComparisonOptions): Assessment {
  const { tuning, heldOut, stress } = slicesOf(pairs, candidate);
  const sens = (opts.sensitivity ?? []).map(sensitivityReport);
  const sensStatus = sens.length === 0 ? 'insufficient_data' : sens.some((s) => s.status === 'fail') ? 'fail' : sens.some((s) => s.status === 'insufficient_data') ? 'insufficient_data' : 'pass';
  const slices = [tuning.slice, ...(heldOut.sel.length ? [heldOut.slice] : []), ...(stress.sel.length ? [stress.slice] : [])];
  const reasons: string[] = [];
  const caveats: string[] = [];
  let decision: Assessment['decision'] = 'recommend';
  const refuse = (why: string): void => { reasons.push(why); decision = 'do_not_recommend'; };
  const lack = (why: string): void => { reasons.push(why); if (decision === 'recommend') decision = 'insufficient_evidence'; };

  for (const s of slices) {
    if (s.hardGatesPass === false) refuse(`a hard gate fails on the ${s.name} runs`);
    if (s.gateRegressions.length > 0) refuse(`${s.gateRegressions.length} gate(s) regress on the ${s.name} runs: ${[...new Set(s.gateRegressions.map((g) => g.gateId))].join(', ')}`);
    if (worseDims(s).length > 0) refuse(`worse on ${worseDims(s).join(', ')} on the ${s.name} runs`);
  }
  const gain = improvedNonRevenue(tuning.slice);
  if (gain.length === 0) {
    const revenue = tuning.slice.dimensions.find((d) => d.revenue && d.verdict === 'improved');
    if (revenue) refuse('the only improvement is platform revenue / fee contribution');
    else if (tuning.slice.dimensions.some((d) => d.subsetOnly)) refuse('the apparent improvement holds only on a subset of seeds');
    else if (tuning.slice.dimensions.every((d) => d.verdict === 'insufficient_data')) lack('insufficient_data: not enough paired seeds (at least two) to judge any dimension');
    else refuse('no non-revenue dimension improved');
  }
  if (heldOut.sel.length === 0) lack('no held-out seeds ran: the improvement cannot be confirmed');
  else {
    const disagree = gain.filter((id) => heldOut.slice.dimensions.find((d) => d.id === id)?.verdict === 'worse');
    if (disagree.length > 0) refuse(`held-out seeds disagree on ${disagree.join(', ')}`);
    else if (gain.length > 0 && !gain.some((id) => heldOut.slice.dimensions.find((d) => d.id === id)?.verdict === 'improved')) refuse('the improvement does not reproduce on the held-out seeds');
  }
  if (sensStatus === 'fail') refuse(`fails the demand sensitivity range: ${sens.filter((s) => s.status === 'fail').map((s) => s.label).join(', ')}`);
  else if (sensStatus === 'insufficient_data') caveats.push('no (or incomplete) demand sensitivity runs: the result holds only for the assumed demand');
  if (stress.sel.length === 0) caveats.push('no stress-suite runs');
  caveats.push('simulations cannot prove real buyer willingness to pay; gate thresholds are uncalibrated hypotheses');

  const movedGates = pairs.flatMap((p) => p.gates.filter((g) => g.baseline !== g.candidate).map((g) => ({ ...g, scenarioId: p.scenarioId, seed: p.seed })));
  const movedMetrics = slices.flatMap((s) => s.dimensions.flatMap((d) => d.series.filter((x) => x.verdict !== 'neutral' && x.verdict !== 'insufficient_data').map((x) => ({
    slice: s.name, dimension: d.id, metricKey: x.metricKey, resource: x.resource, verdict: x.verdict, mean: x.mean, ci: x.ci, seeds: x.seeds, seedsBetter: x.seedsBetter, seedsWorse: x.seedsWorse,
  }))));
  return {
    decision, reasons: reasons.length === 0 ? [`improves ${gain.join(', ')} with no dimension worse, on tuning and held-out seeds`] : reasons, caveats,
    tuning: tuning.slice, heldOut: heldOut.sel.length ? heldOut.slice : null, stress: stress.sel.length ? stress.slice : null,
    sensitivity: { status: sensStatus, cases: sens }, movedGates, movedMetrics,
  };
}
