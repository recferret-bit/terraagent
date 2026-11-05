// @vitest-environment jsdom
import type { MarketPolicyView, MarketSnapshotResponse, MyOrderView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../../core/registry/types';
import { MarketTab } from '../tab/MarketTab';
import { previewOrder } from './orderPreview';

const policy: MarketPolicyView = {
  policyVersion: 'bootstrap-1', policyHash: 'h', platformFeeBp: 100, stallFeeMaxBp: 100, stallFeeDefaultBp: 100,
  ttlOptionsS: [900, 3600, 21600, 86400], openOrderLimit: 20, minNotional: { USDC: '10000' },
};
const myOrder: MyOrderView = {
  orderId: 'o1', ref: 'market-order:c:1', pair: 'bio.water/USDC', side: 'buy', resource: 'bio.water', amount: 300, filled: 100,
  price: { token: 'USDC', amount: '10000000' }, state: 'PARTIAL', fillPolicy: 'partial', policyVersion: 'bootstrap-1',
  platformFeeBp: 100, stallFeeBp: 100, reserved: '6800000', expiresAtMs: 1, createdAtMs: 0,
};
const snap = (usdc: string, orders: MyOrderView[] = []): MarketSnapshotResponse => ({ planetId: 'p1', books: [], board: [], recentTrades: [], policy, balances: { USDC: usdc }, myOrders: orders });

function setup(usdc: string, orders: MyOrderView[] = []) {
  const sendCommand = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 }));
  const services = { session: { planetId: () => 'p1' }, store: {}, sendCommand, marketSnapshot: vi.fn(async () => snap(usdc, orders)) };
  const root = document.createElement('div');
  document.body.append(root);
  const tab = new MarketTab(root, { flags: new Set(['W13']), host: 'server', services } as unknown as FeatureContext);
  const q = (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement;
  const type = (id: string, v: string) => { const i = q(id) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input')); };
  return { tab, root, q, type, sendCommand };
}

describe('previewOrder', () => {
  const base = { side: 'buy', base: 'bio.water', quote: 'USDC', amountText: '300', priceText: '10', maxStallFeeBp: 100, policy, balances: { USDC: '20000000' } } as const;

  it('demo: 300 water for 10 USDC costs the buyer 10.20 in quote (full 300 received)', () => {
    const p = previewOrder(base);
    expect(p.terms).toEqual({ amount: 300, priceAtomic: 10_000_000n });
    expect([p.platformFee, p.stallFee, p.totalMax]).toEqual([100_000n, 100_000n, 10_200_000n]);
    expect(p.spendToken).toBe('USDC');
    expect(p.blocked).toBeUndefined();
  });

  it('resting and incoming buys are both charged in quote: insufficient inclusive funds is blocked', () => {
    const p = previewOrder({ ...base, balances: { USDC: '10100000' } });
    expect(p.blocked).toContain('Insufficient mock USDC: need 10.20, free 10.10');
    expect(previewOrder({ ...base, balances: { USDC: '10200000' } }).blocked).toBeUndefined();
  });

  it('sells need free base; invalid text and stall fee out of range are explained', () => {
    expect(previewOrder({ ...base, side: 'sell', balances: { 'bio.water': '299' } }).blocked).toContain('Insufficient mock bio.water');
    expect(previewOrder({ ...base, side: 'sell', balances: { 'bio.water': '300' } }).blocked).toBeUndefined();
    expect(previewOrder({ ...base, amountText: '1.5' }).blocked).toContain('whole');
    expect(previewOrder({ ...base, priceText: 'abc' }).blocked).toContain('price');
    expect(previewOrder({ ...base, maxStallFeeBp: 101 }).blocked).toContain('0 to 100 bp');
  });
});

describe('Market tab order form', () => {
  it('shows the preview numbers and policy version, sends market.placeOrder with the exact terms', async () => {
    const { tab, q, type, sendCommand } = setup('20000000');
    tab.onShow();
    await vi.waitFor(() => expect(q('order-preview-policy').textContent).toContain('bootstrap-1'));
    type('order-amount', '300');
    type('order-price', '10');
    expect(q('order-preview-total').textContent).toContain('10.20 mock USDC');
    expect(q('order-preview-network').textContent).toContain('mock');
    expect((q('order-submit') as HTMLButtonElement).disabled).toBe(false);
    q('order-submit').click();
    await vi.waitFor(() => expect(q('order-result').textContent).toBe('Order sent.'));
    expect(sendCommand).toHaveBeenCalledWith('market.placeOrder', {
      side: 'buy', resource: 'bio.water', amount: 300, price: { token: 'USDC', amount: '10000000' }, ttlS: 900, maxStallFeeBp: 100,
    });
  });

  it('insufficient inclusive funds disables Submit and says why; a host reject is shown', async () => {
    const { tab, q, type, sendCommand } = setup('10000000');
    tab.onShow();
    await vi.waitFor(() => expect(q('order-preview-policy')).not.toBeNull());
    type('order-amount', '300');
    type('order-price', '10');
    expect((q('order-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(q('order-blocked').textContent).toContain('need 10.20, free 10.00');
    sendCommand.mockResolvedValueOnce({ ok: false, code: 'insufficient_funds', detail: 'funds changed' } as never);
    type('order-price', '9');
    q('order-submit').click();
    await vi.waitFor(() => expect(q('order-result').textContent).toBe('Order refused: funds changed'));
  });

  it('lists my orders with filled/amount and Cancel sends market.cancelOrder', async () => {
    const { tab, q, root, sendCommand } = setup('0', [myOrder]);
    tab.onShow();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-testid=order-my]')).toHaveLength(1));
    const row = root.querySelector('[data-testid=order-my]')!;
    expect(row.textContent).toContain('100/300');
    expect(row.textContent).toContain('PARTIAL');
    (q('order-cancel') as HTMLButtonElement).click();
    expect(sendCommand).toHaveBeenCalledWith('market.cancelOrder', { orderId: 'o1' });
  });
});
