import { STAKING_RULES } from '@terra/contracts';
import type { DbClient } from '@terra/db';

const utcDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

/** USD micros recorded per managed call (rounded up so the recorded spend never understates the real one). */
export const AI_CALL_COST_MICROS = BigInt(Math.ceil(STAKING_RULES.aiCostPerCallUsd * 1_000_000));

/**
 * Charges one managed call to the wallet's UTC-day row (`ai.ai_wallet_usage`, keyed by wallet, never by colony), only
 * while `callsUsed < callLimit`. One conditional UPDATE, so ten colonies racing on one wallet share one budget and the
 * counter never passes the limit. Returns `false` when the budget is spent.
 */
export async function chargeWalletCall(db: DbClient, walletKey: string, callLimit: number, nowMs: number): Promise<boolean> {
  if (callLimit <= 0 || typeof db.aiWalletUsage?.updateMany !== 'function') return false;
  const day = utcDay(nowMs);
  await db.aiWalletUsage.createMany({ data: [{ walletKey, day }], skipDuplicates: true });
  const { count } = await db.aiWalletUsage.updateMany({
    where: { walletKey, day, callsUsed: { lt: callLimit } },
    data: { callsUsed: { increment: 1 }, usdMicros: { increment: AI_CALL_COST_MICROS }, updatedAt: new Date(nowMs) },
  });
  return count === 1;
}

/**
 * Gives back one call charged by {@link chargeWalletCall} on the same UTC day (the provider call failed, so the
 * player paid nothing). Conditional on `callsUsed > 0`, so a double refund never goes negative.
 */
export async function refundWalletCall(db: DbClient, walletKey: string, nowMs: number): Promise<boolean> {
  if (typeof db.aiWalletUsage?.updateMany !== 'function') return false;
  const { count } = await db.aiWalletUsage.updateMany({
    where: { walletKey, day: utcDay(nowMs), callsUsed: { gt: 0 }, usdMicros: { gte: AI_CALL_COST_MICROS } },
    data: { callsUsed: { decrement: 1 }, usdMicros: { decrement: AI_CALL_COST_MICROS }, updatedAt: new Date() },
  });
  return count === 1;
}
