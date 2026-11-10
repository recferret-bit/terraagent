import { HOUR_MS } from '../bounty/validate.js';
import { mercenaryRoster, type MercenaryRosterEntry } from './roster.js';

export interface HireQuote {
  readonly rosterId: string;
  readonly accountId: string;
  readonly count: number;
  readonly resource: string;
  readonly pricePerGameHour: number;
  readonly fundingCap: number;
  readonly hours: number;
  /** `hours * pricePerGameHour` in major units. Never a literal price. */
  readonly total: number;
}

export interface RefundSplit {
  /** Served metals, floored. The escrow keeps this until a later claim. */
  readonly paid: number;
  /** Unused metals returned to the poster (`total - paid`). */
  readonly refunded: number;
}

/**
 * Price and size come from the mercenary table. Hours are whole design hours (the bounty window).
 * One priced resource only: escrow holds a single token.
 */
export function quoteHire(flags: { has(wave: string): boolean }, rosterId: string, hours: number): HireQuote | null {
  if (!Number.isInteger(hours) || hours < 1) return null;
  const entry = mercenaryRoster(flags).find((row) => row.id === rosterId);
  const priced = entry ? singlePrice(entry) : null;
  if (!entry || !priced) return null;
  const total = priced.price * hours;
  if (!Number.isSafeInteger(total) || total < 1) return null;
  return {
    rosterId: entry.id,
    accountId: entry.accountId,
    count: entry.count,
    resource: priced.resource,
    pricePerGameHour: priced.price,
    fundingCap: priced.cap,
    hours,
    total,
  };
}

/**
 * Floor the served part. The refund is whatever is left, so a 2 h hire at 100 cancelled after 1 h
 * (escrow 200) refunds 100. Elapsed time is clamped to the contract.
 */
export function refundSplit(total: number, hours: number, startedAt: number, nowMs: number): RefundSplit {
  const durationMs = hours * HOUR_MS;
  if (!Number.isInteger(total) || total < 0 || !(durationMs > 0)) return { paid: 0, refunded: 0 };
  const elapsed = Math.trunc(Math.min(durationMs, Math.max(0, nowMs - startedAt)));
  const paid = Number((BigInt(total) * BigInt(elapsed)) / BigInt(durationMs));
  return { paid, refunded: total - paid };
}

function singlePrice(entry: MercenaryRosterEntry): { resource: string; price: number; cap: number } | null {
  const resources = Object.keys(entry.pricePerGameHour);
  const resource = resources[0];
  if (resources.length !== 1 || resource === undefined) return null;
  const price = entry.pricePerGameHour[resource];
  const cap = entry.fundingCap[resource];
  if (price === undefined || cap === undefined || price < 1) return null;
  return { resource, price, cap };
}
