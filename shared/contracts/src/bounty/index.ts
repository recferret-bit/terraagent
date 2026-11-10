import { z } from 'zod';
import { T1ResourceKey, TileCoord } from '../ws/sim';

/**
 * Bounties and mercenary hires (F8, W22-02, NEAR-110..112).
 * Target kinds and the client commands `bounty.post` / `bounty.claim` share these schemas.
 * Posting bounds and the roster prices live in `shared/sim/src/data/bounty.ts` and `mercenary.ts` (D-35), not here.
 * Rewards are Tier-1 cargo only (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`).
 */

const Id = z.string().min(1).max(80);
const WholeUnits = z.number().int().positive();

export const BOUNTY_TARGET_KINDS = ['clear_nest', 'defend_area', 'deliver_units'] as const;
export const BountyTargetKind = z.enum(BOUNTY_TARGET_KINDS);
export type BountyTargetKind = z.infer<typeof BountyTargetKind>;

export const BountyClearNestTarget = z.strictObject({
  kind: z.literal('clear_nest'),
  nestId: Id,
});
export type BountyClearNestTarget = z.infer<typeof BountyClearNestTarget>;

/** `radius` is tiles (1..8). `durationH` is the defend length in hours. */
export const BountyDefendAreaTarget = z.strictObject({
  kind: z.literal('defend_area'),
  q: TileCoord,
  r: TileCoord,
  radius: z.number().int().min(1).max(8),
  durationH: z.number().positive(),
});
export type BountyDefendAreaTarget = z.infer<typeof BountyDefendAreaTarget>;

export const BountyDeliverUnitsTarget = z.strictObject({
  kind: z.literal('deliver_units'),
  resource: T1ResourceKey,
  amount: WholeUnits,
});
export type BountyDeliverUnitsTarget = z.infer<typeof BountyDeliverUnitsTarget>;

export const BountyTarget = z.discriminatedUnion('kind', [
  BountyClearNestTarget,
  BountyDefendAreaTarget,
  BountyDeliverUnitsTarget,
]);
export type BountyTarget = z.infer<typeof BountyTarget>;

export const BountyReward = z.strictObject({
  resource: T1ResourceKey,
  amount: WholeUnits,
});
export type BountyReward = z.infer<typeof BountyReward>;

export const BountyPostArgsSchema = z.strictObject({
  target: BountyTarget,
  reward: BountyReward,
  /** Unix ms. The 2–48 h window is the `bounty.policy` row, checked by the posting service (W22-19). */
  expiresAt: z.number().int().positive(),
});
export type BountyPostArgs = z.infer<typeof BountyPostArgsSchema>;

export const BountyClaimArgsSchema = z.strictObject({
  bountyId: Id,
});
export type BountyClaimArgs = z.infer<typeof BountyClaimArgsSchema>;

/** Module-only. A client `cmd` is rejected `unknown_kind` by `precheckClientCommand`. */
export const BountyPaidArgsSchema = z.strictObject({
  bountyId: Id,
  claimerId: Id,
  amount: WholeUnits,
});
export type BountyPaidArgs = z.infer<typeof BountyPaidArgsSchema>;

/** `building_lost`: a poster building inside a `defend_area` was destroyed (W22-21). */
export const BOUNTY_REFUND_REASONS = ['expired', 'cancelled', 'failed', 'building_lost'] as const;
export const BountyRefundReason = z.enum(BOUNTY_REFUND_REASONS);
export type BountyRefundReason = z.infer<typeof BountyRefundReason>;

export const MERCENARY_LEAVE_REASONS = ['ended', 'wiped', 'cancelled'] as const;
export const MercenaryLeaveReason = z.enum(MERCENARY_LEAVE_REASONS);
export type MercenaryLeaveReason = z.infer<typeof MercenaryLeaveReason>;

const bountyHead = { bountyId: Id };

export const BountyPostedData = z.strictObject({
  ...bountyHead,
  posterId: Id,
  target: BountyTarget,
  reward: BountyReward,
  expiresAt: z.number().int().positive(),
});
export type BountyPostedData = z.infer<typeof BountyPostedData>;

export const BountyClaimedData = z.strictObject({
  ...bountyHead,
  claimer: Id,
  kind: BountyTargetKind,
});
export type BountyClaimedData = z.infer<typeof BountyClaimedData>;

/** NEAR-111. `claimer` is the colony (or mercenary account) the escrow pays. */
export const BountyCompletedData = z.strictObject({
  ...bountyHead,
  claimer: Id,
  kind: BountyTargetKind,
});
export type BountyCompletedData = z.infer<typeof BountyCompletedData>;

export const BountyPaidData = z.strictObject({
  ...bountyHead,
  claimerId: Id,
  resource: T1ResourceKey,
  amount: WholeUnits,
});
export type BountyPaidData = z.infer<typeof BountyPaidData>;

export const BountyRefundedData = z.strictObject({
  ...bountyHead,
  posterId: Id,
  resource: T1ResourceKey,
  amount: WholeUnits,
  reason: BountyRefundReason,
});
export type BountyRefundedData = z.infer<typeof BountyRefundedData>;

export const BountyExpiredData = z.strictObject({
  ...bountyHead,
  posterId: Id,
  expiresAt: z.number().int().positive(),
});
export type BountyExpiredData = z.infer<typeof BountyExpiredData>;

export const MercenaryHiredData = z.strictObject({
  ...bountyHead,
  posterId: Id,
  rosterId: Id,
  mercenaryAccountId: Id,
  durationH: z.number().positive(),
  resource: T1ResourceKey,
  pricePerGameHour: WholeUnits,
});
export type MercenaryHiredData = z.infer<typeof MercenaryHiredData>;

export const MercenaryArrivedData = z.strictObject({
  ...bountyHead,
  rosterId: Id,
  q: TileCoord,
  r: TileCoord,
});
export type MercenaryArrivedData = z.infer<typeof MercenaryArrivedData>;

export const MercenaryLeftData = z.strictObject({
  ...bountyHead,
  rosterId: Id,
  reason: MercenaryLeaveReason,
});
export type MercenaryLeftData = z.infer<typeof MercenaryLeftData>;
