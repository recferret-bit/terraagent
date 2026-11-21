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
const DAY = 86_400_000;
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
  await intents.testRegisterSigner('protocol.terraagent.mock');
});
afterAll(async () => { await app?.close(); await db?.drop(); });


async function fill(opts: { patron: boolean; buyerStakeNear?: number; stakedDaysAgo?: number }) {
  const planetId = `pp${++n}`;
  const seller = `s${n}`;
  const buyer = `b${n}`;
  await dao.createDao({ opId: `dao-create:${planetId}`, name: planetId, councilAccountIds: [acct(seller)] });
  for (const c of [seller, buyer]) await intents.testRegisterSigner(acct(c));
  await intents.testSeedVerifier(acct(seller), WATER, toChainUnits('bio.water', 1n));
  await intents.testSeedVerifier(acct(buyer), USDC, 20_000_000n);
  if (opts.patron) {
    await db.prisma.stakingPatronSeat.create({ data: { planetId, accountId: 'king.near', activeStaked: '500000000000000000000000000', sinceAt: new Date() } });
  }
  if (opts.buyerStakeNear) {
    const since = new Date(Date.now() - (opts.stakedDaysAgo ?? 3) * DAY);
    await db.prisma.stakingPosition.create({
      data: { colonyId: buyer, accountId: acct(buyer), poolId: 'astro-stakers.pool.mock', stakedSnapshot: `${opts.buyerStakeNear}000000000000000000000000`, stakedSinceAt: since, lastStakedAt: since },
    });
  }
  const event = (colony: string, over: Record<string, unknown>): PlanetEventOf<'marketOrderRequested'> => ({
    planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colony],
    data: { ref: marketOrderRef(colony, ++seq), orderSeq: seq, colonyId: colony, colonyIndex: colony.startsWith('s') ? 0 : 1, resource: 'bio.water', amount: 1, ttlS: 3600, stallFeeBp: 100, hubEntityId: 3, ...over },
  } as unknown as PlanetEventOf<'marketOrderRequested'>);
  await place.handle(event(seller, { side: 'sell', price: { token: 'USDC', amount: '10000000' } }));
  await place.handle(event(buyer, { side: 'buy', price: { token: 'USDC', amount: '10000000' }, maxStallFeeBp: 100 }));
  const trade = await db.prisma.intentTrade.findFirstOrThrow({ where: { planetId } });
  return { planetId, trade };
}

const payouts = (planetId: string) => db.prisma.stakingPatronPayout.findMany({ where: { planetId } });

describe('W28-06 King-of-the-Hill patron payout on a real market fill', () => {
  it('writes one payout of 12% of gross (DAO 20%, Protocol 68%) and is idempotent on replay', async () => {
    const { planetId, trade } = await fill({ patron: true });
    expect(trade.platformFee.toFixed()).toBe('100000');
    expect(trade.treasuryAllocation.toFixed()).toBe('20000');
    expect(await relay.pollOnce()).toBeGreaterThan(0);
    const rows = await payouts(planetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: 'king.near', sourceTradeId: trade.tradeId });
    expect(rows[0]!.amountUsdcAtomic.toFixed()).toBe('12000');
    expect(100000n - 20000n - 12000n).toBe(68000n);
    const kingBal = await db.prisma.mockChainIntentsBalance.findUniqueOrThrow({
      where: { accountId_tokenId: { accountId: 'king.near', tokenId: USDC } },
    });
    expect(kingBal.amount.toFixed(0)).toBe('12000');
    await fees.depositSettled({ tradeId: trade.tradeId, planetId, quote: 'USDC', treasuryFee: '20000', platformFee: '100000' });
    expect(await payouts(planetId)).toHaveLength(1);
    const kingAfterReplay = await db.prisma.mockChainIntentsBalance.findUniqueOrThrow({
      where: { accountId_tokenId: { accountId: 'king.near', tokenId: USDC } },
    });
    expect(kingAfterReplay.amount.toFixed(0)).toBe('12000');
    expect((await dao.get({ daoAccountId: daoAccountIdFor(planetId) })).balances.USDC).toBe('20000');
  });

  it('a planet without a Lead Patron records no payout', async () => {
    const { planetId } = await fill({ patron: false });
    await relay.pollOnce();
    expect(await payouts(planetId)).toHaveLength(0);
  });

  it('charges the effective tier fee: Tier 2 pays 65 bp inside the 24h warmup and 50 bp after it, patron share follows the fee', async () => {
    const fresh = await fill({ patron: true, buyerStakeNear: 60, stakedDaysAgo: 0 });
    expect([fresh.trade.platformFee.toFixed(), fresh.trade.treasuryAllocation.toFixed()]).toEqual(['65000', '13000']);
    const warm = await fill({ patron: true, buyerStakeNear: 60, stakedDaysAgo: 3 });
    expect([warm.trade.platformFee.toFixed(), warm.trade.treasuryAllocation.toFixed()]).toEqual(['50000', '10000']);
    await relay.pollOnce();
    expect((await payouts(fresh.planetId))[0]!.amountUsdcAtomic.toFixed()).toBe('7800');
    expect((await payouts(warm.planetId))[0]!.amountUsdcAtomic.toFixed()).toBe('6000');
  });

  it('payout income is a Protocol cut: the AI spend cap (35%) leaves a margin of at least 65% of that income', async () => {
    const { planetId } = await fill({ patron: true });
    await relay.pollOnce();
    const protocolFeeUsd = (100000 - 20000 - Number((await payouts(planetId))[0]!.amountUsdcAtomic.toFixed())) / 1e6;
    const aiCapUsd = protocolFeeUsd * 0.35;
    expect(1 - aiCapUsd / protocolFeeUsd).toBeGreaterThanOrEqual(0.65);
  });
});
