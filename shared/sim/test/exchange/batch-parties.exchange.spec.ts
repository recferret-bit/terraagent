import { describe, expect, it } from 'vitest';
import {
  aggregateLegs, assertZeroSum, buildTradeBatch, type BuildBatchInput, type Leg, type TradeBatch, type TreasuryTerms,
} from '../../src/systems/trade/market-batch';
import { matchIncoming } from '../../src/systems/trade/market-matcher';
import { planParties, type PartyOrder } from '../../src/systems/trade/market-parties';
import { maxBuyerFees } from '../../src/systems/trade/market-fees';
import { randBig, randInt, rng, SEEDS, xbook, xo, type XOrder } from './exchange-kit';

const off: TreasuryTerms = { enabled: false, shareBp: 2000, accountId: 'treasury' };
const on: TreasuryTerms = { enabled: true, shareBp: 2000, accountId: 'treasury' };
const sumBy = (legs: readonly Leg[]): Map<string, bigint> => {
  const m = new Map<string, bigint>();
  for (const l of legs) m.set(l.token, (m.get(l.token) ?? 0n) + l.delta);
  return m;
};
const net = (b: TradeBatch, account: string, token: string): bigint => b.legs.filter((l) => l.accountId === account && l.token === token).reduce((a, l) => a + l.delta, 0n);

function fillBatch(buyer: XOrder, seller: XOrder, taker: 'buyer' | 'seller', treasury = off, quote = 'USDC', base = 'bio.water'): TradeBatch {
  const takerOrder = taker === 'buyer' ? buyer : seller;
  const maker = taker === 'buyer' ? seller : buyer;
  const { fills } = matchIncoming(xbook(maker), takerOrder);
  expect(fills).toHaveLength(1);
  return buildTradeBatch({ tradeId: 't1', base, quote, fill: fills[0]!, buyer, seller, treasury });
}

describe('exchange batch: conservation', () => {
  it('every fill of a random run is zero-sum per token in legs and attribution, for both taker sides and treasury on/off', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const amount = randBig(r, 1, 80);
      const price = randBig(r, 100, 90_000);
      const mkSeller = () => xo('sell', amount, price, { stallFeeBp: [0, 30, 100][randInt(r, 0, 2)]! });
      const buyer = xo('buy', amount, price * 2n, { maxStallFeeBp: 100, reservedPrincipal: price * 2n, reservedFees: price });
      const seller = mkSeller();
      const takerBuyer = r() < 0.5;
      const b = fillBatch(buyer, seller, takerBuyer ? 'buyer' : 'seller', r() < 0.5 ? on : off);
      for (const m of sumBy(b.legs).values()) expect(m).toBe(0n);
      for (const m of sumBy(b.attribution).values()) expect(m).toBe(0n);
      expect(b.legs.every((l) => l.delta !== 0n)).toBe(true);
      expect(net(b, buyer.accountId, 'USDC')).toBe(-(b.notional + b.platformFee + b.stallFee));
      expect(net(b, seller.accountId, 'USDC')).toBe(b.notional);
      expect(net(b, buyer.accountId, 'bio.water')).toBe(b.qty);
      expect(net(b, seller.accountId, 'bio.water')).toBe(-b.qty);
      expect(b.platformRetained + b.treasuryAllocation).toBe(b.platformFee);
    }
  });
  it('sequential partial fills: notional sums to the maker price, buyer fees stay within maxBuyerFees, reservations never go negative', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const amount = randBig(r, 3, 60), price = randBig(r, 50, 40_000);
      let seller = xo('sell', amount, price, { stallFeeBp: 100 });
      let buyer = xo('buy', amount, price, { reservedPrincipal: price, reservedFees: maxBuyerFees(price, 100, 100) });
      let notional = 0n, fees = 0n;
      while (buyer.filled < amount) {
        const q = randBig(r, 1, Number(amount - buyer.filled));
        const fill = matchIncoming(xbook(seller), { ...buyer, amount: buyer.filled + q, filled: buyer.filled }).fills[0]!;
        const b = buildTradeBatch({ tradeId: 't', base: 'bio.water', quote: 'USDC', fill, buyer, seller, treasury: off });
        notional += b.notional; fees += b.platformFee + b.stallFee;
        expect(b.buyer.reservedPrincipal).toBeGreaterThanOrEqual(0n);
        expect(b.buyer.reservedFees).toBeGreaterThanOrEqual(0n);
        buyer = { ...buyer, ...b.buyer, amount }; seller = { ...seller, ...b.seller, amount };
      }
      expect(notional).toBe(price);
      expect(fees).toBeLessThanOrEqual(maxBuyerFees(price, 100, 100));
      expect(buyer.filled).toBe(amount);
      expect(buyer.reservedPrincipal + buyer.reservedFees).toBe(0n);
    }
  });
  it('completing fill releases price improvement and fee slack', () => {
    const seller = xo('sell', 10n, 100_000n); // ask 10000/unit
    const buyer = xo('buy', 10n, 200_000n, { reservedPrincipal: 200_000n, reservedFees: 4_000n });
    const b = fillBatch(buyer, seller, 'buyer');
    expect(b.notional).toBe(100_000n);
    expect(b.platformFee).toBe(1000n);
    expect(b.stallFee).toBe(1000n);
    expect(b.buyer).toMatchObject({ filled: 10n, reservedPrincipal: 0n, reservedFees: 0n, releasePrincipal: 100_000n, releaseFees: 2000n });
    expect(b.seller).toMatchObject({ filled: 10n, releasePrincipal: 0n });
  });
});

