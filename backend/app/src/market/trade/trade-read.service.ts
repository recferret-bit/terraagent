import { Inject, Injectable } from '@nestjs/common';
import {
  type BookLevel, isResourceToken, parsePairId, MARKET_TOKEN_KEYS, TRADE_OVERVIEW_MAX_PAIRS, type TradeOverviewRow, type ListTradeOrdersQuery, type TradeBookOrdersResponse, type TokenBalance, type TradeBalancesResponse, type TradeBoardResponse, type TradeBookResponse,
  type TradeFillsResponse, type TradeOrdersResponse, type TradeOverviewResponse, type TradePairsResponse, type TradePolicyResponse, type MarketTokenKey, type ResourceKey,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { colonyFunds } from '../api/colony-funds.js';
import { MarketBookPush } from '../api/market-book-push.service.js';
import { MarketSnapshotService } from '../api/market-snapshot.service.js';
import { MarketBooks } from '../book/market-books.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { OrderFunds } from '../orders/order-funds.js';
import { DEFAULT_KEY_RATE, SESSION_RATE, TradeAuth, type TradePrincipal } from './trade-auth.js';
import { TradeError } from './trade-error.js';
import { TradeOrdersService } from './trade-orders.service.js';
import { bookOrderView } from './trade-book-orders.js';
import { tradeFillView, tradeOrderView } from './trade-views.js';

export const MAX_BOOK_LEVELS = 50;
const OPEN_STATES = ['PENDING', 'OPEN', 'PARTIAL'];

/** Read side of the trade API: own orders, fills and balances (only the caller's colony), public book, board, pairs and policy. */
@Injectable()
export class TradeReadService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly orders: TradeOrdersService,
    private readonly funds: OrderFunds,
    private readonly books: MarketBooks,
    private readonly push: MarketBookPush,
    private readonly snapshots: MarketSnapshotService,
    private readonly policy: MarketPolicyProvider,
  ) {}

  async listOrders(p: TradePrincipal, q: ListTradeOrdersQuery & { planetId?: string }): Promise<TradeOrdersResponse> {
    this.orders.gate();
    TradeAuth.require(p, 'read');
    const planetId = this.orders.planetOf(p, q.planetId);
    const colony = await this.orders.colonyOrThrow(p, planetId);
    const state = q.state === undefined ? {} : q.state === 'open' ? { state: { in: OPEN_STATES } } : { state: q.state };
    const rows = await this.prisma.marketOrder.findMany({ where: { colonyId: colony.colonyId, planetId, ...(q.pair ? { pair: q.pair } : {}), ...state }, orderBy: { id: 'desc' }, take: q.limit ?? 50 });
    return { orders: rows.map(tradeOrderView) };
  }

  async listFills(p: TradePrincipal, planetIdIn: string | undefined, limit = 50): Promise<TradeFillsResponse> {
    this.orders.gate();
    TradeAuth.require(p, 'read');
    const planetId = this.orders.planetOf(p, planetIdIn);
    const colony = await this.orders.colonyOrThrow(p, planetId);
    const rows = await this.prisma.intentTrade.findMany({
      where: { planetId, OR: [{ buyerColonyId: colony.colonyId }, { sellerColonyId: colony.colonyId }] }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 200),
    });
    return { fills: rows.map((t) => tradeFillView(t, colony.colonyId)) };
  }

  /** Quote tokens come from the verifier; `inOrbit` is ONLY this colony's resources (cargo account + verifier balance, whole units), reserved by its open sell orders vs free. Same figures as `GET /v1/market/:planet`. */
  async balances(p: TradePrincipal, planetIdIn: string | undefined): Promise<TradeBalancesResponse> {
    this.orders.gate();
    TradeAuth.require(p, 'read');
    const planetId = this.orders.planetOf(p, planetIdIn);
    const colony = await this.orders.colonyOrThrow(p, planetId);
    const views = await colonyFunds(this.funds, colony);
    const quote: Partial<Record<MarketTokenKey, TokenBalance>> = {};
    const inOrbit: Partial<Record<ResourceKey, TokenBalance>> = {};
    for (const token of MARKET_TOKEN_KEYS) {
      const v = views[token];
      if (v.verifier === 0n && v.cargo === 0n && v.reserved === 0n) continue;
      // The same numbers as `GET /v1/market/:planet` (`balances` = free, `reserved`): free already nets reservations and in-flight debits.
      const entry = { free: v.free.toString(), reserved: v.reserved.toString(), total: (v.cargo + v.verifier).toString() };
      if (isResourceToken(token)) inOrbit[token] = entry;
      else quote[token] = entry;
    }
    return { planetId, colonyId: colony.colonyId, quote, inOrbit };
  }

  async book(planetId: string, pair: string, levelsIn: number | undefined): Promise<TradeBookResponse> {
    this.orders.gate();
    if (!parsePairId(pair) || !this.policy.current().pairs.some((x) => x.pair === pair)) throw new TradeError('invalid_request', `Unknown pair ${pair}.`, { pair });
    const levels = Math.min(Math.max(Math.trunc(levelsIn ?? this.policy.current().bookDepthLevels), 1), MAX_BOOK_LEVELS);
    const book = await this.books.readBook(planetId, pair);
    const ref = await this.orders.reference(planetId, pair);
    return {
      planetId, pair, seq: this.push.seqOf(planetId, pair), bids: book.depth('buy', levels), asks: book.depth('sell', levels),
      reference: ref ? { num: ref.num.toString(), den: Number(ref.den) } : null,
    };
  }

  /** Every resting order of a pair, best price first per side (bids, then asks). `mine` only for an authenticated caller (`principal`). */
  async bookOrders(planetId: string, pair: string, q: { side?: 'buy' | 'sell'; limit: number }, principal: TradePrincipal | null): Promise<TradeBookOrdersResponse> {
    this.orders.gate();
    if (!parsePairId(pair) || !this.policy.current().pairs.some((x) => x.pair === pair)) throw new TradeError('invalid_request', `Unknown pair ${pair}.`, { pair });
    if (principal) TradeAuth.require(principal, 'read');
    const mine = principal ? ((await principal.colonyFor(planetId))?.colonyId ?? null) : undefined;
    const book = await this.books.readBook(planetId, pair);
    const all = (q.side ? [q.side] : (['buy', 'sell'] as const)).flatMap((side) => book.orders(side));
    return { planetId, pair, seq: this.push.seqOf(planetId, pair), orders: all.slice(0, q.limit).map((o) => bookOrderView(o, mine)), truncated: all.length > q.limit };
  }

  async board(planetId: string): Promise<TradeBoardResponse> {
    this.orders.gate();
    return { planetId, board: await this.snapshots.boardRows(planetId) };
  }

  /** All pairs in one answer from the in-memory books and the cached price board (same sources as `book` and `board`). One query finds the pairs that have resting orders; only those books are read (8 at a time), so a probe of an unknown planet costs one cheap query. */
  async overview(planetId: string): Promise<TradeOverviewResponse> {
    this.orders.gate();
    const pairs = this.policy.current().pairs.slice(0, TRADE_OVERVIEW_MAX_PAIRS);
    const [boardRows, active] = await Promise.all([
      this.snapshots.boardRows(planetId),
      this.prisma.marketOrder.findMany({ where: { planetId, state: { in: ['OPEN', 'PARTIAL'] } }, distinct: ['pair'], select: { pair: true } }),
    ]);
    const board = new Map(boardRows.map((r) => [r.pair, r]));
    const live = new Set(active.map((a) => a.pair));
    const top = new Map<string, { bid: BookLevel | null; ask: BookLevel | null }>();
    const todo = pairs.filter((p) => live.has(p.pair));
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < todo.length; i = next++) {
        const book = await this.books.readBook(planetId, todo[i]!.pair);
        top.set(todo[i]!.pair, { bid: book.depth('buy', 1)[0] ?? null, ask: book.depth('sell', 1)[0] ?? null });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, todo.length) }, worker));
    const overview = pairs.map((p): TradeOverviewRow => {
      const t = top.get(p.pair);
      const row = board.get(p.pair);
      return { pair: p.pair, bestBid: t?.bid ?? null, bestAsk: t?.ask ?? null, last: row?.last ?? null, volume24h: row?.volume24h ?? 0 };
    });
    return { planetId, overview };
  }

  pairs(): TradePairsResponse {
    this.orders.gate();
    return { pairs: this.policy.current().pairs.map((x) => ({ pair: x.pair, base: x.base, quote: x.quote, lot: x.lotUnits, minNotionalAtomic: x.minNotionalAtomic })) };
  }

  policyView(p: TradePrincipal | null): TradePolicyResponse {
    this.orders.gate();
    const rate = p?.key ? { perSecond: p.key.ratePerSecond ?? DEFAULT_KEY_RATE.perSecond, burst: p.key.rateBurst ?? DEFAULT_KEY_RATE.burst } : p ? SESSION_RATE : DEFAULT_KEY_RATE;
    return { policy: this.snapshots.policyView(), rateLimit: { perSecond: rate.perSecond, burst: rate.burst } };
  }
}
