import { STAKING_RULES } from '@terra/contracts';
import type { DbClient } from '@terra/db';

/** A verified pilot (`!isGuest`) owns a `core.social_identity` row: Google, Passkey, X or a linked NEAR wallet. */
export async function isVerifiedPilot(db: DbClient, playerId: string | null | undefined): Promise<boolean> {
  if (!playerId || typeof db.socialIdentity?.findFirst !== 'function') return false;
  return (await db.socialIdentity.findFirst({ where: { playerId }, select: { playerId: true } })) !== null;
}

export async function trialTurnsLeft(db: DbClient, playerId: string): Promise<number> {
  if (typeof db.aiFreeTrial?.findUnique !== 'function') return 0;
  const row = await db.aiFreeTrial.findUnique({ where: { playerId }, select: { turnsUsed: true } });
  return Math.max(0, STAKING_RULES.freeTrialTurns - (row?.turnsUsed ?? 0));
}

/**
 * Spends one of the pilot's one-time free turns. One grant per pilot identity (`ai.ai_free_trial.player_id` is the
 * key); the increment is a single conditional UPDATE (`turns_used < total`), so concurrent colony turns never
 * overspend and the 6th turn is refused. Returns the turns left after this one, or `null` when none was granted
 * (guest, no row support, or exhausted).
 */
export async function consumeTrialTurn(db: DbClient, playerId: string | null | undefined): Promise<number | null> {
  if (!playerId || typeof db.aiFreeTrial?.updateMany !== 'function') return null;
  if (!(await isVerifiedPilot(db, playerId))) return null;
  const total = STAKING_RULES.freeTrialTurns;
  await db.aiFreeTrial.createMany({ data: [{ playerId }], skipDuplicates: true });
  const { count } = await db.aiFreeTrial.updateMany({
    where: { playerId, turnsUsed: { lt: total } },
    data: { turnsUsed: { increment: 1 }, updatedAt: new Date() },
  });
  if (count !== 1) return null;
  return trialTurnsLeft(db, playerId);
}

/** Gives back one free turn spent by {@link consumeTrialTurn} whose provider call failed (never below zero). */
export async function refundTrialTurn(db: DbClient, playerId: string): Promise<boolean> {
  if (typeof db.aiFreeTrial?.updateMany !== 'function') return false;
  const { count } = await db.aiFreeTrial.updateMany({
    where: { playerId, turnsUsed: { gt: 0 } },
    data: { turnsUsed: { decrement: 1 }, updatedAt: new Date() },
  });
  return count === 1;
}
