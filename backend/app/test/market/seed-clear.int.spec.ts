import { MarketColonies } from '../../src/market/orders/market-colonies.js';
import { MARKET_TOKENS, fromChainUnits, type MarketTokenKey } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { IntentTradeRepository } from '../../src/market/settlement/intent-trade.repository';
import { MarketOrderRepository } from '../../src/market/book/market-order.repository.js';
import { MarketFaucetService } from '../../src/market/dev/market-faucet.service.js';
import { MarketSeedService, botColonyId } from '../../src/market/dev/market-seed.service.js';
import { MarketMatcher } from '../../src/market/matching/market-matcher.service.js';
import { OrderRelease } from '../../src/market/orders/cancel-order.service.js';
import { LoggingMarketFillsHook } from '../../src/market/orders/market-fills.hook.js';
import { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider.js';
import { MarketSimGateway, type NearMarketCommandBusEvent } from '../../src/market/orders/market-sim-gateway.js';
import { OrderFunds } from '../../src/market/orders/order-funds.js';
import { PlaceOrderService } from '../../src/market/orders/place-order.service.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import type { CargoTokenPort } from '../../src/near/application/ports/cargo-token.port.js';
import type { IntentsBalanceReadPort } from '../../src/near/application/ports/intents-balance-read.port.js';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

function rig(waveOn = true, nodeEnv = 'test') {
  const bus = new EventBus();
  const cmds: NearMarketCommandBusEvent[] = [];
  bus.on('near.market.command', (c) => cmds.push(c), { module: 'test' });
  const repo = new MarketOrderRepository(db.prisma);
  const books = new MarketBooks(repo);
  const cargoPort = { balanceOf: () => Promise.resolve('0') } as unknown as CargoTokenPort;
  const verifierPort = {
    verifierBalance: async (a: string, t: MarketTokenKey) => {
      const r = await db.prisma.mockChainIntentsBalance.findUnique({ where: { accountId_tokenId: { accountId: a, tokenId: MARKET_TOKENS[t].verifierId } } });
      return fromChainUnits(t, r?.amount.toFixed(0) ?? '0');
    },
  } as IntentsBalanceReadPort;
  const funds = new OrderFunds(repo, cargoPort, verifierPort, new IntentTradeRepository(db.prisma));
  const gateway = new MarketSimGateway(bus);
  const env = { NODE_ENV: nodeEnv, DATABASE_URL: 'x' } as never;
  const place = new PlaceOrderService(bus, repo, books, new MarketMatcher(db.prisma, repo, books), funds, new ChainOutboxRepository(db.prisma),
    new MarketPolicyProvider(), gateway, new LoggingMarketFillsHook(), db.prisma, env);
  const faucet = new MarketFaucetService(db.prisma, env, { has: () => waveOn } as never, new MarketColonies(db.prisma, { isScenarioColonyPlanet: () => false } as never));
  const seed = new MarketSeedService(place, new OrderRelease(repo, books, gateway, db.prisma), faucet, new MarketPolicyProvider(), repo, db.prisma);
  return { seed, books, cmds, repo };
}

describe('market.seed / market.clear (W13-30)', () => {
  it('seeds 5 bids and 5 asks as a fixture bot, without touching the sim', async () => {
    const r = rig();
    const res = await r.seed.seed({ planetId: 'pl_seed', pair: 'bio.water/metals.t1' });
    expect(res).toMatchObject({ bids: 5, asks: 5, actorKind: 'fixture', botColonyId: botColonyId('pl_seed') });
    const book = await r.books.book('pl_seed', 'bio.water/metals.t1');
    expect(book.orders('buy')).toHaveLength(5);
    expect(book.orders('sell')).toHaveLength(5);
    expect(book.depth('buy', 10)).toHaveLength(5);
    const best = { bid: book.bestBid()!, ask: book.bestAsk()! };
    expect(best.bid.priceAmount * best.ask.amount).toBeLessThan(best.ask.priceAmount * best.bid.amount); // bids stay below asks
    const rows = await db.prisma.marketOrder.findMany({ where: { planetId: 'pl_seed' } });
    expect(rows).toHaveLength(10);
    expect(rows.every((o) => o.actorKind === 'fixture' && o.state === 'OPEN' && o.colonyId === botColonyId('pl_seed'))).toBe(true);
    expect(r.cmds).toHaveLength(0);
  });

  it('seeds a USDC pair, re-seeding replaces the ladder, clear cancels everything quietly', async () => {
    const r = rig();
    await r.seed.seed({ planetId: 'pl_usdc', pair: 'bio.water/USDC' });
    await r.seed.seed({ planetId: 'pl_usdc', pair: 'bio.water/USDC' });
    const open = async () => db.prisma.marketOrder.count({ where: { planetId: 'pl_usdc', state: { in: ['OPEN', 'PARTIAL'] } } });
    expect(await open()).toBe(10);
    expect(await r.seed.clear({ planetId: 'pl_usdc' })).toEqual({ planetId: 'pl_usdc', cancelled: 10 });
    expect(await open()).toBe(0);
    expect((await r.books.book('pl_usdc', 'bio.water/USDC')).size).toBe(0);
    const row = await db.prisma.marketOrder.findFirstOrThrow({ where: { planetId: 'pl_usdc', state: 'CANCELLED' } });
    expect([row.reservedPrincipal.toFixed(), row.reservedFees.toFixed()]).toEqual(['0', '0']);
    expect(r.cmds).toHaveLength(0);
  });

  it('is dev-only and W13-only; rejects bad pairs', async () => {
    await expect(rig(true, 'production').seed.seed({ planetId: 'p', pair: 'bio.water/USDC' })).rejects.toMatchObject({ status: 404 });
    await expect(rig(false).seed.seed({ planetId: 'p', pair: 'bio.water/USDC' })).rejects.toMatchObject({ status: 403 });
    await expect(rig().seed.seed({ planetId: 'p', pair: 'nope' })).rejects.toMatchObject({ status: 400 });
    await expect(rig(false).seed.clear({ planetId: 'p' })).rejects.toMatchObject({ status: 403 });
  });
});
