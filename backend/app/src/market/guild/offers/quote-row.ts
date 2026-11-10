import { RESOURCE_KEYS, type QuoteToken, type ResourceKey } from '@terra/contracts';
import type { Prisma } from '@terra/db';
import { decimalToBigint } from '../../book/decimal.js';
import type { OfferQuote } from './curate.js';

export interface QuoteRow {
  readonly orderId: string;
  readonly colonyId: string;
  readonly accountId: string;
  readonly base: string;
  readonly quote: string;
  readonly side: string;
  readonly amount: { toFixed(dp?: number): string };
  readonly filled: { toFixed(dp?: number): string };
  readonly priceAmount: { toFixed(dp?: number): string };
  readonly signedTerms: Prisma.JsonValue | null;
}

export function quoteSeqOf(value: Prisma.JsonValue | null): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const n = (value as { quoteSeq?: unknown }).quoteSeq;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1_000_000_000 ? n : 0;
}

/** Drops a row that is not an NPC book quote the offer schema can carry. */
export function toOfferQuote(row: QuoteRow, shipId: string): OfferQuote | null {
  const base = asBase(row.base);
  const quote = asQuote(row.quote);
  if (!base || !quote || base === quote) return null;
  if (row.side !== 'buy' && row.side !== 'sell') return null;
  return {
    orderId: row.orderId,
    shipId,
    npcId: row.colonyId,
    npcAccountId: row.accountId,
    base,
    quote,
    side: row.side,
    amount: decimalToBigint(row.amount),
    filled: decimalToBigint(row.filled),
    priceAmount: decimalToBigint(row.priceAmount),
    quoteSeq: quoteSeqOf(row.signedTerms),
  };
}

function asBase(value: string): ResourceKey | null {
  return (RESOURCE_KEYS as readonly string[]).includes(value) ? (value as ResourceKey) : null;
}

function asQuote(value: string): QuoteToken | null {
  if (value === 'USDC' || value === 'NEAR') return value;
  return asBase(value);
}
