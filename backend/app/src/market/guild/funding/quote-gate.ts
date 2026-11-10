import { reserveExposure, type ExposureBook, type FundingBucket } from './exposure.js';

export type QuotePause = 'funding_cap' | 'killed' | 'cash_paused' | 'inventory_short';

export type QuoteGateResult = { readonly ok: true } | { readonly ok: false; readonly reason: QuotePause };

/** A preview of one quote. `cashBid` is `allowCashBid`. This does not reserve and does not top up. */
export interface QuoteGate {
  readonly killed: boolean;
  readonly bucket: FundingBucket;
  readonly size: bigint;
  readonly stock: bigint;
  readonly cashBid: boolean;
  readonly book: ExposureBook;
}

/** Sells and barter bids draw inventory. Only a cash buy draws the cash book. */
export function quoteBucket(side: 'buy' | 'sell', quote: 'cash' | 'inventory'): FundingBucket {
  return side === 'buy' && quote === 'cash' ? 'cash' : 'inventory';
}

/**
 * Whether this quote may be placed. Killed wins, then a paused cash bid, then stock, then the cap.
 * The returned book is not written: `reserve` is the atomic gate.
 */
export function allowQuote(input: QuoteGate): QuoteGateResult {
  if (input.killed) return { ok: false, reason: 'killed' };
  if (input.bucket === 'cash' && !input.cashBid) return { ok: false, reason: 'cash_paused' };
  if (input.bucket === 'inventory' && input.stock < input.size) return { ok: false, reason: 'inventory_short' };
  return reserveExposure(input.book, input.size).ok ? { ok: true } : { ok: false, reason: 'funding_cap' };
}
