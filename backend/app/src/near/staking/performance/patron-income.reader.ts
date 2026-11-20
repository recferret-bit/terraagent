import type { DbClient } from '@terra/db';
import type { WalletRef } from '../perks/stake-clock.reader.js';
import type { FillIncomeEvent } from './fill-income.reader.js';

/** Lead Patron revenue (`chain.staking_patron_payout`, USDC micro) paid to the wallet since `sinceMs`, USD. */
export async function readPatronIncome(
  db: DbClient,
  wallet: WalletRef,
  sinceMs: number,
): Promise<{ readonly usd: number; readonly events: readonly FillIncomeEvent[] }> {
  if (typeof db.stakingPatronPayout?.findMany !== 'function' || wallet.accountIds.length === 0) return { usd: 0, events: [] };
  const rows = (await db.stakingPatronPayout.findMany({
    where: { accountId: { in: [...wallet.accountIds] }, createdAt: { gte: new Date(sinceMs) } },
    select: { amountUsdcAtomic: true, createdAt: true },
    take: 5_000,
  })) as Array<{ amountUsdcAtomic: { toFixed(n: number): string }; createdAt: Date }>;
  const events = rows.map((r) => ({ tMs: r.createdAt.getTime(), usd: Number(BigInt(r.amountUsdcAtomic.toFixed(0))) / 1e6 }));
  return { usd: events.reduce((s, e) => s + e.usd, 0), events };
}
