// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { TradeClient } from '../api/client';
import { RampView } from './rampView';

const TOKENS = {
  tokens: [{ assetId: 'nep141:odd.near', symbol: 'ODD', decimals: 8, blockchain: 'near' }],
  presets: [
    { assetId: 'nep141:wrap.near', symbol: 'NEAR', decimals: 24, blockchain: 'near' },
    { assetId: 'nep141:usdc.near', symbol: 'USDC', decimals: 6, blockchain: 'near' },
  ],
};
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

function setup(opts: { mainnet?: boolean; tokens?: unknown } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/tokens')) return json(opts.tokens ?? TOKENS);
    return json({ source: 'fallback', amountOutFormatted: '10.00', minAmountOut: '9900000', timeEstimateSec: 12 });
  });
  const view = new RampView({ fetchFn: () => fetchFn } as unknown as TradeClient, { isMainnet: () => opts.mainnet === true });
  const q = (id: string) => view.root.querySelector(`[data-testid="${id}"]`) as unknown as HTMLInputElement;
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
  const quotes = () => calls.filter((c) => c.url.endsWith('/quote')).map((c) => JSON.parse(String(c.init?.body)));
  return { view, q, flush, quotes, fetchFn };
}

describe('RampView decimal scaling & Q-007', () => {
  it('USDC 10.00 sends atomic 10000000 with dry:true and shows the scaled amount', async () => {
    const t = setup(); await t.flush();
    t.q('ramp-origin').value = 'nep141:usdc.near';
    t.q('ramp-amount').value = '10.00';
    t.q('ramp-quote-btn').click(); await t.flush();
    expect(t.quotes()).toEqual([{ originAsset: 'nep141:usdc.near', destinationAsset: expect.any(String), amount: '10000000', dry: true }]);
    expect(t.q('ramp-quote-result').textContent).toContain('10000000 atomic');
  });
  it('NEAR 1 sends 10^24; decimals of a loaded non-preset token are used', async () => {
    const t = setup(); await t.flush();
    t.q('ramp-origin').value = 'nep141:wrap.near'; t.q('ramp-amount').value = '1';
    t.q('ramp-quote-btn').click(); await t.flush();
    expect(t.quotes()[0].amount).toBe('1000000000000000000000000');
  });
  it('invalid input shows an inline error and sends no quote', async () => {
    const t = setup(); await t.flush();
    t.q('ramp-origin').value = 'nep141:usdc.near';
    for (const bad of ['10.0000001', '-1', '1e6', '']) {
      t.q('ramp-amount').value = bad; t.q('ramp-quote-btn').click(); await t.flush();
      expect(t.q('ramp-quote-result').querySelector('[role="alert"]'), bad).not.toBeNull();
    }
    expect(t.quotes()).toHaveLength(0);
  });
  it('stays dry on non-mainnet even if the confirm box were ticked', async () => {
    const t = setup(); await t.flush();
    t.q('ramp-confirm-mainnet').checked = true;
    t.q('ramp-quote-btn').click(); await t.flush();
    expect(t.quotes()[0].dry).toBe(true);
    expect(t.quotes()[0].confirmMainnet).toBeUndefined();
  });
  it('mainnet: dry until the confirm checkbox is ticked, then live with confirmMainnet', async () => {
    const t = setup({ mainnet: true }); await t.flush();
    t.view.root.dispatchEvent(new Event('focusin'));
    expect((t.view.root.querySelector('[data-testid="ramp-confirm-row"]') as HTMLElement).hidden).toBe(false);
    t.q('ramp-quote-btn').click(); await t.flush();
    expect(t.quotes()[0].dry).toBe(true);
    t.q('ramp-confirm-mainnet').checked = true;
    t.q('ramp-quote-btn').click(); await t.flush();
    expect(t.quotes()[1]).toMatchObject({ dry: false, confirmMainnet: true });
  });
  it('tokens endpoint failure falls back to preset decimals', async () => {
    const t = setup({ tokens: { nope: 1 } }); await t.flush();
    t.q('ramp-origin').value = 'nep141:wrap.near';
    t.q('ramp-quote-btn').click(); await t.flush();
    expect(t.quotes()[0].amount).toBe('1000000000000000000000000');
  });
});
