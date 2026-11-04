import { z } from 'zod';
import { ResourceKey } from '../ws/sim';

export const EXPERIMENT_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled', 'incomplete'] as const;
export const ExperimentStatus = z.enum(EXPERIMENT_STATUSES);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;
/** Terminal statuses; budget exhaustion is `incomplete`, never a pass (ECONOMY §6). */
export const isTerminalExperimentStatus = (s: ExperimentStatus): boolean => s !== 'queued' && s !== 'running';

export const GATE_OUTCOMES = ['pass', 'fail', 'insufficient_data'] as const;
export const GateOutcome = z.enum(GATE_OUTCOMES);
export type GateOutcome = z.infer<typeof GateOutcome>;

/** `observed` / `threshold` are exact decimal strings (or null when there is no observation). */
export const GateResult = z.strictObject({
  gateId: z.string().min(1),
  gateVersion: z.number().int().positive(),
  outcome: GateOutcome,
  observed: z.string().nullable(),
  threshold: z.string(),
  runId: z.string().optional(),
});
export type GateResult = z.infer<typeof GateResult>;

export const MetricRow = z.strictObject({
  runId: z.string().optional(),
  window: z.strictObject({ startTick: z.number().int().nonnegative(), endTick: z.number().int().nonnegative() }),
  scope: z.string().min(1),
  resource: ResourceKey.optional(),
  pair: z.string().optional(),
  cohort: z.string().optional(),
  metricKey: z.string().min(1),
  /** Exact decimal string; null when undefined (zero demand, uncertain price) with a `reason` code. */
  value: z.string().nullable(),
  reason: z.string().optional(),
  unit: z.string().min(1),
}).refine((m) => m.value !== null || (m.reason !== undefined && m.reason !== ''), { message: 'a null value needs a reason code', path: ['reason'] });
export type MetricRow = z.infer<typeof MetricRow>;
