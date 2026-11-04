import { z } from 'zod';
import { AchievementFamilyIdSchema, AchievementTierNameSchema, AchievementTierSchema } from '../progression';
import { defineEvent } from './define';

/** Server-emitted notice when a player unlocks an achievement tier (W12-03, W12-27). */
export const event = defineEvent({
  kind: 'achievement.earned',
  wave: 'W12',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    playerId: z.string().min(1),
    achievementId: z.string().min(1),
    familyId: AchievementFamilyIdSchema,
    familyName: z.string().min(1),
    tier: AchievementTierSchema,
    tierName: AchievementTierNameSchema,
    xp: z.number().int().positive(),
    earnedAt: z.string().min(1),
  }),
  summary: 'An achievement tier was unlocked.',
});
