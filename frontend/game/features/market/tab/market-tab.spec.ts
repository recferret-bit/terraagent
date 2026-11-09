// @vitest-environment jsdom
import type { MarketBookPayload, TradeView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext, TradeHubTabDef } from '../../../core/registry/types';
import marketFeature from '../index';
import { MarketTab } from './MarketTab';
import { MarketState } from './marketState';
import { TabExtensions } from '../../trade-hub/tabExtensions';

const PAIR = 'bio.water/USDC';
const book = (seq: number, asks: Array<[string, number, number]> = [], bids: Array<[string, number, number]> = []): MarketBookPayload => ({
  planetId: 'p1', pair: PAIR, seq,
  asks: asks.map(([num, amount, orders]) => ({ num, den: 1, amount, orders })), bids: bids.map(([num, amount, orders]) => ({ num, den: 1, amount, orders })),
});
const trade = (id: string, atMs: number): TradeView => ({ tradeId: id, pair: PAIR, base: 'bio.water', quote: 'USDC', amount: 10, notional: '5000000', platformFee: '0', stallFee: '0', stallFeeBp: 0, makerSide: 'sell', state: 'FINAL', atMs });

function setup() {
  const books: Array<(p: MarketBookPayload) => void> = [];
  const trades: Array<(p: { planetId: string; trade: TradeView }) => void> = [];
  const services = {
    session: { planetId: () => 'p1' },
    store: { onMarketBook: (f: (p: MarketBookPayload) => void) => { books.push(f); return () => undefined; }, onMarketTrade: (f: never) => { trades.push(f); return () => undefined; } },
  };
  const ctx = { flags: new Set(['W13']), host: 'server', services } as unknown as FeatureContext;
  const root = document.createElement('div');
  const tab = new MarketTab(root, ctx);
  return { tab, root, push: (p: MarketBookPayload) => books.forEach((f) => f(p)), pushTrade: (t: TradeView) => trades.forEach((f) => f({ planetId: 'p1', trade: t })), services, ctx };
}
const prices = (root: HTMLElement, side: 'asks' | 'bids') => [...root.querySelectorAll(`[data-testid=market-${side}] .ta-market__price`)].map((e) => e.textContent);

