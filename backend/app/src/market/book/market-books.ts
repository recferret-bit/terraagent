import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { isBookable, type MarketOrderRecord } from './market-order.record.js';
import { MarketOrderRepository } from './market-order.repository.js';

/** Called after an order was put into or taken out of its pair's book (`market.book` push, W13-19). */
export type BookChangeListener = (change: { planetId: string; pair: string; order: MarketOrderRecord }) => void;

const keyOf = (planetId: string, pair: string): string => `${planetId}\u0000${pair}`;

/**
 * One in-memory `OrderBook` per (planet, pair), rebuilt from Postgres (OPEN/PARTIAL rows) on module init and on first
 * access of a book, and kept in sync with repository writes. Entries are the full persisted record, so reservations,
 * pinned terms and fee buckets survive a restart exactly.
 */
@Injectable()
export class MarketBooks implements OnModuleInit, OnModuleDestroy {
  private readonly books = new Map<string, Promise<OrderBook<MarketOrderRecord>>>();
  private unsubscribe: (() => void) | undefined;
  private readonly changeListeners = new Set<BookChangeListener>();

  constructor(private readonly repo: MarketOrderRepository) {
    this.unsubscribe = repo.onWrite((o) => void this.apply(o));
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.rebuildAll();
    } catch (err) {
      // No database or schema yet (unit-test apps): books then load lazily on first access.
      new Logger(MarketBooks.name).warn(`order book rebuild skipped: ${(err as Error).message.split('\n').pop()}`);
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  onChange(listener: BookChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Drops every book and reloads all resting orders from the database. */
  async rebuildAll(): Promise<void> {
    const orders = await this.repo.listAllOpen();
    this.books.clear();
    const byKey = new Map<string, MarketOrderRecord[]>();
    for (const o of orders) {
      const k = keyOf(o.planetId, o.pair);
      byKey.set(k, [...(byKey.get(k) ?? []), o]);
    }
    for (const [k, list] of byKey) {
      const book = new OrderBook<MarketOrderRecord>(list[0]!.pair);
      for (const o of list) book.add(o);
      this.books.set(k, Promise.resolve(book));
    }
  }

  /** The book of a pair on a planet (loads it from the database on first access). */
  book(planetId: string, pair: string): Promise<OrderBook<MarketOrderRecord>> {
    const k = keyOf(planetId, pair);
    let p = this.books.get(k);
    if (!p) {
      p = this.repo.listOpen(planetId, pair).then((list) => {
        const book = new OrderBook<MarketOrderRecord>(pair);
        for (const o of list) book.add(o);
        return book;
      });
      this.books.set(k, p);
      p.catch(() => this.books.delete(k));
    }
    return p;
  }

  /** Books currently loaded, as `{ planetId, pair }` keys. */
  async loadedPairs(): Promise<{ planetId: string; pair: string }[]> {
    const out: { planetId: string; pair: string }[] = [];
    for (const [k, p] of this.books) {
      const [planetId, pair] = k.split('\u0000') as [string, string];
      if (await p) out.push({ planetId, pair });
    }
    return out;
  }

  /** Re-reads orders from the database and applies them (call after a transaction that wrote them has committed). */
  async sync(...orderIds: string[]): Promise<void> {
    for (const id of orderIds) {
      const o = await this.repo.find(id);
      if (o) await this.apply(o);
    }
  }

  /** Puts a persisted order into (or takes it out of) its book according to its state. Idempotent. */
  async apply(order: MarketOrderRecord): Promise<void> {
    const loading = this.books.get(keyOf(order.planetId, order.pair));
    if (loading) { // not loaded: the first access reads the committed row
      const book = await loading;
      if (isBookable(order.state)) book.add(order);
      else book.remove(order.orderId);
    }
    for (const l of this.changeListeners) l({ planetId: order.planetId, pair: order.pair, order });
  }
}