describe('exchange batch: fee attribution', () => {
  const seller = () => xo('sell', 10n, 1_000_000n, { stallFeeBp: 50, stallAccountId: 'stall-S' });
  const buyer = () => xo('buy', 10n, 1_000_000n, { platformAccountId: 'plat', stallFeeBp: 20 });
  it('platform fee to the platform account; stall fee to the MAKER stall (seller maker)', () => {
    const s = seller(), b = buyer();
    const bat = fillBatch(b, s, 'buyer');
    expect(bat.platformFee).toBe(10_000n);
    expect(bat.stallFee).toBe(5_000n);
    expect(bat.stallFeeBp).toBe(50);
    expect(net(bat, 'plat', 'USDC')).toBe(10_000n);
    expect(net(bat, 'stall-S', 'USDC')).toBe(5_000n);
    expect(bat.attribution.filter((l) => l.kind === 'stall_fee').map((l) => l.accountId).sort()).toEqual([b.accountId, 'stall-S'].sort());
  });
  it('buyer maker: the buyer own stall earns the fee', () => {
    const b = xo('buy', 10n, 1_000_000n, { stallFeeBp: 20, stallAccountId: 'stall-B', platformAccountId: 'plat' });
    const bat = fillBatch(b, seller(), 'seller');
    expect(bat.stallFeeBp).toBe(20);
    expect(bat.stallFee).toBe(2_000n);
    expect(net(bat, 'stall-B', 'USDC')).toBe(2_000n);
  });
  it('treasury carve-out comes from the platform fee, never the stall fee', () => {
    const bat = fillBatch(buyer(), seller(), 'buyer', on);
    expect(bat.treasuryAllocation).toBe(2_000n);
    expect(bat.platformRetained).toBe(8_000n);
    expect(net(bat, 'treasury', 'USDC')).toBe(2_000n);
    expect(net(bat, 'plat', 'USDC')).toBe(8_000n);
    expect(net(bat, 'stall-S', 'USDC')).toBe(5_000n);
    expect(fillBatch(buyer(), seller(), 'buyer', off).treasuryAllocation).toBe(0n);
  });
  it('stall 0 bp: no stall leg at all; platform 0 bp: no platform leg', () => {
    const bat = fillBatch(buyer(), xo('sell', 10n, 1_000_000n, { stallFeeBp: 0 }), 'buyer');
    expect(bat.stallFee).toBe(0n);
    expect(bat.attribution.some((l) => l.kind === 'stall_fee')).toBe(false);
    const p0 = fillBatch(xo('buy', 10n, 1_000_000n, { platformFeeBp: 0 }), xo('sell', 10n, 1_000_000n, { platformFeeBp: 0 }), 'buyer');
    expect(p0.platformFee).toBe(0n);
    expect(p0.attribution.some((l) => l.kind === 'platform_fee')).toBe(false);
  });
  it('max rates: stall 100 bp and platform 100 bp are exactly 1% each', () => {
    const bat = fillBatch(xo('buy', 10n, 1_000_000n), xo('sell', 10n, 1_000_000n), 'buyer');
    expect([bat.platformFee, bat.stallFee]).toEqual([10_000n, 10_000n]);
  });
  it('dust fill: fee rounds to 0, no zero legs are emitted, still zero-sum', () => {
    const bat = fillBatch(xo('buy', 1n, 50n), xo('sell', 1n, 50n), 'buyer');
    expect(bat.platformFee).toBe(0n);
    expect(bat.legs.every((l) => l.delta !== 0n)).toBe(true);
    assertZeroSum(bat.legs);
  });
  it('treasury share 100% moves the whole platform fee; treasury on with zero fee adds no leg', () => {
    const t = fillBatch(buyer(), seller(), 'buyer', { enabled: true, shareBp: 10_000, accountId: 'treasury' });
    expect(t.platformRetained).toBe(0n);
    expect(net(t, 'plat', 'USDC')).toBe(0n);
    const z = fillBatch(xo('buy', 1n, 50n), xo('sell', 1n, 50n), 'buyer', on);
    expect(z.attribution.some((l) => l.kind === 'treasury')).toBe(false);
  });
});

