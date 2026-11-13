import type { GuildOffer } from '@terra/contracts';
import { withTransaction, type PrismaClient, type TransactionClient } from '@terra/db';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { matchIncoming } from '@terra/sim/systems/trade/market-matcher';
import { isBookable, type MarketOrderRecord } from '../../book/market-order.record.js';
import { MarketBooks } from '../../book/market-books.js';
import { MarketOrderRepository } from '../../book/market-order.repository.js';
import { orderIdOf } from '../../orders/place-order.service.js';
import { requirementOf } from '../../orders/order-funds.js';
import { PLATFORM_ACCOUNT_ID } from '../../orders/market-policy.provider.js';
import { MarketFillsHook } from '../../orders/market-fills.hook.js';
import type { OfferQuote } from './curate.js';
import { quoteSeqOf } from './quote-row.js';

export interface CrossResult {
  readonly ok: true;
  readonly tradeId: string;
  readonly npcAccountId: string;
  readonly offer: GuildOffer;
}

export interface CrossTakerContext {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly playerId: string;
  readonly accountId: string;
  readonly platformAccountId?: string;
  readonly stakerPlatformFeeBp?: number;
}

/** One player taker crossed only against this NPC quote, then the W13 fills hook. */
export async function crossGuildOffer(
  prisma: PrismaClient,
  repo: MarketOrderRepository,
  fills: MarketFillsHook,
  books: MarketBooks,
  input: CrossTakerContext,
  quote: OfferQuote,
  offer: GuildOffer,
): Promise<CrossResult | { ok: false; code: 'offer_expired'; detail?: string }> {
  const ref = await takerRef(prisma, input.planetId, offer.offerId, input.colonyId);
  const prior = await priorTrade(prisma, input.planetId, ref);
  if (prior) return { ok: true, tradeId: prior, npcAccountId: quote.npcAccountId, offer };
  const settled = await withTransaction(prisma, (tx) => crossLocked(tx, repo, fills, input, quote, ref));
  if (!settled.ok) return { ok: false, code: 'offer_expired', ...(settled.detail ? { detail: settled.detail } : {}) };
  await books.sync(settled.takerId, quote.orderId);
  const trade = await prisma.intentTrade.findFirst({ where: { takerOrderId: settled.takerId }, select: { tradeId: true } });
  if (!trade) return { ok: false, code: 'offer_expired' };
  return { ok: true, tradeId: trade.tradeId, npcAccountId: quote.npcAccountId, offer };
}

async function crossLocked(
  tx: TransactionClient,
  repo: MarketOrderRepository,
  fills: MarketFillsHook,
  input: CrossTakerContext,
  quote: OfferQuote,
  ref: string,
): Promise<{ ok: true; takerId: string } | { ok: false; detail?: string }> {
  const [maker] = await repo.lockForUpdate([quote.orderId], tx);
  if (!maker || !isBookable(maker.state)) return { ok: false };
  const seq = quoteSeqOf((await tx.marketOrder.findUnique({ where: { orderId: maker.orderId }, select: { signedTerms: true } }))?.signedTerms ?? null);
  if (seq !== quote.quoteSeq) return { ok: false, detail: `new price ${maker.quote} ${maker.priceAmount.toString()}`.slice(0, 200) };
  const taker = await repo.createFromRequest(takerInput(input, maker, quote, ref), tx);
  const rows = await repo.lockForUpdate([taker.order.orderId, maker.orderId], tx);
  const freshMaker = rows.find((row) => row.orderId === maker.orderId);
  const freshTaker = rows.find((row) => row.orderId === taker.order.orderId);
  if (!freshMaker || !freshTaker || !isBookable(freshMaker.state)) {
    await repo.setState(taker.order.orderId, 'CANCELLED', 'offer_expired', tx);
    return { ok: false };
  }
  const book = new OrderBook<MarketOrderRecord>(freshMaker.pair);
  book.add(freshMaker);
  const matched = matchIncoming(book, freshTaker);
  const fill = matched.fills.length === 1 && matched.fills[0]!.makerOrderId === freshMaker.orderId ? matched.fills[0]! : null;
  if (!fill) {
    await repo.setState(freshTaker.orderId, 'CANCELLED', 'offer_expired', tx);
    return { ok: false };
  }
  await fills.onFills({
    incoming: freshTaker,
    fills: [fill],
    restingRemainder: matched.restingRemainder,
    makers: new Map([[freshMaker.orderId, freshMaker]]),
  }, tx);
  return { ok: true, takerId: freshTaker.orderId };
}

