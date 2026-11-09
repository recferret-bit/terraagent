import { Inject, Injectable } from '@nestjs/common';
import { withTransaction, type PrismaClient, type TransactionClient } from '@terra/db';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { matchIncoming, type Fill } from '@terra/sim/systems/trade/market-matcher';
import { PRISMA } from '../../db/db.module.js';
import { MarketBooks } from '../book/market-books.js';
import { isBookable, type MarketOrderRecord } from '../book/market-order.record.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';

export interface MatchOutcome {
  /** The incoming order as locked and re-read (null when it does not exist). */
  readonly incoming: MarketOrderRecord | null;
  /** Fills in priority order against the locked, re-read makers; nothing is written. */
  readonly fills: Fill[];
  /** Base units of the incoming order left unfilled after the fills. */
  readonly restingRemainder: bigint;
  /** Locked makers' rows by order id, as read under the lock (fill updates start from these). */
  readonly makers: ReadonlyMap<string, MarketOrderRecord>;
}

const MAX_ATTEMPTS = 5;

/** The book without orders whose TTL has run out (the sweep expires them within 30 s; until then they must not fill). The book itself is untouched. */
export function executableView(book: OrderBook<MarketOrderRecord>, nowMs: number): OrderBook<MarketOrderRecord> {
  const all = [...book.orders('buy'), ...book.orders('sell')];
  if (!all.some((o) => o.expiresAt.getTime() <= nowMs)) return book;
  const live = new OrderBook<MarketOrderRecord>(book.pair);
  for (const o of all) if (o.expiresAt.getTime() > nowMs) live.add(o);
  return live;
}
const same = (a: MarketOrderRecord, b: MarketOrderRecord): boolean =>
  a.state === b.state && a.filled === b.filled && a.amount === b.amount;

/**
 * Finds the fills of a newly OPEN order. It previews against the in-memory book, locks the incoming and candidate
 * maker rows (`SELECT … FOR UPDATE`), re-reads them and re-runs the shared matcher on the locked rows; when a row
 * changed meanwhile it resyncs the book and retries. It only reads and locks: building legs and writing fills is
 * W13-12/13. Pass the caller's `tx` so the locks live until the caller's own writes commit; without one the locks
 * end with this call. After the caller commits fill updates it must `MarketBooks.sync(...)` the touched orders.
 */
@Injectable()
export class MarketMatcher {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly repo: MarketOrderRepository,
    private readonly books: MarketBooks,
  ) {}

  matchOrder(orderId: string, tx?: TransactionClient): Promise<MatchOutcome> {
    return withTransaction(tx ?? this.prisma, async (t) => {
      // One matcher per (planet, pair) at a time: incoming-first / makers-second row locking of two crossing orders deadlocks otherwise.
      const head = await t.marketOrder.findUnique({ where: { orderId }, select: { planetId: true, pair: true } });
      if (head) await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`market-match:${head.planetId}:${head.pair}`}, 0))`;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const out = await this.attempt(orderId, t);
        if (out) return out;
      }
      throw new Error(`market matching of ${orderId} did not stabilise after ${MAX_ATTEMPTS} attempts`);
    });
  }

  private async attempt(orderId: string, tx: TransactionClient): Promise<MatchOutcome | null> {
    const [locked] = await this.repo.lockForUpdate([orderId], tx);
    const empty = { fills: [], restingRemainder: 0n, makers: new Map<string, MarketOrderRecord>() };
    if (!locked) return { incoming: null, ...empty };
    if (!isBookable(locked.state)) return { incoming: locked, ...empty, restingRemainder: locked.amount - locked.filled };
    const book = await this.books.book(locked.planetId, locked.pair);
    const preview = matchIncoming(executableView(book, Date.now()), locked); // a quote past its TTL is not executable before the sweep expires it
    const ids = [...new Set(preview.fills.map((f) => f.makerOrderId))];
    const rows = await this.repo.lockForUpdate(ids, tx);
    const fresh = new Map(rows.map((r) => [r.orderId, r]));
    const stale = ids.filter((id) => {
      const mem = book.get(id);
      const row = fresh.get(id);
      return !mem || !row || !same(mem, row);
    });
    if (stale.length === 0) {
      // Preview was against current rows (the incoming order itself may differ from the book copy).
      return { incoming: locked, fills: preview.fills, restingRemainder: preview.restingRemainder, makers: fresh };
    }
    for (const id of stale) {
      const row = fresh.get(id);
      if (row) await this.books.apply(row);
      else book.remove(id);
    }
    return null;
  }
}
