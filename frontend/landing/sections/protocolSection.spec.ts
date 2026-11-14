// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProtocolTreasuryView } from '../../../backend/app/src/near/infrastructure/dev/protocol-treasury.view';
import { initEconomicsSection } from './economicsSection';
import { initProtocolSection } from './protocolSection';

describe('Landing #protocol & #economics sections', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    document.body.innerHTML = `
      <section id="economics"><div id="economics-board"></div></section>
      <section id="protocol"><div id="protocol-board"></div></section>
    `;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  it('mounts the Protocol schematic, filters streams interactively, and hydrates live /v1/near/protocol telemetry', async () => {
    const realApiPayload = await buildProtocolTreasuryView({
      NEAR_MODE: 'mainnet',
      NEAR_ROOT_ACCOUNT: 'terraagent.near',
      NEAR_PROTOCOL_ACCOUNT: 'treasury.terraagent.near',
      NEAR_PLATFORM_FEE_BP: '120',
      NEAR_STAKER_PLATFORM_FEE_BP: '60',
      NEAR_DAO_FEE_SHARE_BP: '2500',
      NEAR_STAKER_MIN_NEAR: '15',
      NEAR_PROTOCOL_STAKING_YIELD_BP: '1500',
      NEAR_ESCROW_SLASH_PROTOCOL_BP: '1200',
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => realApiPayload,
    }) as unknown as typeof fetch;

    initProtocolSection();
    await new Promise((r) => setTimeout(r, 15));

    const board = document.getElementById('protocol-board');
    const card = document.querySelector<HTMLElement>('[data-testid="landing-protocol-card"]');
    expect(card).not.toBeNull();
    expect(card?.dataset.activeStream).toBe('all');
    expect(board?.dataset.activeStream).toBe('all');
    expect(document.querySelector('[data-protocol-account]')?.textContent).toBe('treasury.terraagent.near');
    expect(document.querySelector('[data-relayer-account]')?.textContent).toBe('relayer.terraagent.near');
    expect(document.querySelector('[data-proto-trade-rate]')?.textContent).toBe('0.90% / 0.45%');
    expect(document.querySelector('[data-proto-yield-title]')?.textContent).toBe('15% of Validator Yield');
    expect(document.querySelector('[data-proto-yield-rate]')?.textContent).toBe('1.35% APY Slice');
    expect(document.querySelector('[data-proto-pilot-net-apy]')?.textContent).toBe('7.65%');
    expect(document.querySelector('[data-proto-slash-rate]')?.textContent).toBe('12% of Breach');
    expect(document.querySelector('[data-proto-min-stake]')?.textContent).toBe('≥15 NEAR');
    expect(document.querySelectorAll('[data-proto-stage]').length).toBe(3);

    const stakingBtn = document.querySelector<HTMLButtonElement>('[data-proto-filter="staking"]')!;
    stakingBtn.click();
    expect(card?.dataset.activeStream).toBe('staking');
    expect(board?.dataset.activeStream).toBe('staking');
    expect(stakingBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('gracefully retains Testnet defaults when /v1/near/protocol fails offline', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    initProtocolSection();
    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelector('[data-protocol-account]')?.textContent).toBe('protocol.terraagent.testnet');
    expect(document.querySelector('[data-proto-trade-rate]')?.textContent).toBe('0.80% / 0.40%');
  });

  it('computes exact Day-1 staking boundary (5 NEAR standard vs 10 NEAR staker unlock) in #economics calculator', () => {
    initEconomicsSection();
    const stakeSlider = document.querySelector<HTMLInputElement>('#econ-stake-slider')!;
    const volSlider = document.querySelector<HTMLInputElement>('#econ-vol-slider')!;
    const banner = document.querySelector<HTMLElement>('#econ-tier-banner')!;
    const feeSaved = document.querySelector<HTMLElement>('#econ-fee-saved')!;
    const userYield = document.querySelector<HTMLElement>('#econ-user-yield')!;

    stakeSlider.value = '5';
    volSlider.value = '1000';
    stakeSlider.dispatchEvent(new Event('input'));
    expect(banner.classList.contains('is-unlocked')).toBe(false);
    expect(feeSaved.textContent).toBe('0.00 USDC / mo (1.00% fee)');

    stakeSlider.value = '10';
    stakeSlider.dispatchEvent(new Event('input'));
    expect(banner.classList.contains('is-unlocked')).toBe(true);
    expect(userYield.textContent).toBe('0.72 NEAR / yr');
    expect(feeSaved.textContent).toBe('5.00 USDC / mo (0.50% fee)');
  });
});
