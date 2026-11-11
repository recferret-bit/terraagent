// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import chainStatus from './index';

function makeContext(): FeatureContext {
  const hudOverlay = document.createElement('div');
  document.body.appendChild(hudOverlay);
  return {
    flags: new Set(['W06']),
    host: 'server',
    services: { hudOverlay, track: vi.fn() },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('chain-status modal (W23-02, W23-43)', () => {
  it('renders NEAR_MODE, NearBlocks explorer links, and executes a live 1Click dry quote', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v1/near/status')) {
        return new Response(
          JSON.stringify({
            nearMode: 'testnet',
            rootAccount: 'terraagent.testnet',
            explorerBaseUrl: 'https://testnet.nearblocks.io',
            health: { ok: true, latencyMs: 42 },
            ports: [
              { port: 'CargoToken', mode: 'testnet', target: 'res.terraagent.testnet' },
              { port: 'Staking', mode: 'mock', target: 'postgres-mock' },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ source: '1click', amountOut: '4500000', minAmountOut: '4450000' }),
        { status: 200 },
      );
    });

    const ctx = makeContext();
    const hud = chainStatus.hud![0]!.mount(document.createElement('div'), ctx);
    chainStatus.menus![0]!.open(ctx);

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="chain-near-mode"]')?.textContent).toBe('NEAR_MODE: testnet');
    });
    const link = document.querySelector('tr[data-port="CargoToken"] a') as HTMLAnchorElement;
    expect(link.href).toBe('https://testnet.nearblocks.io/address/res.terraagent.testnet');
    expect(document.querySelector('tr[data-port="Staking"]')?.textContent).toContain('postgres-mock');

    (document.querySelector('[data-testid="chain-quote-btn"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="chain-quote-output"]')?.textContent).toContain('[1click] 1 wNEAR');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    (document.querySelector('[data-testid="chain-status-close"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="chain-status-modal"]')).toBeNull();
    hud.dispose();
  });

  it('shows a graceful error message when /v1/near/status fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('fail', { status: 503 }));
    const ctx = makeContext();
    const hud = chainStatus.hud![0]!.mount(document.createElement('div'), ctx);
    chainStatus.menus![0]!.open(ctx);

    await vi.waitFor(() => {
      expect(document.querySelector('.ta-chain-fault')?.textContent).toContain('Unable to reach /v1/near/status.');
    });
    hud.dispose();
  });
});
