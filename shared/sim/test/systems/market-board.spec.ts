import { describe, expect, it } from 'vitest';
import { boardRow, defaultBoardLimits, marketBoard, priceDecimal, type BoardTrade } from '../../src/systems/trade/market-board';

const NOW = 100 * 3_600_000;
const PAIR = 'bio.water/USDC';
const L = defaultBoardLimits();
let n = 0;
const trade = (over: Partial<BoardTrade> & { price?: bigint } = {}): BoardTrade => {
  const { price = 400_000n, ...rest } = over;
  const amount = rest.amount ?? 10n;
  n++;
  return { pair: PAIR, amount, notional: amount * price, atMs: NOW - 600_000 - n, organic: true, buyerId: `b${n % 3}`, sellerId: `s${n % 3}`, ...rest };
};
const organicSet = (k = 6): BoardTrade[] => Array.from({ length: k }, () => trade());

describe('market-board', () => {
  it('fixture-only fills never establish a reference price', () => {
    const row = boardRow(PAIR, Array.from({ length: 20 }, () => trade({ organic: false, buyerId: 'fixture', sellerId: 'x' })), NOW);
    expect(row.vwap).toBeNull();
    expect(row.classification).toBe('fixture');
    expect(row.reason).toBe('insufficient_data');
    expect(row.eligibleVolume).toBe(0);
    expect(row.last).not.toBeNull();
  });

  it('organic trades give an exact VWAP and a classification', () => {
    const row = boardRow(PAIR, [...organicSet(2), trade({ price: 500_000n, amount: 20n }), ...organicSet(2)], NOW);
    expect(row.classification).toBe('organic');
    expect(row.reason).toBeUndefined();
    expect(row.vwap).toEqual({ num: '1300000', den: 3 }); // (40 * 0.4M + 20 * 0.5M) / 60 = 26M/60, reduced
  });

  it('mixed: fixture fills are shown in volume but excluded from the reference', () => {
    const fx = trade({ organic: false, price: 900_000n, buyerId: 'fx', sellerId: 'fx2' });
    const row = boardRow(PAIR, [...organicSet(5), fx], NOW);
    expect(row.classification).toBe('mixed');
    expect(row.vwap).toEqual({ num: '400000', den: 1 });
    expect(row.volume24h).toBe(60);
    expect(row.eligibleVolume).toBe(50);
  });

  it('thin data returns insufficient_data', () => {
    expect(boardRow(PAIR, organicSet(2), NOW)).toMatchObject({ classification: 'insufficient_data', reason: 'insufficient_data', vwap: null });
    expect(boardRow(PAIR, [], NOW)).toMatchObject({ classification: 'insufficient_data', last: null, vwap: null });
  });

  it('too few counterparties is thin', () => {
    const two = Array.from({ length: 6 }, () => trade({ buyerId: 'a', sellerId: 'b' }));
    expect(boardRow(PAIR, two, NOW)).toMatchObject({ reason: 'insufficient_data', counterparties: 2, vwap: null });
  });

  it('stale inputs return the stale reason', () => {
    const old = organicSet(6).map((t) => ({ ...t, atMs: NOW - (L.stalenessS + 10) * 1000 }));
    expect(boardRow(PAIR, old, NOW)).toMatchObject({ classification: 'insufficient_data', reason: 'stale', vwap: null });
  });

  it('an outlier is excluded from the reference and reported', () => {
    const row = boardRow(PAIR, [...organicSet(5), trade({ price: 4_000_000n })], NOW);
    expect(row.classification).toBe('organic');
    expect(row.reason).toBe('outlier_excluded');
    expect(row.vwap).toEqual({ num: '400000', den: 1 });
    expect(row.eligibleVolume).toBe(50);
    expect(row.volume24h).toBe(60);
  });

  it('a counterparty above the weight cap withholds the reference', () => {
    const conc = Array.from({ length: 6 }, (_, i) => trade({ buyerId: 'whale', sellerId: `s${i % 3}` }));
    const row = boardRow(PAIR, conc, NOW);
    expect(row).toMatchObject({ classification: 'insufficient_data', reason: 'concentrated', vwap: null });
    expect(row.concentrationBp).toBeGreaterThan(L.counterpartyWeightCapBp);
  });

  it('builds hourly candles and a 24 h change from every fill', () => {
    const t0 = NOW - 5 * 3_600_000;
    const ts = [trade({ atMs: t0, price: 400_000n }), trade({ atMs: t0 + 60_000, price: 500_000n }), trade({ atMs: t0 + 120_000, price: 300_000n }), trade({ atMs: NOW - 1000, price: 600_000n })];
    const row = boardRow(PAIR, ts, NOW);
    expect(row.candles1h).toHaveLength(2);
    expect(row.candles1h[0]).toMatchObject({ o: '400000', h: '500000', l: '300000', c: '300000', v: 30 });
    expect(row.change24hBp).toBe(5000);
    expect(row.last).toEqual({ num: '600000', den: 1 });
  });

  it('ignores trades outside the window and lists pairs sorted', () => {
    const out = trade({ atMs: NOW - (L.windowS + 5) * 1000 });
    expect(boardRow(PAIR, [out], NOW).last).toBeNull();
    expect(marketBoard([trade({ pair: 'b/USDC' }), trade({ pair: 'a/USDC' })], NOW).map((r) => r.pair)).toEqual(['a/USDC', 'b/USDC']);
  });

  it('formats unit prices exactly', () => {
    expect(priceDecimal({ num: 1n, den: 3n })).toBe('0.333333');
    expect(priceDecimal({ num: 5n, den: 2n })).toBe('2.5');
    expect(priceDecimal({ num: 0n, den: 1n })).toBe('0');
  });
});
