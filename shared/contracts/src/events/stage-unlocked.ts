import { z } from 'zod';
import { defineEvent } from './define';

export const StageUnlockedDataSchema = z.strictObject({
  colonyIndex: z.number().int().nonnegative(),
  unlockStage: z.number().int().min(0).max(10),
  previousUnlockStage: z.number().int().min(0).max(10).optional(),
  units: z.array(z.string()).optional(),
  buildings: z.array(z.string()).optional(),
  orders: z.array(z.string()).optional(),
});

export type StageUnlockedData = z.infer<typeof StageUnlockedDataSchema>;

export const event = defineEvent({
  kind: 'stageUnlocked',
  wave: 'W08',
  audience: 'player',
  severity: 'info',
  data: StageUnlockedDataSchema,
  summary: 'Emitted when a colony or player unlockStage advances, unlocking new buildable structures, units, and orders (UO-LC-02).',
});