describe('exchange batch: account aggregation', () => {
  it('aggregateLegs merges equal (account, token), drops zeros, sorts by token then account', () => {
    const legs = aggregateLegs([
      { accountId: 'b', token: 'USDC', delta: 5n }, { accountId: 'a', token: 'USDC', delta: -5n }, { accountId: 'b', token: 'USDC', delta: -5n },
      { accountId: 'a', token: 'USDC', delta: 5n }, { accountId: 'z', token: 'A', delta: 1n }, { accountId: 'a', token: 'A', delta: -1n },
    ]);
    expect(legs).toEqual([{ accountId: 'a', token: 'A', delta: -1n }, { accountId: 'z', token: 'A', delta: 1n }]);
  });
  it('assertZeroSum throws on an imbalance and passes an empty batch', () => {
    expect(() => assertZeroSum([{ accountId: 'a', token: 'X', delta: 1n }])).toThrow(/zero-sum/);
    expect(() => assertZeroSum([])).not.toThrow();
  });
  it('same account on both sides nets to fees only', () => {
    const b = xo('buy', 10n, 1_000_000n, { accountId: 'same', platformAccountId: 'plat' });
    const s = xo('sell', 10n, 1_000_000n, { accountId: 'same', stallAccountId: 'stall-S', stallFeeBp: 50 });
    const bat = fillBatch(b, s, 'buyer');
    expect(net(bat, 'same', 'bio.water')).toBe(0n);
    expect(net(bat, 'same', 'USDC')).toBe(-(bat.platformFee + bat.stallFee));
    assertZeroSum(bat.legs);
  });
  it('seller account that is also the stall account is merged into one leg', () => {
    const s = xo('sell', 10n, 1_000_000n, { accountId: 'S', stallAccountId: 'S', stallFeeBp: 50 });
    const bat = fillBatch(xo('buy', 10n, 1_000_000n), s, 'buyer');
    expect(bat.legs.filter((l) => l.accountId === 'S' && l.token === 'USDC')).toEqual([{ accountId: 'S', token: 'USDC', delta: 1_000_000n + 5_000n }]);
  });
  it('platform and treasury sharing one account are merged', () => {
    const bat = fillBatch(xo('buy', 10n, 1_000_000n), xo('sell', 10n, 1_000_000n), 'buyer', { enabled: true, shareBp: 2000, accountId: 'platform' });
    expect(bat.legs.filter((l) => l.accountId === 'platform')).toEqual([{ accountId: 'platform', token: 'USDC', delta: 10_000n }]);
  });
  // BUG (it.fails): batch builder keys the platform and the stall bucket by (quote, bp, ACCOUNT, policy). When both fee
  // accounts and rates coincide the keys collide and the second charge floors over a base that already holds this fill.
  it.fails('platform and stall fees do not share a bucket when platform account == stall account and rates are equal', () => {
    let s = xo('sell', 3n, 150n, { stallFeeBp: 100, stallAccountId: 'platform' });
    let b = xo('buy', 3n, 150n, { platformFeeBp: 100, platformAccountId: 'platform' });
    let notional = 0n, plat = 0n, stall = 0n;
    for (let i = 0; i < 3; i++) {
      const fill = matchIncoming(xbook(s), { ...b, amount: b.filled + 1n }).fills[0]!;
      const bat = buildTradeBatch({ tradeId: `t${i}`, base: 'bio.water', quote: 'USDC', fill, buyer: b, seller: s, treasury: off });
      notional += bat.notional; plat += bat.platformFee; stall += bat.stallFee;
      b = { ...b, ...bat.buyer, amount: 3n }; s = { ...s, ...bat.seller, amount: 3n };
    }
    const expected = (notional * 100n) / 10_000n;
    expect([plat, stall]).toEqual([expected, expected]);
  });
});

