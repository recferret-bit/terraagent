/* eslint-disable @typescript-eslint/no-explicit-any -- test harness: loosely typed JSON replies */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Exchange, ord, type Actor, type World } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

const PAIR = 'bio.water/USDC';
const UNIT = 10_000n; // quote atomic per unit: 10 units = 0.1 USDC = the minimum notional

async function row(w: World) {
  await ex.settle();
  ex.board.invalidate(w.planetId);
  const r = await ex.api('GET', `/trade/board/${w.planetId}`);
  expect(r.status).toBe(200);
  return (r.body.board as Array<any>).find((x) => x.pair === PAIR);
}
/** seller (rests) -> buyer (takes): one fill of `units`. */
async function fill(seller: Actor, buyer: Actor, units: number) {
  const total = BigInt(units) * UNIT;
  await seller.place(ord('sell', units, total));
  const r = await buyer.place(ord('buy', units, total));
  expect(r.body.order?.state, JSON.stringify(r.body)).toBe('FILLED');
}
const pair = async (w: World, o: { sName?: string; bName?: string } = {}) => [await w.bot({ ...(o.sName ? { name: o.sName } : {}) }), await w.bot({ fund: { USDC: '20' }, ...(o.bName ? { name: o.bName } : {}) })] as const;

describe('organic flag of fills (truth table through real settlement)', () => {
  it('player/bot in any pairing with different owners is organic; the trade rows say so after FINAL', async () => {
    const w = ex.world();
    const [bs, bb] = await pair(w);
    const ps = await w.player();
    const pb = await w.player();
    await ps.fund('bio.water', 100n); await pb.fund('USDC', 20_000_000n);
    await fill(bs, pb, 10); await fill(ps, bb, 10); await fill(ps, pb, 10); await fill(bs, bb, 10);
    await ex.settle();
    const rows = await ex.tradesOf(w.planetId);
    expect(rows.map((t) => [t.sellerActorKind, t.buyerActorKind, t.organic, t.state])).toEqual([
      ['bot', 'player', true, 'FINAL'], ['player', 'bot', true, 'FINAL'], ['player', 'player', true, 'FINAL'], ['bot', 'bot', true, 'FINAL'],
    ]);
  });

  it('same owner (two bots of one owner) is not organic', async () => {
    const w = ex.world();
    const name = `own${Date.now()}`;
    const [s, b] = await pair(w, { sName: name, bName: name });
    await fill(s, b, 10);
    await ex.settle();
    expect((await ex.tradesOf(w.planetId))[0]).toMatchObject({ organic: false, state: 'FINAL' });
  });

  it('fixture, subsidy, npc and guild sides are never organic, whichever side they are on', async () => {
    const w = ex.world();
    const kinds = ['fixture', 'subsidy', 'npc', 'guild'] as const;
    for (const kind of kinds) {
      const [s, b] = await pair(w);
      await ex.placeAs(s, kind, { side: 'sell', amount: 10, price: { token: 'USDC', amount: String(10n * UNIT) } });
      expect((await b.place(ord('buy', 10, 10n * UNIT))).body.order.state).toBe('FILLED'); // fixture is the maker
      const [s2, b2] = await pair(w);
      await b2.fund('USDC', 1n);
      await s2.place(ord('sell', 10, 10n * UNIT));
      await ex.placeAs(b2, kind, { side: 'buy', amount: 10, price: { token: 'USDC', amount: String(10n * UNIT) }, maxStallFeeBp: 100 }); // fixture is the taker
    }
    await ex.settle();
    const rows = await ex.tradesOf(w.planetId);
    expect(rows).toHaveLength(8);
    expect(rows.every((t) => t.organic === false && t.state === 'FINAL')).toBe(true);
    expect(new Set(rows.flatMap((t) => [t.buyerActorKind, t.sellerActorKind])).size).toBeGreaterThanOrEqual(5);
  });
});

