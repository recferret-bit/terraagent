import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { PriceBoardService } from '../../src/market/board/price-board.service.js';
import { IntentTradeRepository, type NewIntentTrade } from '../../src/market/settlement/intent-trade.repository.js';

let db: TestDatabase;
let app: INestApplication;
let board: PriceBoardService;
let trades: IntentTradeRepository;
let bus: EventBus;
let n = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'off', DATABASE_URL: db.url, OUTBOX_RELAY_ENABLED: 'false' },
  });
  app = created.app;
  await app.init();
  board = app.get(PriceBoardService);
  trades = app.get(IntentTradeRepository);
  bus = app.get(EventBus);
});
afterAll(async () => {
  await app?.close();
  await db?.drop();
});

async function finalTrade(planetId: string, o: { organic: boolean; buyer: string; seller: string; price?: bigint; kind?: string; pending?: boolean }): Promise<void> {
  n++;
  const amount = 10n;
  const row: NewIntentTrade = {
    tradeId: `tr_board_${n}`, planetId, pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', makerOrderId: `mo${n}`, takerOrderId: `to${n}`,
    makerSide: 'sell', buyerColonyId: o.buyer, sellerColonyId: o.seller, buyerAccountId: `${o.buyer}.mock`, sellerAccountId: `${o.seller}.mock`,
    stallColonyId: o.seller, stallAccountId: `${o.seller}.mock`, platformAccountId: 'platform.terraagent.mock', amount, notional: amount * (o.price ?? 400_000n),
    platformFee: 0n, stallFee: 0n, treasuryAllocation: 0n, platformFeeBp: 100, stallFeeBp: 100, policyVersion: 'bootstrap-1', policyHash: 'sha256:x',
    legs: [], batchHash: `h${n}`, buyerActorKind: o.kind ?? 'player', sellerActorKind: o.kind ?? 'player', organic: o.organic,
  };
  await trades.insert(row);
  if (!o.pending) await trades.finalize(row.tradeId, `mock:${n}`);
}

const organic = (planetId: string, i: number, price = 400_000n) => finalTrade(planetId, { organic: true, buyer: `b${i % 3}`, seller: `s${i % 3}`, price });

describe('W13-18 price board service', () => {
  it('fixture fills cannot establish an organic reference price', async () => {
    const p = 'pb_fixture';
    for (let i = 0; i < 8; i++) await finalTrade(p, { organic: false, buyer: 'fixture.bot', seller: `s${i}`, kind: 'fixture' });
    const [row] = await board.board(p);
    expect(row).toMatchObject({ pair: 'bio.water/USDC', classification: 'fixture', reason: 'insufficient_data', vwap: null, eligibleVolume: 0, volume24h: 80 });
    expect(row!.last).toEqual({ num: '400000', den: 1 });
  });

  it('organic fills give a VWAP; PENDING trades and other planets are ignored; settlement invalidates the cache', async () => {
    const p = 'pb_organic';
    for (let i = 0; i < 2; i++) await organic(p, i);
    expect((await board.board(p))[0]).toMatchObject({ classification: 'insufficient_data', vwap: null });
    await organic(p, 2);
    await finalTrade(p, { organic: true, buyer: 'b9', seller: 's9', pending: true });
    expect((await board.board(p))[0]!.classification).toBe('insufficient_data'); // cached, third trade not seen yet
    bus.emit('market.trade', { planetId: p, payload: { planetId: p, trade: {} as never } });
    const row = (await board.board(p))[0]!;
    expect(row).toMatchObject({ classification: 'organic', vwap: { num: '400000', den: 1 }, counterparties: 6, eligibleVolume: 30, volume24h: 30 });
    expect((await board.board('pb_other')).length).toBe(0);
  });

  it('stale organic trades return the stale reason', async () => {
    const p = 'pb_stale';
    for (let i = 0; i < 4; i++) await organic(p, i);
    const real = board.now;
    board.now = () => real() + 2 * 3_600_000;
    board.invalidate(p);
    expect((await board.board(p))[0]).toMatchObject({ classification: 'insufficient_data', reason: 'stale', vwap: null });
    board.now = real;
  });
});
