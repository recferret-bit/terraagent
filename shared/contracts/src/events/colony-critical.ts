import { z } from 'zod';
import { defineEvent } from './define';

export const ColonyCriticalCauseSchema = z.enum(['hub_destroyed', 'raid', 'fauna', 'environment', 'other']);
export type ColonyCriticalCause = z.infer<typeof ColonyCriticalCauseSchema>;

/** Declared here so W09-19 and W11-16 can consume it; W18-01 reuses this kind. */
export const ColonyCriticalDataSchema = z.strictObject({
  colonyId: z.string().min(1).max(64).optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  cause: ColonyCriticalCauseSchema,
  atTick: z.number().int().nonnegative().optional(),
  deadlineTick: z.number().int().nonnegative().optional(),
  timerS: z.number().int().nonnegative().optional(),
});
export type ColonyCriticalData = z.infer<typeof ColonyCriticalDataSchema>;

export const event = defineEvent({
  kind: 'colonyCritical',
  wave: 'W09',
  severity: 'critical',
  audience: 'player',
  data: ColonyCriticalDataSchema,
  summary: 'The colony Hub is down and the elimination timer is running (UO-HQ-04, D-17).',
});