describe('exchange batch: hash and validation', () => {
  const mk = (): [XOrder, XOrder] => [xo('buy', 10n, 1_000_000n, { orderId: 'B', accountId: 'aB' }), xo('sell', 10n, 1_000_000n, { orderId: 'S', accountId: 'aS', stallAccountId: 'stS' })];
  const input = (over: Partial<BuildBatchInput> = {}): BuildBatchInput => {
    const [b, s] = mk();
    const fill = matchIncoming(xbook(s), b).fills[0]!;
    return { tradeId: 't', base: 'bio.water', quote: 'USDC', fill, buyer: b, seller: s, treasury: off, ...over };
  };
  it('same input gives an identical batch and hash; hash is a sha256: digest', () => {
    const a = buildTradeBatch(input()), b = buildTradeBatch(input());
    expect(a.batchHash).toBe(b.batchHash);
    expect(a.batchHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a).toEqual(b);
  });
  it('hash changes with trade id, treasury terms and fee accounts', () => {
    const base = buildTradeBatch(input()).batchHash;
    expect(buildTradeBatch(input({ tradeId: 'u' })).batchHash).not.toBe(base);
    expect(buildTradeBatch(input({ treasury: on })).batchHash).not.toBe(base);
    const i = input();
    expect(buildTradeBatch({ ...i, seller: { ...i.seller, stallAccountId: 'other' } }).batchHash).not.toBe(base);
  });
  it('the hash does not depend on input object key order', () => {
    const i = input();
    const shuffled = { ...i, buyer: Object.fromEntries(Object.entries(i.buyer).reverse()) as unknown as XOrder };
    expect(buildTradeBatch(shuffled).batchHash).toBe(buildTradeBatch(i).batchHash);
  });
  it('rejects zero/negative qty, mismatched orders, overfill and a too-small reservation', () => {
    const i = input();
    expect(() => buildTradeBatch({ ...i, fill: { ...i.fill, qty: 0n } })).toThrow(RangeError);
    expect(() => buildTradeBatch({ ...i, fill: { ...i.fill, qty: -1n } })).toThrow(RangeError);
    expect(() => buildTradeBatch({ ...i, fill: { ...i.fill, buyerOrderId: 'nope' } })).toThrow(/does not match/);
    expect(() => buildTradeBatch({ ...i, fill: { ...i.fill, qty: 11n } })).toThrow(/exceeds/);
    expect(() => buildTradeBatch({ ...i, buyer: { ...i.buyer, reservedPrincipal: 1n } })).toThrow(/reservation/);
    expect(() => buildTradeBatch({ ...i, buyer: { ...i.buyer, reservedFees: 0n } })).toThrow(/reservation/);
    expect(() => buildTradeBatch({ ...i, seller: { ...i.seller, reservedPrincipal: 9n } })).toThrow(/reservation/);
  });
  it('bucket state advances only on the buyer; the seller order keeps its buckets', () => {
    const bat = buildTradeBatch(input());
    expect(Object.keys(bat.buyer.feeBuckets).length).toBe(2);
    expect(bat.seller.feeBuckets).toEqual({});
    expect(bat.buyer.cumNotional).toBe(bat.notional);
    expect(bat.seller.cumNotional).toBe(bat.notional);
  });
});

