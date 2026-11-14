import { pairId, type GuildOffer, type QuoteToken, type ResourceKey } from '@terra/contracts';
import { comparePrice, limitPrice } from '@terra/sim/systems/trade/market-price';
import { guildOfferId, parseGuildOfferId } from './offer-id.js';

/** `guild.arrived` carries at most this many offers. */
export const GUILD_OFFER_CAP = 6;

/** One resting NPC quote the curator can turn into a player-facing offer. `side` is the NPC's book side. */
export interface OfferQuote {
  readonly orderId: string;
  readonly shipId: string;
  readonly npcId: string;
  readonly npcAccountId: string;
  readonly base: ResourceKey;
  readonly quote: QuoteToken;
  readonly side: 'buy' | 'sell';
  readonly amount: bigint;
  readonly filled: bigint;
  readonly priceAmount: bigint;
  readonly quoteSeq: number;
}

export type OfferJudge =
  | { readonly ok: true; readonly offer: GuildOffer; readonly quote: OfferQuote }
  | { readonly ok: false; readonly code: 'offer_expired'; readonly detail?: string };

const MAX_AMOUNT = 1_000_000_000;

/** Whole base units still resting. Zero means the quote cannot fill now. */
export function fillsNow(q: OfferQuote): bigint {
  const left = q.amount - q.filled;
  return left > 0n && left <= BigInt(MAX_AMOUNT) ? left : 0n;
}

/** Cargo quote for `qty` base units at the maker's rational (floor). Fees are not included. */
export function quoteTotal(q: OfferQuote, qty: bigint): bigint {
  if (qty <= 0n || q.amount <= 0n) return 0n;
  return (qty * q.priceAmount) / q.amount;
}

/**
 * Best price per pair and side, then at most {@link GUILD_OFFER_CAP}.
 * A player buy (NPC ask) keeps the lower price. A player sell (NPC bid) keeps the higher price.
 * Ties keep the larger fill, then the lower order id. The cap drops the tail of pair, then player action.
 */
export function curateGuildOffers(rows: readonly OfferQuote[], cap = GUILD_OFFER_CAP): GuildOffer[] {
  const best = new Map<string, OfferQuote>();
  for (const row of rows) {
    if (fillsNow(row) <= 0n) continue;
    const key = `${pairId(row.base, row.quote)}:${row.side}`;
    const prev = best.get(key);
    if (!prev || betterPrice(row, prev)) best.set(key, row);
  }
  return [...best.values()].sort(byRank).slice(0, cap).map(toOffer);
}

/** Open quote, matching seq, and a ship that is still docked. Anything else is `offer_expired`. */
export function judgeOffer(offerId: string, rows: readonly OfferQuote[], docked: boolean): OfferJudge {
  const parsed = parseGuildOfferId(offerId);
  const quote = parsed ? rows.find((row) => row.orderId === parsed.orderId) : undefined;
  if (!quote || !docked || fillsNow(quote) <= 0n) return { ok: false, code: 'offer_expired' };
  if (quote.quoteSeq !== parsed!.quoteSeq) return { ok: false, code: 'offer_expired', detail: staleDetail(quote) };
  return { ok: true, offer: toOffer(quote), quote };
}

export function staleDetail(q: OfferQuote): string {
  const qty = fillsNow(q);
  const total = qty > 0n ? quoteTotal(q, qty) : q.priceAmount;
  return `new price ${q.quote} ${total.toString()}`.slice(0, 200);
}

function toOffer(q: OfferQuote): GuildOffer {
  const qty = fillsNow(q);
  const priceAmount = quoteTotal(q, qty).toString();
  const stance = q.side === 'sell' ? 'stock > target, discounting ask' : 'stock < target, raising bid';
  return {
    offerId: guildOfferId(q.orderId, q.quoteSeq),
    shipId: q.shipId,
    npcId: q.npcId,
    npcAccountId: q.npcAccountId,
    action: q.side === 'sell' ? 'buy' : 'sell',
    resource: q.base,
    amount: Number(qty),
    price: { token: q.quote, amount: priceAmount },
    quoteSeq: q.quoteSeq,
    reason: `Guild ${q.npcId} ${q.side === 'sell' ? 'selling surplus' : 'buying needed'} ${q.base} (${Number(qty)} @ ${priceAmount} ${q.quote} — ${stance}, 24h VWAP power-law)`,
  };
}

/** NPC sell: lower price is better for the player. NPC buy: higher price is better. */
function betterPrice(a: OfferQuote, b: OfferQuote): boolean {
  const cmp = comparePrice(limitPrice(a.priceAmount, a.amount), limitPrice(b.priceAmount, b.amount));
  if (cmp !== 0) return a.side === 'sell' ? cmp < 0 : cmp > 0;
  const left = fillsNow(a) - fillsNow(b);
  if (left !== 0n) return left > 0n;
  return a.orderId < b.orderId;
}

function byRank(a: OfferQuote, b: OfferQuote): number {
  const pair = pairId(a.base, a.quote).localeCompare(pairId(b.base, b.quote));
  if (pair !== 0) return pair;
  const action = (a.side === 'sell' ? 'buy' : 'sell').localeCompare(b.side === 'sell' ? 'buy' : 'sell');
  return action;
}
