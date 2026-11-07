import { Inject, Injectable } from '@nestjs/common';
import type { TradeStreamEvent } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import { PRISMA } from '../../db/db.module.js';
import type { HttpRes } from '../../core/logging/request-id.js';
import { MarketBooks } from '../book/market-books.js';
import type { MarketTradeBusEvent } from '../settlement/trade-settlement.service.js';
import { TradeAuth, type TradePrincipal } from './trade-auth.js';
import { TradeError } from './trade-error.js';
import { TradeOrdersService } from './trade-orders.service.js';
import { tradeFillView, tradeOrderView } from './trade-views.js';

export const STREAM_HEARTBEAT_MS = 15_000;
/** Open SSE connections one caller (key or session) may hold: each registers bus handlers and a timer. */
export const MAX_STREAMS_PER_CALLER = 5;

/**
 * Server-sent events of `GET /v1/trade/stream`: the caller's own order state changes and fills, plus the book updates of the
 * planet (optionally filtered by pair). Fed by the same hooks as the WS pushes (`MarketBooks.onChange`, bus `market.book` /
 * `market.trade`); nothing here polls. Each event is `data: <TradeStreamEvent JSON>`.
 */
@Injectable()
export class TradeStreamService {
  private readonly open_ = new Map<string, Set<{ res: HttpRes; keyId: string | null }>>();

  constructor(
    private readonly bus: EventBus,
    private readonly books: MarketBooks,
    private readonly orders: TradeOrdersService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async open(p: TradePrincipal, res: HttpRes, planetIdIn: string | undefined, pairs: readonly string[]): Promise<void> {
    this.orders.gate();
    TradeAuth.require(p, 'read');
    const planetId = this.orders.planetOf(p, planetIdIn);
    const colony = await this.orders.colonyOrThrow(p, planetId);
    const mine = this.open_.get(p.ownerRef) ?? new Set();
    if (mine.size >= MAX_STREAMS_PER_CALLER) throw new TradeError('too_many_streams', `At most ${MAX_STREAMS_PER_CALLER} open streams per caller.`, { max: MAX_STREAMS_PER_CALLER });
    const entry = { res, keyId: p.key?.keyId ?? null };
    mine.add(entry);
    this.open_.set(p.ownerRef, mine);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (e: TradeStreamEvent): void => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
    const wanted = (pair: string): boolean => pairs.length === 0 || pairs.includes(pair);
    send({ type: 'hello', planetId, serverTimeMs: Date.now() });
    const offs = [
      this.books.onChange((c) => {
        if (c.planetId !== planetId || c.order.colonyId !== colony.colonyId || !wanted(c.pair)) return;
        void this.prisma.marketOrder.findUnique({ where: { orderId: c.order.orderId } }).then((row) => row && send({ type: 'order', order: tradeOrderView(row) }));
      }),
      this.bus.on('market.book', (e) => { if (e.planetId === planetId && wanted(e.payload.pair)) send({ type: 'book', book: e.payload }); }, { module: 'TradeStream' }),
      this.bus.on('market.trade', (e: MarketTradeBusEvent) => {
        if (e.planetId !== planetId || !wanted(e.payload.trade.pair)) return;
        void this.prisma.intentTrade.findUnique({ where: { tradeId: e.payload.trade.tradeId } }).then((t) => {
          if (t && (t.buyerColonyId === colony.colonyId || t.sellerColonyId === colony.colonyId)) send({ type: 'fill', planetId, fill: tradeFillView(t, colony.colonyId) });
        });
      }, { module: 'TradeStream' }),
    ];
    const beat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, STREAM_HEARTBEAT_MS);
    beat.unref();
    res.on('close', () => {
      clearInterval(beat);
      for (const off of offs) off();
      mine.delete(entry);
      if (mine.size === 0 && this.open_.get(p.ownerRef) === mine) this.open_.delete(p.ownerRef);
    });
  }

  /** Ends every stream of a revoked key (a long-lived connection must not outlive the key's authority). */
  closeKey(keyId: string): void {
    for (const set of this.open_.values()) for (const e of [...set]) if (e.keyId === keyId && !e.res.writableEnded) e.res.end();
  }
}
