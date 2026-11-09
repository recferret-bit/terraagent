import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { MarketBookPayload } from '@terra/contracts';
import { EventBus } from '../../bus/event-bus.js';
import { MarketBooks } from '../book/market-books.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';

/** `market.book` push: one message per (planet, pair), broadcast to the planet's sockets by `WsGateway`. */
export interface MarketBookBusEvent {
  readonly planetId: string;
  readonly payload: MarketBookPayload;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'market.book': MarketBookBusEvent;
  }
}

const keyOf = (planetId: string, pair: string): string => `${planetId}\u0000${pair}`;

/**
 * Throttles book changes (place/fill/cancel/expire) to `bookPushHz` per (planet, pair), leading and trailing: when the pair
 * has not been pushed for a whole window (`1000 / hz` ms) the push goes out at once; otherwise one push is scheduled at the
 * end of the window carrying the book as it is then (so every order placed inside the window is in it). At most one push per
 * pair and window. `seq` is monotonic per planet and pair.
 */
@Injectable()
export class MarketBookPush implements OnModuleInit, OnModuleDestroy {
  private off: (() => void) | null = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastPush = new Map<string, number>();
  /** Test seam. */
  now: () => number = () => Date.now();
  private readonly seqs = new Map<string, number>();

  constructor(
    private readonly books: MarketBooks,
    private readonly bus: EventBus,
    private readonly policy: MarketPolicyProvider,
  ) {}

  onModuleInit(): void {
    this.off ??= this.books.onChange((c) => this.touch(c.planetId, c.pair));
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Pushes now when the pair is quiet, else schedules one push at the end of the current window. */
  touch(planetId: string, pair: string): void {
    const key = keyOf(planetId, pair);
    if (this.timers.has(key)) return;
    const windowMs = Math.ceil(1000 / this.policy.current().bookPushHz);
    const wait = (this.lastPush.get(key) ?? -Infinity) + windowMs - this.now();
    if (wait <= 0) {
      this.lastPush.set(key, this.now());
      void this.push(planetId, pair).catch(() => undefined);
      return;
    }
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      this.lastPush.set(key, this.now());
      void this.push(planetId, pair).catch(() => undefined);
    }, wait));
  }

  /** Current depth of a pair as a `market.book` payload (also the REST snapshot's book). */
  async payload(planetId: string, pair: string, seq: number): Promise<MarketBookPayload> {
    const levels = this.policy.current().bookDepthLevels;
    const book = await this.books.book(planetId, pair);
    return { planetId, pair, bids: book.depth('buy', levels), asks: book.depth('sell', levels), seq };
  }

  private async push(planetId: string, pair: string): Promise<void> {
    const key = keyOf(planetId, pair);
    const seq = (this.seqs.get(key) ?? 0) + 1;
    this.seqs.set(key, seq);
    this.bus.emit('market.book', { planetId, payload: await this.payload(planetId, pair, seq) });
  }

  /** Last `seq` pushed for a pair (a snapshot carries it so a client drops older pushes). */
  seqOf(planetId: string, pair: string): number {
    return this.seqs.get(keyOf(planetId, pair)) ?? 0;
  }
}
