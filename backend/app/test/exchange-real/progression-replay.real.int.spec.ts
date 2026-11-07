import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import { MarketProgressionProducer } from '../../src/market/progression/market-progression.producer.js';
import { feeUnitsOf } from '../../src/market/progression/market-progress-events.js';
import { Exchange, ord, type Actor } from '../exchange/exchange-harness.js';
import { realWorld, type RealWorld } from './real-planet.js';

/**
 * `MarketProgressionProducer.replayMissingFacts()` against Postgres and the real engine, on trades the REAL sim and settlement made.
 * The live path cannot resolve `col_<n>` to a player here (no landing registered them), which is exactly what a crash between
 * FINAL and the fact write leaves behind: a FINAL trade without receipts. Only the replay can then produce the facts.
 */
let ex: Exchange;
let w: RealWorld;
let seller: Actor;
let buyer: Actor;
const DAY = 86_400_000;

beforeAll(async () => {
  ex = await Exchange.boot({}, { realSim: true });
  w = await realWorld(ex, 2);
  seller = await w.bot({ idx: 0, fund: { 'bio.water': '500', USDC: '1' }, allowance: { maxOpenOrders: 50, dailyBudget: '100000000000' } });
  buyer = await w.bot({ idx: 1, fund: { USDC: '1000' }, allowance: { maxOpenOrders: 50, dailyBudget: '100000000000' } });
  for (const [a, id] of [[seller, 'col_0'], [buyer, 'col_1']] as const) {
    await ex.prisma.player.upsert({ where: { id: a.ownerId }, create: { id: a.ownerId, handle: a.name.slice(0, 24) }, update: {} });
    await ex.prisma.colony.create({ data: { id, playerId: a.ownerId, planetId: w.planetId, colonyIndex: a.idx, name: id } });
  }
});
afterAll(async () => { await ex?.close(); });

const producer = () => ex.get(MarketProgressionProducer);
const fact = async (a: Actor, family: string) => (await ex.prisma.playerFact.findUnique({ where: { playerId_family: { playerId: a.ownerId, family } } }))?.value ?? 0;
const receipts = (tradeId: string) => ex.prisma.progressionReceipt.findMany({ where: { id: { contains: tradeId } }, select: { id: true }, orderBy: { id: 'asc' } });
const later = (ms = 61_000) => Date.now() + ms;

/** One real FINAL trade (seller col_0 is maker, therefore the stall owner); returns the trade id. */
async function finalTrade(units = 10): Promise<string> {
  expect((await seller.place(ord('sell', units, units * 100_000))).status).toBe(201);
  expect((await buyer.place(ord('buy', units, units * 100_000))).body.order.state).toBe('FILLED');
  await ex.settle();
  const t = (await ex.prisma.intentTrade.findMany({ where: { planetId: w.planetId }, orderBy: { id: 'desc' }, take: 1 }))[0]!;
  expect(t.state).toBe('FINAL');
  return t.tradeId;
}
/** The fee units a trade's stall fee is worth. */
const feeUnits = async (tradeId: string) => feeUnitsOf('USDC', (await ex.trades.find(tradeId))!.stallFee.toString());

