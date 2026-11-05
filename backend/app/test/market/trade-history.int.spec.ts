import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { ProgressionEventForwarder } from '../../src/game/progression-events.service.js';
import { TradeHistoryProducer } from '../../src/market/progression/trade-history.producer.js';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

describe('W13-24 history.trade rows', () => {
  it('writes the toast sentence once per colony player; replay and unknown colonies add nothing', async () => {
    const bus = new EventBus();
    const forwarder = new ProgressionEventForwarder(bus);
    forwarder.registerColony('cA', 'pa');
    forwarder.registerColony('cB', 'pb');
    const producer = new TradeHistoryProducer(bus, forwarder, db.prisma, { DATABASE_URL: db.url, NODE_ENV: 'development' } as never);
    producer.onModuleInit();
    const emit = (colonyId: string, role: 'buyer' | 'seller') => bus.emit('planet.event', {
      planetId: 'pl', tick: 4, kind: 'tradeSettled', severity: 'info', colonyIds: [colonyId],
      data: { tradeId: 'tr_h1', colonyId, role, base: 'bio.water', amount: 300, quote: 'USDC', notional: '10000000', platformFee: '100000', stallFee: '100000', stallFeeBp: 100, makerSide: 'sell', stallName: 'Port A' },
    } as never);
    emit('cA', 'seller'); emit('cB', 'buyer'); emit('cA', 'seller'); emit('cX', 'buyer');
    await producer.idle();
    const rows = await db.prisma.playerNotification.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.playerId, (r.payload as { title: string }).title])).toEqual([
      ['pa', 'Contract signed: 300 water for 10.00 USDC at Port A (1 % fee)'],
      ['pb', 'Contract signed: 300 water for 10.00 USDC at Port A (1 % fee)'],
    ]);
    expect((rows[0]!.payload as { kind: string }).kind).toBe('history.trade');
  });
});
