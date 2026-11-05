// @vitest-environment jsdom
import { AnalyticsBatchV1, type MarketPolicyView, type MyOrderView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsClient, type AnalyticsDeps } from '../../../core/analytics/client';
import type { FeatureContext } from '../../../core/registry/types';
import marketFeature from '../index';
import { MarketTab } from '../tab/MarketTab';
import { MARKET_EVENTS } from './marketTracker';

const policy: MarketPolicyView = { policyVersion: 'bootstrap-1', policyHash: 'h', platformFeeBp: 100, stallFeeMaxBp: 100, stallFeeDefaultBp: 100, ttlOptionsS: [900], openOrderLimit: 20, minNotional: {} };
const mine: MyOrderView = {
  orderId: 'o1', ref: 'r', pair: 'bio.water/USDC', side: 'buy', resource: 'bio.water', amount: 300, filled: 0, price: { token: 'USDC', amount: '10000000' },
  state: 'OPEN', fillPolicy: 'partial', policyVersion: 'bootstrap-1', platformFeeBp: 100, stallFeeBp: 100, reserved: '1', expiresAtMs: 1, createdAtMs: 0,
};

function setup(consent: boolean) {
  const sent: Array<{ events: Array<{ name: string; props: Record<string, unknown> }> }> = [];
  let allowed = consent;
  const d: AnalyticsDeps = {
    readConsent: () => allowed, writeConsent: (a) => void (allowed = a), anonId: () => '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11', clearAnonId: () => undefined,
    newSessionId: () => 's', fetch: vi.fn(async (_u, init) => void sent.push(JSON.parse(init.body))), sendBeacon: () => true, now: () => 1, setInterval: () => 1, clearInterval: () => undefined,
  };
  const client = new AnalyticsClient(d);
  const eventListeners: Array<(e: unknown[]) => void> = [];
  const sendCommand = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 }));
  const services = {
    session: { planetId: () => 'p1' }, sendCommand, track: (n: string, p?: never) => client.track(n, p),
    store: { onServerEvents: (f: (e: unknown[]) => void) => { eventListeners.push(f); return () => undefined; } },
    marketSnapshot: vi.fn(async () => ({ planetId: 'p1', books: [], board: [], recentTrades: [], policy, balances: { USDC: '20000000' }, myOrders: [mine] })),
  };
  const root = document.createElement('div');
  document.body.append(root);
  const tab = new MarketTab(root, { flags: new Set(['W13']), host: 'server', services } as unknown as FeatureContext);
  const q = (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement;
  const type = (id: string, v: string) => { const i = q(id) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input')); };
  const names = async () => { await client.flush(); return sent.flatMap((b) => b.events); };
  return { tab, q, type, names, sent, client, emit: (e: unknown[]) => eventListeners.forEach((f) => f(e)), sendCommand };
}

describe('market analytics (W13-28)', () => {
  it('records the demo story with pair, side and amount after opt-in', async () => {
    const { tab, q, type, names, emit, client } = setup(true);
    tab.onShow();
    await vi.waitFor(() => expect(q('order-preview-policy')).not.toBeNull());
    type('order-amount', '300');
    type('order-price', '10');
    q('order-submit').click();
    await vi.waitFor(() => expect(q('order-result').textContent).toBe('Order sent.'));
    await vi.waitFor(() => expect(q('order-cancel')).not.toBeNull());
    q('order-cancel').click();
    emit([{ kind: 'tradeSettled', data: { base: 'bio.water', quote: 'USDC', amount: 300, notional: '10000000', platformFee: '100000', stallFee: '100000', role: 'buyer', makerSide: 'sell' } }]);
    await vi.waitFor(async () => expect((await names()).some((e) => e.name === 'market_order_cancelled')).toBe(true));
    emit([{ kind: 'tradeSettled', data: { base: 'bio.water', quote: 'USDC', amount: 300, notional: '10000000', platformFee: '100000', stallFee: '100000', role: 'buyer', makerSide: 'sell' } }]);
    const events = await names();
    void client;
    const by = (n: string) => events.find((e) => e.name === n)!;
    expect(by('market_tab_opened')).toBeDefined();
    expect(by('market_order_previewed').props).toMatchObject({ pair: 'bio.water/USDC', side: 'buy', amount: 300 });
    expect(by('market_order_placed').props).toEqual({ pair: 'bio.water/USDC', side: 'buy', amount: 300, quoteToken: 'USDC', totalAtomic: '10000000', maxSpendAtomic: '10200000' });
    expect(by('market_order_cancelled').props).toEqual({ pair: 'bio.water/USDC', side: 'buy', amount: 300 });
    expect(by('market_trade_settled').props).toEqual({ pair: 'bio.water/USDC', side: 'buy', role: 'buyer', amount: 300, notional: '10000000', fees: '200000', makerSide: 'sell' });
    for (const e of events) expect(MARKET_EVENTS as readonly string[]).toContain(e.name);
  });

  it('a refused order records market_order_rejected with the code; every batch passes the server schema', async () => {
    const { tab, q, type, names, sendCommand, sent } = setup(true);
    tab.onShow();
    await vi.waitFor(() => expect(q('order-preview-policy')).not.toBeNull());
    type('order-amount', '1');
    type('order-price', '1');
    sendCommand.mockResolvedValueOnce({ ok: false, code: 'insufficient_funds' } as never);
    q('order-submit').click();
    await vi.waitFor(async () => expect((await names()).some((e) => e.name === 'market_order_rejected')).toBe(true));
    expect((await names()).find((e) => e.name === 'market_order_rejected')!.props).toMatchObject({ code: 'insufficient_funds', pair: 'bio.water/USDC', side: 'buy', amount: 1 });
    for (const b of sent) expect(AnalyticsBatchV1.safeParse(b).success).toBe(true);
  });

  it('sends nothing without consent', async () => {
    const { tab, q, type, names, sent } = setup(false);
    tab.onShow();
    await vi.waitFor(() => expect(q('order-preview-policy')).not.toBeNull());
    type('order-amount', '300');
    type('order-price', '10');
    q('order-submit').click();
    await vi.waitFor(() => expect(q('order-result').textContent).toBe('Order sent.'));
    expect(await names()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('the market feature lists its event names', () => {
    expect(marketFeature.analytics).toEqual([...MARKET_EVENTS]);
  });
});
