import { STAKING_RULES } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import { quoteToUsd } from '../performance/fill-income.reader.js';
import { identityResolver, isSelfFill, type AccountOwnerRow } from '../performance/self-fill.js';
import type { TradeFeeUsdProvider } from './perks-deps.js';
import type { WalletRef } from './stake-clock.reader.js';

const MAX_DAILY_TRADES = 2_000;
const DAY_MS = 86_400_000;

interface TradeFeeRow {
  readonly tradeId: string;
  readonly quote: string;
  readonly platformFee: { toFixed(n: number): string };
  readonly treasuryAllocation: { toFixed(n: number): string };
  readonly buyerAccountId: string;
  readonly sellerAccountId: string;
  readonly stallAccountId: string;
  readonly buyerColonyId: string;
  readonly sellerColonyId: string;
  readonly stallColonyId: string;
}

function utcDayBounds(nowMs: number): { readonly start: Date; readonly end: Date } {
  const d = new Date(nowMs);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

async function loadTradeIdentities(db: DbClient, rows: readonly TradeFeeRow[]) {
  const involved = new Set<string>();
  for (const r of rows) {
    involved.add(r.buyerAccountId);
    involved.add(r.sellerAccountId);
    involved.add(r.stallAccountId);
  }
  const [owners, socialRows] = await Promise.all([
    typeof db.nearColonyAccount?.findMany === 'function'
      ? (db.nearColonyAccount.findMany({
          where: { accountId: { in: [...involved] } },
          select: { accountId: true, playerId: true, ownerAccountId: true, claimedByAccountId: true },
        }) as Promise<AccountOwnerRow[]>)
      : Promise.resolve([] as AccountOwnerRow[]),
    typeof db.socialIdentity?.findMany === 'function'
      ? (db.socialIdentity.findMany({
          where: { accountId: { in: [...involved] } },
          select: { accountId: true, playerId: true },
        }) as Promise<Array<{ accountId: string | null; playerId: string }>>)
      : Promise.resolve([] as Array<{ accountId: string | null; playerId: string }>),
  ]);
  const combined: AccountOwnerRow[] = [
    ...owners,
    ...socialRows
      .filter((s): s is { accountId: string; playerId: string } => Boolean(s.accountId))
      .map((s) => ({ accountId: s.accountId, playerId: s.playerId })),
  ];
  return identityResolver(combined);
}

async function loadPatronCuts(db: DbClient, tradeIds: readonly string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (tradeIds.length === 0 || typeof db.stakingPatronPayout?.findMany !== 'function') return out;
  const payouts = (await db.stakingPatronPayout.findMany({
    where: { sourceTradeId: { in: [...tradeIds] } },
    select: { sourceTradeId: true, amountUsdcAtomic: true },
  })) as Array<{ sourceTradeId: string | null; amountUsdcAtomic: { toFixed(n: number): string } }>;
  for (const p of payouts) {
    if (!p.sourceTradeId) continue;
    out.set(p.sourceTradeId, (out.get(p.sourceTradeId) ?? 0n) + BigInt(p.amountUsdcAtomic.toFixed(0)));
  }
  return out;
}

/**
 * Sums the protocol's net market taker-fee revenue from this wallet's genuine (non-self-fill) UTC-day buyer trades
 * in USD (`platformFee - treasuryAllocation - patronPayout`). Feeds the 35% daily AI trade-bonus call cap.
 */
export async function readDailyProtocolTradeFeeUsd(
  db: DbClient,
  wallet: WalletRef,
  nowMs: number,
  nearUsd: number,
): Promise<number> {
  if (typeof db.intentTrade?.findMany !== 'function') return 0;
  if (!Number.isFinite(nearUsd) || nearUsd <= 0 || !Number.isFinite(nowMs)) return 0;
  const accounts = [...wallet.accountIds];
  const colonies = [...wallet.colonyIds];
  if (accounts.length + colonies.length === 0) return 0;
  const buyerFilters: Array<Record<string, unknown>> = [];
  if (accounts.length > 0) buyerFilters.push({ buyerAccountId: { in: accounts } });
  if (colonies.length > 0) buyerFilters.push({ buyerColonyId: { in: colonies } });
  const { start, end } = utcDayBounds(nowMs);
  const rows = (await db.intentTrade.findMany({
    where: {
      state: 'FINAL',
      OR: buyerFilters,
      AND: [{ OR: [{ settledAt: { gte: start, lt: end } }, { settledAt: null, createdAt: { gte: start, lt: end } }] }],
    },
    select: {
      tradeId: true,
      quote: true,
      platformFee: true,
      treasuryAllocation: true,
      buyerAccountId: true,
      sellerAccountId: true,
      stallAccountId: true,
      buyerColonyId: true,
      sellerColonyId: true,
      stallColonyId: true,
    },
    orderBy: { id: 'desc' },
    take: MAX_DAILY_TRADES,
  })) as TradeFeeRow[];
  if (rows.length === 0) return 0;
  const [identities, patronCuts] = await Promise.all([
    loadTradeIdentities(db, rows),
    loadPatronCuts(db, rows.map((r) => r.tradeId)),
  ]);
  let totalUsd = 0;
  for (const r of rows) {
    if (isSelfFill(r, identities)) continue;
    const gross = BigInt(r.platformFee.toFixed(0));
    const dao = BigInt(r.treasuryAllocation.toFixed(0));
    const patron = r.quote === 'USDC' ? (patronCuts.get(r.tradeId) ?? 0n) : 0n;
    const protocolNet = gross > dao + patron ? gross - dao - patron : 0n;
    totalUsd += quoteToUsd(r.quote, protocolNet, nearUsd);
  }
  return totalUsd;
}

export const dbTradeFeeProvider: TradeFeeUsdProvider = {
  dailyProtocolTradeFeeUsd: (wallet, nowMs, db, nearUsd) =>
    db ? readDailyProtocolTradeFeeUsd(db, wallet, nowMs, nearUsd ?? STAKING_RULES.estNearUsd) : 0,
};
