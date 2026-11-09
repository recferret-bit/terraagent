import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketOrderRepository, type CreateMarketOrderInput } from '../../src/market/book/market-order.repository.js';
import { MarketMatcher } from '../../src/market/matching/market-matcher.service.js';

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

const input = (n: number, side: 'buy' | 'sell', amount: bigint, price: bigint, colony = `c${n}`): CreateMarketOrderInput => ({
  orderId: `m-${n}`, ref: `ref-${n}`, planetId: 'p', pair: 'metals.t1/USDC', base: 'metals.t1', quote: 'USDC', side, colonyId: colony,
  accountId: `a${n}`, stallColonyId: colony, stallAccountId: `a${n}`, platformAccountId: 'platform', amount, priceAmount: price,
  fillPolicy: 'partial', policyVersion: 'v1', policyHash: 'h', platformFeeBp: 100, stallFeeBp: 50, maxStallFeeBp: side === 'buy' ? 100 : null,
  ttlS: 900, expiresAt: new Date('2030-01-01T00:00:00Z'),
});

describe('MarketMatcher', () => {
  it('ask 200 @0.40 + bid 100 @0.45 -> one fill of 100 at the maker price; same colony never matches', async () => {
    const repo = new MarketOrderRepository(db.prisma);
    const books = new MarketBooks(repo);
    const matcher = new MarketMatcher(db.prisma, repo, books);
    await repo.createFromRequest(input(1, 'sell', 200n, 80n));
    await repo.createFromRequest(input(2, 'buy', 100n, 45n));
    await repo.createFromRequest(input(3, 'buy', 100n, 50n, 'c1')); // same colony as the ask
    for (const id of ['m-1', 'm-2', 'm-3']) await repo.setState(id, 'OPEN');
    const own = await matcher.matchOrder('m-3');
    expect(own.fills).toEqual([]);
    const r = await matcher.matchOrder('m-2');
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]).toMatchObject({ makerOrderId: 'm-1', takerOrderId: 'm-2', qty: 100n, price: { num: 80n, den: 200n } });
    expect(r.makers.get('m-1')?.filled).toBe(0n);
    expect(r.restingRemainder).toBe(0n);
  });
});
