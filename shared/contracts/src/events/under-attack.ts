import { z } from 'zod';
import { defineEvent } from './define';

export const UnderAttackDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  entityId: z.number().int().optional(),
  attackerId: z.number().int().optional(),
  q: z.number().int(),
  r: z.number().int(),
});
export type UnderAttackData = z.infer<typeof UnderAttackDataSchema>;

export const event = defineEvent({
  kind: 'underAttack',
  wave: 'W07',
  severity: 'warn',
  audience: 'player',
  data: UnderAttackDataSchema,
  summary: 'Emitted when a player-owned entity takes hostile damage, debounced once per 60 s per colony (W07-16).',
});
