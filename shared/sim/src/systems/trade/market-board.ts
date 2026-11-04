import type { PriceBoardRow } from '@terra/contracts';
import market from '../../data/market';
import { comparePrice, reducePrice, type LimitPrice } from './market-price';

/** One FINAL trade as the board sees it (exact amounts; `organic` false for fixture/Guild/known-related fills, D-44). */
export interface BoardTrade {
  readonly pair: string;
  /** Whole base units. */
  readonly amount: bigint;
  /** Quote atomic for the whole fill. */
  readonly notional: bigint;
  readonly atMs: number;
  readonly organic: boolean;
  readonly buyerId: string;
  readonly sellerId: string;
}

/** The `market.board` data row: limits that decide when trades may establish an organic reference price. */
export interface BoardLimits {
  readonly windowS: number;
  readonly candleS: number;
  readonly minEligibleTrades: number;
  readonly minEligibleVolume: number;
  readonly minCounterparties: number;
  readonly counterpartyWeightCapBp: number;
  readonly maxMoveBp: number;
  readonly stalenessS: number;
}

export function defaultBoardLimits(): BoardLimits {
  const row = market.rows.find((r) => r.id === 'board') as unknown as BoardLimits | undefined;
  if (!row) throw new Error('market.board data row missing');
  return row;
}

const priceOf = (t: BoardTrade): LimitPrice => ({ num: t.notional, den: t.amount });
const sum = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
const wire = (p: LimitPrice): { num: string; den: number } => {
  const r = reducePrice(p);
  return { num: r.num.toString(), den: Number(r.den) };
};

