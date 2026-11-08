import { z } from 'zod';
import { defineEvent } from './define';

export const FaunaKilledDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  entityId: z.number().int(),
  hiveId: z.number().int().optional(),
  species: z.string().optional(),
  attackerId: z.number().int().optional(),
  count: z.number().int().positive().optional(),
  q: z.number().int(),
  r: z.number().int(),
});
export type FaunaKilledData = z.infer<typeof FaunaKilledDataSchema>;

export const event = defineEvent({
  kind: 'faunaKilled',
  wave: 'W07',
  severity: 'info',
  audience: 'player',
  data: FaunaKilledDataSchema,
  summary: 'Emitted when a fauna unit is killed by a colony, driving the Exterminator achievement family (W07-01, W07-27).',
});
