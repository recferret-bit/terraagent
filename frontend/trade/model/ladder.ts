import type { BookLevel } from '@terra/contracts';
import { cmpRatio, levelRatio, type Ratio } from './units';

export interface LadderRow {
  readonly level: BookLevel;
  readonly price: Ratio;
  /** Running base units from the best price outwards. */
  readonly cumulative: number;
  /** 0..1 of the deeper side's total, for the depth bar. */
  readonly depth: number;
}

export interface Ladder {
  /** Best first (lowest ask / highest bid). */
  readonly asks: readonly LadderRow[];
  readonly bids: readonly LadderRow[];
  readonly bestBid: Ratio | null;
  readonly bestAsk: Ratio | null;
  /** `ask - bid` as an exact rational; null when a side is empty. Negative would mean a crossed book (never expected). */
  readonly spread: { readonly num: bigint; readonly den: bigint } | null;
  readonly spreadBp: number | null;
  readonly crossed: boolean;
}

function side(levels: readonly BookLevel[], bestFirst: 'asc' | 'desc'): { rows: LadderRow[]; total: number } {
  const sorted = [...levels].sort((a, b) => cmpRatio(levelRatio(a), levelRatio(b)) * (bestFirst === 'asc' ? 1 : -1));
  let run = 0;
  const rows = sorted.map((level) => ({ level, price: levelRatio(level), cumulative: (run += level.amount), depth: 0 }));
  return { rows, total: run };
}

export function buildLadder(bids: readonly BookLevel[], asks: readonly BookLevel[]): Ladder {
  const b = side(bids, 'desc');
  const a = side(asks, 'asc');
  const max = Math.max(a.total, b.total, 1);
  const scale = (rows: LadderRow[]): LadderRow[] => rows.map((r) => ({ ...r, depth: r.cumulative / max }));
  const bestBid = b.rows[0]?.price ?? null;
  const bestAsk = a.rows[0]?.price ?? null;
  let spread: Ladder['spread'] = null;
  let spreadBp: number | null = null;
  if (bestBid && bestAsk) {
    const den = BigInt(bestAsk.den) * BigInt(bestBid.den);
    const num = BigInt(bestAsk.num) * BigInt(bestBid.den) - BigInt(bestBid.num) * BigInt(bestAsk.den);
    spread = { num, den };
    const midNum = BigInt(bestAsk.num) * BigInt(bestBid.den) + BigInt(bestBid.num) * BigInt(bestAsk.den);
    spreadBp = midNum === 0n ? null : Number((num * 20_000n) / midNum);
  }
  return { asks: scale(a.rows), bids: scale(b.rows), bestBid, bestAsk, spread, spreadBp, crossed: spread !== null && spread.num < 0n };
}

/** A spread as a Ratio to feed `formatUnitPrice` (null when negative or the denominator is not a safe integer). */
export function spreadRatio(s: NonNullable<Ladder['spread']>): Ratio | null {
  if (s.num < 0n || s.den > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { num: s.num.toString(), den: Number(s.den) };
}
