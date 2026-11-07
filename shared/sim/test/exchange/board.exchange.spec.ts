import { describe, expect, it } from 'vitest';
import {
  boardRow, candlesOf, counterpartyStats, defaultBoardLimits, excludeOutliers, marketBoard, type BoardLimits, type BoardTrade,
} from '../../src/systems/trade/market-board';
import { randInt, rng, SEEDS } from './exchange-kit';

const NOW = 1_000 * 3_600_000;
const PAIR = 'bio.water/USDC';
const L: BoardLimits = defaultBoardLimits();
let n = 0;
interface T { amount?: bigint; price?: bigint; notional?: bigint; ageMs?: number; organic?: boolean; b?: string; s?: string; pair?: string }
const tr = (o: T = {}): BoardTrade => {
  n++;
  const amount = o.amount ?? 10n;
  return {
    pair: o.pair ?? PAIR, amount, notional: o.notional ?? amount * (o.price ?? 100n), atMs: NOW - (o.ageMs ?? 1000 + n),
    organic: o.organic ?? true, buyerId: o.b ?? `b${n}`, sellerId: o.s ?? `s${n}`,
  };
};
const many = (k: number, o: T = {}): BoardTrade[] => Array.from({ length: k }, () => tr(o));
const wide: BoardLimits = { ...L, counterpartyWeightCapBp: 10_000 };

describe('exchange board: thresholds', () => {
  it('2 vs 3 eligible trades', () => {
    expect(boardRow(PAIR, many(2), NOW).classification).toBe('insufficient_data');
    expect(boardRow(PAIR, many(2), NOW).vwap).toBeNull();
    const r = boardRow(PAIR, many(3), NOW);
    expect(r.classification).toBe('organic');
    expect(r.vwap).toEqual({ num: '100', den: 1 });
  });
  it('9 vs 10 eligible units', () => {
    const lo = [tr({ amount: 3n }), tr({ amount: 3n }), tr({ amount: 3n })];
    const hi = [tr({ amount: 3n }), tr({ amount: 3n }), tr({ amount: 4n })];
    expect(boardRow(PAIR, lo, NOW).classification).toBe('insufficient_data');
    expect(boardRow(PAIR, lo, NOW).eligibleVolume).toBe(9);
    expect(boardRow(PAIR, hi, NOW).classification).toBe('organic');
  });
  it('2 vs 3 counterparties', () => {
    const two = [tr({ b: 'a', s: 'b' }), tr({ b: 'b', s: 'a' }), tr({ b: 'a', s: 'b' })];
    const three = [tr({ b: 'a', s: 'b' }), tr({ b: 'b', s: 'c' }), tr({ b: 'c', s: 'a' })];
    const r2 = boardRow(PAIR, two, NOW, wide);
    expect(r2.counterparties).toBe(2);
    expect(r2.classification).toBe('insufficient_data');
    expect(boardRow(PAIR, three, NOW, wide).classification).toBe('organic');
  });
  it('minimums are inclusive and honour custom limits', () => {
    const lim: BoardLimits = { ...wide, minEligibleTrades: 1, minEligibleVolume: 1, minCounterparties: 2 };
    expect(boardRow(PAIR, [tr({ amount: 1n })], NOW, lim).classification).toBe('organic');
  });
  it('staleness boundary: exactly stalenessS passes, +1 ms is stale', () => {
    const edge = L.stalenessS * 1000;
    const ok = [tr({ ageMs: edge }), tr({ ageMs: edge + 5 }), tr({ ageMs: edge + 9 })];
    expect(boardRow(PAIR, ok, NOW).classification).toBe('organic');
    const stale = [tr({ ageMs: edge + 1 }), tr({ ageMs: edge + 5 }), tr({ ageMs: edge + 9 })];
    const r = boardRow(PAIR, stale, NOW);
    expect(r).toMatchObject({ classification: 'insufficient_data', reason: 'stale', vwap: null });
  });
  it('stale judges the NEWEST eligible trade, one fresh trade is enough', () => {
    const t = [tr({ ageMs: 10 * 3_600_000 }), tr({ ageMs: 10 * 3_600_000 }), tr({ ageMs: 1000 })];
    expect(boardRow(PAIR, t, NOW).classification).toBe('organic');
  });
  it('concentration cap boundary: share == cap passes, cap-1 is concentrated', () => {
    // party X is on every trade: 4 trades x 10 units, X shares 40 of 80 = 5000 bp
    const ts = [tr({ b: 'X' }), tr({ b: 'X' }), tr({ b: 'X' }), tr({ b: 'X' })];
    expect(boardRow(PAIR, ts, NOW, { ...L, counterpartyWeightCapBp: 5000 }).classification).toBe('organic');
    const r = boardRow(PAIR, ts, NOW, { ...L, counterpartyWeightCapBp: 4999 });
    expect(r).toMatchObject({ classification: 'insufficient_data', reason: 'concentrated', vwap: null, concentrationBp: 5000 });
  });
  it('counterpartyStats: shares sum over 2x volume; empty and self-trade', () => {
    expect(counterpartyStats([])).toEqual({ count: 0, topBp: 0 });
    expect(counterpartyStats([tr({ b: 'a', s: 'a' })])).toEqual({ count: 1, topBp: 10_000 });
    expect(counterpartyStats([tr({ b: 'a', s: 'b' })])).toEqual({ count: 2, topBp: 5000 });
  });
  it('a dominant counterparty on a few trades is flagged with default cap', () => {
    const ts = [tr({ b: 'W', amount: 100n }), tr({ amount: 1n }), tr({ amount: 1n }), tr({ amount: 1n })];
    expect(boardRow(PAIR, ts, NOW).reason).toBe('concentrated');
  });
});

