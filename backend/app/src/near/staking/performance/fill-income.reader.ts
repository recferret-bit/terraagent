import { STAKING_TIERS } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import type { WalletRef } from '../perks/stake-clock.reader.js';
import { identityResolver, isSelfFill, type AccountOwnerRow } from './self-fill.js';

const MAX_FILLS = 5_000;
const NEAR_STEP = 10n ** 12n;

export interface FillIncomeEvent {
  readonly tMs: number;
  readonly usd: number;
}

export interface FillIncome {
  /** Non-self `(standard fee - fee actually paid)` over the wallet's fills as buyer, USD. */
  readonly marketFeeSavingsUsd: number;
  /** Non-self stall fee received as stall owner, USD. */
  readonly stallRoyaltiesUsd: number;
  /** Fills of the wallet that were wash trades (buyer == seller owner / buyer == stall owner) and counted as 0. */
  readonly selfFillsExcluded: number;
  readonly events: readonly FillIncomeEvent[];
}

export const EMPTY_FILL_INCOME: FillIncome = Object.freeze({ marketFeeSavingsUsd: 0, stallRoyaltiesUsd: 0, selfFillsExcluded: 0, events: [] });

interface TradeRow {
  readonly quote: string;
  readonly notional: { toFixed(n: number): string };
  readonly stallFee: { toFixed(n: number): string };
  readonly platformFeeBp: number;
  readonly buyerAccountId: string;
  readonly sellerAccountId: string;
  readonly stallAccountId: string;
  readonly buyerColonyId: string;
  readonly sellerColonyId: string;
  readonly stallColonyId: string;
  readonly createdAt: Date;
  readonly settledAt: Date | null;
}

/** Atomic quote units → USD: `USDC` (6 decimals) and `NEAR` (24 decimals, at `nearUsd`); resource quotes carry no USD value. */
export function quoteToUsd(quote: string, atomic: bigint, nearUsd: number): number {
  if (quote === 'USDC') return Number(atomic) / 1e6;
  if (quote === 'NEAR') return (Number(atomic / NEAR_STEP) / 1e12) * nearUsd;
  return 0;
}

const big = (d: { toFixed(n: number): string }): bigint => BigInt(d.toFixed(0));

export interface FillIncomeQuery {
  readonly sinceMs: number;
  readonly nearUsd: number;
}

/**
 * Reads the wallet's FINAL market fills since `sinceMs` and values them. Self-fills are classified by
 * `isSelfFill` over `chain.near_colony_account` ownership and contribute nothing (only `selfFillsExcluded`).
 */
export async function readFillIncome(db: DbClient, wallet: WalletRef, q: FillIncomeQuery): Promise<FillIncome> {
  if (typeof db.intentTrade?.findMany !== 'function') return EMPTY_FILL_INCOME;
  const accounts = [...wallet.accountIds];
  const colonies = [...wallet.colonyIds];
  if (accounts.length + colonies.length === 0) return EMPTY_FILL_INCOME;
  const mine = [
    { buyerAccountId: { in: accounts } },
    { buyerColonyId: { in: colonies } },
    { stallAccountId: { in: accounts } },
    { stallColonyId: { in: colonies } },
  ];
  const since = new Date(q.sinceMs);
  const rows = (await db.intentTrade.findMany({
    where: { state: 'FINAL', OR: mine, AND: [{ OR: [{ settledAt: { gte: since } }, { settledAt: null, createdAt: { gte: since } }] }] },
    orderBy: { id: 'desc' },
    take: MAX_FILLS,
  })) as TradeRow[];
  if (rows.length === 0) return EMPTY_FILL_INCOME;

  const involved = new Set<string>();
  for (const r of rows) [r.buyerAccountId, r.sellerAccountId, r.stallAccountId].forEach((a) => involved.add(a));
  const owners =
    typeof db.nearColonyAccount?.findMany === 'function'
      ? ((await db.nearColonyAccount.findMany({
          where: { accountId: { in: [...involved] } },
          select: { accountId: true, playerId: true, ownerAccountId: true, claimedByAccountId: true },
        })) as AccountOwnerRow[])
      : [];
  const identities = identityResolver(owners);

  const accountSet = new Set(accounts);
  const colonySet = new Set(colonies);
  const standardBp = STAKING_TIERS[0]!.takerFeeBp;
  let savings = 0;
  let royalties = 0;
  let selfFills = 0;
  const events: FillIncomeEvent[] = [];
  for (const r of rows) {
    const isBuyer = accountSet.has(r.buyerAccountId) || colonySet.has(r.buyerColonyId);
    const isStall = accountSet.has(r.stallAccountId) || colonySet.has(r.stallColonyId);
    if (isSelfFill(r, identities)) {
      selfFills++;
      continue;
    }
    const tMs = (r.settledAt ?? r.createdAt).getTime();
    if (isBuyer) {
      const saved = Math.max(0, standardBp - r.platformFeeBp);
      const usd = quoteToUsd(r.quote, (big(r.notional) * BigInt(saved)) / 10_000n, q.nearUsd);
      if (usd > 0) {
        savings += usd;
        events.push({ tMs, usd });
      }
    }
    if (isStall) {
      const usd = quoteToUsd(r.quote, big(r.stallFee), q.nearUsd);
      if (usd > 0) {
        royalties += usd;
        events.push({ tMs, usd });
      }
    }
  }
  return { marketFeeSavingsUsd: savings, stallRoyaltiesUsd: royalties, selfFillsExcluded: selfFills, events };
}
