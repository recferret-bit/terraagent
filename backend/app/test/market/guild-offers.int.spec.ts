import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { ModuleRef } from '@nestjs/core';
import { MARKET_TOKENS, marketTradeOpId, pairId, toChainUnits, type GuildOffer, type MarketTokenKey, type TradeOverviewResponse } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketOrderRepository } from '../../src/market/book/market-order.repository.js';
import { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';
import { GuildMakerService } from '../../src/market/guild/maker/guild-maker.service.js';
import { GuildOrderBook } from '../../src/market/guild/maker/order-book.js';
import { tier1BarterPairs, TIER1_RESOURCES } from '../../src/market/guild/maker/pairs.js';
import { AcceptGuildOfferService } from '../../src/market/guild/offers/accept-guild-offer.service.js';
import { GuildOffersService } from '../../src/market/guild/offers/guild-offers.service.js';
import { parseGuildOfferId } from '../../src/market/guild/offers/offer-id.js';
import { OrderRelease } from '../../src/market/orders/cancel-order.service.js';
import { MarketSimGateway } from '../../src/market/orders/market-sim-gateway.js';
import { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';
import { GuildVisitPublisher } from '../../src/market/guild/visit/guild-visit.publisher.js';
import { IntentTradeRepository } from '../../src/market/settlement/intent-trade.repository.js';
import { SettlementFillsHook } from '../../src/market/settlement/settlement-fills.hook.js';
import { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import type { SignedIntent } from '../../src/near/application/ports/intents.port.js';
import { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';

const PLANET = 'pl_guild_offer';
const DEPART = 1_900_000_000_000;
const on = { has: (wave: string) => wave === 'W15' || wave === 'W13', flags: { has: (wave: string) => wave === 'W15' || wave === 'W13' } } as unknown as FlagsService;

let db: TestDatabase;
let env: AppEnv;
let offers: GuildOffersService;
let accept: AcceptGuildOfferService;
let maker: GuildMakerService;
let intents: MockIntentsAdapter;
let trades: IntentTradeRepository;
let bus: EventBus;

beforeAll(async () => {
  db = await createTestDatabase();
  env = { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv;
  const wallet = new MockAgentWalletAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 11 }, { sleep: async () => undefined });
  const npcs = new GuildNpcRepository(db.prisma);
  const keys = new TradeKeyRepository(db.prisma);
  const provision = new GuildProvisionService(on, npcs, new GuildWalletBinder(wallet), new GuildTradeKeyBinder(db.prisma, keys), env);
  await provision.provision();
  for (const resource of TIER1_RESOURCES) await provision.allocateFixtureCargo('kestrel', resource, 2500);
  bus = new EventBus();
  const repo = new MarketOrderRepository(db.prisma);
  const books = new MarketBooks(repo, env);
  const release = new OrderRelease(repo, books, new MarketSimGateway(bus), db.prisma);
  const book = new GuildOrderBook(db.prisma, repo, release);
  const unused = { get() { throw new Error('unused'); } } as unknown as ModuleRef;
  maker = new GuildMakerService(on, new GuildFundingService(new GuildFundingRepository(db.prisma), on, env), npcs, keys, unused, bus, env, db.prisma, book, {
    overview: (planetId) => Promise.resolve(board(planetId)),
  });
  offers = new GuildOffersService(on, maker, db.prisma);
  intents = new MockIntentsAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 11 }, { sleep: async () => undefined }, env);
  trades = new IntentTradeRepository(db.prisma);
  const fills = new SettlementFillsHook(repo, trades, new ChainOutboxRepository(db.prisma), intents, new MarketPolicyProvider());
  accept = new AcceptGuildOfferService(on, offers, repo, books, fills, bus, db.prisma, env);
  await db.prisma.guildVisit.create({
    data: { id: 'gv:offer', npcId: 'kestrel', shipId: 'kestrel', planetId: PLANET, arriveAt: new Date(DEPART - 720_000), departAt: new Date(DEPART), offers: [], status: 'docked', kind: 'extra' },
  });
});

afterAll(async () => {
  await db?.drop();
});

describe('accept a curated Guild offer (W15-11)', () => {
  it('settles one NPC trade, then a re-quoted id and a departed ship are offer_expired', async () => {
    const listed = await dockedOffers();
    expect(listed.length).toBeGreaterThanOrEqual(2);
    expect(listed.length).toBeLessThanOrEqual(6);
    const first = await take(listed[0]!);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await finish(first.tradeId);
    const trade = (await trades.find(first.tradeId))!;
    const npc = (await db.prisma.guildNpc.findUnique({ where: { id: 'kestrel' } }))!;
    expect([trade.buyerAccountId, trade.sellerAccountId]).toContain(npc.accountId);
    expect(trade.buyerAccountId === npc.accountId ? trade.buyerActorKind : trade.sellerActorKind).toBe('npc');
    expect(trade.organic).toBe(false);
    expect(trade.state).toBe('FINAL');
    expect(await db.prisma.intentTrade.count({ where: { planetId: PLANET } })).toBe(1);

    const staleId = listed[1]!.offerId;
    expect(await offers.bumpQuoteSeq(parseGuildOfferId(staleId)!.orderId)).toBe(1);
    const again = await take(listed[1]!);
    expect(again).toMatchObject({ ok: false, code: 'offer_expired' });
    if (!again.ok) expect(again.detail).toBe(`new price ${listed[1]!.price.token} ${listed[1]!.price.amount}`);
    expect(await db.prisma.intentTrade.count({ where: { planetId: PLANET } })).toBe(1);

    await db.prisma.guildVisit.update({ where: { id: 'gv:offer' }, data: { status: 'departed' } });
    await maker.onDeparted({ shipId: 'kestrel', planetId: PLANET, npcId: 'kestrel' });
    const left = listed.find((row) => row.offerId !== listed[0]!.offerId && row.offerId !== staleId) ?? listed[1]!;
    expect(await take(left)).toMatchObject({ ok: false, code: 'offer_expired' });
  });
});

async function dockedOffers(): Promise<GuildOffer[]> {
  const push = await new GuildVisitPublisher(bus, offers).arrived({
    shipId: 'kestrel', planetId: PLANET, npcId: 'kestrel', name: 'Kestrel', departAt: DEPART,
  });
  if (!('offers' in push.d)) throw new Error('expected guild.arrived');
  return push.d.offers;
}

function take(offer: GuildOffer) {
  return accept.accept({ offerId: offer.offerId, planetId: PLANET, colonyId: 'co_buyer', colonyIndex: 0, playerId: 'pr_buyer' });
}

async function finish(tradeId: string): Promise<void> {
  const trade = (await trades.find(tradeId))!;
  for (const accountId of [trade.buyerAccountId, trade.sellerAccountId]) {
    await fund(accountId, trade.base as MarketTokenKey, 1_000_000n);
    await fund(accountId, trade.quote as MarketTokenKey, 1_000_000n);
  }
  const row = (await db.prisma.chainOutbox.findUnique({ where: { opId: marketTradeOpId(tradeId) } }))!;
  const payload = row.payload as unknown as { intents: SignedIntent[] };
  const receipt = await intents.execute({ opId: row.opId, intents: payload.intents });
  expect(await trades.finalize(tradeId, receipt.txHash)).toBe(true);
}

function fund(accountId: string, token: MarketTokenKey, units: bigint): Promise<void> {
  return intents.testSeedVerifier(accountId, MARKET_TOKENS[token].verifierId, toChainUnits(token, units));
}

function board(planetId: string): TradeOverviewResponse {
  return {
    planetId,
    overview: tier1BarterPairs().map((pair) => ({
      pair: pairId(pair.base, pair.quote), bestBid: null, bestAsk: null, last: { num: '2', den: 1 }, volume24h: 100,
    })),
  };
}
