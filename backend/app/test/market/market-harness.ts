import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { MARKET_TOKENS, marketOrderRef, marketTradeOpId, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { OrderRelease } from '../../src/market/orders/cancel-order.service.js';
import type { NearMarketCommandBusEvent } from '../../src/market/orders/market-sim-gateway.js';
import { OrderFunds } from '../../src/market/orders/order-funds.js';
import { PlaceOrderService } from '../../src/market/orders/place-order.service.js';
import { IntentTradeRepository } from '../../src/market/settlement/intent-trade.repository.js';
import { TradeRecovery } from '../../src/market/settlement/trade-recovery.service.js';
import { TradeSettlement, type MarketTradeBusEvent } from '../../src/market/settlement/trade-settlement.service.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { IntentsPort } from '../../src/near/application/ports/intents.port.js';
import type { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';

export const WATER = MARKET_TOKENS['bio.water'].verifierId;
export const USDC = MARKET_TOKENS.USDC.verifierId;
export const acct = (c: string): string => `${c}.terraagent.mock`;

export interface Harness {
  db: TestDatabase; app: INestApplication; place: PlaceOrderService; relay: OutboxRelayService; settlement: TradeSettlement;
  recovery: TradeRecovery; intents: MockIntentsAdapter; trades: IntentTradeRepository; funds: OrderFunds; release: OrderRelease; bus: EventBus;
  cmds: NearMarketCommandBusEvent[]; pushes: MarketTradeBusEvent[];
  colony(name: string, opts: { water?: bigint; usdc?: bigint }): Promise<void>;
  order(planetId: string, colony: string, over: Record<string, unknown>): PlanetEventOf<'marketOrderRequested'>;
  /** A seller offers 300 water for 5 USDC; a buyer bids the same with maxStall 100 bp. Returns the PENDING trade and both order ids. */
  matched(n: number, opts?: { buyerUsdc?: bigint }): Promise<{ planetId: string; seller: string; buyer: string; tradeId: string; askId: string; bidId: string }>;
  verifier(account: string, tokenId: string): Promise<string>;
  order$(orderId: string): Promise<NonNullable<Awaited<ReturnType<TestDatabase['prisma']['marketOrder']['findUnique']>>>>;
  setVerifier(account: string, tokenId: string, atomic: bigint): Promise<void>;
  close(): Promise<void>;
}

export async function bootHarness(): Promise<Harness> {
  const db = await createTestDatabase();
  const { app } = await createApp({
    source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'off', DATABASE_URL: db.url, OUTBOX_RELAY_ENABLED: 'false', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0' },
  });
  await app.init();
  const intents = app.get(IntentsPort, { strict: false }) as unknown as MockIntentsAdapter;
  const bus = app.get(EventBus);
  const cmds: NearMarketCommandBusEvent[] = [];
  const pushes: MarketTradeBusEvent[] = [];
  bus.on('near.market.command', (c) => cmds.push(c), { module: 'harness' });
  bus.on('market.trade', (p) => pushes.push(p), { module: 'harness' });
  let seq = 0;
  const h: Harness = {
    db, app, intents, bus, cmds, pushes, place: app.get(PlaceOrderService), relay: app.get(OutboxRelayService), settlement: app.get(TradeSettlement),
    recovery: app.get(TradeRecovery), trades: app.get(IntentTradeRepository), funds: app.get(OrderFunds), release: app.get(OrderRelease),
    async colony(name, opts) {
      await intents.testRegisterSigner(acct(name));
      if (opts.water) await intents.testSeedVerifier(acct(name), WATER, toChainUnits('bio.water', opts.water));
      if (opts.usdc) await intents.testSeedVerifier(acct(name), USDC, opts.usdc);
    },
    order(planetId, colony, over) {
      const orderSeq = ++seq;
      return {
        planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colony],
        data: { ref: marketOrderRef(colony, orderSeq), orderSeq, colonyId: colony, colonyIndex: colony.startsWith('s') ? 0 : 1, resource: 'bio.water', amount: 300, ttlS: 3600, stallFeeBp: 100, hubEntityId: 3, ...over },
      } as unknown as PlanetEventOf<'marketOrderRequested'>;
    },
    async matched(n, opts = {}) {
      const planetId = `pr${n}`;
      const [seller, buyer] = [`s${n}`, `b${n}`];
      await h.colony(seller, { water: 300n });
      await h.colony(buyer, { usdc: opts.buyerUsdc ?? 10_000_000n });
      const ask = (await h.place.handle(h.order(planetId, seller, { side: 'sell', price: { token: 'USDC', amount: '5000000' } })))!;
      const bid = (await h.place.handle(h.order(planetId, buyer, { side: 'buy', price: { token: 'USDC', amount: '5000000' }, maxStallFeeBp: 100 })))!;
      const row = (await db.prisma.intentTrade.findMany({ where: { planetId } }))[0]!;
      return { planetId, seller, buyer, tradeId: row.tradeId, askId: ask.order.orderId, bidId: bid.order.orderId };
    },
    async verifier(account, tokenId) {
      return (await db.prisma.mockChainIntentsBalance.findUnique({ where: { accountId_tokenId: { accountId: account, tokenId } } }))?.amount.toFixed() ?? '0';
    },
    async setVerifier(account, tokenId, atomic) {
      await db.prisma.mockChainIntentsBalance.updateMany({ where: { accountId: account, tokenId }, data: { amount: atomic.toString() } });
    },
    order$: (orderId) => db.prisma.marketOrder.findUniqueOrThrow({ where: { orderId } }),
    async close() { await app.close(); await db.drop(); },
  };
  return h;
}

export const opIdOf = marketTradeOpId;
