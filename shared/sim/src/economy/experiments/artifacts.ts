import type { ExperimentManifest, MetricRow } from '@terra/contracts';
import { canonical } from '../../data/_hash';
import type { ExperimentResult } from './run-experiment';
import { hashJson } from './hashes';

/** Pure builders of the runner's artifact files (ECONOMY §6 outputs). The CLI only writes them. */

const csvCell = (v: string | number | undefined): string => {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const METRICS_CSV_COLUMNS = ['runId', 'startTick', 'endTick', 'scope', 'resource', 'pair', 'cohort', 'metricKey', 'value', 'reason', 'unit'] as const;

const rowsOf = (r: ExperimentResult): MetricRow[] => r.runs.flatMap((x) => x.run.metrics);

/** One canonical JSON object per line, key order fixed by `canonical` (sorted), so equal runs are byte-equal. */
export const metricsJsonl = (r: ExperimentResult): string => rowsOf(r).map((m) => `${canonical(m)}\n`).join('');

export const metricsCsv = (r: ExperimentResult): string => {
  const lines = [METRICS_CSV_COLUMNS.join(',')];
  for (const m of rowsOf(r)) {
    lines.push([m.runId, m.window.startTick, m.window.endTick, m.scope, m.resource, m.pair, m.cohort, m.metricKey, m.value ?? '', m.reason, m.unit].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
};

export interface SummaryContext {
  readonly manifest: ExperimentManifest;
  readonly engine: { readonly commit: string; readonly pinned: boolean };
  /** Free-form run environment (wall clock, node version): kept apart from the deterministic part. */
  readonly environment?: Readonly<Record<string, unknown>>;
}

/** `summary.json`: everything deterministic first (what a replay must reproduce), the environment last. */
export function buildSummary(r: ExperimentResult, ctx: SummaryContext): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: r.status,
    outcome: r.outcome,
    manifestHash: hashJson(ctx.manifest),
    profile: ctx.manifest.profile,
    engine: ctx.engine,
    plannedRuns: r.plannedRuns,
    executedRuns: r.runs.length,
    runs: r.runs.map(({ run, gates }) => ({
      runId: run.runId, scenarioId: run.scenarioId, scenarioVersion: run.scenarioVersion, seed: run.seed, hashes: run.hashes,
      rngState: run.rngState, summary: run.summary, flowsReconciliation: run.flowsReconciliation, gates,
      metricsHash: hashJson(run.metrics),
    })),
    failing: r.failing,
    environment: ctx.environment ?? {},
  };
}

export const replayText = (r: ExperimentResult): string => r.failing.length === 0 ? '' : `${[...new Set(r.failing.map((f) => f.replay))].join('\n')}\n`;
