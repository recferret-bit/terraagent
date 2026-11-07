import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PriceBoardRow } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { defaultBoardLimits, marketBoard, type BoardLimits } from '@terra/sim/systems/trade/market-board';
import { EventBus } from '../../bus/event-bus.js';
import { PRISMA } from '../../db/db.module.js';
import { actorStats, type ActorTrade } from './board-actors.js';

/** Cached boards also expire by time: staleness changes while no trade arrives. */
export const BOARD_CACHE_TTL_MS = 5_000;

interface Cached { readonly at: number; readonly rows: PriceBoardRow[] }

/**
 * Price board of a planet (W13-18): loads the FINAL trades of the board window from `chain.intent_trade` and runs the pure
 * `marketBoard` (`@terra/sim`). Cached per planet; the `market.trade` push `TradeSettlement` emits for every trade it
 * finalizes invalidates that planet's cache, so settlement itself is untouched.
 */
@Injectable()
export class PriceBoardService implements OnModuleInit, OnModuleDestroy {
  private readonly cache = new Map<string, Cached>();
  private off: (() => void) | null = null;
  /** Test seam. */
  now: () => number = Date.now;
  limits: BoardLimits = defaultBoardLimits();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.off ??= this.bus.on('market.trade', (e) => this.invalidate(e.planetId), { module: 'market.board' });
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
  }

  invalidate(planetId: string): void {
    this.cache.delete(planetId);
  }

  async board(planetId: string): Promise<PriceBoardRow[]> {
    const now = this.now();
    const hit = this.cache.get(planetId);
    if (hit && now - hit.at < BOARD_CACHE_TTL_MS) return hit.rows;
    const trades = await this.loadTrades(planetId, now);
    const rows = marketBoard(trades, now, this.limits).map((r) => ({ ...r, ...actorStats(r.pair, trades, now, this.limits) }));
    this.cache.set(planetId, { at: now, rows });
    return rows;
  }

  private async loadTrades(planetId: string, now: number): Promise<ActorTrade[]> {
    const since = new Date(now - this.limits.windowS * 1000);
    const rows = await this.prisma.intentTrade.findMany({
      where: { planetId, state: 'FINAL', settledAt: { gt: since } },
      orderBy: { settledAt: 'asc' },
      select: { pair: true, amount: true, notional: true, settledAt: true, organic: true, buyerColonyId: true, sellerColonyId: true, buyerActorKind: true, sellerActorKind: true },
    });
    return rows.map((r) => ({
      pair: r.pair, amount: BigInt(r.amount.toFixed()), notional: BigInt(r.notional.toFixed()), atMs: r.settledAt!.getTime(),
      organic: r.organic, buyerId: r.buyerColonyId, sellerId: r.sellerColonyId, buyerKind: r.buyerActorKind, sellerKind: r.sellerActorKind,
    }));
  }
}
