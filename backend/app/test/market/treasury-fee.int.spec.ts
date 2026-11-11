import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { MARKET_TOKENS, marketOrderRef, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { PlaceOrderService } from '../../src/market/orders/place-order.service.js';
import { TreasuryFeeService } from '../../src/market/settlement/treasury-fee.service.js';
import { TreasuryDaoPort } from '../../src/near/application/ports/treasury-dao.port.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import type { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { IntentsPort } from '../../src/near/application/ports/intents.port.js';
import { daoAccountIdFor } from '../../src/near/treasury/policy.js';

let db: TestDatabase;
let app: INestApplication;
let place: PlaceOrderService;
let relay: OutboxRelayService;
let dao: TreasuryDaoPort;
let fees: TreasuryFeeService;
let intents: MockIntentsAdapter;
const USDC = MARKET_TOKENS.USDC.verifierId;
const WATER = MARKET_TOKENS['bio.water'].verifierId;
const acct = (c: string) => `${c}.terraagent.mock`;
let n = 0;
let seq = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'off', DATABASE_URL: db.url, OUTBOX_RELAY_ENABLED: 'false', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0' },
  });
  app = created.app;
  await app.init();
  place = app.get(PlaceOrderService);
  relay = app.get(OutboxRelayService);
  dao = app.get(TreasuryDaoPort);
  fees = app.get(TreasuryFeeService);
  intents = app.get(IntentsPort) as unknown as MockIntentsAdapter;
  await intents.testRegisterSigner('platform.terraagent.mock');
});
afterAll(async () => { await app?.close(); await db?.drop(); });

const usdc = async (accountId: string): Promise<bigint> => {
  const row = await db.prisma.mockChainIntentsBalance.findUnique({ where: { accountId_tokenId: { accountId, tokenId: USDC } } });
  return row ? BigInt(row.amount.toFixed()) : 0n;
};

/** One water for 10 USDC. Buyer is seeded with 20 USDC. Returns the planet and the PENDING trade id. */
async function fillTen(opts: { dao: boolean }): Promise<{ planetId: string; tradeId: string; buyer: string; seller: string }> {
  const planetId = `tf${++n}`;
  const seller = `s${n}`;
  const buyer = `b${n}`;
  if (opts.dao) await dao.createDao({ opId: `dao-create:${planetId}`, name: planetId, councilAccountIds: [acct(seller)] });
  for (const c of [seller, buyer]) await intents.testRegisterSigner(acct(c));
  await intents.testSeedVerifier(acct(seller), WATER, toChainUnits('bio.water', 1n));
  await intents.testSeedVerifier(acct(buyer), USDC, 20_000_000n);
  const event = (colony: string, over: Record<string, unknown>): PlanetEventOf<'marketOrderRequested'> => ({
    planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colony],
    data: { ref: marketOrderRef(colony, ++seq), orderSeq: seq, colonyId: colony, colonyIndex: colony.startsWith('s') ? 0 : 1, resource: 'bio.water', amount: 1, ttlS: 3600, stallFeeBp: 100, hubEntityId: 3, ...over },
  } as unknown as PlanetEventOf<'marketOrderRequested'>);
  await place.handle(event(seller, { side: 'sell', price: { token: 'USDC', amount: '10000000' } }));
  await place.handle(event(buyer, { side: 'buy', price: { token: 'USDC', amount: '10000000' }, maxStallFeeBp: 100 }));
  const tradeId = (await db.prisma.intentTrade.findFirstOrThrow({ where: { planetId } })).tradeId;
  return { planetId, tradeId, buyer, seller };
}

describe('W22-07 treasury fee deposit', () => {
  it('settles 10 USDC, credits the DAO once, and a second deposit of the same trade does not move funds', async () => {
    const t = await fillTen({ dao: true });
    const daoId = daoAccountIdFor(t.planetId);
    expect((await db.prisma.intentTrade.findUniqueOrThrow({ where: { tradeId: t.tradeId } })).treasuryAllocation.toFixed()).toBe('20000');
    expect(await relay.pollOnce()).toBeGreaterThan(0);
    const trade = await db.prisma.intentTrade.findUniqueOrThrow({ where: { tradeId: t.tradeId } });
    expect(trade.state).toBe('FINAL');
    expect(trade.organic).toBe(true);
    expect(trade.treasuryAccountId).toBe(daoId);
    expect([trade.notional.toFixed(), trade.platformFee.toFixed(), trade.stallFee.toFixed(), trade.treasuryAllocation.toFixed()]).toEqual(['10000000', '100000', '100000', '20000']);
    expect(await usdc(acct(t.buyer))).toBe(9_800_000n);
    expect(await usdc(acct(t.seller))).toBe(10_100_000n);
    expect(await usdc(daoId)).toBe(20_000n);
    expect((await dao.get({ daoAccountId: daoId })).balances.USDC).toBe('20000');
    await fees.depositSettled({ tradeId: t.tradeId, planetId: t.planetId, quote: 'USDC', treasuryFee: '20000' });
    expect((await dao.get({ daoAccountId: daoId })).balances.USDC).toBe('20000');
  });

  it('a missing DAO leaves the trade FINAL with the allocation stored and deposits nothing', async () => {
    const t = await fillTen({ dao: false });
    const daoId = daoAccountIdFor(t.planetId);
    expect(await relay.pollOnce()).toBeGreaterThan(0);
    const trade = await db.prisma.intentTrade.findUniqueOrThrow({ where: { tradeId: t.tradeId } });
    expect(trade).toMatchObject({ state: 'FINAL', organic: true, treasuryAccountId: `treasury:${t.planetId}` });
    expect(trade.treasuryAllocation.toFixed()).toBe('20000');
    expect(await usdc(acct(t.buyer))).toBe(9_800_000n);
    await expect(dao.get({ daoAccountId: daoId })).rejects.toMatchObject({ errorCode: 'DAO_NOT_FOUND' });
    await fees.depositSettled({ tradeId: t.tradeId, planetId: t.planetId, quote: 'USDC', treasuryFee: trade.treasuryAllocation.toFixed() });
    expect(await db.prisma.mockChainDao.findUnique({ where: { id: daoId } })).toBeNull();
    expect((await db.prisma.intentTrade.findUniqueOrThrow({ where: { tradeId: t.tradeId } })).state).toBe('FINAL');
  });
});
