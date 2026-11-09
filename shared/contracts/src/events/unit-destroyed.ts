import { z } from 'zod';
import { defineEvent } from './define';

export const UnitDestroyedDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  entityId: z.number().int(),
  unit: z.string().optional(),
  kind: z.number().int().optional(),
  attackerId: z.number().int().optional(),
  q: z.number().int(),
  r: z.number().int(),
});
export type UnitDestroyedData = z.infer<typeof UnitDestroyedDataSchema>;

export const event = defineEvent({
  kind: 'unitDestroyed',
  wave: 'W07',
  severity: 'warn',
  audience: 'player',
  data: UnitDestroyedDataSchema,
  summary: 'Emitted when a non-HQ unit reaches 0 HP and is removed from the world (W07-02, W07-16).',
});
