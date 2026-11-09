import { OrderBook } from '../../src/systems/trade/market-book';
import { buildTradeBatch, type BatchOrder, type TradeBatch, type TreasuryTerms } from '../../src/systems/trade/market-batch';
import { matchIncoming, type MatchableOrder } from '../../src/systems/trade/market-matcher';

/** An order usable by both the matcher and the batch builder. */
export type KitOrder = MatchableOrder & BatchOrder;

let seq = 0n;
export function kitOrder(side: 'buy' | 'sell', amount: bigint, priceAmount: bigint, over: Partial<KitOrder> = {}): KitOrder {
  seq += 1n;
  const id = `k${seq}`;
  return {
    orderId: id, seq, side, colonyId: `col-${id}`, accountId: `acc-${id}`, amount, filled: 0n, priceAmount,
    fillPolicy: 'partial', policyVersion: 'v1', platformFeeBp: 100, stallFeeBp: 100, maxStallFeeBp: side === 'buy' ? 100 : null,
    stallColonyId: `col-${id}`, stallAccountId: `stall-${id}`, platformAccountId: 'platform', feeBuckets: {}, cumNotional: 0n,
    reservedPrincipal: side === 'sell' ? amount : priceAmount, reservedFees: side === 'buy' ? priceAmount : 0n, ...over,
  };
}

export const kitBook = (...os: KitOrder[]): OrderBook<KitOrder> => {
  const b = new OrderBook<KitOrder>('pair');
  os.forEach((o) => b.add(o));
  return b;
};

export const noTreasury: TreasuryTerms = { enabled: false, shareBp: 2000, accountId: 'treasury' };

/** Matches `incoming` against the book and builds every fill's batch, carrying order state fill by fill. */
export function matchAndBatch(book: OrderBook<KitOrder>, incoming: KitOrder, base = 'bio.water', quote = 'USDC', treasury = noTreasury): TradeBatch[] {
  const { fills } = matchIncoming(book, incoming);
  const state = new Map<string, KitOrder>([[incoming.orderId, incoming]]);
  for (const f of fills) if (!state.has(f.makerOrderId)) state.set(f.makerOrderId, book.get(f.makerOrderId)!);
  const batches: TradeBatch[] = [];
  fills.forEach((fill, i) => {
    const batch = buildTradeBatch({ tradeId: `t${i}`, base, quote, fill, buyer: state.get(fill.buyerOrderId)!, seller: state.get(fill.sellerOrderId)!, treasury });
    for (const u of [batch.buyer, batch.seller]) state.set(u.orderId, { ...state.get(u.orderId)!, ...u });
    batches.push(batch);
  });
  return batches;
}

export function tokenSums(batches: readonly TradeBatch[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const b of batches) for (const l of b.legs) m.set(l.token, (m.get(l.token) ?? 0n) + l.delta);
  return m;
}