describe('REAL DB: market fact replay (LED-25 outbox)', () => {
  it('a FINAL trade without receipts gets its three facts exactly once; a second pass is a no-op', async () => {
    const [m0, p0, mb0] = [await fact(seller, 'merchant'), await fact(seller, 'port-authority'), await fact(buyer, 'merchant')];
    const t1 = await finalTrade();
    const t2 = await finalTrade();
    expect(await receipts(t1)).toHaveLength(0); // the crash window: FINAL, no fact
    expect(await fact(seller, 'merchant')).toBe(m0);
    const r = await producer().replayMissingFacts(later());
    expect(r.replayed).toBeGreaterThanOrEqual(6);
    expect(r.failed).toBe(0);
    for (const t of [t1, t2]) {
      expect((await receipts(t)).map((x) => x.id).sort()).toEqual([`market:merchant:${t}:col_0`, `market:merchant:${t}:col_1`, `market:portAuthority:${t}:col_0`].sort());
    }
    expect(await fact(seller, 'merchant')).toBe(m0 + 2);
    expect(await fact(buyer, 'merchant')).toBe(mb0 + 2);
    expect(await fact(seller, 'port-authority')).toBe(p0 + (await feeUnits(t1)) + (await feeUnits(t2)));
    expect(await fact(buyer, 'port-authority')).toBe(0); // only the stall owner earns the fee
    // idempotent
    const again = await producer().replayMissingFacts(later());
    expect(again.replayed).toBe(0);
    expect(again.skipped).toBe(again.scanned);
    expect(await fact(seller, 'merchant')).toBe(m0 + 2);
    expect((await receipts(t1)).length).toBe(3);
  });

  it('applies only the part that is missing (one receipt lost): the others are never counted twice', async () => {
    await producer().replayMissingFacts(later()); // settle everything older
    const t = await finalTrade();
    await producer().replayMissingFacts(later());
    const m = await fact(buyer, 'merchant');
    await ex.prisma.progressionReceipt.delete({ where: { id: `market:merchant:${t}:col_1` } });
    const r = await producer().replayMissingFacts(later());
    expect(r.replayed).toBe(1);
    expect(await fact(buyer, 'merchant')).toBe(m + 1); // the lost receipt's fact is applied again (the counter had no idempotence beyond the receipt)
    expect((await receipts(t)).length).toBe(3);
  });

  it('honours the 60 s grace: a trade younger than that is left to the live path', async () => {
    await producer().replayMissingFacts(later());
    const t = await finalTrade();
    const m = await fact(seller, 'merchant');
    const young = await producer().replayMissingFacts(Date.now() + 30_000); // now + 30 s: the trade is 30 s old
    expect(young.replayed).toBe(0);
    expect(await receipts(t)).toHaveLength(0);
    const old = await producer().replayMissingFacts(Date.now() + 61_000);
    expect(old.replayed).toBe(3);
    expect(await fact(seller, 'merchant')).toBe(m + 1);
  });

  it('honours the 7-day window: older trades are never scanned, 6-day-old ones are', async () => {
    await producer().replayMissingFacts(later());
    const [stale, recent] = [await finalTrade(), await finalTrade()];
    await ex.prisma.intentTrade.update({ where: { tradeId: stale }, data: { settledAt: new Date(Date.now() - 8 * DAY) } });
    await ex.prisma.intentTrade.update({ where: { tradeId: recent }, data: { settledAt: new Date(Date.now() - 6 * DAY) } });
    const r = await producer().replayMissingFacts();
    expect(r.replayed).toBe(3);
    expect(await receipts(stale)).toHaveLength(0);
    expect(await receipts(recent)).toHaveLength(3);
  });

  it('does nothing while W13 is off, and replays once it is on again', async () => {
    await producer().replayMissingFacts(later());
    const t = await finalTrade();
    const p = producer() as unknown as { flags: FlagsService };
    const on = p.flags;
    p.flags = new FlagsService({ TA_WAVES: '..12' } as never);
    try {
      expect(await producer().replayMissingFacts(later())).toEqual({ scanned: 0, replayed: 0, skipped: 0, failed: 0 });
      expect(await receipts(t)).toHaveLength(0);
    } finally { p.flags = on; }
    expect((await producer().replayMissingFacts(later())).replayed).toBe(3);
  });
});

describe('REAL DB: market fact replay, edge cases and crash', () => {
  it('a FAILED or PENDING trade never produces a fact; a colony without a player row produces none', async () => {
    await producer().replayMissingFacts(later());
    const t = await finalTrade();
    const copy = (await ex.prisma.intentTrade.findUniqueOrThrow({ where: { tradeId: t } }));
    const { id: _id, ...base } = copy;
    void _id;
    const rest = { ...base, legs: base.legs as never };
    await ex.prisma.intentTrade.create({ data: { ...rest, tradeId: `${t}-failed`, state: 'FAILED' } });
    await ex.prisma.intentTrade.create({ data: { ...rest, tradeId: `${t}-pending`, state: 'PENDING', settledAt: null } });
    await ex.prisma.intentTrade.create({ data: { ...rest, tradeId: `${t}-ghost`, buyerColonyId: 'col_ghost', sellerColonyId: 'col_ghost2', stallColonyId: 'col_ghost2' } });
    const r = await producer().replayMissingFacts(later());
    expect(r.failed).toBe(0);
    expect(await receipts(`${t}-failed`)).toHaveLength(0);
    expect(await receipts(`${t}-pending`)).toHaveLength(0);
    expect(await receipts(`${t}-ghost`)).toHaveLength(0);
    expect(await receipts(t)).toHaveLength(3);
  });

  it('crash simulation: the process dies between FINAL and the fact; the next boot (inside the grace) leaves it, a later pass fixes it once', async () => {
    await producer().replayMissingFacts(later());
    const t = await finalTrade();
    const m = await fact(buyer, 'merchant');
    await ex.stop(); // kill: nothing of the live path ran
    await ex.start(); // boot replay: the trade is seconds old, so inside the grace
    await ex.get(MarketProgressionProducer).idle();
    expect(await receipts(t)).toHaveLength(0);
    const r = await ex.get(MarketProgressionProducer).replayMissingFacts(later());
    expect(r.replayed).toBe(3);
    expect(await fact(buyer, 'merchant')).toBe(m + 1);
    // another restart and pass: nothing new, no double count
    await ex.restart();
    expect((await ex.get(MarketProgressionProducer).replayMissingFacts(later())).replayed).toBe(0);
    expect(await fact(buyer, 'merchant')).toBe(m + 1);
    expect(await receipts(t)).toHaveLength(3);
  });
});
