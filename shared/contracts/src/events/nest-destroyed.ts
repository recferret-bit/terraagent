import { z } from 'zod';
import { defineEvent } from './define';

export const NestDestroyedDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  hiveId: z.number().int().optional(),
  entityId: z.number().int().optional(),
  species: z.string().optional(),
  attackerId: z.number().int().optional(),
  count: z.number().int().positive().optional(),
  q: z.number().int(),
  r: z.number().int(),
});
export type NestDestroyedData = z.infer<typeof NestDestroyedDataSchema>;

export const event = defineEvent({
  kind: 'nestDestroyed',
  wave: 'W07',
  severity: 'info',
  audience: 'player',
  data: NestDestroyedDataSchema,
  summary: 'Emitted when a fauna hive is destroyed, halting further spawns and wave rolls from that hive (UO-T-09, W07-15, W07-16, W07-27).',
});
