import 'reflect-metadata';
import { ACHIEVEMENT_FAMILY_IDS } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ProgressionEventForwarder } from '../../src/game/progression-events.service.js';
import { MarketProgressionProducer } from '../../src/market/progression/market-progression.producer.js';
import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FamilyAvailabilityService } from '../../src/progression/family-availability.js';
import { ProgressionEngine } from '../../src/progression/progression-engine.js';

let db: TestDatabase;
const availability = { availableFamilies: () => new Set(ACHIEVEMENT_FAMILY_IDS) } as FamilyAvailabilityService;
let n = 0;

beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

/** A fresh producer on its own bus, with colonies cA/cB mapped to unique players (a new engine per call = a restart). */
function setup(waves = 'all') {
  const k = ++n;
  const bus = new EventBus();
  const forwarder = new ProgressionEventForwarder(bus);
  const A = `A${k}`, B = `B${k}`;
  forwarder.registerColony(`cA${k}`, A);
  forwarder.registerColony(`cB${k}`, B);
  const engine = new ProgressionEngine(db.prisma, availability);
  const facts = new FactsUpdaterService(new FactsStore(db.prisma), bus, undefined, engine);
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const producer = new MarketProgressionProducer(bus, facts, forwarder, flags);
  producer.onModuleInit();
  const emit = (kind: 'tradeSettled' | 'feeEarned', colonyId: string, tradeId: string, extra: Record<string, unknown>) =>
    bus.emit('planet.event', { planetId: 'pl', tick: 3, kind, severity: 'info', colonyIds: [colonyId], data: { tradeId, colonyId, ...extra } } as never);
  const settled = (colonyId: string, tradeId: string, role: 'buyer' | 'seller') => emit('tradeSettled', colonyId, tradeId, {
    role, base: 'bio.water', amount: 300, quote: 'USDC', notional: '10000000', platformFee: '100000', stallFee: '100000', stallFeeBp: 100, makerSide: 'sell',
  });
  const fee = (colonyId: string, tradeId: string) => emit('feeEarned', colonyId, tradeId, { token: 'USDC', amount: '100000', bp: 100 });
  const fact = async (player: string, family: string) =>
    (await db.prisma.playerFact.findUnique({ where: { playerId_family: { playerId: player, family } } }))?.value ?? 0;
  /** One FINAL trade as the sim emits it: buyer B, seller A, stall A. */
  const trade = (id: string) => { settled(`cB${k}`, id, 'buyer'); settled(`cA${k}`, id, 'seller'); fee(`cA${k}`, id); };
  return { A, B, producer, trade, settled, fee, fact, bus, k };
}

describe('W13-27 market progression producer (Postgres)', () => {
  it('demo: one settled trade gives merchant +1 to A and B and portAuthority to the stall owner A only', async () => {
    const s = setup();
    s.trade('tr_demo');
    await s.producer.idle();
    expect(await s.fact(s.A, 'merchant')).toBe(1);
    expect(await s.fact(s.B, 'merchant')).toBe(1);
    expect(await s.fact(s.A, 'port-authority')).toBe(1);
    expect(await s.fact(s.B, 'port-authority')).toBe(0);
  });

  it('three fee-earning fills give portAuthority +3 for A; replay and restart never double count', async () => {
    const s = setup();
    for (const id of ['t1', 't2', 't3']) s.trade(id);
    await s.producer.idle();
    expect(await s.fact(s.A, 'port-authority')).toBe(3);
    expect(await s.fact(s.A, 'merchant')).toBe(3);
    // Same events again (sim replay) through a new producer/engine (restart).
    const again = setup();
    again.bus.emit('planet.event', { planetId: 'pl', tick: 3, kind: 'feeEarned', severity: 'info', colonyIds: [`cA${s.k}`], data: { tradeId: 't1', colonyId: `cA${s.k}`, token: 'USDC', amount: '100000', bp: 100 } } as never);
    s.trade('t1');
    s.trade('t2');
    await s.producer.idle();
    expect(await s.fact(s.A, 'port-authority')).toBe(3);
    expect(await s.fact(s.A, 'merchant')).toBe(3);
    expect(await db.prisma.progressionReceipt.count({ where: { playerId: s.A } })).toBe(6);
  });

  it('applies concurrent trades without lost updates and unlocks the Merchant bronze tier at 5', async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) s.trade(`c${i}`);
    await s.producer.idle();
    expect(await s.fact(s.A, 'merchant')).toBe(5);
    expect(await db.prisma.achievementUnlock.count({ where: { playerId: s.A, family: 'merchant', tier: 1 } })).toBe(1);
  });

  it('records nothing while W13 is off and skips a colony without a player', async () => {
    const off = setup('W01');
    off.trade('x');
    await off.producer.idle();
    expect(await off.fact(off.A, 'merchant')).toBe(0);
    expect(await db.prisma.progressionReceipt.count({ where: { playerId: off.A } })).toBe(0);

    const s = setup();
    s.settled('unknown-colony', 'y', 'buyer');
    s.fee('unknown-colony', 'y');
    await s.producer.idle();
    expect(await db.prisma.progressionReceipt.count({ where: { id: { contains: 'unknown-colony' } } })).toBe(0);
  });
});
