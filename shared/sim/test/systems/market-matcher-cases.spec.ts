import { describe, expect, it } from 'vitest';
import { matchIncoming } from '../../src/systems/trade/market-matcher';
import { kitBook, kitOrder, matchAndBatch, tokenSums } from './market-test-kit';

const zeroSum = (m: Map<string, bigint>): void => {
  for (const s of m.values()) expect(s).toBe(0n);
};

describe('market-matcher cases: policy change mid-book', () => {
  it('old orders keep their pinned terms; incompatible new orders do not cross them, compatible ones do', () => {
    const oldAsk = kitOrder('sell', 100n, 40n, { policyVersion: 'v1', platformFeeBp: 100, stallFeeBp: 80 });
    const book = kitBook(oldAsk);
    const newBid = kitOrder('buy', 100n, 90n, { policyVersion: 'v2', platformFeeBp: 150 });
    expect(matchIncoming(book, newBid).fills).toEqual([]);
    const newAsk = kitOrder('sell', 100n, 50n, { policyVersion: 'v2', platformFeeBp: 150, stallFeeBp: 60 });
    book.add(newAsk);
    const batches = matchAndBatch(book, newBid);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.platformFeeBp).toBe(150);
    expect(batches[0]!.stallFeeBp).toBe(60);
    expect(book.get(oldAsk.orderId)).toBe(oldAsk); // untouched
    const oldBid = kitOrder('buy', 100n, 90n, { policyVersion: 'v1' });
    const oldFill = matchAndBatch(book, oldBid);
    expect(oldFill[0]!.platformFeeBp).toBe(100);
    expect(oldFill[0]!.stallFeeBp).toBe(80);
    zeroSum(tokenSums([...batches, ...oldFill]));
  });
});

describe('market-matcher cases: both buyer roles over a multi-maker sweep', () => {
  it('incoming buy sweeps three asks: buyer pays every fee, zero-sum, maker prices', () => {
    const asks = [kitOrder('sell', 100n, 3_000_000n), kitOrder('sell', 100n, 4_000_000n), kitOrder('sell', 100n, 5_000_001n)];
    const buy = kitOrder('buy', 250n, 20_000_000n);
    const batches = matchAndBatch(kitBook(...asks), buy);
    expect(batches.map((b) => b.qty)).toEqual([100n, 100n, 50n]);
    expect(batches.map((b) => b.notional)).toEqual([3_000_000n, 4_000_000n, 2_500_000n]);
    const paid = batches.flatMap((b) => b.attribution).filter((l) => l.accountId === buy.accountId && l.token === 'USDC').reduce((s, l) => s + l.delta, 0n);
    expect(paid).toBe(-(9_500_000n + 95_000n + 95_000n));
    zeroSum(tokenSums(batches));
  });
  it('incoming sell sweeps three resting bids: each buyer (maker) still pays notional and fees', () => {
    const bids = [kitOrder('buy', 100n, 9_000_000n), kitOrder('buy', 100n, 8_000_000n), kitOrder('buy', 100n, 7_000_000n)];
    const sell = kitOrder('sell', 250n, 1n);
    const batches = matchAndBatch(kitBook(...bids), sell);
    expect(batches.map((b) => [b.notional, b.platformFee, b.stallFee])).toEqual([
      [9_000_000n, 90_000n, 90_000n], [8_000_000n, 80_000n, 80_000n], [3_500_000n, 35_000n, 35_000n],
    ]);
    expect(batches.every((b, i) => b.attribution.some((l) => l.accountId === bids[i]!.accountId && l.kind === 'platform_fee' && l.delta < 0n))).toBe(true);
    zeroSum(tokenSums(batches));
  });
});

describe('market-matcher cases: rounding across many partial lots', () => {
  it('1-unit lots against an odd price sum to the unsplit notional, fees and buyer spend', () => {
    const price = 10_000_003n;
    const make = (): ReturnType<typeof kitOrder> => kitOrder('sell', 300n, price);
    const whole = matchAndBatch(kitBook(make()), kitOrder('buy', 300n, price));
    let ask = make();
    let notional = 0n, fees = 0n;
    let state = kitOrder('buy', 300n, price);
    // explicit 1-unit slices carrying both orders' cumulative state (reservations are not under test here)
    for (let i = 0; i < 300; i++) {
      const b = matchAndBatch(kitBook(ask), { ...state, amount: state.filled + 1n, reservedPrincipal: 10n ** 20n, reservedFees: 10n ** 20n });
      expect(b).toHaveLength(1);
      notional += b[0]!.notional;
      fees += b[0]!.platformFee + b[0]!.stallFee;
      ask = { ...ask, filled: b[0]!.seller.filled, cumNotional: b[0]!.seller.cumNotional };
      state = { ...state, filled: b[0]!.buyer.filled, cumNotional: b[0]!.buyer.cumNotional, feeBuckets: b[0]!.buyer.feeBuckets };
    }
    expect(notional).toBe(whole[0]!.notional);
    expect(fees).toBe(whole[0]!.platformFee + whole[0]!.stallFee);
  });
});

describe('market-matcher cases: barter pairs and self-trade', () => {
  it('a barter pair with tiny amounts stays zero-sum per token and charges no fee dust', () => {
    const sell = kitOrder('sell', 7n, 7n);
    const buy = kitOrder('buy', 7n, 7n);
    const batches = matchAndBatch(kitBook(sell), buy, 'metals.t1', 'bio.water');
    expect(batches[0]!.platformFee).toBe(0n);
    expect(batches[0]!.stallFee).toBe(0n);
    expect(batches[0]!.notional).toBe(7n);
    const sums = tokenSums(batches);
    expect([...sums.keys()].sort()).toEqual(['bio.water', 'metals.t1']);
    zeroSum(sums);
  });
  it('skips the own colony at several levels and matches the others in order', () => {
    const own1 = kitOrder('sell', 10n, 10n, { colonyId: 'me' });
    const other1 = kitOrder('sell', 10n, 20n);
    const own2 = kitOrder('sell', 10n, 30n, { colonyId: 'me' });
    const other2 = kitOrder('sell', 10n, 40n);
    const r = matchIncoming(kitBook(own1, other1, own2, other2), kitOrder('buy', 40n, 400n, { colonyId: 'me' }));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([other1.orderId, other2.orderId]);
    expect(r.restingRemainder).toBe(20n);
  });
});
