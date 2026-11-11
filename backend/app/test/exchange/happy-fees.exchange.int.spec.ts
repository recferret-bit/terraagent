import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditPlanet, expectLedgerDelta } from './exchange-audit.js';
import { Exchange, PLATFORM, floorBp, ord, type Actor } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

const ok = (r: { status: number; body: unknown }) => { expect(r.status, JSON.stringify(r.body)).toBe(201); return (r.body as { order: { orderId: string; state: string } }).order; };

/** Settles everything, then asserts conservation, exact ledger deltas, book/reservation consistency. */
async function finish(planetId: string, before: { sup: Record<string, bigint>; led: Map<string, bigint> }) {
  await ex.settle();
  expect(await ex.supply()).toEqual(before.sup);
  await expectLedgerDelta(ex, planetId, before.led);
  await auditPlanet(ex, planetId);
}
const snap = async () => ({ sup: await ex.supply(), led: await ex.ledger() });

describe('happy paths: every actor pairing ends FINAL on the emulated chain', () => {
  const pairing = async (mk: (w: ReturnType<Exchange['world']>) => Promise<[Actor, Actor]>, kinds: [string, string], organic: boolean) => {
    const w = ex.world();
    const [seller, buyer] = await mk(w);
    await buyer.fund('USDC', 20_000_000n);
    if (seller.kind === 'player') await seller.fund('bio.water', 100n);
    const before = await snap();
    ok(await seller.place(ord('sell', 100, 5_000_000)));
    const bid = ok(await buyer.place(ord('buy', 100, 5_000_000)));
    expect(bid.state).toBe('FILLED');
    await finish(w.planetId, before);
    const [t] = await ex.tradesOf(w.planetId);
    expect(t).toMatchObject({ state: 'FINAL', organic, sellerActorKind: kinds[0], buyerActorKind: kinds[1] });
    expect([t!.notional.toFixed(), t!.platformFee.toFixed(), t!.stallFee.toFixed()]).toEqual(['5000000', '50000', '50000']);
    expect(await buyer.bal('bio.water')).toBe(100n);
    expect((await seller.bal('USDC')) % 10_000_000n).toBeGreaterThanOrEqual(5_050_000n); // notional + the maker stall fee
    // receipt on the chain and visible in the explorer feed for both sides
    expect(await ex.prisma.mockChainReceipt.count({ where: { opId: `trade:${t!.tradeId}`, status: 'success' } })).toBe(1);
    for (const a of [seller, buyer]) {
      const feed = await ex.api<Array<{ opId: string; status: string }>>('GET', `/dev/chain/receipts?account=${a.accountId}&limit=100`);
      expect(feed.body.find((r) => r.opId === `trade:${t!.tradeId}`)).toMatchObject({ status: 'success' });
    }
    expect(ex.settledCmds(t!.tradeId)).toHaveLength(3);
  };

  it('player vs player', () => pairing(async (w) => [await w.player(), await w.player()], ['player', 'player'], true));
  it('bot sells to a player', () => pairing(async (w) => [await w.bot(), await w.player()], ['bot', 'player'], true));
  it('player sells to a bot', () => pairing(async (w) => [await w.player(), await w.bot({ fund: { USDC: '1' } })], ['player', 'bot'], true));
  it('bot vs bot with different owners is organic', () => pairing(async (w) => [await w.bot(), await w.bot({ fund: { USDC: '1' } })], ['bot', 'bot'], true));
  it('bot vs bot of the SAME owner settles but is not organic', async () => {
    const w = ex.world();
    const name = `twin${Date.now()}`;
    const a = await w.bot({ name });
    const b = await w.bot({ name, fund: { USDC: '100' } });
    const before = await snap();
    ok(await a.place(ord('sell', 100, 5_000_000)));
    ok(await b.place(ord('buy', 100, 5_000_000)));
    await finish(w.planetId, before);
    expect((await ex.tradesOf(w.planetId))[0]).toMatchObject({ state: 'FINAL', organic: false });
  });
});

