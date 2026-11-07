import { formatUnitPrice, type MarketBookPayload, type MarketTokenKey, type ResourceKey, type TradeView } from '@terra/contracts';

/** The in-game quick-trade picker: a short list of bases (the full pair list lives on the trade page). */
export const QUICK_BASES: readonly ResourceKey[] = ['bio.water', 'bio.biomass', 'metals.t1', 'minerals.t1', 'metals.t2', 'minerals.t2'];
export const QUICK_QUOTES: readonly MarketTokenKey[] = ['USDC', 'NEAR'];
export const MINI_DEPTH_LEVELS = 5;
export const FILLS_SHOWN = 5;
const DAY_MS = 24 * 3600 * 1000;

export type TradeSection = 'board' | 'orders';

/** `/trade.html` of the full trading page; carries the planet and opens a section by hash. */
export function tradePageUrl(planetId: string | null, section?: TradeSection): string {
  return `/trade.html${planetId ? `?planet=${encodeURIComponent(planetId)}` : ''}${section ? `#${section}` : ''}`;
}

export interface PairStats { readonly bid: string; readonly ask: string; readonly last: string; readonly change24h: string }

const unit = (t: Pick<TradeView, 'notional' | 'amount'>): number => Number(t.notional) / t.amount;

/** Best bid / best ask / last price and the 24 h change (oldest to newest FINAL trade inside the last 24 h; needs two). */
export function pairStats(book: MarketBookPayload | undefined, trades: readonly TradeView[], quote: MarketTokenKey, nowMs: number): PairStats {
  const bid = book?.bids[0];
  const ask = book?.asks[0];
  const newest = trades[0];
  const recent = trades.filter((t) => nowMs - t.atMs <= DAY_MS);
  const oldest = recent[recent.length - 1];
  let change24h = '—';
  if (recent.length >= 2 && oldest && unit(oldest) > 0) {
    const pct = ((unit(recent[0]!) - unit(oldest)) / unit(oldest)) * 100;
    change24h = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %`;
  }
  return {
    bid: bid ? formatUnitPrice(bid.num, bid.den, quote) : '—',
    ask: ask ? formatUnitPrice(ask.num, ask.den, quote) : '—',
    last: newest ? formatUnitPrice(newest.notional, newest.amount, quote) : '—',
    change24h,
  };
}