describe('exchange parties', () => {
  const po = (colonyId: string, over: Partial<PartyOrder> = {}): PartyOrder => ({ colonyId, colonyIndex: 1, ref: `ref-${colonyId}`, stallColonyId: colonyId, ...over });
  const batchOf = (base: string, quote: string): TradeBatch => {
    const b = xo('buy', 10n, 1000n, { reservedPrincipal: 1500n, reservedFees: 200n }), s = xo('sell', 10n, 1000n);
    const fill = matchIncoming(xbook(s), b).fills[0]!;
    return buildTradeBatch({ tradeId: 't', base, quote, fill, buyer: b, seller: s, treasury: off });
  };
  it('barter trade: buyer, seller and stall deltas; platform fee leaves every colony', () => {
    const bat = batchOf('bio.water', 'metals.t1');
    const parties = planParties(bat, po('B'), po('S'), po('S'));
    expect(parties.map((p) => p.role)).toEqual(['buyer', 'seller', 'stall']);
    expect(parties[0]!.deltas).toEqual({ 'bio.water': 10, 'metals.t1': -1020 });
    expect(parties[1]!.deltas).toEqual({ 'bio.water': -10, 'metals.t1': 1000 });
    expect(parties[2]!.deltas).toEqual({ 'metals.t1': 10 });
    const total = parties.reduce((a, p) => a + (p.deltas['metals.t1'] ?? 0), 0);
    expect(total).toBe(-Number(bat.platformFee));
    expect(parties.reduce((a, p) => a + (p.deltas['bio.water'] ?? 0), 0)).toBe(0);
  });
  it('released amounts: buyer quote = spent + reservation slack, seller base = delivered + slack', () => {
    const bat = batchOf('bio.water', 'metals.t1');
    const [b, s] = planParties(bat, po('B'), po('S'), po('S'));
    expect(b!.released['metals.t1']).toBe(1020 + Number(bat.buyer.releasePrincipal + bat.buyer.releaseFees));
    expect(s!.released['bio.water']).toBe(10 + Number(bat.seller.releasePrincipal));
  });
  it('cash quote (USDC) never touches the sim mirror; only the base moves', () => {
    const [b, s, st] = planParties(batchOf('bio.water', 'USDC'), po('B'), po('S'), po('S'));
    expect(b!.deltas).toEqual({ 'bio.water': 10 });
    expect(s!.deltas).toEqual({ 'bio.water': -10 });
    expect(b!.released).toEqual({});
    expect(st!.deltas).toEqual({});
  });
  it('no stall party when the stall fee is 0; stall colony index only when the maker is its own stall', () => {
    const zero = buildTradeBatch({ ...(() => { const b = xo('buy', 10n, 1000n), s = xo('sell', 10n, 1000n, { stallFeeBp: 0 }); return { tradeId: 't', base: 'bio.water', quote: 'metals.t1', fill: matchIncoming(xbook(s), b).fills[0]!, buyer: b, seller: s, treasury: off }; })() });
    expect(planParties(zero, po('B'), po('S'), po('S')).map((p) => p.role)).toEqual(['buyer', 'seller']);
    const bat = batchOf('bio.water', 'metals.t1');
    expect(planParties(bat, po('B'), po('S'), po('S', { stallColonyId: 'S' }))[2]).toMatchObject({ colonyId: 'S', colonyIndex: 1 });
    expect(planParties(bat, po('B'), po('S'), po('S', { stallColonyId: 'HUB' }))[2]).toMatchObject({ colonyId: 'HUB', colonyIndex: null });
  });
  it('party refs and colony data are passed through', () => {
    const [b, s] = planParties(batchOf('bio.water', 'USDC'), po('B', { colonyIndex: 4, ref: 'r1' }), po('S', { colonyIndex: null, ref: null }), po('S'));
    expect(b).toMatchObject({ colonyId: 'B', colonyIndex: 4, ref: 'r1' });
    expect(s).toMatchObject({ colonyId: 'S', colonyIndex: null, ref: null });
  });
});
