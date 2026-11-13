import { z } from 'zod';
import { ColonyTargetIdSchema, DiplomacyBondTokenSchema } from '../diplomacy';
import { defineEvent } from './define';

export const TruceNoticeDataSchema = z.strictObject({
  truceId: z.string().min(1).max(64),
  cancelledBy: ColonyTargetIdSchema.optional(),
  cancelledByColony: z.number().int().nonnegative().optional(),
  cancelledByColonyId: ColonyTargetIdSchema.optional(),
  partnerColonyId: ColonyTargetIdSchema.optional(),
  partnerColony: z.number().int().nonnegative().optional(),
  colonyA: z.number().int().nonnegative().optional(),
  colonyB: z.number().int().nonnegative().optional(),
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  noticeS: z.number().int().nonnegative().optional(),
  noticeEndsAtTick: z.number().int().nonnegative(),
  oathbreakerUntilTick: z.number().int().nonnegative().optional(),
  bondToken: DiplomacyBondTokenSchema.optional(),
  bondAmount: z.number().nonnegative().optional(),
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
