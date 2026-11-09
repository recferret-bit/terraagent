import { describe, expect, it } from 'vitest';
import { compareRemedies, ratio, walkAsks, walkBids, type DepthLevel } from '../../src';

const lvl = (num: bigint, den: bigint, amount: bigint): DepthLevel => ({ num, den, amount });
const fees = { platformFeeBp: 100, stallFeeBp: 100 };

describe('walkAsks (depth-aware buy cost)', () => {
  it('prices across levels, cheapest first, and sums exact notional plus cumulative fees', () => {
    // 30 units: 10 @ 0.40, 20 @ 0.50 (USDC micro per unit); the book is handed over unsorted
    const q = walkAsks([lvl(500_000n, 1n, 20n), lvl(400_000n, 1n, 10n)], 30n, fees);
    expect(q).toMatchObject({ requested: 30n, fillable: 30n, missing: 0n, state: 'full', levelsUsed: 2, notional: 14_000_000n });
    expect(q.platformFee).toBe(140_000n);
    expect(q.stallFee).toBe(140_000n);
    expect(q.total).toBe(14_280_000n);
    expect(q.best).toEqual(lvl(400_000n, 1n, 10n));
  });

  it('partial: reports what is for sale and the missing quantity, costing only the fillable units', () => {
    const q = walkAsks([lvl(400_000n, 1n, 5n), lvl(450_000n, 1n, 5n)], 40n, fees);
    expect(q).toMatchObject({ fillable: 10n, missing: 30n, state: 'partial', notional: 4_250_000n, total: 4_335_000n });
  });

  it('empty or unusable book is insufficient_depth with zero cost (never a made-up price)', () => {
    for (const book of [[], [lvl(0n, 1n, 5n)], [lvl(1n, 0n, 5n)], [lvl(1n, 1n, 0n)], [lvl(-1n, 1n, 5n)]]) {
      const q = walkAsks(book, 7n, fees);
      expect(q).toMatchObject({ fillable: 0n, missing: 7n, state: 'insufficient_depth', notional: 0n, total: 0n, best: null });
    }
  });

  it('zero or negative quantity is a full, free no-op', () => {
    expect(walkAsks([lvl(1n, 1n, 5n)], 0n, fees)).toMatchObject({ fillable: 0n, missing: 0n, state: 'full', total: 0n });
    expect(walkAsks([lvl(1n, 1n, 5n)], -3n, fees)).toMatchObject({ requested: 0n, state: 'full', total: 0n });
  });

  it('ceil per level: a fractional price rounds the buyer cost up (dust)', () => {
    // 1 unit @ 1/3 atomic: ceil = 1; 2 units @ 1/3 -> ceil(2/3) = 1 per call
    expect(walkAsks([lvl(1n, 3n, 10n)], 1n, { platformFeeBp: 0, stallFeeBp: 0 }).notional).toBe(1n);
    expect(walkAsks([lvl(1n, 3n, 10n)], 4n, { platformFeeBp: 0, stallFeeBp: 0 }).notional).toBe(2n);
    // two levels each round up separately
    expect(walkAsks([lvl(1n, 3n, 1n), lvl(1n, 3n, 1n)], 2n, { platformFeeBp: 0, stallFeeBp: 0 }).notional).toBe(2n);
  });

  it('fees use settlement\'s cumulative floors: a 1 % fee on 7 units of notional is 0, not 1', () => {
    const q = walkAsks([lvl(7n, 1n, 1n)], 1n, fees);
    expect(q).toMatchObject({ notional: 7n, platformFee: 0n, stallFee: 0n, total: 7n });
    // splitting the same notional over levels cannot dodge or add fee: floor of the cumulative base
    const split = walkAsks([lvl(50n, 1n, 1n), lvl(50n, 1n, 1n)], 2n, { platformFeeBp: 100, stallFeeBp: 0 });
    expect(split.platformFee).toBe(1n); // floor(100 * 100 / 10000), not 0 + 0
  });

  it('ties keep the given (time) order and are all taken before a dearer level', () => {
    const a = lvl(10n, 1n, 3n), b = lvl(20n, 2n, 3n), c = lvl(11n, 1n, 3n);
    const q = walkAsks([c, a, b], 7n, { platformFeeBp: 0, stallFeeBp: 0 });
    expect(q.best).toBe(a);
    expect(q.notional).toBe(3n * 10n + 3n * 10n + 11n);
  });

  it('handles overflow-size quantities and prices exactly', () => {
    const big = 10n ** 40n;
    const q = walkAsks([lvl(10n ** 30n, 1n, big), lvl(2n * 10n ** 30n, 1n, big)], 3n * big / 2n, fees);
    expect(q.fillable).toBe(3n * big / 2n);
    expect(q.notional).toBe(big * 10n ** 30n + (big / 2n) * 2n * 10n ** 30n);
    expect(q.total).toBe(q.notional + q.platformFee + q.stallFee);
  });

  it('a one-sided book (only asks, then none) behaves like an empty buy side', () => {
    expect(walkAsks([], 1n, fees).state).toBe('insufficient_depth');
  });
});

