import { MetricRow, type ResourceKey } from '@terra/contracts';
import { ratioToDecimal, type Ratio } from './ratio';

/** Why a metric has no value (`MetricRow.reason`): never infinity, never a fabricated number. */
export type NullReason = 'no_consumption' | 'uncertain_price' | 'insufficient_data' | 'no_resource_output';

/** Tick window `[startTick, endTick]` a value was measured over. */
export interface FlowWindow {
  readonly startTick: number;
  readonly endTick: number;
}

/** `colony:<index>`, `global`, `sector:<id>` ... : what the value sums over. */
export type FlowScope = string;

/** A calculator result: an exact value or an explicit null with its reason, plus unit, window and scope. */
export interface Metric<T = Ratio> {
  readonly value: T | null;
  readonly reason?: NullReason;
  readonly unit: string;
  readonly window: FlowWindow;
  readonly scope: FlowScope;
}

export const metricOf = <T>(value: T, unit: string, window: FlowWindow, scope: FlowScope): Metric<T> => ({ value, unit, window, scope });
export const nullMetric = (reason: NullReason, unit: string, window: FlowWindow, scope: FlowScope): Metric<never> =>
  ({ value: null, reason, unit, window, scope });

/** A metric as a validated `MetricRow` (exact decimal string; `value: null` keeps its reason). */
export function toMetricRow(
  m: Metric<Ratio | bigint>,
  metricKey: string,
  extra: { resource?: ResourceKey; cohort?: string; pair?: string; runId?: string; digits?: number } = {},
): MetricRow {
  const { digits, ...ids } = extra;
  const value = m.value === null ? null : typeof m.value === 'bigint' ? m.value.toString() : ratioToDecimal(m.value, digits);
  return MetricRow.parse({
    ...ids, window: { startTick: m.window.startTick, endTick: m.window.endTick }, scope: m.scope, metricKey, value,
    ...(m.reason ? { reason: m.reason } : {}), unit: m.unit,
  });
}