describe('exchange board: outliers', () => {
  const base = (p: bigint): BoardTrade[] => [tr({ price: 100n }), tr({ price: 100n }), tr({ price: 100n }), tr({ price: p })];
  it('exactly maxMoveBp from the median is kept; one atomic more is excluded', () => {
    expect(excludeOutliers(base(150n), 5000)).toMatchObject({ excluded: 0 });
    const r = excludeOutliers(base(151n), 5000);
    expect(r.excluded).toBe(1);
    expect(r.kept).toHaveLength(3);
  });
  it('symmetric below the median: 50 is kept, 49 is excluded', () => {
    expect(excludeOutliers(base(50n), 5000).excluded).toBe(0);
    expect(excludeOutliers(base(49n), 5000).excluded).toBe(1);
  });
  it('the median is the lower middle for an even count', () => {
    const ts = [tr({ price: 100n }), tr({ price: 100n }), tr({ price: 200n }), tr({ price: 200n })];
    expect(excludeOutliers(ts, 1000)).toMatchObject({ excluded: 2 }); // median 100 keeps the 100s only
  });
  it('empty input, single trade, and zero median', () => {
    expect(excludeOutliers([], 5000)).toEqual({ kept: [], excluded: 0 });
    expect(excludeOutliers([tr()], 0).excluded).toBe(0);
    const zeros = [tr({ notional: 0n }), tr({ notional: 0n }), tr({ price: 900n })];
    expect(excludeOutliers(zeros, 100).excluded).toBe(0);
  });
  it('maxMoveBp 0 keeps only the median price', () => {
    expect(excludeOutliers(base(101n), 0).excluded).toBe(1);
    expect(excludeOutliers(many(5, { price: 7n }), 0).excluded).toBe(0);
  });
  it('board marks outlier_excluded and removes the outlier from VWAP and eligible volume', () => {
    const r = boardRow(PAIR, base(900n), NOW);
    expect(r).toMatchObject({ classification: 'organic', reason: 'outlier_excluded', eligibleVolume: 30, volume24h: 40, vwap: { num: '100', den: 1 } });
  });
  it('an outlier can drop the set under the minimum trades', () => {
    const r = boardRow(PAIR, [tr({ price: 100n }), tr({ price: 100n }), tr({ price: 900n })], NOW);
    expect(r.classification).toBe('insufficient_data');
  });
});

describe('exchange board: classification', () => {
  it('fixture only -> fixture, reason insufficient_data, last still displayed', () => {
    const r = boardRow(PAIR, many(30, { organic: false }), NOW);
    expect(r).toMatchObject({ classification: 'fixture', reason: 'insufficient_data', vwap: null, eligibleVolume: 0, counterparties: 0 });
    expect(r.last).not.toBeNull();
    expect(r.volume24h).toBe(300);
  });
  it('mixed when enough organic trades coexist with fixture fills; VWAP ignores fixtures', () => {
    const r = boardRow(PAIR, [...many(3), tr({ organic: false, price: 5000n })], NOW);
    expect(r.classification).toBe('mixed');
    expect(r.vwap).toEqual({ num: '100', den: 1 });
  });
  it('fixture fills cannot top up an organic set below the thresholds', () => {
    const r = boardRow(PAIR, [...many(2), ...many(30, { organic: false })], NOW);
    expect(r.classification).toBe('insufficient_data');
    expect(r.vwap).toBeNull();
  });
  it('organic requires every in-window trade to be organic', () => {
    expect(boardRow(PAIR, many(5), NOW).classification).toBe('organic');
    expect(boardRow(PAIR, [...many(5), tr({ organic: false })], NOW).classification).toBe('mixed');
  });
  it('empty window and wrong pair', () => {
    const r = boardRow(PAIR, [], NOW);
    expect(r).toMatchObject({ classification: 'insufficient_data', reason: 'insufficient_data', last: null, change24hBp: null, vwap: null, volume24h: 0, candles1h: [], counterparties: 0, concentrationBp: 0 });
    expect(boardRow(PAIR, many(5, { pair: 'other/USDC' }), NOW).last).toBeNull();
  });
  it('zero-amount trades are ignored', () => {
    expect(boardRow(PAIR, [tr({ amount: 0n, notional: 0n })], NOW).last).toBeNull();
  });
});