describe('fills: partial, many, sweep', () => {
  it('many partial fills of one resting ask: cumulative floor notional and per-buyer fees, odd totals', async () => {
    const w = ex.world();
    const seller = await w.bot();
    const A = 37n, T = 10_000_003n; // odd total for an odd quantity
    const sizes = [5, 5, 7, 3, 9, 1, 7]; // 37
    const buyers = await Promise.all(sizes.map(() => w.bot({ fund: { USDC: '50' } })));
    const before = await snap();
    ok(await seller.place(ord('sell', 37, T)));
    let cum = 0n; const expectN: bigint[] = [];
    for (const [i, n] of sizes.entries()) {
      // buy exactly n units at the ask's unit price rounded up so it crosses
      const total = (BigInt(n) * T + A - 1n) / A;
      ok(await buyers[i]!.place(ord('buy', n, total)));
      const prev = (cum * T) / A; cum += BigInt(n); expectN.push((cum * T) / A - prev);
    }
    await finish(w.planetId, before);
    const trades = await ex.tradesOf(w.planetId);
    expect(trades.map((t) => t.notional.toFixed())).toEqual(expectN.map(String));
    expect(trades.map((t) => t.platformFee.toFixed())).toEqual(expectN.map((n) => String(floorBp(n, 100))));
    expect(trades.map((t) => t.stallFee.toFixed())).toEqual(expectN.map((n) => String(floorBp(n, 100))));
    expect(expectN.reduce((s, n) => s + n, 0n)).toBe(T); // the pieces add up to the unsplit notional
    expect((await ex.order((await ex.ordersOf(w.planetId))[0]!.orderId)).state).toBe('FILLED');
  });

  it('one big bid sweeps several price levels at the maker prices; its fees are cumulative per bucket', async () => {
    const w = ex.world();
    const sellers = await Promise.all([0, 1, 2, 3].map(() => w.bot()));
    const buyer = await w.bot({ fund: { USDC: '500' } });
    const before = await snap();
    const asks: Array<[number, number]> = [[10, 100_007], [10, 200_011], [10, 200_011], [10, 300_013]]; // [qty, total]
    for (const [i, [q, t]] of asks.entries()) ok(await sellers[i]!.place(ord('sell', q, t)));
    const bid = ok(await buyer.place(ord('buy', 40, 1_300_000)));
    expect(bid.state).toBe('FILLED');
    await finish(w.planetId, before);
    const trades = await ex.tradesOf(w.planetId);
    expect(trades.map((t) => t.notional.toFixed())).toEqual(['100007', '200011', '200011', '300013']);
    const sumN = 100007n + 200011n * 2n + 300013n;
    const buyerOrder = (await ex.ordersOf(w.planetId)).find((o) => o.side === 'buy')!;
    // the fee of the buyer order is the cumulative floor over all fills (not the sum of per-fill floors)
    expect(trades.reduce((s, t) => s + BigInt(t.platformFee.toFixed()), 0n)).toBe(floorBp(sumN, 100));
    expect(BigInt(buyerOrder.cumNotional.toFixed())).toBe(sumN);
    expect(buyerOrder.state).toBe('FILLED');
    // the 1,000,000 reservation covered 603,..: leftover is free again (nothing stays locked)
    expect(BigInt(buyerOrder.reservedPrincipal.toFixed()) + BigInt(buyerOrder.reservedFees.toFixed())).toBe(0n);
  });

  it('taker with leftover rests PARTIAL and a later cross completes it', async () => {
    const w = ex.world();
    const s1 = await w.bot(); const s2 = await w.bot(); const b = await w.bot({ fund: { USDC: '100' } });
    const before = await snap();
    ok(await s1.place(ord('sell', 30, 300_000)));
    const bid = ok(await b.place(ord('buy', 100, 1_000_000)));
    expect(bid.state).toBe('PARTIAL');
    ok(await s2.place(ord('sell', 70, 700_000)));
    await finish(w.planetId, before);
    expect((await ex.ordersOf(w.planetId)).every((o) => o.state === 'FILLED')).toBe(true);
    expect(await b.bal('bio.water')).toBe(100n);
  });
});

