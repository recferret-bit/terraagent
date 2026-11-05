import { formatUnitPrice, marketToken, mockLabel, type MarketSnapshotResponse, type MarketTokenKey, type PriceBoardRow, type TradeView } from '@terra/contracts';

/** Most points the sparkline draws: one per FINAL trade of the pair, newest last. */
export const SPARK_MAX_POINTS = 30;

export interface Ratio { readonly num: string; readonly den: number }
export interface SparkPoint { readonly t: number; readonly price: number }

export const CLASS_LABELS: Readonly<Record<PriceBoardRow['classification'], string>> = {
  organic: 'ORGANIC',
  fixture: 'FIXTURE (bot-seeded)',
  mixed: 'MIXED',
  insufficient_data: 'INSUFFICIENT DATA',
};

export const quoteOf = (pair: string): MarketTokenKey => pair.split('/')[1] as MarketTokenKey;
export const baseOf = (pair: string): string => pair.split('/')[0]!;

/** The price of one trade as a ratio: quote atomic per whole base unit. */
export const tradeRatio = (t: Pick<TradeView, 'notional' | 'amount'>): Ratio => ({ num: t.notional, den: t.amount });

/** Display price of a ratio in whole quote units (`formatUnitPrice`); `-` when there is none. Display only. */
export const priceText = (r: Ratio | null, quote: MarketTokenKey): string => (r ? formatUnitPrice(r.num, r.den, quote) : '-');

const asNumber = (r: Ratio, quote: MarketTokenKey): number => Number(formatUnitPrice(r.num, r.den, quote));

/**
 * What the sparkline plots: **one point per FINAL trade of the pair** (oldest to newest, at most {@link SPARK_MAX_POINTS}),
 * because 1 h candles collapse several trades into one point. The last point is the last trade price, the same figure as
 * the board's `last`. With no trade list (e.g. after a restart trimmed it) the 1 h candle closes are plotted instead.
 */
export function sparkPoints(row: PriceBoardRow, trades: readonly TradeView[]): SparkPoint[] {
  const quote = quoteOf(row.pair);
  const own = trades.filter((t) => t.pair === row.pair && t.state === 'FINAL').sort((a, b) => a.atMs - b.atMs || a.tradeId.localeCompare(b.tradeId));
  if (own.length > 0) return own.slice(-SPARK_MAX_POINTS).map((t) => ({ t: t.atMs, price: asNumber(tradeRatio(t), quote) }));
  return row.candles1h.slice(-SPARK_MAX_POINTS).map((c) => ({ t: c.t, price: Number(c.c) / 10 ** marketToken(quote).decimals }));
}

/** `+1.25 %` / `-0.50 %` from basis points; `-` when the board has no 24 h reference price. */
export function changeText(bp: number | null): string {
  if (bp === null) return '-';
  return `${bp > 0 ? '+' : bp < 0 ? '-' : ''}${(Math.abs(bp) / 100).toFixed(2)} %`;
}

export const badgeOf = (pair: string): string => mockLabel(quoteOf(pair)).toUpperCase();

/** Merges a pushed or fetched trade list by id (newest data wins), keeping the newest `limit`. */
export function mergeTrades(a: readonly TradeView[], b: readonly TradeView[], limit = 200): TradeView[] {
  const byId = new Map<string, TradeView>();
  for (const t of [...a, ...b]) byId.set(t.tradeId, t);
  return [...byId.values()].sort((x, y) => x.atMs - y.atMs).slice(-limit);
}

export interface BoardState { readonly rows: readonly PriceBoardRow[]; readonly trades: readonly TradeView[] }
export const stateOf = (s: MarketSnapshotResponse): BoardState => ({ rows: s.board, trades: s.recentTrades });