function takerInput(
  input: CrossTakerContext,
  maker: MarketOrderRecord,
  quote: OfferQuote,
  ref: string,
) {
  const side = quote.side === 'sell' ? 'buy' as const : 'sell' as const;
  const qty = maker.amount - maker.filled;
  const limit = takerLimit(maker, qty, side);
  const maxStall = Math.max(maker.stallFeeBp, maker.maxStallFeeBp ?? 0);
  const effectiveFeeBp =
    side === 'buy' && input.stakerPlatformFeeBp !== undefined && input.stakerPlatformFeeBp < maker.platformFeeBp
      ? input.stakerPlatformFeeBp
      : maker.platformFeeBp;
  const need = requirementOf({
    side, base: quote.base, quote: quote.quote, amount: limit.amount, priceAmount: limit.priceAmount,
    platformFeeBp: effectiveFeeBp, maxStallFeeBp: maxStall,
  });
  return {
    orderId: orderIdOf(input.planetId, ref),
    ref,
    planetId: input.planetId,
    pair: maker.pair,
    base: maker.base,
    quote: maker.quote,
    side,
    colonyId: input.colonyId,
    colonyIndex: input.colonyIndex,
    playerId: input.playerId,
    accountId: input.accountId,
    stallColonyId: input.colonyId,
    stallAccountId: input.accountId,
    stallHubEntityId: 0,
    platformAccountId: input.platformAccountId ?? PLATFORM_ACCOUNT_ID,
    amount: limit.amount,
    priceAmount: limit.priceAmount,
    fillPolicy: 'partial',
    policyVersion: maker.policyVersion,
    policyHash: maker.policyHash,
    platformFeeBp: maker.platformFeeBp,
    ...(effectiveFeeBp < maker.platformFeeBp ? { signedTerms: { stakerPlatformFeeBp: effectiveFeeBp } } : {}),
    stallFeeBp: maker.stallFeeBp,
    maxStallFeeBp: side === 'buy' ? maxStall : null,
    actorKind: 'player',
    ttlS: maker.ttlS,
    expiresAt: new Date(Date.now() + maker.ttlS * 1000),
    state: 'OPEN',
    reservedPrincipal: need.principal,
    reservedFees: need.fees,
  };
}

function takerLimit(maker: MarketOrderRecord, qty: bigint, side: 'buy' | 'sell'): { amount: bigint; priceAmount: bigint } {
  if (maker.filled === 0n && qty === maker.amount) return { amount: maker.amount, priceAmount: maker.priceAmount };
  const num = qty * maker.priceAmount;
  const whole = num / maker.amount;
  const price = side === 'buy' && num % maker.amount !== 0n ? whole + 1n : whole;
  return { amount: qty, priceAmount: price };
}

async function takerRef(prisma: PrismaClient, planetId: string, offerId: string, colonyId: string): Promise<string> {
  const base = `gof-take:${offerId}:${colonyId}`;
  for (let n = 1; n <= 4; n++) {
    const ref = n === 1 ? base : `${base}:${n}`;
    const row = await prisma.marketOrder.findUnique({ where: { planetId_ref: { planetId, ref } }, select: { state: true } });
    if (!row || row.state === 'OPEN' || row.state === 'PARTIAL' || row.state === 'PENDING' || row.state === 'FILLED') return ref;
  }
  return `${base}:4`;
}

async function priorTrade(prisma: PrismaClient, planetId: string, ref: string): Promise<string | null> {
  const row = await prisma.marketOrder.findUnique({ where: { planetId_ref: { planetId, ref } }, select: { orderId: true, state: true } });
  if (!row || row.state !== 'FILLED') return null;
  const trade = await prisma.intentTrade.findFirst({ where: { planetId, takerOrderId: row.orderId }, select: { tradeId: true } });
  return trade?.tradeId ?? null;
}
