/**
 * Aggregate market analytics of one planet window (W13-28), pure over FINAL `chain.intent_trade` rows. No personal data and no
 * identifiers in the output: counts are of **colonies** (and accounts), never of "players" or "humans" — one wallet or account is
 * not one person (D-44), so the report says so and counts nothing as a human.
 */
export interface AnalyticsTradeRow {
  readonly quote: string;
  readonly buyerColonyId: string;
  readonly sellerColonyId: string;
  readonly buyerActorKind: string;
  readonly sellerActorKind: string;
  readonly organic: boolean;
  readonly notional: bigint;
  readonly platformFee: bigint;
  readonly stallFee: bigint;
}

/** Assumption, not data: share of volume that would move off-platform to avoid fees. Labelled in the report; tune with real evidence. */
export const FEE_LEAKAGE_ASSUMPTION = { offPlatformShareBp: 1_000, label: 'assumption: 10 % of volume trades off-platform; no external data', source: 'assumption' } as const;
/** Non-player actor kinds: fills against these are subsidised or fixture volume, never organic. */
const SUBSIDISED_KINDS: ReadonlySet<string> = new Set(['fixture', 'subsidy', 'npc', 'guild']);

export interface QuoteVolume { readonly organic: string; readonly subsidised: string; readonly related: string }
export interface MarketAnalytics {
  readonly window: { readonly hours: number };
  readonly trades: number;
  readonly colonies: { readonly buyers: number; readonly sellers: number; readonly repeatBuyers: number; readonly note: string };
  /** Notional volume per quote token (atomic decimal strings): organic, subsidised (fixture/subsidy/npc/guild) and related (player-vs-player flagged non-organic). */
  readonly volumeByQuote: Record<string, QuoteVolume>;
  readonly exclusions: { readonly subsidisedTrades: number; readonly relatedTrades: number };
  /** Fees actually charged per notional, in bp (floored), per quote. */
  readonly executionCostBpByQuote: Record<string, number>;
  readonly feeLeakage: typeof FEE_LEAKAGE_ASSUMPTION & { readonly estimatedLeakedFeeByQuote: Record<string, string> };
  readonly cohorts: string;
}

const NOTE = 'Counts are colonies/accounts; a colony or wallet is not a human player.';

export function computeMarketAnalytics(rows: readonly AnalyticsTradeRow[], hours: number, platformFeeBp: number): MarketAnalytics {
  const buyerTrades = new Map<string, number>();
  const sellers = new Set<string>();
  const vol = new Map<string, { organic: bigint; subsidised: bigint; related: bigint; fees: bigint; total: bigint }>();
  let subsidisedTrades = 0;
  let relatedTrades = 0;
  for (const r of rows) {
    buyerTrades.set(r.buyerColonyId, (buyerTrades.get(r.buyerColonyId) ?? 0) + 1);
    sellers.add(r.sellerColonyId);
    const v = vol.get(r.quote) ?? { organic: 0n, subsidised: 0n, related: 0n, fees: 0n, total: 0n };
    const subsidised = SUBSIDISED_KINDS.has(r.buyerActorKind) || SUBSIDISED_KINDS.has(r.sellerActorKind);
    if (r.organic && !subsidised) v.organic += r.notional;
    else if (subsidised) { v.subsidised += r.notional; subsidisedTrades++; }
    else { v.related += r.notional; relatedTrades++; }
    v.fees += r.platformFee + r.stallFee;
    v.total += r.notional;
    vol.set(r.quote, v);
  }
  const volumeByQuote: Record<string, QuoteVolume> = {};
  const cost: Record<string, number> = {};
  const leak: Record<string, string> = {};
  const share = BigInt(FEE_LEAKAGE_ASSUMPTION.offPlatformShareBp);
  for (const [q, v] of vol) {
    volumeByQuote[q] = { organic: v.organic.toString(), subsidised: v.subsidised.toString(), related: v.related.toString() };
    cost[q] = v.total === 0n ? 0 : Number((v.fees * 10_000n) / v.total);
    leak[q] = ((v.total * share * BigInt(platformFeeBp)) / 100_000_000n).toString();
  }
  return {
    window: { hours }, trades: rows.length,
    colonies: { buyers: buyerTrades.size, sellers: sellers.size, repeatBuyers: [...buyerTrades.values()].filter((n) => n >= 2).length, note: NOTE },
    volumeByQuote, exclusions: { subsidisedTrades, relatedTrades }, executionCostBpByQuote: cost,
    feeLeakage: { ...FEE_LEAKAGE_ASSUMPTION, estimatedLeakedFeeByQuote: leak },
    cohorts: 'not available in F2: consumption cohorts need the W13-42 flows; trades are not linked to colony cohorts here',
  };
}
