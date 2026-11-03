import { z } from 'zod';
import { PlayerAchievementEntrySchema } from '../progression';

export const PROFILE_STAT_KEYS = [
  'coloniesFounded',
  'coloniesSettled',
  'coloniesEliminated',
  'highestStageReached',
  'tilesGraded',
  'obstaclesRemoved',
  'waterTilesReclaimed',
  'livingTilesCreated',
  'buildingsCompleted',
  'peakNetPower',
  'nightsNoBrownout',
  'resourcesProduced',
  'faunaKilled',
  'nestsDestroyed',
  'raidsRepelled',
  'marketTradesSettled',
] as const;

export type ProfileStatKey = (typeof PROFILE_STAT_KEYS)[number];

export interface ProfileStatDef {
  readonly key: ProfileStatKey;
  readonly label: string;
  readonly category: 'career' | 'terraforming' | 'economy' | 'combat';
  readonly unit?: string;
}

/** The 16 lifetime stats tiles shown on `/me` (W12-09, W12-16). */
export const PROFILE_STAT_DEFINITIONS: readonly ProfileStatDef[] = [
  { key: 'coloniesFounded', label: 'Colonies Founded', category: 'career' },
  { key: 'coloniesSettled', label: 'Colonies Settled', category: 'career' },
  { key: 'coloniesEliminated', label: 'Colonies Eliminated', category: 'career' },
  { key: 'highestStageReached', label: 'Highest Stage', category: 'career' },
  { key: 'tilesGraded', label: 'Tiles Graded', category: 'terraforming' },
  { key: 'obstaclesRemoved', label: 'Obstacles Removed', category: 'terraforming' },
  { key: 'waterTilesReclaimed', label: 'Water Reclaimed', category: 'terraforming' },
  { key: 'livingTilesCreated', label: 'Living Tiles', category: 'terraforming' },
  { key: 'buildingsCompleted', label: 'Buildings Built', category: 'economy' },
  { key: 'peakNetPower', label: 'Peak Net Power', category: 'economy', unit: 'E/s' },
  { key: 'nightsNoBrownout', label: 'Clean Nights', category: 'economy' },
  { key: 'resourcesProduced', label: 'Resources Produced', category: 'economy' },
  { key: 'faunaKilled', label: 'Fauna Eliminated', category: 'combat' },
  { key: 'nestsDestroyed', label: 'Nests Destroyed', category: 'combat' },
  { key: 'raidsRepelled', label: 'Raids Repelled', category: 'combat' },
  { key: 'marketTradesSettled', label: 'Market Trades', category: 'economy' },
];

export const ProfileStatsSchema = z.strictObject({
  coloniesFounded: z.number().int().nonnegative(),
  coloniesSettled: z.number().int().nonnegative(),
  coloniesEliminated: z.number().int().nonnegative(),
  highestStageReached: z.number().int().nonnegative(),
  tilesGraded: z.number().int().nonnegative(),
  obstaclesRemoved: z.number().int().nonnegative(),
  waterTilesReclaimed: z.number().int().nonnegative(),
  livingTilesCreated: z.number().int().nonnegative(),
  buildingsCompleted: z.number().int().nonnegative(),
  peakNetPower: z.number().int().nonnegative(),
  nightsNoBrownout: z.number().int().nonnegative(),
  resourcesProduced: z.number().int().nonnegative(),
  faunaKilled: z.number().int().nonnegative(),
  nestsDestroyed: z.number().int().nonnegative(),
  raidsRepelled: z.number().int().nonnegative(),
  marketTradesSettled: z.number().int().nonnegative(),
});
export type ProfileStats = z.infer<typeof ProfileStatsSchema>;

export const ProfileIdentitySchema = z.strictObject({
  playerId: z.string().min(1),
  handle: z.string().min(1),
  accountId: z.string().nullable(),
  isGuest: z.boolean(),
  pilotSince: z.string().min(1),
  avatarSeed: z.string().min(1),
  frame: z.string().min(1),
});
export type ProfileIdentity = z.infer<typeof ProfileIdentitySchema>;

export const ProfileProgressionSchema = z.strictObject({
  level: z.number().int().min(0).max(30),
  xp: z.number().int().nonnegative(),
  currentLevelXp: z.number().int().nonnegative(),
  nextLevelXp: z.number().int().nonnegative(),
  title: z.string().min(1),
  titles: z.array(z.string().min(1)),
  frames: z.array(z.string().min(1)),
  unlockStage: z.number().int().min(0).max(10),
  nextStageCondition: z.string().nullable(),
});
export type ProfileProgression = z.infer<typeof ProfileProgressionSchema>;

export const CurrentColonySummarySchema = z.strictObject({
  colonyId: z.string().min(1),
  name: z.string().min(1),
  planetId: z.string().min(1),
  planetName: z.string().min(1),
  planetType: z.string().min(1),
  stage: z.number().int().min(0).max(10),
  status: z.string().min(1),
  foundedAt: z.string().min(1),
});
export type CurrentColonySummary = z.infer<typeof CurrentColonySummarySchema>;

export const PastColonyOutcomeSchema = z.enum(['settled', 'eliminated', 'abandoned']);
export type PastColonyOutcome = z.infer<typeof PastColonyOutcomeSchema>;

export const PastColonySummarySchema = z.strictObject({
  colonyId: z.string().min(1),
  name: z.string().min(1),
  planetId: z.string().min(1),
  planetName: z.string().min(1),
  planetType: z.string().min(1),
  stageReached: z.number().int().min(0).max(10),
  outcome: PastColonyOutcomeSchema,
  foundedAt: z.string().min(1),
  endedAt: z.string().min(1),
});
export type PastColonySummary = z.infer<typeof PastColonySummarySchema>;

/** Response of `GET /v1/me/profile` (W12-09). */
export const MeProfileResponseSchema = z.strictObject({
  identity: ProfileIdentitySchema,
  progression: ProfileProgressionSchema,
  stats: ProfileStatsSchema,
  currentColonies: z.array(CurrentColonySummarySchema),
  pastColonies: z.array(PastColonySummarySchema),
  nextAchievements: z.array(PlayerAchievementEntrySchema),
  earnedAchievementsCount: z.number().int().nonnegative(),
  totalAchievementsCount: z.number().int().positive(),
});
export type MeProfileResponse = z.infer<typeof MeProfileResponseSchema>;