/** Unit price as a decimal string (quote atomic per base unit), truncated to `digits` places, trailing zeros trimmed. */
export function priceDecimal(p: LimitPrice, digits = 6): string {
  const scaled = (p.num * BigInt(`1${'0'.repeat(digits)}`)) / p.den;
  const s = scaled.toString().padStart(digits + 1, '0');
  const whole = s.slice(0, s.length - digits);
  const frac = s.slice(s.length - digits).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** Organic trades without those further than `maxMoveBp` from the median organic price (lower middle). */
export function excludeOutliers(trades: readonly BoardTrade[], maxMoveBp: number): { kept: BoardTrade[]; excluded: number } {
  if (trades.length === 0) return { kept: [], excluded: 0 };
  const sorted = [...trades].sort((a, b) => comparePrice(priceOf(a), priceOf(b)));
  const med = priceOf(sorted[Math.floor((sorted.length - 1) / 2)]!);
  if (med.num === 0n) return { kept: [...trades], excluded: 0 };
  const kept = trades.filter((t) => {
    const p = priceOf(t);
    const diff = p.num * med.den - med.num * p.den;
    return (diff < 0n ? -diff : diff) * 10_000n <= BigInt(maxMoveBp) * med.num * p.den;
  });
  return { kept, excluded: trades.length - kept.length };
}

interface Counterparties { readonly count: number; readonly topBp: number }

/** Distinct counterparties and the largest share one takes part in (bp of 2x volume, so shares sum to 10000). */
export function counterpartyStats(trades: readonly BoardTrade[]): Counterparties {
  const part = new Map<string, bigint>();
  for (const t of trades) for (const id of [t.buyerId, t.sellerId]) part.set(id, (part.get(id) ?? 0n) + t.amount);
  const total = sum(trades.map((t) => t.amount)) * 2n;
  const top = [...part.values()].reduce((a, b) => (a > b ? a : b), 0n);
  return { count: part.size, topBp: total === 0n ? 0 : Number((top * 10_000n) / total) };
}

export function candlesOf(trades: readonly BoardTrade[], candleS: number): PriceBoardRow['candles1h'] {
  const size = candleS * 1000;
  const byT = new Map<number, BoardTrade[]>();
  for (const t of [...trades].sort((a, b) => a.atMs - b.atMs)) {
    const k = Math.floor(t.atMs / size) * size;
    byT.set(k, [...(byT.get(k) ?? []), t]);
  }
  return [...byT].map(([t, ts]) => {
    const ps = ts.map(priceOf);
    const hi = ps.reduce((a, b) => (comparePrice(b, a) > 0 ? b : a));
    const lo = ps.reduce((a, b) => (comparePrice(b, a) < 0 ? b : a));
    return { t, o: priceDecimal(ps[0]!), h: priceDecimal(hi), l: priceDecimal(lo), c: priceDecimal(ps[ps.length - 1]!), v: Number(sum(ts.map((x) => x.amount))) };
  });
}

type Verdict = Pick<PriceBoardRow, 'classification' | 'reason'>;

function judge(all: readonly BoardTrade[], eligible: readonly BoardTrade[], cp: Counterparties, excluded: number, nowMs: number, l: BoardLimits): Verdict {
  if (all.length === 0) return { classification: 'insufficient_data', reason: 'insufficient_data' };
  if (!all.some((t) => t.organic)) return { classification: 'fixture', reason: 'insufficient_data' };
  const volume = sum(eligible.map((t) => t.amount));
  if (eligible.length < l.minEligibleTrades || volume < BigInt(l.minEligibleVolume) || cp.count < l.minCounterparties) {
    return { classification: 'insufficient_data', reason: 'insufficient_data' };
  }
  const newest = Math.max(...eligible.map((t) => t.atMs));
  if (nowMs - newest > l.stalenessS * 1000) return { classification: 'insufficient_data', reason: 'stale' };
  if (cp.topBp > l.counterpartyWeightCapBp) return { classification: 'insufficient_data', reason: 'concentrated' };
  const classification = all.every((t) => t.organic) ? 'organic' : 'mixed';
  return excluded > 0 ? { classification, reason: 'outlier_excluded' } : { classification };
}

/**
 * Board row of one pair from its FINAL trades. Display fields (`last`, change, volume, candles) show every finalized
 * trade honestly; the reference `vwap` exists only when organic trades alone pass the limits (enough trades, volume and
 * counterparties, fresh, not concentrated, outliers excluded). Fixture/Guild/known-related fills never feed it.
 */
export function boardRow(pair: string, trades: readonly BoardTrade[], nowMs: number, limits: BoardLimits = defaultBoardLimits()): PriceBoardRow {
  const inWindow = trades.filter((t) => t.pair === pair && t.amount > 0n && t.atMs > nowMs - limits.windowS * 1000 && t.atMs <= nowMs)
    .sort((a, b) => a.atMs - b.atMs);
  const organic = inWindow.filter((t) => t.organic);
  const { kept, excluded } = excludeOutliers(organic, limits.maxMoveBp);
  const cp = counterpartyStats(kept);
  const verdict = judge(inWindow, kept, cp, excluded, nowMs, limits);
  const reference = verdict.classification === 'insufficient_data' || verdict.classification === 'fixture' ? null : kept;
  const first = inWindow[0] ? priceOf(inWindow[0]) : null;
  const last = inWindow.length > 0 ? priceOf(inWindow[inWindow.length - 1]!) : null;
  const change = first && last && first.num > 0n ? Number(((last.num * first.den - first.num * last.den) * 10_000n) / (first.num * last.den)) : null;
  return {
    pair,
    last: last ? wire(last) : null,
    change24hBp: change,
    volume24h: Number(sum(inWindow.map((t) => t.amount))),
    vwap: reference && reference.length > 0 ? wire({ num: sum(reference.map((t) => t.notional)), den: sum(reference.map((t) => t.amount)) }) : null,
    candles1h: candlesOf(inWindow, limits.candleS),
    ...verdict,
    eligibleVolume: Number(sum(kept.map((t) => t.amount))),
    counterparties: cp.count,
    concentrationBp: cp.topBp,
  };
}

/** One row per pair that has any trade in the input (pairs without trades are the caller's to list as `insufficient_data`). */
export function marketBoard(trades: readonly BoardTrade[], nowMs: number, limits: BoardLimits = defaultBoardLimits()): PriceBoardRow[] {
  return [...new Set(trades.map((t) => t.pair))].sort().map((p) => boardRow(p, trades, nowMs, limits));
}
