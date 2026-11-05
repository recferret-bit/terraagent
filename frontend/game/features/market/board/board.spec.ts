// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MarketSnapshotResponse, PriceBoardRow, TradeView } from '@terra/contracts';
import { BoardController } from './BoardController';
import { BoardPanel } from './BoardPanel';
import { changeText, sparkPoints } from './boardModel';

const trade = (n: number, notional: string, over: Partial<TradeView> = {}): TradeView => ({
  tradeId: `tr_${n}`, pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', amount: 300, notional, platformFee: '0', stallFee: '0', stallFeeBp: 100,
  makerSide: 'sell', state: 'FINAL', atMs: 1_000 * n, ...over,
});
const row = (over: Partial<PriceBoardRow> = {}): PriceBoardRow => ({
  pair: 'bio.water/USDC', last: { num: '12000000', den: 300 }, change24hBp: 125, volume24h: 900, vwap: null,
  candles1h: [{ t: 0, o: '40000', h: '40000', l: '30000', c: '40000', v: 900 }], classification: 'organic', ...over,
});
const snap = (rows: PriceBoardRow[], trades: TradeView[]): MarketSnapshotResponse => ({ planetId: 'p1', books: [], board: rows, recentTrades: trades });

// 3 trades in the same hour: 10.00, 11.00 and 12.00 USDC for 300 water.
const THREE = [trade(1, '10000000'), trade(2, '11000000'), trade(3, '12000000')];

describe('W13-23 price board', () => {
  it('after 3 trades the sparkline has 3 points and the last price is the last trade', async () => {
    const c = new BoardController(async () => snap([row()], THREE), () => 'p1');
    const panel = new BoardPanel(document.createElement('div'), c);
    await c.refresh();
    const root = (panel as unknown as { root: HTMLElement }).root;
    const svg = root.querySelector('svg')!;
    expect(svg.dataset.points).toBe('3');
    expect(svg.querySelectorAll('circle')).toHaveLength(3);
    expect(root.querySelector('[data-testid=board-last]')!.textContent).toBe('0.0400 USDC');
    expect(sparkPoints(row(), THREE).at(-1)!.price).toBeCloseTo(0.04, 6);
  });

  it('shows change, volume, mock badge and plain classification labels', async () => {
    const rows = [row(), row({ pair: 'metals.t1/USDC', last: null, change24hBp: null, volume24h: 0, candles1h: [], classification: 'insufficient_data', reason: 'fewer than 3 eligible trades' }), row({ pair: 'bio.biomass/NEAR', classification: 'fixture' })];
    const c = new BoardController(async () => snap(rows, []), () => 'p1');
    const panel = new BoardPanel(document.createElement('div'), c);
    await c.refresh();
    const root = (panel as unknown as { root: HTMLElement }).root;
    const text = (pair: string) => root.querySelector(`[data-pair="${pair}"]`)!.textContent!;
    expect(text('bio.water/USDC')).toContain('+1.25 %');
    expect(text('bio.water/USDC')).toContain('vol 900');
    expect(text('bio.water/USDC')).toContain('MOCK USDC');
    expect(text('bio.water/USDC')).toContain('ORGANIC');
    expect(text('metals.t1/USDC')).toContain('INSUFFICIENT DATA');
    expect(text('metals.t1/USDC')).toContain('fewer than 3 eligible trades');
    expect(text('bio.biomass/NEAR')).toContain('FIXTURE (bot-seeded)');
    expect(changeText(null)).toBe('-');
    expect(changeText(-50)).toBe('-0.50 %');
  });

  it('falls back to candle closes when no trades are known; ignores other pairs and non-final trades', () => {
    expect(sparkPoints(row(), [])).toHaveLength(1);
    expect(sparkPoints(row(), [trade(1, '1', { pair: 'metals.t1/USDC' }), trade(2, '1', { state: 'PENDING' })])).toHaveLength(1);
  });

  it('a market.trade push adds a point at once and refetches; other planets are ignored; dispose unsubscribes', async () => {
    let handler: ((m: unknown) => void) | undefined;
    let fetches = 0;
    let off = 0;
    const c = new BoardController(async () => { fetches++; return snap([row()], THREE); }, () => 'p1', { onMessage: (f) => { handler = f; return () => { off++; }; } });
    const panel = new BoardPanel(document.createElement('div'), c);
    await c.refresh();
    handler!({ t: 'market.trade', d: { planetId: 'p1', trade: trade(4, '13000000') } });
    expect(c.current.trades).toHaveLength(4);
    handler!({ t: 'market.trade', d: { planetId: 'other', trade: trade(5, '1') } });
    await Promise.resolve();
    expect(c.current.trades).toHaveLength(4);
    expect(fetches).toBeGreaterThanOrEqual(2);
    expect((panel as unknown as { root: HTMLElement }).root.querySelector('svg')!.dataset.points).toBe('4');
    c.dispose();
    expect(off).toBe(1);
  });

  it('opens and closes, and says so when not connected', async () => {
    const c = new BoardController(async () => snap([], []), () => null);
    const panel = new BoardPanel(document.createElement('div'), c);
    expect(panel.isOpen).toBe(false);
    panel.setOpen(true);
    await Promise.resolve();
    expect(panel.isOpen).toBe(true);
    expect((panel as unknown as { root: HTMLElement }).root.textContent).toContain('Not connected');
  });
});
