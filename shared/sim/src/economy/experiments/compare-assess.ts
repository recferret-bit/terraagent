import { ratio, subRatio, type Ratio } from '../flows/ratio';
import { DIMENSIONS, type Polarity } from './metric-dimensions';
import { parseDecimal } from './gates';
import { decimal, pairedStats, sign } from './stats';
import type { PairComparison } from './compare';

export type SeriesVerdict = 'better' | 'worse' | 'neutral' | 'insufficient_data';
export type DimensionVerdict = 'improved' | 'worse' | 'neutral' | 'insufficient_data';
/** `ci`: significance needs the 95 % interval to exclude 0 (tuning seeds). `sign`: the mean's direction (held-out, stress and sensitivity slices have too few seeds for an interval). */
export type Mode = 'ci' | 'sign';

export interface SeriesReport {
  readonly dimension: string;
  readonly scenarioId: string;
  readonly metricKey: string;
  readonly scope: string;
  readonly resource: string | null;
  readonly polarity: Polarity;
  readonly n: number;
  readonly seeds: number[];
  /** Mean paired difference `candidate - baseline` (decimal) and its 95 % interval (null: fewer than two pairs). */
  readonly mean: string | null;
  readonly ci: { readonly lo: string; readonly hi: string } | null;
  readonly seedsBetter: number;
  readonly seedsWorse: number;
  readonly verdict: SeriesVerdict;
  /** The mean says better but not on (almost) every seed: a favourable subset, not an improvement. */
  readonly subsetOnly: boolean;
}
export interface DimensionReport { readonly id: string; readonly revenue: boolean; readonly verdict: DimensionVerdict; readonly subsetOnly: boolean; readonly series: SeriesReport[] }

const exact = (v: string | null): Ratio | null => (v === null ? null : parseDecimal(v));

/** Series of one dimension over the pairs of a slice, one per (scenario, metric, scope, resource). */
function seriesOf(pairs: readonly PairComparison[], dimension: string, metricKey: string, polarity: Polarity, mode: Mode): SeriesReport[] {
  const groups = new Map<string, { scenarioId: string; scope: string; resource: string | null; seeds: number[]; diffs: Ratio[] }>();
  for (const p of pairs) {
    for (const d of p.deltas) {
      if (d.metricKey !== metricKey || d.scope !== 'global') continue;
      const b = exact(d.baseline);
      const c = exact(d.candidate);
      if (!b || !c) continue;
      const k = `${p.scenarioId}|${d.scope}|${d.resource ?? ''}`;
      const g = groups.get(k) ?? { scenarioId: p.scenarioId, scope: d.scope, resource: d.resource, seeds: [], diffs: [] };
      g.seeds.push(p.seed);
      g.diffs.push(subRatio(c, b));
      groups.set(k, g);
    }
  }
  return [...groups.values()].map((g) => classify(g, dimension, metricKey, polarity, mode));
}

function classify(g: { scenarioId: string; scope: string; resource: string | null; seeds: number[]; diffs: Ratio[] }, dimension: string, metricKey: string, polarity: Polarity, mode: Mode): SeriesReport {
  const eff = (r: Ratio): Ratio => (polarity === 'higher' ? r : ratio(-r.num, r.den));
  const stats = pairedStats(g.diffs.map(eff));
  const better = g.diffs.filter((d) => sign(eff(d)) > 0).length;
  const worse = g.diffs.filter((d) => sign(eff(d)) < 0).length;
  let verdict: SeriesVerdict = 'insufficient_data';
  if (stats) {
    if (mode === 'sign') verdict = sign(stats.mean) > 0 ? 'better' : sign(stats.mean) < 0 ? 'worse' : 'neutral';
    else if (stats.ci) verdict = sign(stats.ci.lo) > 0 ? 'better' : sign(stats.ci.hi) < 0 ? 'worse' : 'neutral';
  }
  const consistent = worse === 0 && better * 4 >= g.diffs.length * 3;
  const subsetOnly = verdict === 'better' && !consistent;
  if (subsetOnly) verdict = 'neutral';
  const rawMean = stats ? (polarity === 'higher' ? stats.mean : ratio(-stats.mean.num, stats.mean.den)) : null;
  const rawCi = stats?.ci ? (polarity === 'higher' ? stats.ci : { lo: ratio(-stats.ci.hi.num, stats.ci.hi.den), hi: ratio(-stats.ci.lo.num, stats.ci.lo.den) }) : null;
  return {
    dimension, scenarioId: g.scenarioId, metricKey, scope: g.scope, resource: g.resource, polarity, n: g.diffs.length, seeds: g.seeds, mean: rawMean ? decimal(rawMean) : null,
    ci: rawCi ? { lo: decimal(rawCi.lo), hi: decimal(rawCi.hi) } : null, seedsBetter: better, seedsWorse: worse, verdict, subsetOnly,
  };
}

/** Every dimension of ECONOMY §6 over a slice of pairs; a dimension with no usable series is `insufficient_data`, never neutral. */
export function dimensionsOf(pairs: readonly PairComparison[], mode: Mode): DimensionReport[] {
  return DIMENSIONS.map((dim) => {
    const series = dim.metrics.flatMap((m) => seriesOf(pairs, dim.id, m.metricKey, m.polarity, mode));
    const verdict: DimensionVerdict = series.some((s) => s.verdict === 'worse') ? 'worse' : series.some((s) => s.verdict === 'better') ? 'improved'
      : series.length === 0 || series.every((s) => s.verdict === 'insufficient_data') ? 'insufficient_data' : 'neutral';
    return { id: dim.id, revenue: dim.revenue, verdict, subsetOnly: series.some((s) => s.subsetOnly), series };
  });
}
