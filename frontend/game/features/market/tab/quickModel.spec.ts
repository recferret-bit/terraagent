import type { MarketBookPayload, TradeView } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { pairStats, tradePageUrl } from './quickModel';

const NOW = 100 * 3600 * 1000;
const trade = (id: string, notional: string, atMs: number): TradeView => ({ tradeId: id, pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', amount: 10, notional, platformFee: '0', stallFee: '0', stallFeeBp: 0, makerSide: 'sell', state: 'FINAL', atMs });
const book: MarketBookPayload = { planetId: 'p', pair: 'bio.water/USDC', seq: 1, asks: [{ num: '400000', den: 1, amount: 1, orders: 1 }], bids: [{ num: '300000', den: 1, amount: 1, orders: 1 }] };

describe('pairStats', () => {
  it('best bid / ask, last price and 24h change from the oldest to the newest trade in the window', () => {
    const s = pairStats(book, [trade('b', '6000000', NOW - 1000), trade('a', '5000000', NOW - 3600_000), trade('old', '1000000', NOW - 30 * 3600_000)], 'USDC', NOW);
    expect([s.bid, s.ask, s.last, s.change24h]).toEqual(['0.300', '0.400', '0.600', '+20.0 %']);
  });
  it('shows dashes without a book or two recent trades', () => {
    expect(pairStats(undefined, [trade('a', '5000000', NOW - 1)], 'USDC', NOW)).toMatchObject({ bid: '—', ask: '—', change24h: '—' });
  });
});

describe('tradePageUrl', () => {
  it('carries the planet and a section hash', () => {
    expect(tradePageUrl('pl_1', 'board')).toBe('/trade.html?planet=pl_1#board');
    expect(tradePageUrl(null)).toBe('/trade.html');
    expect(tradePageUrl('a b', 'orders')).toBe('/trade.html?planet=a%20b#orders');
  });
});
