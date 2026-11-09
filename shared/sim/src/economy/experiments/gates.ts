import { GateResult } from '@terra/contracts';
import { ratio, ratioToDecimal, subRatio, type Ratio } from '../flows/ratio';
import type { RunResult } from './types';

/** A versioned economic gate over one metric series of a run (ECONOMY §7). Data lives in the scenario's `assumptions.gates`. */
export interface GateDef {
  readonly gateId: string;
  readonly gateVersion: number;
  readonly metricKey: string;
  readonly scope: string;
  readonly resource?: string;
  /** The window the series is read over: the last sample, or the min/max over the measure window. */
  readonly aggregate: 'last' | 'min' | 'max';
  /** `hard` gates are conservation/safety invariants (evaluated by code); `economic` gates are calibration hypotheses (ECONOMY §7). */
  readonly kind?: 'hard' | 'economic';
  readonly cohort?: string;
  readonly op: 'gte' | 'lte';
  /** Exact decimal. */
  readonly threshold: string;
}

/** Decimal string (`-12.5`) to an exact ratio; null for anything else. */
export function parseDecimal(s: string): Ratio | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  const num = BigInt(`${m[2]}${frac}`) * (m[1] ? -1n : 1n);
  return ratio(num, BigInt(`1${'0'.repeat(frac.length)}`));
}

const cmp = (a: Ratio, b: Ratio): number => {
  const d = subRatio(a, b).num;
  return d === 0n ? 0 : d < 0n ? -1 : 1;
};

export function parseGateDefs(raw: unknown): GateDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((g): g is GateDef => !!g && typeof g === 'object' && typeof (g as GateDef).gateId === 'string' && typeof (g as GateDef).metricKey === 'string');
}

/** The fields a gate reads of a metric row (a `MetricRow` or a stored/compared row). */
export interface GateRow { readonly metricKey: string; readonly scope: string; readonly resource?: string | null; readonly cohort?: string | null; readonly value: string | null }

export function evaluateOne(def: GateDef, metrics: readonly GateRow[], runId: string): GateResult {
  const rows = metrics.filter((m) => m.metricKey === def.metricKey && m.scope === def.scope && (def.resource === undefined || m.resource === def.resource) && (def.cohort === undefined || m.cohort === def.cohort) && m.value !== null);
  const values = rows.map((r) => parseDecimal(r.value as string)).filter((v): v is Ratio => v !== null);
  const base = { gateId: def.gateId, gateVersion: def.gateVersion, threshold: def.threshold, runId };
  const limit = parseDecimal(def.threshold);
  if (values.length === 0 || !limit) return GateResult.parse({ ...base, outcome: 'insufficient_data', observed: null });
  const observed = def.aggregate === 'last' ? values[values.length - 1]! : values.reduce((a, b) => ((cmp(b, a) < 0) === (def.aggregate === 'min') ? b : a));
  const ok = def.op === 'gte' ? cmp(observed, limit) >= 0 : cmp(observed, limit) <= 0;
  return GateResult.parse({ ...base, outcome: ok ? 'pass' : 'fail', observed: ratioToDecimal(observed, 6) });
}

/** Hard gates that always apply (ECONOMY §7): exact reconciliation, no negative stock, no mock-ledger drift. */
export function hardGates(run: RunResult): GateResult[] {
  const rec = run.flowsReconciliation;
  const driftRows = Object.entries(rec.resources).filter(([, r]) => r.drift !== '0');
  const mk = (gateId: string, ok: boolean, observed: string): GateResult =>
    GateResult.parse({ gateId, gateVersion: 1, outcome: ok ? 'pass' : 'fail', observed, threshold: '0', runId: run.runId });
  return [
    mk('hard.flow_reconciliation', driftRows.length === 0, String(driftRows.length)),
    mk('hard.no_negative_stock', rec.negativeStock.length === 0, String(rec.negativeStock.length)),
    mk('hard.mock_ledger_conservation', rec.usdc.drift === '0', rec.usdc.drift),
  ];
}

export const evaluateGates = (run: RunResult, defs: readonly GateDef[]): GateResult[] =>
  [...hardGates(run), ...defs.map((d) => evaluateOne(d, run.metrics, run.runId))];
