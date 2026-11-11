import { z } from 'zod';
import { ColonyTargetIdSchema } from '../diplomacy';
import { defineEvent } from './define';

export const TruceNoticeDataSchema = z.strictObject({
  truceId: z.string().min(1).max(64),
  cancelledBy: z.number().int().nonnegative().optional(),
  cancelledByColonyId: ColonyTargetIdSchema.optional(),
  colonyA: z.number().int().nonnegative().optional(),
  colonyB: z.number().int().nonnegative().optional(),
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  noticeS: z.number().int().nonnegative().optional(),
  noticeEndsAtTick: z.number().int().nonnegative(),
});
export type TruceNoticeData = z.infer<typeof TruceNoticeDataSchema>;

export const event = defineEvent({
  kind: 'truceNotice',
  wave: 'W18',
  severity: 'warn',
  audience: 'player',
  data: TruceNoticeDataSchema,
  summary: 'Emitted when a partner initiates the 10-minute cancellation notice on an active truce (`UO-DIP-04`, W18-01, W18-14).',
});
