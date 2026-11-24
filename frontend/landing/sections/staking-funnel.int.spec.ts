// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAKING_TIERS } from '@terra/contracts';
import { initEconomicsSection } from './economicsSection';
import { initProtocolSection } from './protocolSection';
import { initStakeNavPill } from './stakeNavPill';

describe('Landing staking funnel integration (#nav pill + #economics calculator + #protocol schematic)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('hydrates live APY & protocol telemetry and updates CTA href across slider tier transitions', async () => {
    document.body.innerHTML = `
      <header><div class="header-right"></div></header>
      <div id="economics-board"></div>
      <div id="protocol-board"></div>
    `;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/near/staking/overview')) {
        return new Response(JSON.stringify({ apy: { netApyBp: 792, grossApyBp: 990, protocolYieldShareBp: 2000, source: 'live' } }), { status: 200 });
      }
      if (url.includes('/v1/near/protocol')) {
        return new Response(
          JSON.stringify({
            protocolAccountId: 'protocol.live.testnet',
            relayerAccountId: 'relayer.live.testnet',
            feeSchedule: {
              standardPlatformFeeBp: 100,
              stakerPlatformFeeBp: 65,
              tierTakerFeeBp: STAKING_TIERS.map((t) => t.takerFeeBp),
              daoCarveOutShareBp: 2000,
              protocolNetStandardBp: 80,
              protocolNetStakerBp: 52,
              validatorGrossApyBp: 990,
              stakerNetApyBp: 792,
              protocolStakingYieldBp: 198,
              protocolStakingYieldShareBp: 2000,
              minStakeForPerksNear: '10',
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pillDone = initStakeNavPill(document.querySelector<HTMLElement>('.header-right'), fetchMock as unknown as typeof fetch);
    initEconomicsSection();
    initProtocolSection();

    await pillDone;
    await vi.waitFor(() => {
      expect(document.querySelector('[data-protocol-account]')?.textContent).toBe('protocol.live.testnet');
    });

    const pillBadge = document.querySelector('[data-testid="landing-stake-pill"] .stake-pill-badge')!;
    expect(pillBadge.textContent).toContain('7.92% APY');
    expect(document.querySelector('#econ-apy-badge')?.textContent).toBe('7.92% LIVE APY');

    const slider = document.querySelector<HTMLInputElement>('#econ-stake-slider')!;
    const cta = document.querySelector<HTMLAnchorElement>('#econ-stake-cta')!;
    slider.value = '500';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(cta.getAttribute('href')).toBe('/me.html#staking?amount=500');
    expect(document.querySelector('#econ-tier-banner')?.textContent).toContain('TIER 4');
    expect(document.querySelector('#econ-user-yield')?.textContent).toBe('39.60 NEAR / yr');
    expect(document.querySelector('[data-testid="landing-tier-perks"]')?.textContent).toContain('15× gasless relay');
    expect(document.querySelector('[data-testid="landing-tier-perks"]')?.textContent).toContain('1.5× DAO votes');
    expect(document.querySelector('[data-testid="landing-tier-perks"]')?.textContent).toContain('Lead Patron');
    expect(document.querySelector('[data-testid="landing-staking-rules"]')?.textContent).toContain('0.25%');
    expect(document.querySelector('[data-testid="landing-staking-rules"]')?.textContent).toContain('15% of Protocol');

    slider.value = '0';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(cta.getAttribute('href')).toBe('/me.html#staking?amount=10');
    expect(document.querySelector('#econ-tier-banner')?.textContent).toContain('CADET');
    expect(document.querySelector('[data-testid="landing-tier-perks"]')?.textContent).toContain('5 free TEE turns');
  });

  it('keeps offline sim APY fallback when overview & protocol endpoints 404', async () => {
    document.body.innerHTML = `<header><div class="header-right"></div></header><div id="economics-board"></div><div id="protocol-board"></div>`;
    const fetch404 = vi.fn(async () => new Response('{}', { status: 404 }));
    globalThis.fetch = fetch404 as unknown as typeof fetch;

    await initStakeNavPill(document.querySelector<HTMLElement>('.header-right'), fetch404 as unknown as typeof fetch);
    initEconomicsSection();
    initProtocolSection();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('[data-testid="landing-stake-pill"]')?.textContent).toContain('SIM APY');
    expect(document.querySelector('#econ-apy-badge')?.textContent).toContain('SIM APY');
  });
});
