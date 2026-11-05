// @vitest-environment jsdom
import type { MarketSnapshotResponse } from '@terra/contracts';
import type { SupplyTradeView } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../../core/registry/types';
import marketFeature from '../index';
import { SupplyPanel } from './SupplyPanel';
import { buyText, logisticsLines, remedyRows } from './supplyModel';

const view = (over: Partial<SupplyTradeView> = {}): SupplyTradeView => ({
  badges: [{ resource: 'metals.t1', level: 'abundant', weightBp: 15000 }, { resource: 'minerals.t3', level: 'scarce', weightBp: 1500 }, { resource: 'bio.water', level: 'normal', weightBp: 8000 }],
  mainResource: 'minerals.t1',
  basket: {
    buy: [{ resource: 'minerals.t3', qty: 8, reason: 'job', jobId: 'q1', label: 'Survey Array' }, { resource: 'metals.t1', qty: 40, reason: 'logistics' }],
    sell: [{ resource: 'minerals.t1', qty: 450, reason: 'surplus' }],
  },
  logistics: {
    windowKey: '0/3.0', K: 100, L: '200', u: '2', M: '1.25', bill: [{ resource: 'metals.t1', units: '50' }], reserveWindows: 3, graceLeftTicks: 0, maxRouteTiles: 12,
    bottleneck: { nodeId: '7', entities: 5 }, status: { supplied: 4, reserve: 0, grace: 0, partial: 1, unavailable: 0 }, unavailable: [], windowTicks: 300,
  },
  remedy: { depot: { cost: { 'metals.t1': 60 }, buildMinutes: 0.2, throughputAdd: 60 }, produce: { 'metals.t1': { num: '1000', den: '180000' } } },
  ...over,
});
const snap = { planetId: 'p', books: [{ planetId: 'p', pair: 'minerals.t3/USDC', seq: 1, bids: [], asks: [{ num: '400000', den: 1, amount: 50, orders: 1 }] }], board: [], recentTrades: [],
  policy: { policyVersion: 'x', policyHash: 'h', platformFeeBp: 100, stallFeeMaxBp: 100, stallFeeDefaultBp: 100, ttlOptionsS: [3600], openOrderLimit: 20, minNotional: {} } } as unknown as MarketSnapshotResponse;
const text = (el: Element): string => el.textContent ?? '';

describe('Supply & trade model', () => {
  it('names the job and the missing quantity', () => {
    expect(buyText(view().basket.buy[0]!)).toBe('Needed by Survey Array job: 8 Minerals T3');
    expect(buyText(view().basket.buy[1]!)).toBe('Next supply window needs 40 Metals T1');
  });

  it('army at load 200 on capacity 100: congestion x1.25, the exact bill, reserve duration, bottleneck and remedies before confirming', () => {
    const l = logisticsLines(view())!;
    expect(l.congestion).toBe('Congestion x1.25');
    expect(l.load).toBe('Load 200 / capacity 100 (200%)');
    expect(l.bill).toEqual(['50 Metals T1']);
    expect(l.reserve).toBe('Reserve lasts 3 windows (180 s)');
    expect(l.bottleneck).toBe('Bottleneck node #7 serves 5');
    expect(l.remedies[0]).toContain('Over capacity');
    expect(l.remedies[0]).toContain('+60 per window');
  });

  it('the four remedies for crystal: buy incl. fees, produce, depot, reserve', () => {
    const rows = remedyRows(view(), view().basket.buy[0]!, snap);
    expect(rows.map((r) => r.kind)).toEqual(['buy', 'produce', 'depot', 'reserve']);
    expect(rows[0]!.detail).toContain('3.20 + 0.064 fees = 3.264 mock USDC');
    expect(rows[1]!.detail).toContain('not available'); // crystal has no local extractor row in this fixture
    expect(rows[2]!.detail).toContain('60 Metals T1');
  });
});

describe('SupplyPanel', () => {
  const mount = () => {
    const calls: string[] = [];
    const panel = new SupplyPanel({ buy: (r, q) => calls.push(`buy ${r} ${q}`), sell: (r, q) => calls.push(`sell ${r} ${q}`), snapshot: async () => snap });
    document.body.append(panel.el);
    panel.setOpen(true);
    return { panel, calls };
  };

  it('desert specialist: scarce crystal is badged, the basket says why to buy it and the surplus says what to sell', () => {
    const { panel } = mount();
    panel.update(view());
    expect(text(panel.el.querySelector('[data-testid=supply-badge-minerals\\.t3]')!)).toContain('SCARCE');
    expect(panel.el.querySelector('[data-testid=supply-badge-bio\\.water]')).toBeNull();
    expect(text(panel.el.querySelector('[data-testid=supply-buy]')!)).toContain('Needed by Survey Array job: 8 Minerals T3');
    expect(text(panel.el.querySelector('[data-testid=supply-sell]')!)).toContain('Surplus 450 Minerals T1');
  });

  it('buttons only prefill (the callbacks), COMPARE shows the four options', async () => {
    const { panel, calls } = mount();
    panel.update(view());
    (panel.el.querySelector('[data-testid=supply-buy-act]') as HTMLElement).click();
    (panel.el.querySelector('[data-testid=supply-sell-act]') as HTMLElement).click();
    expect(calls).toEqual(['buy minerals.t3 8', 'sell minerals.t1 450']);
    (panel.el.querySelector('[data-testid=supply-buy-compare]') as HTMLElement).click();
    await vi.waitFor(() => expect(panel.el.querySelectorAll('[data-testid^=supply-option-]')).toHaveLength(4));
  });

  it('hidden without data; refreshes when the view changes', () => {
    const { panel } = mount();
    panel.update(undefined);
    expect(panel.el.hidden).toBe(true);
    panel.update(view());
    expect(panel.el.hidden).toBe(false);
    panel.update(view({ basket: { buy: [], sell: [] } }));
    expect(text(panel.el.querySelector('[data-testid=supply-basket]')!)).toContain('Nothing to buy');
  });

  it('the market feature registers the panel', () => {
    expect(marketFeature.hud!.some((h) => h.id === 'supply-trade')).toBe(true);
  });

  it('mounts from the HUD def and reads colony.supplyTrade of the own colony', () => {
    const el = document.createElement('div');
    const ctx = { flags: new Set(['W13']), host: 'server', services: { colonyId: 1 } } as unknown as FeatureContext;
    const inst = marketFeature.hud!.find((h) => h.id === 'supply-trade')!.mount(el, ctx);
    inst.update!({ colonies: [{ index: 0 }, { index: 1, supplyTrade: view() }] } as never);
    (el.querySelector('[data-testid=supply-toggle]') as HTMLElement).click();
    expect(el.querySelector('[data-testid=supply-basket]')).not.toBeNull();
    inst.dispose();
  });
});
