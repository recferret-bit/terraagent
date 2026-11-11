import { z } from 'zod';
import { TileCoord } from './ws/sim';

export const TRUCE_DURATIONS_HOURS = [2, 6, 24, 72] as const;
export type TruceDurationHours = (typeof TRUCE_DURATIONS_HOURS)[number];
export const TruceDurationHoursSchema = z.union([
  z.literal(2),
  z.literal(6),
  z.literal(24),
  z.literal(72),
]);

export const TruceOfferStatusSchema = z.enum(['pending', 'accepted', 'declined', 'expired', 'cancelled']);
export type TruceOfferStatus = z.infer<typeof TruceOfferStatusSchema>;

export const TruceStatusSchema = z.enum(['active', 'notice', 'ended']);
export type TruceStatus = z.infer<typeof TruceStatusSchema>;

export const TruceEndReasonSchema = z.enum(['expired', 'cancelled', 'settled', 'eliminated']);
export type TruceEndReason = z.infer<typeof TruceEndReasonSchema>;

export const ColonyTargetIdSchema = z.union([
  z.number().int().nonnegative(),
  z.string().min(1).max(64),
]);
export type ColonyTargetId = z.infer<typeof ColonyTargetIdSchema>;

export const TruceOfferSchema = z.strictObject({
  offerId: z.string().min(1).max(64),
  fromColony: z.number().int().nonnegative(),
  toColony: z.number().int().nonnegative(),
  fromColonyId: z.string().min(1).max(64).optional(),
  toColonyId: z.string().min(1).max(64).optional(),
  hours: TruceDurationHoursSchema,
  offeredAtTick: z.number().int().nonnegative(),
  expiresAtTick: z.number().int().nonnegative(),
  status: TruceOfferStatusSchema.optional(),
});
export type TruceOffer = z.infer<typeof TruceOfferSchema>;

export const TruceStateSchema = z.strictObject({
  truceId: z.string().min(1).max(64),
  colonyA: z.number().int().nonnegative(),
  colonyB: z.number().int().nonnegative(),
  colonyAId: z.string().min(1).max(64).optional(),
  colonyBId: z.string().min(1).max(64).optional(),
  hours: TruceDurationHoursSchema,
  signedAtTick: z.number().int().nonnegative(),
  expiresAtTick: z.number().int().nonnegative(),
  status: TruceStatusSchema,
  noticeEndsAtTick: z.number().int().nonnegative().optional(),
  cancelledBy: z.number().int().nonnegative().optional(),
});
export type TruceState = z.infer<typeof TruceStateSchema>;
export const TruceRecordSchema = TruceStateSchema;
export type TruceRecord = TruceState;

export const DiplomacyStateSchema = z.strictObject({
  offers: z.array(TruceOfferSchema),
  truces: z.array(TruceStateSchema),
  oathbreakerUntilByColony: z.record(z.string(), z.number().int().nonnegative()).optional(),
  lastHostilityAtByPair: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export type DiplomacyState = z.infer<typeof DiplomacyStateSchema>;

export const RaidTaskFields = {
  targetColonyId: ColonyTargetIdSchema.optional(),
  targetColonyIndex: z.number().int().nonnegative().optional(),
  targetColony: ColonyTargetIdSchema.optional(),
  unitIds: z.array(z.number().int().positive()).min(1).max(64).optional(),
  entityIds: z.array(z.number().int().positive()).min(1).max(64).optional(),
  q: TileCoord.optional(),
  r: TileCoord.optional(),
} as const;

export const hasRaidTargetField = (v: {
  targetColonyId?: unknown;
  targetColonyIndex?: unknown;
  targetColony?: unknown;
}): boolean =>
  v.targetColonyId !== undefined || v.targetColonyIndex !== undefined || v.targetColony !== undefined;

export const RaidTaskPayloadSchema = z
  .strictObject(RaidTaskFields)
  .refine(hasRaidTargetField, {
    message: 'A raid requires targetColonyId, targetColonyIndex, or targetColony.',
  });
export type RaidTaskPayload = z.infer<typeof RaidTaskPayloadSchema>;
