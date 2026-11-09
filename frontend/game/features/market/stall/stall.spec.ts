// @vitest-environment jsdom
import type { MarketSnapshotResponse, MyOrderView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../../core/registry/types';
import { MarketTab } from '../tab/MarketTab';
import { StallSection } from './StallSection';
import { bpText, earnedRows, inventoryRows, pinnedFees, valuationRows } from './stallModel';

const policy = { policyVersion: 'v1', policyHash: 'h', platformFeeBp: 100, stallFeeMaxBp: 100, stallFeeDefaultBp: 100, ttlOptionsS: [60], openOrderLimit: 10, minNotional: {} };
const order = (over: Partial<MyOrderView> = {}): MyOrderView => ({
  orderId: 'o1', ref: 'r1', pair: 'bio.water/USDC', side: 'buy', resource: 'bio.water', amount: 300, filled: 0, price: { token: 'USDC', amount: '10000000' },
  state: 'OPEN', fillPolicy: 'GTC', policyVersion: 'v1', platformFeeBp: 100, stallFeeBp: 100, reserved: '10200000', expiresAtMs: 1, createdAtMs: 1, ...over,
} as MyOrderView);
const NOW = 1_000_000;
const snap = (over: Partial<MarketSnapshotResponse> = {}): MarketSnapshotResponse => ({
  planetId: 'p1', books: [], recentTrades: [], policy,
  board: [{ pair: 'bio.water/USDC', last: { num: '10000000', den: 300 }, change24hBp: null, volume24h: 300, vwap: null, candles1h: [], classification: 'organic' },
    { pair: 'metals.t1/USDC', last: null, change24hBp: null, volume24h: 0, vwap: null, candles1h: [], classification: 'insufficient_data', reason: 'thin' }],
  myOrders: [order()], balances: { 'bio.water': '300', 'metals.t1': '20', USDC: '5000000' }, reserved: { 'bio.water': '10' },
  stall: { hubFeeBp: 100, earned: { USDC: '100000' } }, ...over,
});
const ctxOf = (sendCommand = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 })), extra: Record<string, unknown> = {}) =>
  ({ flags: new Set(['W13']), host: 'server', services: { sendCommand, session: { planetId: () => 'p1' }, ...extra } }) as unknown as FeatureContext;
const q = (root: HTMLElement, id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement;

describe('stall model', () => {
  it('earned shows the demo 0.10 mock USDC; zero tokens are hidden', () => {
    expect(earnedRows(snap()).map((r) => r.text)).toEqual(['0.10 mock USDC']);
    expect(earnedRows(snap({ stall: { hubFeeBp: 0, earned: { USDC: '0' } } }))).toEqual([]);
    expect(bpText(25)).toBe('0.25 %');
  });
  it('inventory lists resources only; valuation is an estimate, insufficient_data is a dash', () => {
    expect(inventoryRows(snap()).map((r) => [r.resource, r.free, r.reserved])).toEqual([['bio.water', 300n, 10n], ['metals.t1', 20n, 0n]]);
    const s = snap({ recentTrades: [{ tradeId: 't', pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', amount: 300, notional: '10000000', platformFee: '0', stallFee: '0', stallFeeBp: 0, makerSide: 'sell', state: 'FINAL', atMs: NOW - 120_000 }] });
    const rows = valuationRows(s, NOW);
    expect(rows[0]).toMatchObject({ resource: 'bio.water', value: '10.333333 mock USDC' });
    expect(rows[0]!.source).toContain('2 min ago');
    expect(rows[1]).toMatchObject({ resource: 'metals.t1', value: null });
  });
  it('pinnedFees groups open orders only', () => {
    expect(pinnedFees([order(), order({ orderId: 'o2', stallFeeBp: 50 }), order({ orderId: 'o3', state: 'FILLED', stallFeeBp: 7 })])).toEqual([{ bp: 50, orders: 1 }, { bp: 100, orders: 1 }]);
  });
});

describe('StallSection', () => {
  it('shows ONE read-only stall fee line and only the own in-orbit resources; no editor, earnings or valuation', () => {
    const s = new StallSection(ctxOf());
    s.apply(snap());
    expect(q(s.el, 'stall-current').textContent).toContain('1.00 %');
    expect(s.el.querySelectorAll('[data-testid=stall-inv]').length).toBeGreaterThan(0);
    expect(s.el.textContent).toContain('300 free');
    for (const id of ['stall-slider', 'stall-apply', 'stall-valuation', 'stall-earnings']) expect(s.el.querySelector(`[data-testid=${id}]`)).toBeNull();
  });

  it('is mounted in the Market tab and fed by the snapshot', async () => {
    const ctx = ctxOf(undefined, { marketSnapshot: vi.fn(async () => snap({ stall: { hubFeeBp: 50, earned: {} } })) });
    const root = document.createElement('div');
    const tab = new MarketTab(root, ctx);
    tab.onShow();
    await vi.waitFor(() => expect(q(root, 'stall-current').textContent).toContain('0.50 %'));
    tab.dispose();
  });
});
