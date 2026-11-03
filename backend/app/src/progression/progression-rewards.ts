import type { XpLevelUpEventV1 } from './xp-ledger.service.js';
import { levelForXp, titleForLevel, type AchievementDef } from '@terra/contracts';
import type { TransactionClient } from '@terra/db';
import type { AchievementUnlockedEventV1 } from './achievement-evaluator.service.js';

/** Called inside the player's progression transaction and lock. */
export async function recordReward(tx: TransactionClient, playerId: string, def: AchievementDef): Promise<AchievementUnlockedEventV1> {
  const unlockId = `achievement:${playerId}:${def.id}`;
  const earnedAt = new Date();
  const event: AchievementUnlockedEventV1 = {
    playerId, achievementId: def.id, familyId: def.familyId, familyName: def.familyName,
    tier: def.tier, tierName: def.tierName, xp: def.xp, earnedAt: earnedAt.toISOString(),
  };
  await tx.achievementUnlock.create({ data: { id: unlockId, playerId, achievementId: def.id, family: def.familyId, tier: def.tier, earnedAt } });
  await tx.xpLedger.create({ data: { id: `xp:${unlockId}`, playerId, source: 'achievement', sourceId: def.id, delta: def.xp } });
  for (const kind of ['achievement.notification', 'achievement.badge']) {
    await tx.progressionEffect.create({ data: { id: `${kind}:${unlockId}`, kind, playerId, payload: { ...event } } });
  }
  return event;
}

export async function creditRewardXp(tx: TransactionClient, playerId: string, delta: number): Promise<XpLevelUpEventV1 | null> {
  if (!delta) return null;
  const row = await tx.playerXp.upsert({ where: { playerId }, create: { playerId, xp: delta }, update: { xp: { increment: delta } } });
  const { level } = levelForXp(row.xp);
  const title = titleForLevel(level);
  await tx.playerXp.update({ where: { playerId }, data: { level, title } });
  return level > row.level ? { playerId, previousLevel: row.level, level, xp: row.xp, title } : null;
}
