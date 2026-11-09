import type { ProgressEventV1 } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { MarketFactReplay, type ReplayDb, type ReplayTradeRow } from '../../src/market/progression/market-fact-replay';

const NOW = 1_800_000_000_000;
const trade = (n: number, over: Partial<ReplayTradeRow> = {}): ReplayTradeRow => ({
  id: BigInt(n), tradeId: `tr_${n}`, planetId: 'pl_a', quote: 'USDC',
  buyerColonyId: 'cB', sellerColonyId: 'cA', stallColonyId: 'cA', stallFee: '100000', ...over,
});

/** A fake DB + engine: `applied` plays the progression receipts (event ids), exactly like the engine's one-receipt-per-id rule. */
function setup(rows: ReplayTradeRow[], applied = new Set<string>(), colonies: Record<string, string> = { cA: 'pA', cB: 'pB' }) {
  const facts: ProgressEventV1[] = [];
  let pages = 0;
  const db: ReplayDb = {
    intentTrade: {
      findMany: async (args) => {
        pages++;
        const where = args.where as { id?: { gt: bigint }; settledAt: { lte: Date } };
        return rows.filter((r) => (where.id ? r.id > where.id.gt : true)).slice(0, args.take as number);
      },
    },
    progressionReceipt: { findMany: async (args) => (((args.where as { id: { in: string[] } }).id.in).filter((i) => applied.has(i)).map((id) => ({ id }))) },
    colony: { findMany: async (args) => ((args.where as { id: { in: string[] } }).id.in).filter((c) => colonies[c]).map((id) => ({ id, playerId: colonies[id]! })) },
  };
  const apply = async (ev: ProgressEventV1) => {
    if (applied.has(ev.eventId!)) throw new Error('duplicate');
    applied.add(ev.eventId!);
    facts.push(ev);
  };
  return { db, apply, facts, applied, pages: () => pages };
}

describe('market progression fact replay (LED-25 outbox)', () => {
  it('after a crash between FINAL and the fact write, the missing facts are applied once', async () => {
    const s = setup([trade(1), trade(2)], new Set([
      'market:merchant:tr_1:cB', 'market:merchant:tr_1:cA', 'market:portAuthority:tr_1:cA', // tr_1 was fully written; tr_2 crashed
    ]));
    const replay = new MarketFactReplay(s.db, s.apply);
    const r = await replay.runOnce(NOW);
    expect(r).toEqual({ scanned: 2, replayed: 3, skipped: 1, failed: 0 });
    expect(s.facts.map((f) => f.eventId).sort()).toEqual(['market:merchant:tr_2:cA', 'market:merchant:tr_2:cB', 'market:portAuthority:tr_2:cA']);
    expect(s.facts.find((f) => f.family === 'port-authority')).toMatchObject({ playerId: 'pA', value: 1 });
    // a second pass (the next restart) finds nothing to do
    expect(await replay.runOnce(NOW)).toEqual({ scanned: 2, replayed: 0, skipped: 2, failed: 0 });
    expect(s.facts).toHaveLength(3);
  });

  it('applies only the part that is missing (merchant written, fee lost)', async () => {
    const s = setup([trade(5)], new Set(['market:merchant:tr_5:cB', 'market:merchant:tr_5:cA']));
    await new MarketFactReplay(s.db, s.apply).runOnce(NOW);
    expect(s.facts.map((f) => f.eventId)).toEqual(['market:portAuthority:tr_5:cA']);
  });

  it('a buyer that is also the seller and the stall gets one merchant fact, not two', async () => {
    const s = setup([trade(6, { buyerColonyId: 'cA' })]);
    await new MarketFactReplay(s.db, s.apply).runOnce(NOW);
    expect(s.facts.filter((f) => f.family === 'merchant')).toHaveLength(1);
  });

  it('negative: a zero stall fee has no port authority fact; a colony without a player gets nothing; an unknown token is skipped', async () => {
    const zero = setup([trade(7, { stallFee: '0' })]);
    await new MarketFactReplay(zero.db, zero.apply).runOnce(NOW);
    expect(zero.facts.map((f) => f.family)).toEqual(['merchant', 'merchant']);

    const bot = setup([trade(8)], new Set(), { cA: 'pA' }); // buyer cB is a seed bot (no colony row)
    await new MarketFactReplay(bot.db, bot.apply).runOnce(NOW);
    expect(bot.facts.map((f) => f.eventId).sort()).toEqual(['market:merchant:tr_8:cA', 'market:portAuthority:tr_8:cA']);

    const odd = setup([trade(9, { quote: 'DOGE' })]);
    const r = await new MarketFactReplay(odd.db, odd.apply).runOnce(NOW);
    expect(r.failed).toBe(0);
    expect(odd.facts.some((f) => f.family === 'port-authority')).toBe(false);
  });

  it('a failing apply is counted and does not stop the other trades', async () => {
    const s = setup([trade(10), trade(11)]);
    const flaky = async (ev: ProgressEventV1) => { if (ev.eventId === 'market:merchant:tr_10:cB') throw new Error('db down'); return s.apply(ev); };
    const r = await new MarketFactReplay(s.db, flaky).runOnce(NOW);
    expect(r.failed).toBe(1);
    expect(s.facts.some((f) => f.eventId === 'market:merchant:tr_11:cB')).toBe(true);
    // the next pass retries only the failed one
    const again = await new MarketFactReplay(s.db, s.apply).runOnce(NOW);
    expect(again.replayed).toBe(1);
  });

  it('pages through more trades than one page and handles an empty book', async () => {
    const many = setup(Array.from({ length: 5 }, (_, i) => trade(20 + i)));
    const r = await new MarketFactReplay(many.db, many.apply, { pageSize: 2 }).runOnce(NOW);
    expect(r.scanned).toBe(5);
    expect(r.replayed).toBe(15);
    expect(many.pages()).toBeGreaterThan(1);
    expect(await new MarketFactReplay(setup([]).db, async () => undefined).runOnce(NOW)).toEqual({ scanned: 0, replayed: 0, skipped: 0, failed: 0 });
  });
});
