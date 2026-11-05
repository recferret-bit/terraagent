import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { computeMarketAnalytics, type AnalyticsTradeRow } from '../../src/market/analytics/market-analytics.js';
import { MarketAnalyticsService } from '../../src/market/analytics/market-analytics.service.js';
import { IntentTradeRepository, type NewIntentTrade } from '../../src/market/settlement/intent-trade.repository.js';

let db: TestDatabase;
let app: INestApplication;
let trades: IntentTradeRepository;
let service: MarketAnalyticsService;
let n = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({ source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'off', DATABASE_URL: db.url, OUTBOX_RELAY_ENABLED: 'false' } });
  app = created.app;
  await app.init();
  trades = app.get(IntentTradeRepository);
  service = app.get(MarketAnalyticsService);
});
afterAll(async () => {
  await app?.close();
  await db?.drop();
});

async function finalTrade(planetId: string, o: { buyer: string; seller: string; organic?: boolean; kind?: string; pending?: boolean; notional?: bigint }): Promise<void> {
  n++;
  const notional = o.notional ?? 10_000_000n;
  const row: NewIntentTrade = {
    tradeId: `tr_an_${n}`, planetId, pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', makerOrderId: `mo${n}`, takerOrderId: `to${n}`, makerSide: 'sell',
    buyerColonyId: o.buyer, sellerColonyId: o.seller, buyerAccountId: `${o.buyer}.mock`, sellerAccountId: `${o.seller}.mock`, stallColonyId: o.seller, stallAccountId: `${o.seller}.mock`,
    platformAccountId: 'platform.terraagent.mock', amount: 300n, notional, platformFee: notional / 100n, stallFee: notional / 100n, treasuryAllocation: 0n, platformFeeBp: 100, stallFeeBp: 100,
    policyVersion: 'bootstrap-1', policyHash: 'sha256:x', legs: [], batchHash: `h${n}`, buyerActorKind: o.kind ?? 'player', sellerActorKind: 'player', organic: o.organic ?? true,
  };
  await trades.insert(row);
  if (!o.pending) await trades.finalize(row.tradeId, `mock:${n}`);
}

describe('W13-28 market analytics aggregate', () => {
  it('repeat buyers, organic vs subsidised vs related volume, execution cost, labelled leakage assumption', async () => {
    const p = 'an_planet';
    await finalTrade(p, { buyer: 'b', seller: 's1' });
    await finalTrade(p, { buyer: 'b', seller: 's2' });
    await finalTrade(p, { buyer: 'c', seller: 's1' });
    await finalTrade(p, { buyer: 'fixture.bot', seller: 's1', kind: 'fixture', organic: false });
    await finalTrade(p, { buyer: 'r1', seller: 'r2', organic: false });
    await finalTrade(p, { buyer: 'b', seller: 's1', pending: true });
    await finalTrade('an_other', { buyer: 'b', seller: 's1' });
    const r = await service.report(p);
    expect(r.trades).toBe(5);
    expect(r.colonies).toMatchObject({ buyers: 4, sellers: 3, repeatBuyers: 1 });
    expect(r.colonies.note).toContain('not a human');
    expect(r.volumeByQuote.USDC).toEqual({ organic: '30000000', subsidised: '10000000', related: '10000000' });
    expect(r.exclusions).toEqual({ subsidisedTrades: 1, relatedTrades: 1 });
    expect(r.executionCostBpByQuote.USDC).toBe(200);
    expect(r.feeLeakage.source).toBe('assumption');
    expect(r.feeLeakage.estimatedLeakedFeeByQuote.USDC).toBe('50000');
    expect(JSON.stringify(r)).not.toMatch(/mock|fixture\.bot|"b"/);
  });

  it('an empty window is all zeros', async () => {
    const r = await service.report('an_empty');
    expect(r).toMatchObject({ trades: 0, colonies: { buyers: 0, repeatBuyers: 0 }, volumeByQuote: {} });
  });

  it('pure aggregate: no division by zero', () => {
    const row: AnalyticsTradeRow = { quote: 'USDC', buyerColonyId: 'a', sellerColonyId: 'b', buyerActorKind: 'player', sellerActorKind: 'player', organic: true, notional: 0n, platformFee: 0n, stallFee: 0n };
    expect(computeMarketAnalytics([row], 24, 100).executionCostBpByQuote.USDC).toBe(0);
  });
});
