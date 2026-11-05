import { Inject, Injectable } from '@nestjs/common';
import {
  MARKET_TOKEN_KEYS, type MarketBookPayload, type MarketPolicyView, type MarketSnapshotResponse, type MarketTokenKey, type MyOrderView,
  type PriceBoardRow, type QuoteToken, type TradeView,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import type { MarketOrderRecord } from '../book/market-order.record.js';
import { PriceBoardService } from '../board/price-board.service.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { OrderFunds } from '../orders/order-funds.js';
import { IntentTradeRepository } from '../settlement/intent-trade.repository.js';
import { MarketBookPush } from './market-book-push.service.js';
import type { MarketCaller } from './market-caller.js';

export const RECENT_TRADES = 50;

type TradeRow = Awaited<ReturnType<IntentTradeRepository['recentFinal']>>[number];

const tradeView = (t: TradeRow): TradeView => ({
  tradeId: t.tradeId, pair: t.pair, base: t.base as TradeView['base'], quote: t.quote as TradeView['quote'], amount: Number(t.amount.toFixed()),
  notional: t.notional.toFixed(), platformFee: t.platformFee.toFixed(), stallFee: t.stallFee.toFixed(), stallFeeBp: t.stallFeeBp,
  makerSide: t.makerSide as TradeView['makerSide'], state: 'FINAL', organic: t.organic,
  ...(t.txHash ? { txHash: t.txHash } : {}), atMs: (t.settledAt ?? t.createdAt).getTime(),
});

const myOrderView = (o: MarketOrderRecord): MyOrderView => ({
  orderId: o.orderId, ref: o.ref, pair: o.pair, side: o.side, resource: o.base as MyOrderView['resource'], amount: Number(o.amount), filled: Number(o.filled),
  price: { token: o.quote as QuoteToken, amount: o.priceAmount.toString() }, state: o.state as MyOrderView['state'], fillPolicy: o.fillPolicy as MyOrderView['fillPolicy'],
  policyVersion: o.policyVersion, platformFeeBp: o.platformFeeBp, stallFeeBp: o.stallFeeBp, reserved: (o.reservedPrincipal + o.reservedFees).toString(),
  expiresAtMs: o.expiresAt.getTime(), createdAtMs: o.createdAt.getTime(),
});

const insufficient = (pair: string): PriceBoardRow => ({ pair, last: null, change24hBp: null, volume24h: 0, vwap: null, candles1h: [], classification: 'insufficient_data', reason: 'insufficient_data' });

/** `GET /v1/market/{planetId}` (W13-19): book depth, price board, recent trades, policy and (for a caller with a colony) own orders, balances and stall. */
@Injectable()
export class MarketSnapshotService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly push: MarketBookPush,
    private readonly board: PriceBoardService,
    private readonly trades: IntentTradeRepository,
    private readonly policy: MarketPolicyProvider,
    private readonly orders: MarketOrderRepository,
    private readonly funds: OrderFunds,
  ) {}

  async snapshot(planetId: string, caller: MarketCaller | null): Promise<MarketSnapshotResponse> {
    const [books, board, recent] = await Promise.all([this.books(planetId), this.boardRows(planetId), this.trades.recentFinal(planetId, RECENT_TRADES)]);
    const out: MarketSnapshotResponse = { planetId, books, board, recentTrades: recent.map(tradeView), policy: this.policyView() };
    if (caller?.colony) Object.assign(out, await this.mine(planetId, caller.colony));
    return out;
  }

  private async books(planetId: string): Promise<MarketBookPayload[]> {
    const pairs = await this.prisma.marketOrder.findMany({ where: { planetId, state: { in: ['OPEN', 'PARTIAL'] } }, distinct: ['pair'], select: { pair: true }, orderBy: { pair: 'asc' } });
    return Promise.all(pairs.map((p) => this.push.payload(planetId, p.pair, this.push.seqOf(planetId, p.pair))));
  }

  private async boardRows(planetId: string): Promise<PriceBoardRow[]> {
    const rows = new Map((await this.board.board(planetId)).map((r) => [r.pair, r]));
    return this.policy.current().pairs.map((p) => rows.get(p.pair) ?? insufficient(p.pair));
  }

  policyView(): MarketPolicyView {
    const c = this.policy.current();
    const minNotional: Partial<Record<QuoteToken, string>> = {};
    for (const p of c.pairs) minNotional[p.quote] ??= p.minNotionalAtomic;
    return {
      policyVersion: c.policyVersion, policyHash: c.policyHash, platformFeeBp: c.platformFeeBp, stallFeeMaxBp: c.stallFeeMaxBp, stallFeeDefaultBp: c.stallFeeDefaultBp,
      ttlOptionsS: [...c.ttlOptionsS], openOrderLimit: c.openOrderLimit, minNotional,
    };
  }

  private async mine(planetId: string, colony: NonNullable<MarketCaller['colony']>): Promise<Partial<MarketSnapshotResponse>> {
    const open = await this.orders.listOpenByColony(colony.colonyId);
    const balances: Partial<Record<MarketTokenKey, string>> = {};
    const reserved: Partial<Record<MarketTokenKey, string>> = {};
    await Promise.all(MARKET_TOKEN_KEYS.map(async (token) => {
      const v = await this.funds.view(colony.accountId, colony.colonyId, token);
      if (v.free > 0n) balances[token] = v.free.toString();
      if (v.reserved > 0n) reserved[token] = v.reserved.toString();
    }));
    const stall = await this.prisma.marketStall.findUnique({ where: { planetId_colonyId: { planetId, colonyId: colony.colonyId } }, select: { feeBp: true } });
    const earned = await this.trades.stallEarned(planetId, colony.colonyId);
    return {
      myOrders: open.filter((o) => o.planetId === planetId).map(myOrderView), balances, reserved,
      stall: { hubFeeBp: stall?.feeBp ?? this.policy.current().stallFeeDefaultBp, earned },
    };
  }
}
