import { STAKING_RULES } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import type { WalletRef } from './stake-clock.reader.js';

/** Wallet-wide managed-AI counters read for the perks object. W28-06 owns the writes and the enforcement. */
export interface AiUsageSnapshot {
  readonly freeTrialTurnsRemaining: number;
  /** `false` for anonymous guests (no trial). */
  readonly trialEligible: boolean;
  readonly dailyCallsUsed: number;
  readonly dailyUsdUsed: number;
  readonly activeAiColonySlots: number;
}

export interface AiUsageReader {
  read(db: DbClient | null | undefined, wallet: WalletRef, nowMs: number): Promise<AiUsageSnapshot>;
}

export const EMPTY_AI_USAGE: AiUsageSnapshot = Object.freeze({
  freeTrialTurnsRemaining: 0,
  trialEligible: false,
  dailyCallsUsed: 0,
  dailyUsdUsed: 0,
  activeAiColonySlots: 0,
});

export const utcDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

/**
 * Default reader: `ai.ai_wallet_usage` (today's calls and USD, keyed by wallet) and `ai.ai_free_trial` (turns used per
 * player). A pilot is trial-eligible when it has a verified social identity (guests have none). Active colony slots
 * are tracked by W28-06 and read as `0` until it lands.
 */
export const dbAiUsageReader: AiUsageReader = {
  async read(db, wallet, nowMs) {
    if (!db) return EMPTY_AI_USAGE;
    let dailyCallsUsed = 0;
    let dailyUsdUsed = 0;
    if (typeof db.aiWalletUsage?.findUnique === 'function') {
      const row = await db.aiWalletUsage.findUnique({
        where: { walletKey_day: { walletKey: wallet.walletKey, day: utcDay(nowMs) } },
        select: { callsUsed: true, usdMicros: true },
      });
      dailyCallsUsed = row?.callsUsed ?? 0;
      dailyUsdUsed = Number(row?.usdMicros ?? 0n) / 1_000_000;
    }
    const trial = await readTrial(db, wallet.playerId);
    return { ...trial, dailyCallsUsed, dailyUsdUsed, activeAiColonySlots: 0 };
  },
};

async function readTrial(
  db: DbClient,
  playerId: string | null,
): Promise<Pick<AiUsageSnapshot, 'freeTrialTurnsRemaining' | 'trialEligible'>> {
  if (!playerId || typeof db.socialIdentity?.findFirst !== 'function') {
    return { freeTrialTurnsRemaining: 0, trialEligible: false };
  }
  const verified = await db.socialIdentity.findFirst({ where: { playerId }, select: { playerId: true } });
  if (!verified) return { freeTrialTurnsRemaining: 0, trialEligible: false };
  const used =
    typeof db.aiFreeTrial?.findUnique === 'function'
      ? ((await db.aiFreeTrial.findUnique({ where: { playerId }, select: { turnsUsed: true } }))?.turnsUsed ?? 0)
      : 0;
  return { freeTrialTurnsRemaining: Math.max(0, STAKING_RULES.freeTrialTurns - used), trialEligible: true };
}
