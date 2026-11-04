import { z } from 'zod';
import { ACHIEVEMENT_FAMILY_IDS } from './achievements';

export * from './achievements';

export const AchievementFamilyIdSchema = z.enum(ACHIEVEMENT_FAMILY_IDS);
export const AchievementMetricSchema = z.enum(['counter', 'max']);
export const AchievementTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const AchievementTierNameSchema = z.enum(['Bronze', 'Silver', 'Gold']);
export const AchievementStatusSchema = z.enum(['locked', 'earned', 'coming_soon']);
export type AchievementStatus = z.infer<typeof AchievementStatusSchema>;

export const AchievementNftStateSchema = z.enum(['none', 'pending', 'minted', 'failed']);
export type AchievementNftState = z.infer<typeof AchievementNftStateSchema>;

export const AchievementNftStatusSchema = z.strictObject({
  status: AchievementNftStateSchema,
  tokenId: z.string().optional(),
  txHash: z.string().optional(),
  contractId: z.string().optional(),
  error: z.string().optional(),
});
export type AchievementNftStatus = z.infer<typeof AchievementNftStatusSchema>;

export const AchievementProgressSchema = z.strictObject({
  value: z.number().int().nonnegative(),
  target: z.number().int().positive(),
});
export type AchievementProgress = z.infer<typeof AchievementProgressSchema>;

/** Bus/updater progression fact event (`ProgressEventV1`, W12-01 / W12-02). */
export const ProgressEventV1Schema = z.strictObject({
  eventId: z.string().min(1).max(256).optional(),
  playerId: z.string().min(1),
  colonyId: z.string().min(1),
  planetId: z.string().min(1),
  family: AchievementFamilyIdSchema,
  metric: AchievementMetricSchema,
  value: z.number().int().nonnegative(),
  atTick: z.number().int().nonnegative(),
});
export type ProgressEventV1 = z.infer<typeof ProgressEventV1Schema>;

/** One of the 60 entries returned by `GET /v1/me/achievements` and `profile.nextAchievements` (W12-09 / W12-12). */
export const PlayerAchievementEntrySchema = z.strictObject({
  id: z.string().min(1),
  familyId: AchievementFamilyIdSchema,
  familyName: z.string().min(1),
  tier: AchievementTierSchema,
  tierName: AchievementTierNameSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  threshold: z.number().int().positive(),
  xp: z.number().int().positive(),
  star: z.boolean(),
  metric: AchievementMetricSchema,
  producerWave: z.string().min(1),
  glyph: z.string().min(1),
  status: AchievementStatusSchema,
  progress: AchievementProgressSchema,
  earnedAt: z.string().nullable(),
  nft: AchievementNftStatusSchema,
});
export type PlayerAchievementEntry = z.infer<typeof PlayerAchievementEntrySchema>;

/** Response of `GET /v1/me/achievements` (W12-12). */
export const MeAchievementsResponseSchema = z.strictObject({
  earnedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().positive(),
  achievements: z.array(PlayerAchievementEntrySchema),
});
export type MeAchievementsResponse = z.infer<typeof MeAchievementsResponseSchema>;