describe('walkBids (depth-aware sell proceeds)', () => {
  it('takes the best-paying bids first and floors proceeds per level, no seller fee', () => {
    const q = walkBids([lvl(300_000n, 1n, 4n), lvl(400_000n, 1n, 6n)], 8n);
    expect(q).toMatchObject({ fillable: 8n, missing: 0n, state: 'full', proceeds: 6n * 400_000n + 2n * 300_000n });
    expect(q.best).toEqual(lvl(400_000n, 1n, 6n));
  });
  it('partial, empty and floor dust', () => {
    expect(walkBids([lvl(1n, 3n, 10n)], 2n).proceeds).toBe(0n); // floor(2/3)
    expect(walkBids([lvl(5n, 1n, 2n)], 5n)).toMatchObject({ fillable: 2n, missing: 3n, state: 'partial', proceeds: 10n });
    expect(walkBids([], 5n)).toMatchObject({ fillable: 0n, state: 'insufficient_depth', proceeds: 0n });
  });
});

describe('compareRemedies with ask levels', () => {
  const base = { resource: 'minerals.t3' as const, localMinutesPerUnit: null, depot: null };
  const ask = (levels?: DepthLevel[]) => ({ num: 400_000n, den: 1n, quote: 'USDC' as const, platformFeeBp: 100, stallFeeBp: 100, ...(levels ? { levels } : {}) });

  it('walks the levels and reports fillable vs missing', () => {
    const r = compareRemedies({ ...base, qty: 60, ask: ask([lvl(400_000n, 1n, 50n), lvl(500_000n, 1n, 5n)]) })[0]!;
    expect(r.available).toBe(true);
    expect(r.note).toBe('partial_depth');
    expect(r.depth).toEqual({ requested: 60n, fillable: 55n, missing: 5n, state: 'partial' });
    expect(r.quoteCost).toMatchObject({ notional: 50n * 400_000n + 5n * 500_000n });
  });

  it('full depth has no note; no usable level makes buy unavailable with insufficient_depth', () => {
    const full = compareRemedies({ ...base, qty: 10, ask: ask([lvl(400_000n, 1n, 50n)]) })[0]!;
    expect(full.note).toBeUndefined();
    expect(full.depth?.state).toBe('full');
    const none = compareRemedies({ ...base, qty: 10, ask: ask([lvl(400_000n, 1n, 0n)]) })[0]!;
    expect(none).toMatchObject({ available: false, note: 'insufficient_depth' });
    expect(none.quoteCost).toBeUndefined();
  });

  it('without levels the single ask prices everything (compat); a broken ask or NaN quantity is safe', () => {
    const r = compareRemedies({ ...base, qty: 10, ask: ask() })[0]!;
    expect(r.quoteCost).toEqual({ token: 'USDC', notional: 4_000_000n, fees: 80_000n, total: 4_080_000n });
    expect(compareRemedies({ ...base, qty: Number.NaN, ask: ask() })[0]!.quoteCost?.total).toBe(0n);
    expect(compareRemedies({ ...base, qty: 5, ask: { ...ask(), den: 0n } })[0]).toMatchObject({ available: false, note: 'no_ask' });
    expect(ratio(1n)).toEqual({ num: 1n, den: 1n });
  });
});
