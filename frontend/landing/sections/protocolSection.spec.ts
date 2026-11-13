// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        protocolAccount: 'treasury.terraagent.near',
        feeSchedule: {
          standardPlatformFeeBp: 120,
          stakerPlatformFeeBp: 60,
          protocolShareBp: 7500,
          stakerMinNear: 15,
          diplomacySlashProtocolBp: 1200,
        },
      }),
    }) as unknown as typeof fetch;

    initProtocolSection();
    await new Promise((r) => setTimeout(r, 10));

    const card = document.querySelector<HTMLElement>('[data-testid="landing-protocol-card"]');
    expect(card).not.toBeNull();
    expect(card?.dataset.activeStream).toBe('all');
    expect(document.querySelector('[data-protocol-account]')?.textContent).toBe('treasury.terraagent.near');
    expect(document.querySelector('[data-proto-trade-rate]')?.textContent).toBe('0.90% / 0.45%');
    expect(document.querySelector('[data-proto-slash-rate]')?.textContent).toBe('12% of Breach');
    expect(document.querySelector('[data-proto-min-stake]')?.textContent).toBe('≥15 NEAR');
    expect(document.querySelectorAll('[data-proto-stage]').length).toBe(3);

    const stakingBtn = document.querySelector<HTMLButtonElement>('[data-proto-filter="staking"]')!;
    stakingBtn.click();
    expect(card?.dataset.activeStream).toBe('staking');
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
