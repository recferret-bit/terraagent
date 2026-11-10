import { z } from 'zod';
import { TruceEndReasonSchema } from '../diplomacy';
import { defineEvent } from './define';

export const TruceEndedDataSchema = z.strictObject({
  truceId: z.string().min(1).max(64),
  colonyA: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]).optional(),
  colonyB: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]).optional(),
  colonyAId: z.string().min(1).max(64).optional(),
  colonyBId: z.string().min(1).max(64).optional(),
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  reason: TruceEndReasonSchema,
  cancelledBy: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]).optional(),
  oathbreakerUntilTick: z.number().int().nonnegative().optional(),
  endedAtTick: z.number().int().nonnegative().optional(),
  count: z.number().int().positive().optional(),
});
export type TruceEndedData = z.infer<typeof TruceEndedDataSchema>;

export const event = defineEvent({
  kind: 'truceEnded',
  wave: 'W18',
  severity: 'info',
  audience: 'player',
  data: TruceEndedDataSchema,
  summary: 'Emitted when a truce expires on term or ends after its 10-minute cancellation notice (`UO-DIP-04`, W18-01, W18-14).',
});