describe('VWAP only from enough organic evidence', () => {
  it('no trades: the pair is listed as insufficient_data without a reference', async () => {
    const w = ex.world();
    const r = await row(w);
    expect(r).toMatchObject({ classification: 'insufficient_data', vwap: null, reason: 'insufficient_data' });
  });

  it('two organic trades are not enough: no vwap, but last price and volume are shown', async () => {
    const w = ex.world();
    for (let i = 0; i < 2; i++) { const [s, b] = await pair(w); await fill(s, b, 10); }
    const r = await row(w);
    expect(r).toMatchObject({ classification: 'insufficient_data', vwap: null, reason: 'insufficient_data', volume24h: 20 });
    expect(r.last).toEqual({ num: '10000', den: 1 });
  });

  it('three trades but under 10 units of volume: insufficient_data', async () => {
    const w = ex.world();
    for (let i = 0; i < 3; i++) {
      const [s, b] = await pair(w);
      await s.place(ord('sell', 3, 100_000));
      expect((await b.place(ord('buy', 3, 100_000))).body.order.state).toBe('FILLED'); // 9 units over 3 trades
    }
    const r = await row(w);
    expect(r).toMatchObject({ vwap: null, classification: 'insufficient_data', volume24h: 9 });
  });

  it('three trades between only two colonies: too few counterparties', async () => {
    const w = ex.world();
    const [s, b] = await pair(w);
    for (let i = 0; i < 3; i++) await fill(s, b, 10);
    const r = await row(w);
    expect(r).toMatchObject({ classification: 'insufficient_data', vwap: null, counterparties: 2 });
  });

  it('one party in every trade is concentrated: no vwap even with 3+ counterparties', async () => {
    const w = ex.world();
    const hub = await w.bot({ fund: { 'bio.water': '500' } });
    for (let i = 0; i < 4; i++) { const b = await w.bot({ fund: { USDC: '20' } }); await fill(hub, b, 10); }
    const r = await row(w);
    expect(r.vwap).toBeNull();
    expect(r.reason).toBe('concentrated');
    expect(r.concentrationBp).toBe(5000);
  });

  it('4 trades among 8 owners: organic, vwap is exact and the allowance band can use it', async () => {
    const w = ex.world();
    for (let i = 0; i < 4; i++) { const [s, b] = await pair(w); await fill(s, b, 10); }
    const r = await row(w);
    expect(r).toMatchObject({ classification: 'organic', vwap: { num: '10000', den: 1 }, counterparties: 8, eligibleVolume: 40, volume24h: 40 });
    const book = await ex.api('GET', `/trade/book/${w.planetId}/${encodeURIComponent(PAIR)}`);
    expect(book.body.reference).toEqual({ num: '10000', den: 1 });
  });

  it('same-owner and fixture trades never feed the reference: 4 non-organic trades leave no vwap', async () => {
    const w = ex.world();
    const name = `same${Date.now()}`;
    for (let i = 0; i < 2; i++) { const [s, b] = await pair(w, { sName: name, bName: name }); await fill(s, b, 10); }
    for (let i = 0; i < 2; i++) {
      const [s, b] = await pair(w);
      await ex.placeAs(s, 'fixture', { side: 'sell', amount: 10, price: { token: 'USDC', amount: String(10n * UNIT) } });
      await b.place(ord('buy', 10, 10n * UNIT));
    }
    const r = await row(w);
    expect(r).toMatchObject({ classification: 'fixture', vwap: null, volume24h: 40 }); // shown, never a reference
  });

  it('a mix of organic and fixture fills prices from the organic ones only (mixed)', async () => {
    const w = ex.world();
    for (let i = 0; i < 4; i++) { const [s, b] = await pair(w); await fill(s, b, 10); }
    const [s, b] = await pair(w);
    await ex.placeAs(s, 'fixture', { side: 'sell', amount: 10, price: { token: 'USDC', amount: String(10n * UNIT * 3n) } }); // fixture trades at 3x
    await b.place(ord('buy', 10, 10n * UNIT * 3n));
    const r = await row(w);
    expect(r.classification).toBe('mixed');
    expect(r.vwap).toEqual({ num: '10000', den: 1 }); // the 3x fixture trade is excluded
    expect(r.volume24h).toBe(50);
  });
});
