import { withTransaction } from '@terra/db';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFillBatch } from '../../src/market/settlement/batch-builder.js';
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

const input = (id: string, side: 'buy' | 'sell', amount: bigint, price: bigint, over: Partial<CreateMarketOrderInput> = {}): CreateMarketOrderInput => ({
  orderId: id, ref: `ref-${id}`, planetId: 'p', pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', side, colonyId: `col-${id}`,
  accountId: `acc-${id}`, stallColonyId: `col-${id}`, stallAccountId: `acc-${id}`, platformAccountId: 'platform', amount, priceAmount: price,
  fillPolicy: 'partial', policyVersion: 'v1', policyHash: 'h', platformFeeBp: 100, stallFeeBp: 100, maxStallFeeBp: side === 'buy' ? 100 : null,
  ttlS: 900, expiresAt: new Date('2030-01-01T00:00:00Z'), ...over,
});

describe('concurrent fill vs cancel on one order', () => {
  it('exactly one reservation release; consumed + released always equals the reservation', async () => {
    const repo = new MarketOrderRepository(db.prisma);
    for (let i = 0; i < 12; i++) {
      const id = `race-${i}`;
      await repo.createFromRequest(input(id, 'sell', 300n, 10n, { reservedPrincipal: 300n, state: 'OPEN' }));
      const ledger = { consumed: 0n, released: 0n, releases: 0 };
      const fill = (): Promise<void> => withTransaction(db.prisma, async (tx) => {
        const [o] = await repo.lockForUpdate([id], tx);
        if (!o || (o.state !== 'OPEN' && o.state !== 'PARTIAL')) return;
        await repo.updateFill(id, { filled: o.filled + 100n, cumNotional: 3n, feeBuckets: {}, state: 'PARTIAL' }, tx);
        await repo.updateReservation(id, { reservedPrincipal: o.reservedPrincipal - 100n, reservedFees: 0n }, tx);
        ledger.consumed += 100n;
      });
      const cancel = (): Promise<void> => withTransaction(db.prisma, async (tx) => {
        const [o] = await repo.lockForUpdate([id], tx);
        if (!o || (o.state !== 'OPEN' && o.state !== 'PARTIAL')) return;
        await repo.updateReservation(id, { reservedPrincipal: 0n, reservedFees: 0n }, tx);
        await repo.setState(id, 'CANCELLED', null, tx);
        ledger.released += o.reservedPrincipal;
        ledger.releases += 1;
      });
      await Promise.all(i % 3 === 0 ? [cancel(), cancel(), fill()] : i % 3 === 1 ? [fill(), cancel(), cancel()] : [cancel(), fill(), fill()]);
      const row = (await repo.find(id))!;
      expect(ledger.releases).toBe(1);
      expect(ledger.consumed + ledger.released).toBe(300n);
      expect(row.state).toBe('CANCELLED');
      expect(row.reservedPrincipal).toBe(0n);
      expect(row.filled).toBe(ledger.consumed);
    }
  });
});

describe('restart after partial fills', () => {
  it('keeps feeBuckets, cumNotional, filled and reservations exact', async () => {
    const repo = new MarketOrderRepository(db.prisma);
    const books = new MarketBooks(repo);
    const matcher = new MarketMatcher(db.prisma, repo, books);
    const price = 10_000_003n;
    await repo.createFromRequest(input('ask', 'sell', 300n, price, { reservedPrincipal: 300n, state: 'OPEN' }));
    // the buyer comes in 7-unit slices: each slice is its own order of the same colony, so the fee bucket must carry
    await repo.createFromRequest(input('bid', 'buy', 300n, price, { reservedPrincipal: price, reservedFees: 200_000n, state: 'OPEN' }));
    for (let i = 0; i < 3; i++) {
      const outcome = await matcher.matchOrder('bid');
      const f = outcome.fills[0]!;
      const slice = { ...f, qty: 7n };
      const orders = new Map([[f.buyerOrderId, (await repo.find(f.buyerOrderId))!], [f.sellerOrderId, (await repo.find(f.sellerOrderId))!]]);
      const batch = buildFillBatch({ tradeId: `t${i}`, fill: slice, orders, treasury: { enabled: false, shareBp: 0, accountId: 't' } });
      await withTransaction(db.prisma, async (tx) => {
        await repo.lockForUpdate(['bid', 'ask'], tx);
        for (const u of [batch.buyer, batch.seller]) {
          await repo.updateFill(u.orderId, { filled: u.filled, cumNotional: u.cumNotional, feeBuckets: u.feeBuckets as never, state: 'PARTIAL' }, tx);
          await repo.updateReservation(u.orderId, { reservedPrincipal: u.reservedPrincipal, reservedFees: u.reservedFees }, tx);
        }
      });
      await books.sync('bid', 'ask');
    }
    const live = await books.book('p', 'bio.water/USDC');
    const before = { buy: live.orders('buy'), sell: live.orders('sell') };
    const bid = before.buy[0]!;
    expect(bid.filled).toBe(21n);
    expect(Object.keys(bid.feeBuckets)).toHaveLength(2);
    expect(bid.cumNotional).toBeGreaterThan(0n);

    const books2 = new MarketBooks(new MarketOrderRepository(db.prisma));
    await books2.onModuleInit();
    const book2 = await books2.book('p', 'bio.water/USDC');
    expect({ buy: book2.orders('buy'), sell: book2.orders('sell') }).toEqual(before);
  });
});

describe('settlement-dependent cases (W13-13 / W13-14)', () => {
  it.todo('W13-14: an ambiguous settlement outcome quarantines the trade and keeps both reservations until reconciled');
  it.todo('W13-14: restart after the batch was executed but before FINAL is recorded settles exactly once');
  it.todo('W13-13: a failed final settlement restores both orders to executable with reservations reacquired atomically');
});