describe('MarketTab', () => {
  it('renders depth from a payload, best ask nearest the middle, with the mock label', () => {
    const { tab, root, push } = setup();
    expect(root.querySelector('[data-testid=market-empty]')?.textContent).toContain('mock USDC');
    push(book(1, [['400000', 100, 1], ['500000', 50, 2]], [['300000', 70, 1]]));
    expect(prices(root, 'asks')).toEqual(['0.500', '0.400']);
    expect(prices(root, 'bids')).toEqual(['0.300']);
    expect(root.querySelector('[data-testid=market-empty]')).toBeNull();
    tab.dispose();
  });

  it('shows only the top 5 levels per side (mini depth)', () => {
    const { root, push } = setup();
    push(book(1, Array.from({ length: 14 }, (_, i) => [String(100_000 * (i + 1)), 1, 1] as [string, number, number])));
    expect(prices(root, 'asks')).toHaveLength(5);
  });

  it('a push replaces the book: the filled ask disappears; an older seq is dropped', () => {
    const { root, push } = setup();
    push(book(2, [['400000', 100, 1]]));
    expect(prices(root, 'asks')).toEqual(['0.400']);
    push(book(1, [['999999', 1, 1]]));
    expect(prices(root, 'asks')).toEqual(['0.400']);
    push(book(3, []));
    expect(prices(root, 'asks')).toEqual([]);
    expect(root.querySelector('[data-testid=market-empty]')).not.toBeNull();
  });

  it('lists trades of the selected pair, newest first, no duplicates', () => {
    const { root, pushTrade } = setup();
    pushTrade(trade('a', 1000));
    pushTrade(trade('b', 2000));
    pushTrade(trade('b', 2000));
    expect(root.querySelectorAll('[data-testid=market-trade]')).toHaveLength(2);
  });

  it('pair picker: a short list of bases and USDC / NEAR; switching pair shows that pair book', () => {
    const { tab, root, push } = setup();
    const quote = root.querySelector('[data-testid=market-quote]') as HTMLSelectElement;
    expect(quote.value).toBe('USDC');
    expect([...quote.options].map((o) => o.value)).toEqual(['USDC', 'NEAR']);
    expect((root.querySelector('[data-testid=market-base]') as HTMLSelectElement).options.length).toBeLessThanOrEqual(6);
    push(book(1, [['400000', 100, 1]]));
    quote.value = 'NEAR';
    quote.dispatchEvent(new Event('change'));
    expect(tab.selected()).toBe('bio.water/NEAR');
    expect(prices(root, 'asks')).toEqual([]);
  });

  it('a pair set from a suggestion outside the short list is still selectable', () => {
    const { tab, root } = setup();
    tab.setPair('metals.t3', 'USDC');
    expect((root.querySelector('[data-testid=market-base]') as HTMLSelectElement).value).toBe('metals.t3');
  });

  it('shows best bid / ask / last price and 24h change', () => {
    const { root, push, pushTrade } = setup();
    push(book(1, [['400000', 100, 1]], [['300000', 70, 1]]));
    pushTrade(trade('a', Date.now() - 3600_000));
    pushTrade(trade('b', Date.now() - 1000));
    const stat = (id: string) => root.querySelector(`[data-testid=market-stat-${id}] .ta-market__stat-v`)!.textContent;
    expect([stat('bid'), stat('ask'), stat('last'), stat('change')]).toEqual(['0.300', '0.400', '0.500', '+0.0 %']);
  });

  it('lists only the last 5 fills', () => {
    const { root, pushTrade } = setup();
    for (let i = 1; i <= 8; i++) pushTrade(trade(`t${i}`, i * 1000));
    expect(root.querySelectorAll('[data-testid=market-trade]')).toHaveLength(5);
  });

  it('the full trading page link opens /trade.html in a new tab with noopener and carries the planet', () => {
    const { root } = setup();
    const a = root.querySelector('[data-testid=market-open-full]') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/trade.html?planet=p1');
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener');
  });

  it('the ticket keeps advanced options collapsed and no stall editor, analytics or board in the hub', () => {
    const { root } = setup();
    expect((root.querySelector('[data-testid=order-advanced]') as HTMLDetailsElement).open).toBe(false);
    for (const id of ['stall-slider', 'stall-valuation', 'stall-earnings', 'market-candles']) expect(root.querySelector(`[data-testid=${id}]`)).toBeNull();
  });

  it('onShow loads the REST snapshot', async () => {
    const { tab, root, services } = setup();
    (services as Record<string, unknown>).marketSnapshot = vi.fn(async () => ({ planetId: 'p1', books: [book(0, [['400000', 100, 1]])], board: [], recentTrades: [trade('t', 5)] }));
    tab.onShow();
    await vi.waitFor(() => expect(prices(root, 'asks')).toEqual(['0.400']));
    expect(root.querySelectorAll('[data-testid=market-trade]')).toHaveLength(1);
  });
});

describe('MarketState', () => {
  it('a snapshot never replaces a newer push', () => {
    const s = new MarketState(() => 'p1');
    s.applyBook(book(5, [['400000', 1, 1]]));
    s.applySnapshot({ planetId: 'p1', books: [book(3, [['999', 1, 1]])], board: [], recentTrades: [] });
    expect(s.book(PAIR)!.seq).toBe(5);
    expect(s.applyBook({ ...book(9), planetId: 'other' })).toBe(false);
  });
});

describe('market feature and the Trade Hub tab extension', () => {
  it('registers a MARKET tab once the Trade Hub panel offers registerTradeHubTab; shows/hides bodies', () => {
    const tabsRow = document.createElement('div');
    const form = document.createElement('div');
    tabsRow.after(form);
    document.createElement('div').append(tabsRow, form);
    const parent = document.createElement('div');
    parent.append(tabsRow, form);
    const { ctx } = setup();
    const changes: Array<string | null> = [];
    const ext = new TabExtensions(tabsRow, form, ctx, (id) => changes.push(id));
    const services = ctx.services as unknown as Record<string, unknown>;
    const inst = marketFeature.hud!.find((h) => h.id === 'market-tab')!.mount(document.createElement('div'), ctx);
    expect(parent.querySelector('[data-testid=trade-hub-tab-market]')).toBeNull();
    services.registerTradeHubTab = (d: TradeHubTabDef) => ext.register(d);
    inst.update!({});
    const btn = parent.querySelector('[data-testid=trade-hub-tab-market]') as HTMLButtonElement;
    expect(btn.textContent).toBe('MARKET');
    btn.click();
    expect(form.hidden).toBe(true);
    expect((parent.querySelector('[data-testid=trade-hub-ext-market]') as HTMLElement).hidden).toBe(false);
    ext.show(null);
    expect(form.hidden).toBe(false);
    expect(changes).toEqual(['market', null]);
    inst.dispose();
    expect(parent.querySelector('[data-testid=trade-hub-tab-market]')).toBeNull();
  });
});
