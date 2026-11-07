import { Inject, Injectable } from '@nestjs/common';
import {
  isResourceToken, parsePairId, MARKET_TOKEN_KEYS, type ListTradeOrdersQuery, type TokenBalance, type TradeBalancesResponse, type TradeBoardResponse, type TradeBookResponse,
  type TradeFillsResponse, type TradeOrdersResponse, type TradePairsResponse, type TradePolicyResponse, type MarketTokenKey, type ResourceKey,
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

  /** Quote tokens come from the verifier; `inOrbit` is ONLY this colony's cargo account (whole units), reserved by its open sell orders vs free. */
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
      if (isResourceToken(token)) {
        if (v.cargo === 0n) continue;
        const reserved = v.reserved < v.cargo ? v.reserved : v.cargo;
        inOrbit[token] = { free: (v.cargo - reserved).toString(), reserved: reserved.toString(), total: v.cargo.toString() };
      } else if (v.verifier > 0n || v.reserved > 0n) {
        quote[token] = { free: v.free.toString(), reserved: v.reserved.toString(), total: v.verifier.toString() };
      }
    }
    return { planetId, colonyId: colony.colonyId, quote, inOrbit };
  }

  async book(planetId: string, pair: string, levelsIn: number | undefined): Promise<TradeBookResponse> {
    this.orders.gate();
    if (!parsePairId(pair) || !this.policy.current().pairs.some((x) => x.pair === pair)) throw new TradeError('invalid_request', `Unknown pair ${pair}.`, { pair });
    const levels = Math.min(Math.max(Math.trunc(levelsIn ?? this.policy.current().bookDepthLevels), 1), MAX_BOOK_LEVELS);
    const book = await this.books.book(planetId, pair);
    const ref = await this.orders.reference(planetId, pair);
    return {
      planetId, pair, seq: this.push.seqOf(planetId, pair), bids: book.depth('buy', levels), asks: book.depth('sell', levels),
      reference: ref ? { num: ref.num.toString(), den: Number(ref.den) } : null,
    };
  }

  async board(planetId: string): Promise<TradeBoardResponse> {
    this.orders.gate();
    return { planetId, board: await this.snapshots.boardRows(planetId) };
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
