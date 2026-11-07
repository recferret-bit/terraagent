import { withTransaction } from '@terra/db';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketOrderRepository, type CreateMarketOrderInput } from '../../src/market/book/market-order.repository.js';

let db: TestDatabase;
const PLANET = 'planet-1';
const PAIR = 'water/USDC';
const huge = 10n ** 40n + 7n;

const input = (n: number, side: 'buy' | 'sell', amount: bigint, price: bigint, over: Partial<CreateMarketOrderInput> = {}): CreateMarketOrderInput => ({
  orderId: `ord-${n}`,
  ref: `market-order:c${n}:${n}`,
  planetId: PLANET,
  pair: PAIR,
  base: 'water',
  quote: 'USDC',
  side,
  colonyId: `c${n}`,
  accountId: `acc-${n}`,
  stallColonyId: `c${n}`,
  stallAccountId: `acc-${n}`,
  platformAccountId: 'platform',
  amount,
  priceAmount: price,
  fillPolicy: 'partial',
  policyVersion: 'fees-v1',
  policyHash: 'sha256:abc',
  platformFeeBp: 50,
  stallFeeBp: 100 + n,
  maxStallFeeBp: side === 'buy' ? 300 : null,
  ttlS: 3600,
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  ...over,
});

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('market order book persistence', () => {
  it('rebuilds the same price-time book after a restart, bit for bit', async () => {
    const repo = new MarketOrderRepository(db.prisma);
    const books = new MarketBooks(repo);
    const specs: [number, 'buy' | 'sell', bigint, bigint][] = [
      [1, 'sell', 300n, 10_000_000n], // 1/30 * 1e7
      [2, 'sell', 30n, 1_000_000n], // equal rational to #1 (tie, later seq)
      [3, 'sell', 100n, 45_000_000n],
      [4, 'sell', 100n, 40_000_000n],
      [5, 'buy', 100n, 30_000_000n],
      [6, 'buy', 100n, 35_000_000n],
      [7, 'buy', 50n, 15_000_000n], // equals #5's rational price; cancelled below
    ];
    for (const [n, side, amount, price] of specs) {
      const { order } = await repo.createFromRequest(input(n, side, amount, price));
      expect(order.state).toBe('PENDING');
    }
    // reserve + open, with exact odd values
    await books.book(PLANET, PAIR); // load (empty)
    for (const [n, side, amount] of specs) {
      const id = `ord-${n}`;
      await repo.updateReservation(id, { reservedPrincipal: side === 'sell' ? amount : huge + BigInt(n), reservedFees: BigInt(n) * 12_345n, state: 'OPEN' });
    }
    await repo.updateFill('ord-1', {
      filled: 120n,
      cumNotional: 4_000_001n,
      feeBuckets: { 'USDC|50|platform|fees-v1': { base: '4000001', fee: '20000' } },
      state: 'PARTIAL',
    });
    await repo.setState('ord-7', 'CANCELLED');

    const live = await books.book(PLANET, PAIR);
    const snapshot = (b: typeof live) => ({ buy: b.orders('buy'), sell: b.orders('sell') });
    const before = snapshot(live);
    expect(before.sell.map((o) => o.orderId)).toEqual(['ord-1', 'ord-2', 'ord-4', 'ord-3']);
    expect(before.buy.map((o) => o.orderId)).toEqual(['ord-6', 'ord-5']);
    expect(before.sell[0]!.filled).toBe(120n);

    // simulated restart: fresh repository and service over the same database
    const books2 = new MarketBooks(new MarketOrderRepository(db.prisma));
    await books2.onModuleInit();
    const after = snapshot(await books2.book(PLANET, PAIR));
    expect(after).toEqual(before);
    expect(after.sell[0]!.reservedPrincipal).toBe(300n);
    expect(after.buy[0]!.reservedPrincipal).toBe(huge + 6n);
    expect(after.sell[0]!.feeBuckets).toEqual({ 'USDC|50|platform|fees-v1': { base: '4000001', fee: '20000' } });
    expect(after.sell[0]!.cumNotional).toBe(4_000_001n);
    expect(after.sell[0]).toMatchObject({ policyVersion: 'fees-v1', policyHash: 'sha256:abc', platformFeeBp: 50, stallFeeBp: 101, ttlS: 3600, fillPolicy: 'partial', actorKind: 'player' });
    expect(after.buy[0]!.maxStallFeeBp).toBe(300);
    expect((await books2.book(PLANET, PAIR)).depth('sell', 5)[0]).toEqual({ num: '100000', den: 3, amount: 180 + 30, orders: 2 });

    // lazy first access on a service that skipped init also reads the DB
    const books3 = new MarketBooks(new MarketOrderRepository(db.prisma));
    expect(snapshot(await books3.book(PLANET, PAIR))).toEqual(before);
  });

  it('createFromRequest is idempotent on ref', async () => {
    const repo = new MarketOrderRepository(db.prisma);
    const a = await repo.createFromRequest(input(20, 'buy', 10n, 5n));
    const b = await repo.createFromRequest(input(20, 'buy', 99n, 7n, { orderId: 'other' }));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.order.orderId).toBe('ord-20');
    expect(b.order.amount).toBe(10n);
    expect(b.order.seq).toBe(a.order.seq);
    expect(await db.prisma.marketOrder.count({ where: { ref: 'market-order:c20:20' } })).toBe(1);
  });

  it('keeps the live book in sync and locks rows', async () => {
    const repo = new MarketOrderRepository(db.prisma);
    const books = new MarketBooks(repo);
    const live = await books.book('planet-2', PAIR);
    await repo.createFromRequest(input(30, 'sell', 10n, 10n, { planetId: 'planet-2' }));
    expect(live.size).toBe(0);
    await repo.updateReservation('ord-30', { reservedPrincipal: 10n, reservedFees: 0n, state: 'OPEN' });
    await books.book('planet-2', PAIR);
    expect(live.bestAsk()?.orderId).toBe('ord-30');
    expect((await repo.listOpenByColony('planet-2', 'c30')).map((o) => o.orderId)).toEqual(['ord-30']);
    expect((await repo.listOpen('planet-2', PAIR)).length).toBe(1);

    await withTransaction(db.prisma, async (tx) => {
      const [locked] = await repo.lockForUpdate(['ord-30'], tx);
      expect(locked!.state).toBe('OPEN');
      await repo.setState('ord-30', 'FILLED', null, tx);
    });
    expect(live.size).toBe(1); // tx writes do not notify until the caller syncs after commit
    await books.sync('ord-30');
    expect(live.size).toBe(0);
  });
});
