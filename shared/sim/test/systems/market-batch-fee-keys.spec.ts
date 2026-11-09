import { describe, expect, it } from 'vitest';
import { buildTradeBatch, stallBucket, type BatchOrder } from '../../src/systems/trade/market-batch';
import { feeBucketKey } from '../../src/systems/trade/market-fees';
import type { Fill } from '../../src/systems/trade/market-matcher';

const off = { enabled: false, shareBp: 2000, accountId: 'treasury' };
const order = (o: Partial<BatchOrder> & Pick<BatchOrder, 'orderId' | 'side' | 'amount' | 'priceAmount'>): BatchOrder => ({
  colonyId: o.orderId, accountId: `acc-${o.orderId}`, filled: 0n, platformFeeBp: 100, stallFeeBp: 100, stallColonyId: o.orderId,
  stallAccountId: `acc-${o.orderId}`, platformAccountId: 'platform', policyVersion: 'v1', feeBuckets: {}, cumNotional: 0n,
  reservedPrincipal: o.side === 'sell' ? o.amount : o.priceAmount, reservedFees: 10n ** 30n, ...o,
});

function fillOneByOne(seller: BatchOrder, buyer0: BatchOrder): { platform: bigint; stall: bigint; buyer: BatchOrder } {
  let s = seller, b = buyer0, platform = 0n, stall = 0n;
  while (b.filled < b.amount) {
    const fill: Fill = { makerOrderId: s.orderId, takerOrderId: b.orderId, makerSide: 'sell', buyerOrderId: b.orderId, sellerOrderId: s.orderId,
      buyerColonyId: b.colonyId, sellerColonyId: s.colonyId, qty: 1n, price: { num: s.priceAmount, den: s.amount } };
    const t = buildTradeBatch({ tradeId: 't', base: 'bio.water', quote: 'USDC', fill, buyer: b, seller: s, treasury: off });
    platform += t.platformFee; stall += t.stallFee;
    s = { ...s, filled: t.seller.filled, cumNotional: t.seller.cumNotional };
    b = { ...b, filled: t.buyer.filled, cumNotional: t.buyer.cumNotional, feeBuckets: t.buyer.feeBuckets, reservedPrincipal: t.buyer.reservedPrincipal, reservedFees: t.buyer.reservedFees };
  }
  return { platform, stall, buyer: b };
}

describe('platform and stall fee buckets never collide', () => {
  it('platform account == maker stall account, equal rates: 3 units at 150, one at a time, fees are 1 + 1 (not 3)', () => {
    const seller = order({ orderId: 'S', side: 'sell', amount: 3n, priceAmount: 150n, stallAccountId: 'platform' });
    const buyer = order({ orderId: 'B', side: 'buy', amount: 3n, priceAmount: 150n });
    const r = fillOneByOne(seller, buyer);
    expect(r.platform).toBe(1n); // floor(150 * 100 / 10000)
    expect(r.stall).toBe(1n);
    expect(Object.keys(r.buyer.feeBuckets).length).toBe(2);
  });

  it('distinct accounts behave as before', () => {
    const r = fillOneByOne(order({ orderId: 'S', side: 'sell', amount: 3n, priceAmount: 150n }), order({ orderId: 'B', side: 'buy', amount: 3n, priceAmount: 150n }));
    expect([r.platform, r.stall]).toEqual([1n, 1n]);
  });

  it('stallBucket adopts a legacy (plain key) stall bucket, but never the platform\'s own collided bucket', () => {
    const plain = feeBucketKey('USDC', 100, 'acc-S', 'v1');
    const platform = feeBucketKey('USDC', 100, 'platform', 'v1');
    const legacy = { [plain]: { base: '100', fee: '1' } };
    expect(stallBucket(legacy, plain, platform)).toEqual({ key: `${plain}|stall`, buckets: { ...legacy, [`${plain}|stall`]: legacy[plain] } });
    const collided = { [platform]: { base: '100', fee: '1' } };
    expect(stallBucket(collided, platform, platform).buckets).toBe(collided);
    const migrated = { [`${plain}|stall`]: { base: '5', fee: '0' }, [plain]: { base: '9', fee: '0' } };
    expect(stallBucket(migrated, plain, platform).buckets).toBe(migrated);
    expect(stallBucket({}, plain, platform).buckets).toEqual({});
  });
});