describe('exchange board: window, change, vwap, candles', () => {
  it('window edges: age == window excluded, age == window-1 included, future trades excluded, now included', () => {
    const w = L.windowS * 1000;
    const r = boardRow(PAIR, [tr({ ageMs: w }), tr({ ageMs: w - 1 }), tr({ ageMs: -1 }), tr({ ageMs: 0 })], NOW);
    expect(r.volume24h).toBe(20);
    expect(r.candles1h.reduce((a, c) => a + c.v, 0)).toBe(20);
  });
  it('change24hBp from first to last in-window trade, truncated toward zero', () => {
    const r = boardRow(PAIR, [tr({ price: 300n, ageMs: 5000 }), tr({ price: 400n, ageMs: 100 })], NOW);
    expect(r.change24hBp).toBe(3333);
    const down = boardRow(PAIR, [tr({ price: 300n, ageMs: 5000 }), tr({ price: 200n, ageMs: 100 })], NOW);
    expect(down.change24hBp).toBe(-3333);
  });
  it('zero first price: change is null and nothing divides by zero', () => {
    const r = boardRow(PAIR, [tr({ notional: 0n, ageMs: 5000 }), tr({ price: 100n, ageMs: 100 })], NOW);
    expect(r.change24hBp).toBeNull();
    expect(r.last).toEqual({ num: '100', den: 1 });
  });
  it('single trade has change 0; unchanged price has change 0', () => {
    expect(boardRow(PAIR, [tr()], NOW).change24hBp).toBe(0);
  });
  it('input order does not matter', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const r = rng(seed);
      const ts = Array.from({ length: 8 }, () => tr({ price: BigInt(randInt(r, 90, 110)), amount: BigInt(randInt(r, 1, 9)), ageMs: randInt(r, 1, 80_000_000) }));
      const shuffled = [...ts].sort(() => r() - 0.5);
      expect(boardRow(PAIR, shuffled, NOW)).toEqual(boardRow(PAIR, ts, NOW));
    }
  });
  it('VWAP is exact and reduced: (1000+3600+2200)/60 = 340/3', () => {
    const r = boardRow(PAIR, [tr({ amount: 10n, price: 100n }), tr({ amount: 30n, price: 120n }), tr({ amount: 20n, price: 110n })], NOW);
    expect(r.vwap).toEqual({ num: '340', den: 3 });
  });
  it('VWAP weights by amount, not by trade count: 110200/1002 = 55100/501', () => {
    const r = boardRow(PAIR, [tr({ amount: 1n, price: 100n }), tr({ amount: 1n, price: 100n }), tr({ amount: 1000n, price: 110n })], NOW, { ...L, maxMoveBp: 10_000, counterpartyWeightCapBp: 10_000 });
    expect(r.vwap).toEqual({ num: '55100', den: 501 });
  });
  it('candles bucket on candleS boundaries: 3599.999 s vs 3600 s', () => {
    const t0 = NOW - 7_200_000; // a bucket start (NOW is a multiple of one hour)
    const a = { ...tr({ price: 100n, amount: 1n }), atMs: t0 + 3_599_999 };
    const b = { ...tr({ price: 200n, amount: 2n }), atMs: t0 + 3_600_000 };
    const c = candlesOf([b, a], 3600);
    expect(c).toEqual([
      { t: t0, o: '100', h: '100', l: '100', c: '100', v: 1 },
      { t: t0 + 3_600_000, o: '200', h: '200', l: '200', c: '200', v: 2 },
    ]);
  });
  it('candle o/h/l/c by time inside a bucket, equal timestamps keep input order', () => {
    const t0 = NOW - 7_200_000;
    const mk = (p: bigint, off: number, amount = 1n): BoardTrade => ({ ...tr({ price: p, amount }), atMs: t0 + off });
    const [c] = candlesOf([mk(150n, 3000), mk(100n, 1000), mk(300n, 2000, 3n), mk(50n, 4000)], 3600);
    expect(c).toEqual({ t: t0, o: '100', h: '300', l: '50', c: '50', v: 6 });
    expect(candlesOf([], 3600)).toEqual([]);
  });
  it('candles use fractional-price decimals truncated to 6 places', () => {
    const t = { ...tr({ notional: 2n, amount: 3n }), atMs: NOW - 10 };
    expect(candlesOf([t], 3600)[0]).toMatchObject({ o: '0.666666', c: '0.666666' });
  });
  it('marketBoard returns one sorted row per pair that has trades', () => {
    const rows = marketBoard([...many(3, { pair: 'z/USDC' }), ...many(3, { pair: 'a/USDC' })], NOW);
    expect(rows.map((r) => r.pair)).toEqual(['a/USDC', 'z/USDC']);
    expect(marketBoard([], NOW)).toEqual([]);
  });
  it('huge notionals stay exact (beyond 2^64)', () => {
    const big = 2n ** 70n;
    const r = boardRow(PAIR, [tr({ notional: big * 10n }), tr({ notional: big * 10n }), tr({ notional: big * 10n })], NOW);
    expect(r.vwap).toEqual({ num: (big).toString(), den: 1 });
  });
});
