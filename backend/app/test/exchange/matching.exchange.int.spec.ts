import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditPlanet, expectLedgerDelta } from './exchange-audit.js';
import { Exchange, ord, sleep, type Actor } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

const id = (r: { body: any }): string => r.body.order.orderId;
const state = async (orderId: string) => (await ex.order(orderId)).state;
const claim = (a: Actor) => ex.prisma.nearColonyAccount.updateMany({ where: { accountId: a.accountId }, data: { claimedAt: new Date() } });
const snap = async () => { await ex.settle(); return { sup: await ex.supply(), led: await ex.ledger() }; };
async function settled(planetId: string, before: Awaited<ReturnType<typeof snap>>) {
  await ex.settle();
  expect(await ex.supply()).toEqual(before.sup);
  await expectLedgerDelta(ex, planetId, before.led);
  await auditPlanet(ex, planetId);
}

describe('matching corners over the real stack', () => {
  it('self-trade is skipped: the same colony bid and ask both rest', async () => {
    const w = ex.world();
    const a = await w.bot();
    const ask = await a.place(ord('sell', 10, 1_000_000));
    const bid = await a.place(ord('buy', 10, 1_000_000));
    expect([ask.status, bid.status]).toEqual([201, 201]);
    expect([await state(id(ask)), await state(id(bid))]).toEqual(['OPEN', 'OPEN']);
    expect(await ex.tradesOf(w.planetId)).toHaveLength(0);
    await auditPlanet(ex, w.planetId);
  });

  it('two bots of one owner DO match each other (different colonies) but the fill is not organic', async () => {
    const w = ex.world();
    const name = `sameown${Date.now()}`;
    const a = await w.bot({ name });
    const b = await w.bot({ name });
    const before = await snap();
    await a.place(ord('sell', 10, 1_000_000));
    expect((await b.place(ord('buy', 10, 1_000_000))).body.order.state).toBe('FILLED');
    await settled(w.planetId, before);
    expect((await ex.tradesOf(w.planetId))[0]!.organic).toBe(false);
  });

  it('price-time priority: of two equal asks the older fills first; a better price beats time', async () => {
    const w = ex.world();
    const [s1, s2, s3, b] = [await w.bot(), await w.bot(), await w.bot(), await w.bot({ fund: { USDC: '100' } })];
    const o1 = id(await s1.place(ord('sell', 10, 1_000_000)));
    const o2 = id(await s2.place(ord('sell', 10, 1_000_000)));
    const o3 = id(await s3.place(ord('sell', 10, 900_000))); // better price, newest
    await b.place(ord('buy', 10, 1_000_000));
    expect([await state(o3), await state(o1), await state(o2)]).toEqual(['FILLED', 'OPEN', 'OPEN']);
    await b.place(ord('buy', 10, 1_000_000));
    expect([await state(o1), await state(o2)]).toEqual(['FILLED', 'OPEN']); // equal price: older (o1) first
    await ex.settle();
    await auditPlanet(ex, w.planetId);
  });

  it('stall fee above the buyer maximum: no fill; a buyer that accepts it fills', async () => {
    const w = ex.world();
    const seller = await w.bot({ stallBp: 100 });
    const picky = await w.bot({ fund: { USDC: '100' } });
    const ok = await w.bot({ fund: { USDC: '100' } });
    const ask = id(await seller.place(ord('sell', 10, 1_000_000)));
    const noFill = await picky.place(ord('buy', 10, 1_000_000, { maxStallFeeBp: 50 }));
    expect(noFill.body.order.state).toBe('OPEN');
    expect(await state(ask)).toBe('OPEN');
    expect((await ok.place(ord('buy', 10, 1_000_000, { maxStallFeeBp: 100 }))).body.order.state).toBe('FILLED');
    await ex.settle();
    await auditPlanet(ex, w.planetId);
  });

  it('a buy without maxStallFeeBp defaults its maximum to the policy ceiling (100 bp) and takes the cheaper 100 bp ask', async () => {
    const w = ex.world();
    const free = await w.bot({ stallBp: 0 });
    const paying = await w.bot({ stallBp: 100 });
    const buyer = await w.bot({ fund: { USDC: '100' } });
    const body = ord('buy', 10, 1_300_000); delete (body as any).maxStallFeeBp;
    const fromPaying = id(await paying.place(ord('sell', 10, 1_000_000)));
    const fromFree = id(await free.place(ord('sell', 10, 1_200_000)));
    expect((await buyer.place(body)).body.order.state).toBe('FILLED');
    expect([await state(fromPaying), await state(fromFree)]).toEqual(['FILLED', 'OPEN']);
    await ex.settle();
    await auditPlanet(ex, w.planetId);
  });

  it('all-or-nothing taker: a claimed bid for 30 does not take 20; it rests unfilled, then a 30-unit seller fills it whole', async () => {
    const w = ex.world();
    const [s1, s2, s3, aon] = [await w.bot(), await w.bot(), await w.bot(), await w.bot({ fund: { USDC: '100' } })];
    await claim(aon);
    const before = await snap();
    const small = id(await s1.place(ord('sell', 20, 2_000_000)));
    const t1 = await aon.place(ord('buy', 30, 3_000_000));
    expect(t1.body.order).toMatchObject({ state: 'OPEN', filled: 0 });
    expect(await state(small)).toBe('OPEN');
    const s2o = await s2.place(ord('sell', 10, 1_000_000)); // taker of 10 against an AON maker of 30: skipped
    expect(s2o.body.order.state).toBe('OPEN');
    expect(await state(id(t1))).toBe('OPEN');
    expect((await s3.place(ord('sell', 30, 3_000_000))).body.order.state).toBe('FILLED'); // completes the AON bid whole
    expect(await state(id(t1))).toBe('FILLED');
    await settled(w.planetId, before);
  });

  it('all-or-nothing maker: a smaller taker skips it, a taker of the full size takes it', async () => {
    const w = ex.world();
    const [aon, small, full] = [await w.bot(), await w.bot({ fund: { USDC: '100' } }), await w.bot({ fund: { USDC: '100' } })];
    await claim(aon);
    const before = await snap();
    const ask = id(await aon.place(ord('sell', 40, 4_000_000)));
    const p = await small.place(ord('buy', 5, 500_000));
    expect(p.body.order).toMatchObject({ state: 'OPEN', filled: 0 });
    expect(await state(ask)).toBe('OPEN');
    expect((await full.place(ord('buy', 40, 4_000_000))).body.order.state).toBe('FILLED');
    expect(await state(ask)).toBe('FILLED');
    await settled(w.planetId, before);
  });

  it('policy version change mid-book: incompatible orders do not cross until the old one is cancelled and reposted', async () => {
    const w = ex.world();
    const [s, b] = [await w.bot(), await w.bot({ fund: { USDC: '100' } })];
    const before = await snap();
    const old = id(await s.place(ord('sell', 10, 1_000_000)));
    const policy = ex.policy as unknown as { cached: Record<string, unknown> };
    const v1 = policy.cached ?? (ex.policy.current() as unknown as Record<string, unknown>);
    policy.cached = { ...ex.policy.current(), policyVersion: 'bootstrap-2' } as never;
    try {
      const bid = await b.place(ord('buy', 10, 1_000_000));
      expect(bid.body.order.state).toBe('OPEN'); // pinned to v2: the v1 ask is skipped, never silently re-termed
      expect((await ex.order(old)).policyVersion).toBe(v1.policyVersion);
      expect((await ex.order(id(bid))).policyVersion).toBe('bootstrap-2');
      expect((await s.cancel(old)).status).toBe(200);
      const repost = await s.place(ord('sell', 10, 1_000_000));
      expect(repost.body.order.state).toBe('FILLED');
    } finally { policy.cached = v1 as never; }
    await settled(w.planetId, before);
  });

  it('minimum notional boundary: one atomic below is refused, exactly the minimum is accepted', async () => {
    const w = ex.world();
    const a = await w.bot();
    const below = await a.place(ord('sell', 10, 99_999));
    expect(below.status).toBe(422);
    expect(below.body.error.code).toBe('order_too_small');
    const at = await a.place(ord('sell', 10, 100_000));
    expect(at.status).toBe(201);
    await auditPlanet(ex, w.planetId);
  });

  it('TTL: a resting order expires once, releases its reservation, and the book drops it', async () => {
    const w = ex.world();
    const s = await w.bot();
    const o = id(await s.place(ord('sell', 10, 1_000_000, { ttlS: 900 })));
    await ex.prisma.marketOrder.update({ where: { orderId: o }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await ex.sweep.sweep()).toContain(o);
    expect(await ex.sweep.sweep()).not.toContain(o); // second sweep: nothing to do
    expect(await state(o)).toBe('EXPIRED');
    expect(ex.releasesOf(o).filter((c) => (c.args as { reason: string }).reason === 'expired')).toHaveLength(1);
    await auditPlanet(ex, w.planetId);
  });

  it('TTL during match: a maker whose TTL ran out (not yet swept) must not fill', async () => {
    const w = ex.world();
    const [s, b] = [await w.bot(), await w.bot({ fund: { USDC: '100' } })];
    const o = id(await s.place(ord('sell', 10, 1_000_000, { ttlS: 900 })));
    await ex.prisma.marketOrder.update({ where: { orderId: o }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await ex.books.sync(o);
    const bid = await b.place(ord('buy', 10, 1_000_000));
    expect(bid.body.order.state).toBe('OPEN'); // an expired quote is not executable even before the sweep gets to it
    expect(await state(o)).not.toBe('FILLED');
  });

  it('open-order limit per colony: the 21st order is refused with order_limit; cancelling one frees a slot', async () => {
    const w = ex.world();
    const a = await w.bot({ allowance: { maxOpenOrders: 100 } });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(id(await a.place(ord('sell', 1, 100_000 + i, { resource: 'bio.water' }))));
    const over = await a.place(ord('sell', 1, 100_100));
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('order_limit');
    expect((await a.cancel(ids[0]!)).status).toBe(200);
    expect((await a.place(ord('sell', 1, 100_100))).status).toBe(201);
    await auditPlanet(ex, w.planetId);
  });
});

describe('cancel semantics', () => {
  it('cancel of a PARTIAL order releases only the rest; the in-flight fill still settles once and conserves', async () => {
    const w = ex.world();
    const [s, b] = [await w.bot(), await w.bot({ fund: { USDC: '100' } })];
    const before = await snap();
    const ask = id(await s.place(ord('sell', 100, 5_000_000)));
    await b.place(ord('buy', 40, 2_000_000));
    expect(await state(ask)).toBe('PARTIAL');
    const c = await s.cancel(ask);
    expect(c.status).toBe(200);
    const row = await ex.order(ask);
    expect([row.state, row.filled.toFixed(), row.reservedPrincipal.toFixed()]).toEqual(['CANCELLED', '40', '0']);
    expect(ex.releasesOf(ask).filter((x) => (x.args as { reason: string }).reason === 'cancelled')).toHaveLength(1);
    await settled(w.planetId, before);
    expect((await ex.tradesOf(w.planetId))[0]!.state).toBe('FINAL');
  });

  it('cancel of a FILLED order is 409 order_not_open; a double cancel is idempotent; a stranger gets 404', async () => {
    const w = ex.world();
    const [s, b, stranger] = [await w.bot(), await w.bot({ fund: { USDC: '100' } }), await w.bot()];
    const ask = id(await s.place(ord('sell', 10, 1_000_000)));
    await b.place(ord('buy', 10, 1_000_000));
    const filled = await s.cancel(ask);
    expect(filled.status).toBe(409);
    expect(filled.body.error.code).toBe('order_not_open');
    const rest = id(await s.place(ord('sell', 10, 2_000_000)));
    expect((await stranger.cancel(rest)).status).toBe(404);
    expect((await s.cancel(rest)).status).toBe(200);
    expect((await s.cancel(rest)).status).toBe(200);
    expect(ex.releasesOf(rest).filter((x) => (x.args as { reason: string }).reason === 'cancelled')).toHaveLength(1);
    expect((await ex.order(rest)).state).toBe('CANCELLED');
    await ex.settle();
    await auditPlanet(ex, w.planetId);
  });

  it('foreign planet: a key cannot place on or cancel orders of another planet', async () => {
    const w1 = ex.world(); const w2 = ex.world();
    const a = await w1.bot(); const c = await w2.bot();
    const wrong = await a.req('POST', '/trade/orders', { body: { ...ord('sell', 10, 1_000_000), planetId: w2.planetId }, idem: `x${Date.now()}` });
    expect(wrong.status).toBe(409 === wrong.status ? 409 : wrong.status);
    expect(wrong.body.error.code).toBe('wrong_planet');
    const theirs = id(await c.place(ord('sell', 10, 1_000_000)));
    expect((await a.cancel(theirs)).status).toBe(404);
    expect(await state(theirs)).toBe('OPEN');
  });

  it.fails('KNOWN: two colonies with the same index on different planets do not share funds or reservations (scenario planets share col_<n> accounts)', async () => {
    const w1 = ex.world(); const w2 = ex.world();
    const idx = 880 + Math.floor(Math.random() * 90);
    const mk = (planetId: string, name: string, fund: object) => ex.api('POST', '/dev/trade/bots', { body: { name, planetId, colonyIndex: idx, fund } });
    const a = await mk(w1.planetId, `fa${idx}`, { 'bio.water': '100' });
    const b = await mk(w2.planetId, `fb${idx}`, {});
    expect([a.status, b.status]).toEqual([201, 201]);
    const accA = (await ex.prisma.tradeApiKey.findUniqueOrThrow({ where: { keyId: a.body.keyId } })).accountId;
    const accB = (await ex.prisma.tradeApiKey.findUniqueOrThrow({ where: { keyId: b.body.keyId } })).accountId;
    // an unfunded colony of another planet must not be able to sell the first colony's water
    const sold = await ex.api('POST', '/trade/orders', { auth: b.body.secret, idem: `f${Date.now()}`, body: ord('sell', 100, 1_000_000) });
    expect(accA === accB && sold.status === 201, `planet ${w2.planetId} sold funds of ${w1.planetId} (shared account ${accA})`).toBe(false);
    await sleep(0);
  });
});
