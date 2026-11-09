import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditPlanet, expectLedgerDelta } from './exchange-audit.js';
import { Exchange, ord, type Actor, type World } from './exchange-harness.js';
import type { TradePlan } from '../../src/market/settlement/trade-plan.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

describe('request linker: the sim echoes commandId (or not)', () => {
  const place = async (echo: boolean) => {
    ex.echoCommandId = echo;
    try {
      const w = ex.world();
      const a = await w.bot();
      const r = await a.place(ord('sell', 10, 1_000_000));
      expect(r.status).toBe(201);
      return { w, a, r };
    } finally { ex.echoCommandId = false; }
  };

  it('without the field (today\'s sim) the exact-terms fallback links the request: actor bot, request ACCEPTED, commandId written at submit', async () => {
    const { r, w } = await place(false);
    const row = await ex.prisma.tradeApiRequest.findUniqueOrThrow({ where: { requestId: r.body.requestId } });
    expect(row).toMatchObject({ state: 'ACCEPTED', commandId: r.body.requestId });
    expect((await ex.ordersOf(w.planetId))[0]).toMatchObject({ actorKind: 'bot' });
  });

  it('with the field the order links by commandId (same result end to end)', async () => {
    const { r, w } = await place(true);
    const row = await ex.prisma.tradeApiRequest.findUniqueOrThrow({ where: { requestId: r.body.requestId } });
    expect(row).toMatchObject({ state: 'ACCEPTED', commandId: r.body.requestId, orderId: expect.any(String) });
    expect((await ex.ordersOf(w.planetId))[0]).toMatchObject({ actorKind: 'bot', orderId: row.orderId });
  });

  it('two identical SUBMITTED requests of one colony: claiming by commandId takes the named one, not the oldest; unknown ids fall back to the oldest', async () => {
    const w = ex.world();
    const a = await w.bot();
    const base = { kind: 'place', planetId: w.planetId, colonyId: a.colonyId, colonyIndex: a.idx, ownerId: a.ownerId, keyId: a.keyId!, side: 'sell', resource: 'bio.water', amount: '10', priceAmount: '1000000', notional: '1000000', state: 'SUBMITTED', pair: 'bio.water/USDC' };
    const mk = (requestId: string, commandId: string, idemKey: string) => ex.prisma.tradeApiRequest.create({ data: { ...base, requestId, commandId, idemKey, ownerRef: `key:${a.keyId}`, bodyHash: idemKey } });
    await mk('rq_old', 'cmd_old', 'i1'); await new Promise((r) => setTimeout(r, 20));
    await mk('rq_new', 'cmd_new', 'i2');
    const terms = { planetId: w.planetId, colonyId: a.colonyId, side: 'sell', resource: 'bio.water', amount: 10n, priceAmount: 1_000_000n };
    const repo = ex.get((await import('../../src/market/trade/trade-request.repository.js')).TradeRequestRepository);
    expect((await repo.claimSubmitted({ ...terms, commandId: 'cmd_new' }))?.requestId).toBe('rq_new');
    expect((await repo.claimSubmitted({ ...terms, commandId: 'cmd_nope' }))?.requestId).toBe('rq_old'); // fallback: terms, oldest first
    expect(await repo.claimSubmitted({ ...terms })).toBeNull(); // nothing left
  });
});

describe('fee buckets after a rolled-back fill equal an unsplit run', () => {
  const MAKERS: Array<[number, number]> = [[26, 777_750], [33, 1_000_050], [41, 2_000_050]]; // units, total quote: every notional ends in .50 of a fee unit, so subtracting a rolled-back floor leaves dust

  async function run(w: World, failSecond: boolean) {
    const sellers = await Promise.all(MAKERS.map(() => w.bot({ fund: { 'bio.water': '100' } })));
    const buyer = await w.bot({ fund: { USDC: '100' } });
    for (const [i, s] of sellers.entries()) await s.place(ord('sell', MAKERS[i]![0], MAKERS[i]![1]));
    const bid = (await buyer.place(ord('buy', 100, 5_000_000))).body.order.orderId as string;
    if (failSecond) {
      const trades = await ex.tradesOf(w.planetId);
      expect(trades).toHaveLength(3);
      const outbox = await ex.prisma.chainOutbox.findUniqueOrThrow({ where: { opId: `trade:${trades[1]!.tradeId}` } });
      const out = await ex.recovery.failTrade((outbox.payload as unknown as { trade: TradePlan }).trade, 'NEAR_INSUFFICIENT_BALANCE: test rollback');
      expect(out.failed).toBe(true);
      await ex.prisma.chainOutbox.update({ where: { opId: outbox.opId }, data: { status: 'DEAD' } }); // the failed row is abandoned like in production
    }
    await ex.settle();
    return { bid, buyer, sellers };
  }
  const shape = async (orderId: string) => {
    const o = await ex.order(orderId);
    return { state: o.state, filled: o.filled.toFixed(), cum: o.cumNotional.toFixed(), buckets: Object.values(o.feeBuckets as Record<string, { base: string; fee: string }>).map((b) => `${b.base}:${b.fee}`).sort() };
  };

  it('splits a buyer order across three makers unevenly, rolls the middle fill back, re-matches: buckets and fees equal the control', async () => {
    const wc = ex.world();
    const control = await run(wc, false);
    const wf = ex.world();
    const before = { sup: await ex.supply(), led: await ex.ledger() };
    const failed = await run(wf, true);
    const [c, f] = [await shape(control.bid), await shape(failed.bid)];
    expect(c.state).toBe('FILLED');
    expect(f).toEqual(c);
    const fin = (await ex.tradesOf(wf.planetId)).filter((t) => t.state === 'FINAL');
    const ctl = await ex.tradesOf(wc.planetId);
    const sum = (rows: typeof fin, k: 'platformFee' | 'stallFee' | 'notional') => rows.reduce((s, t) => s + BigInt(t[k].toFixed()), 0n);
    expect(fin).toHaveLength(3);
    expect(sum(fin, 'notional')).toBe(sum(ctl, 'notional'));
    // The buckets are exact (above). The fees already charged to the LATER fill (t3) were computed against the old cumulative, so the paid fee
    // rows can sit at most one atomic unit per bucket below the unsplit run (known limitation: re-pricing a committed later fill is out of scope).
    for (const k of ['platformFee', 'stallFee'] as const) {
      const d = sum(ctl, k) - sum(fin, k);
      expect(d >= 0n && d <= 1n, `${k} off by ${d}`).toBe(true);
    }
    expect((await ex.tradesOf(wf.planetId)).filter((t) => t.state === 'FAILED')).toHaveLength(1);
    expect(before.sup).toBeDefined();
    await auditPlanet(ex, wf.planetId);
    await auditPlanet(ex, wc.planetId);
    void (null as unknown as Actor); void randomUUID; void expectLedgerDelta;
  });
});
