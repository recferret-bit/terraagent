import { z } from 'zod';
import { defineEvent } from './define';

export const StageReachedDataSchema = z.strictObject({
  colonyIndex: z.number().int().nonnegative(),
  stage: z.number().int().min(0).max(10),
  previousStage: z.number().int().min(0).max(10).optional(),
  title: z.string().min(1).max(64).optional(),
  teaches: z.string().max(128).optional(),
  units: z.array(z.string()).optional(),
  buildings: z.array(z.string()).optional(),
  orders: z.array(z.string()).optional(),
  override: z.string().max(32).optional(),
});

export type StageReachedData = z.infer<typeof StageReachedDataSchema>;

export const event = defineEvent({
  kind: 'stageReached',
  wave: 'W08',
  audience: 'player',
  severity: 'info',
  data: StageReachedDataSchema,
  summary: 'Emitted when a colony reaches a new progression stage after trigger and dwell (or safety override, UO-P §6.2–§6.3).',
});
