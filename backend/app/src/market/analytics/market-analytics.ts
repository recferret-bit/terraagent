/**
 * Aggregate market analytics of one planet window (W13-28), pure over FINAL `chain.intent_trade` rows. No personal data and no
 * identifiers in the output: counts are of **colonies** (and accounts), never of "players" or "humans" — one wallet or account is
 * not one person (D-44), so the report says so and counts nothing as a human.
 */
export interface AnalyticsTradeRow {
  readonly base?: string;
  readonly amount?: bigint;
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
export interface BotResourceVolume {
  readonly bought: string;
  readonly sold: string;
  /** Units both bought and re-sold by the same bot colony in the window: min(bought, sold) per bot colony (W13-62 / LED-18). */
  readonly intermediary: string;
  /** Net units bought by bot colonies and retained/consumed rather than re-sold: max(0, bought - sold) per bot colony. */
  readonly netConsumed: string;
}
export interface MarketAnalytics {
  readonly window: { readonly hours: number };
  readonly trades: number;
  readonly colonies: { readonly buyers: number; readonly sellers: number; readonly repeatBuyers: number; readonly note: string };
  /** Notional volume per quote token (atomic decimal strings): organic, subsidised (fixture/subsidy/npc/guild) and related (player-vs-player flagged non-organic). */
  readonly volumeByQuote: Record<string, QuoteVolume>;
  /** Per-resource bot base-unit volume split into intermediary (re-sold) vs net-consumed/retained (W13-62). */
  readonly botVolumeByResource: Record<string, BotResourceVolume>;
  readonly exclusions: { readonly subsidisedTrades: number; readonly relatedTrades: number };
  /** Fees actually charged per notional, in bp (floored), per quote. */
  readonly executionCostBpByQuote: Record<string, number>;
  readonly feeLeakage: typeof FEE_LEAKAGE_ASSUMPTION & { readonly estimatedLeakedFeeByQuote: Record<string, string> };
  readonly cohorts: string;
}

const NOTE = 'Counts are colonies/accounts; a colony or wallet is not a human player.';

function aggregateBotVolume(rows: readonly AnalyticsTradeRow[]): Record<string, BotResourceVolume> {
  const perResourceColony = new Map<string, Map<string, { bought: bigint; sold: bigint }>>();
  for (const r of rows) {
    if (!r.base || r.amount === undefined || r.amount <= 0n) continue;
    if (r.buyerActorKind !== 'bot' && r.sellerActorKind !== 'bot') continue;
    let byColony = perResourceColony.get(r.base);
    if (!byColony) perResourceColony.set(r.base, (byColony = new Map()));
    if (r.buyerActorKind === 'bot') {
      const cur = byColony.get(r.buyerColonyId) ?? { bought: 0n, sold: 0n };
      cur.bought += r.amount;
      byColony.set(r.buyerColonyId, cur);
    }
    if (r.sellerActorKind === 'bot') {
      const cur = byColony.get(r.sellerColonyId) ?? { bought: 0n, sold: 0n };
      cur.sold += r.amount;
      byColony.set(r.sellerColonyId, cur);
    }
  }
  const out: Record<string, BotResourceVolume> = {};
  for (const [res, byColony] of perResourceColony) {
    let bought = 0n;
    let sold = 0n;
    let intermediary = 0n;
    let netConsumed = 0n;
    for (const c of byColony.values()) {
      bought += c.bought;
      sold += c.sold;
      intermediary += c.bought < c.sold ? c.bought : c.sold;
      if (c.bought > c.sold) netConsumed += c.bought - c.sold;
    }
    out[res] = { bought: bought.toString(), sold: sold.toString(), intermediary: intermediary.toString(), netConsumed: netConsumed.toString() };
  }
  return out;
}

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
    volumeByQuote, botVolumeByResource: aggregateBotVolume(rows), exclusions: { subsidisedTrades, relatedTrades }, executionCostBpByQuote: cost,
    feeLeakage: { ...FEE_LEAKAGE_ASSUMPTION, estimatedLeakedFeeByQuote: leak },
    cohorts: 'not available in F2: consumption cohorts need the W13-42 flows; trades are not linked to colony cohorts here',
  };
}