describe('quote tokens and fee legs', () => {
  const trio = async (stallBp: number, makerSide: 'sell' | 'buy', total: bigint, amount = 100) => {
    const w = ex.world();
    const seller = await w.bot({ fund: { 'bio.water': '500' }, stallBp: makerSide === 'sell' ? stallBp : 100 });
    const buyer = await w.bot({ fund: { USDC: '2000' }, stallBp: makerSide === 'buy' ? stallBp : 100 });
    const before = await snap();
    const [maker, taker] = makerSide === 'sell' ? [seller, buyer] : [buyer, seller];
    ok(await maker.place(ord(makerSide, amount, total)));
    const r = ok(await taker.place(ord(makerSide === 'sell' ? 'buy' : 'sell', amount, total)));
    expect(r.state).toBe('FILLED');
    await finish(w.planetId, before);
    return { w, seller, buyer, t: (await ex.tradesOf(w.planetId))[0]! };
  };

  it.each([0, 1, 50, 99, 100])('stall fee %i bp: exact platform and stall legs, platform account gets exactly its fee', async (bp) => {
    const total = 7_654_321n;
    const platformBefore = await ex.balOf(PLATFORM, 'USDC');
    const { t, seller, buyer } = await trio(bp, 'sell', total);
    expect(t.stallFeeBp).toBe(bp);
    const platformFee = floorBp(total, 100);
    // W22 keeps 2 000 bp of the platform fee for the planet DAO. The buyer still pays the full platform fee.
    const treasuryFee = (platformFee * 2000n) / 10000n;
    expect(BigInt(t.platformFee.toFixed())).toBe(platformFee);
    expect(BigInt(t.stallFee.toFixed())).toBe(floorBp(total, bp));
    expect((await ex.balOf(PLATFORM, 'USDC')) - platformBefore).toBe(platformFee - treasuryFee);
    expect(await seller.bal('USDC')).toBe(total + floorBp(total, bp)); // seller is the maker stall
    expect(await buyer.bal('USDC')).toBe(2_000_000_000n - total - floorBp(total, 100) - floorBp(total, bp));
  });

  it('a resting BID is the maker: the buyer is its own stall, fees aggregate onto its leg (taker seller pays nothing)', async () => {
    const total = 1_234_567n;
    const { t, seller, buyer } = await trio(70, 'buy', total);
    expect(t.makerSide).toBe('buy');
    expect(t.stallFeeBp).toBe(70);
    expect(await seller.bal('USDC')).toBe(total);
    expect(await buyer.bal('USDC')).toBe(2_000_000_000n - total - floorBp(total, 100)); // pays the stall fee to itself
  });

  it('dust: a notional so small that both fees floor to zero still settles with zero fee legs', async () => {
    const w = ex.world();
    const al = { allowedPairs: ['bio.water/metals.t1'] };
    const seller = await w.bot({ fund: { 'bio.water': '10', USDC: '1' }, allowance: al });
    const buyer = await w.bot({ fund: { 'metals.t1': '100' }, allowance: al });
    const before = await snap();
    const pair = { resource: 'bio.water', price: { token: 'metals.t1', amount: '99' } };
    // 99 metals for 10 water: platform fee floor(99*100/10000) = 0
    ok(await seller.place(ord('sell', 10, 99, pair)));
    ok(await buyer.place(ord('buy', 10, 99, pair)));
    await finish(w.planetId, before);
    const t = (await ex.tradesOf(w.planetId))[0]!;
    expect([t.notional.toFixed(), t.platformFee.toFixed(), t.stallFee.toFixed()]).toEqual(['99', '0', '0']);
    expect(await buyer.bal('bio.water')).toBe(10n);
    expect(await seller.bal('metals.t1')).toBe(99n);
  });

  it('barter pair: base and quote are both resources, fees are in the quote resource', async () => {
    const w = ex.world();
    const al = { allowedPairs: ['bio.water/metals.t1'] };
    const seller = await w.bot({ fund: { 'bio.water': '200' }, allowance: al });
    const buyer = await w.bot({ fund: { 'metals.t1': '5000' }, allowance: al });
    const before = await snap();
    const pair = { resource: 'bio.water', price: { token: 'metals.t1', amount: '3333' } };
    ok(await seller.place(ord('sell', 100, 3333, pair)));
    ok(await buyer.place(ord('buy', 100, 3333, pair)));
    await finish(w.planetId, before);
    const t = (await ex.tradesOf(w.planetId))[0]!;
    expect(t).toMatchObject({ quote: 'metals.t1', base: 'bio.water', state: 'FINAL' });
    expect([t.notional.toFixed(), t.platformFee.toFixed(), t.stallFee.toFixed()]).toEqual(['3333', '33', '33']);
    expect(await seller.bal('metals.t1')).toBe(3333n + 33n);
    expect(await buyer.bal('metals.t1')).toBe(5000n - 3333n - 33n - 33n);
    expect(await buyer.bal('bio.water')).toBe(100n);
  });

  it('NEAR quote: 24-decimal amounts settle exactly', async () => {
    const w = ex.world();
    const al = { allowedPairs: ['bio.water/NEAR'], maxOrderNotional: '10000000000000000000000000', dailyBudget: '100000000000000000000000000' };
    const seller = await w.bot({ fund: { 'bio.water': '100' }, allowance: al });
    const buyer = await w.bot({ fund: { NEAR: '100' }, allowance: al });
    const before = await snap();
    const total = 12_345_678_901_234_567_890_123n; // 12.3 NEAR in yocto
    const pair = { resource: 'bio.water', price: { token: 'NEAR', amount: total.toString() } };
    ok(await seller.place(ord('sell', 100, total, pair)));
    ok(await buyer.place(ord('buy', 100, total, pair)));
    await finish(w.planetId, before);
    const t = (await ex.tradesOf(w.planetId))[0]!;
    expect(t.notional.toFixed()).toBe(total.toString());
    expect(BigInt(t.platformFee.toFixed())).toBe(floorBp(total, 100));
    expect(await seller.bal('NEAR')).toBe(total + floorBp(total, 100));
  });
});
