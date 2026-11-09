import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreException } from '../../src/core/errors/index.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { MarketBookPush, type MarketBookBusEvent } from '../../src/market/api/market-book-push.service.js';
import { MarketController } from '../../src/market/api/market.controller.js';
import type { MarketBooks } from '../../src/market/book/market-books.js';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { compileMarketConfig } from '@terra/sim';

const config = compileMarketConfig({ parameters: {} });
const order = (i: number) => ({ orderId: `o${i}`, seq: BigInt(i), side: 'sell' as const, colonyId: 'c', amount: 10n, filled: 0n, priceAmount: BigInt(100 + i) * 10n });

describe('MarketBookPush debounce', () => {
  let bus: EventBus;
  let book: OrderBook;
  let push: MarketBookPush;
  let change: (c: { planetId: string; pair: string }) => void;
  const out: MarketBookBusEvent[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    out.length = 0;
    bus = new EventBus();
    book = new OrderBook('bio.water/USDC');
    const books = { onChange: (l: typeof change) => { change = l; return () => undefined; }, book: async () => book } as unknown as MarketBooks;
    push = new MarketBookPush(books, bus, { current: () => config } as never);
    push.onModuleInit();
    bus.on('market.book', (e) => out.push(e), { module: 'test' });
  });
  afterEach(() => { push.onModuleDestroy(); vi.useRealTimers(); });

  it('after a quiet period the first change pushes at once; the rest of the second go in ONE trailing push with all 5', async () => {
    for (let i = 0; i < 5; i++) {
      book.add(order(i) as never);
      change({ planetId: 'p', pair: 'bio.water/USDC' });
      await vi.advanceTimersByTimeAsync(100);
      if (i === 0) {
        expect(out).toHaveLength(1);
        expect(out[0]!.payload.asks.reduce((n, l) => n + l.orders, 0)).toBe(1);
      }
    }
    expect(out).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(out).toHaveLength(2);
    expect(out[1]!.payload.asks.reduce((n, l) => n + l.orders, 0)).toBe(5);
    expect(out.map((e) => e.payload.seq)).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(out).toHaveLength(2);
  });

  it('never pushes a pair more than once per second', async () => {
    for (let i = 0; i < 30; i++) {
      change({ planetId: 'p', pair: 'a/USDC' });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('is per pair, keeps a monotonic seq and sends nothing without changes', async () => {
    change({ planetId: 'p', pair: 'a/USDC' });
    change({ planetId: 'p', pair: 'b/USDC' });
    await vi.advanceTimersByTimeAsync(10);
    expect(out.map((e) => e.payload.pair).sort()).toEqual(['a/USDC', 'b/USDC']);
    await vi.advanceTimersByTimeAsync(2000);
    change({ planetId: 'p', pair: 'a/USDC' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(out.filter((e) => e.payload.pair === 'a/USDC').map((e) => e.payload.seq)).toEqual([1, 2]);
    expect(out).toHaveLength(3);
  });
});

describe('MarketController', () => {
  it('403 wave_disabled when W13 is off', async () => {
    const c = new MarketController({} as never, {} as never, { has: () => false } as never);
    await expect(c.snapshot({} as never, 'p')).rejects.toMatchObject({ status: 403, errorCode: 'wave_disabled' });
    await expect(c.snapshot({} as never, 'p')).rejects.toBeInstanceOf(CoreException);
  });
});
