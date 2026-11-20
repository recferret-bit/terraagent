// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProtocolTreasuryView } from '../../../backend/app/src/near/infrastructure/dev/protocol-treasury.view';
import { initEconomicsSection } from './economicsSection';
import { initProtocolSection } from './protocolSection';

function assertHydratedReceipts(): void {
  expect(document.querySelector('[data-proto-ex-buyer-total]')?.textContent).toBe('Buyer pays $101.70 ($101.10 Staker)');
  expect(document.querySelector('[data-proto-ex-trade]')?.textContent).toBe('+$0.90 ($0.45 Stk)');
  expect(document.querySelector('[data-proto-ex-dao]')?.textContent).toBe('+$0.30 ($0.15 Stk)');
  expect(document.querySelector('[data-proto-ex-trade-txs]')?.textContent).toBe('~750 gasless NEP-366 player txs');
  expect(document.querySelector('[data-proto-ex-pilot-yield]')?.textContent).toBe('+3.83 NEAR / yr');
  expect(document.querySelector('[data-proto-ex-proto-yield]')?.textContent).toBe('+0.68 NEAR / yr');
  expect(document.querySelector('[data-proto-ex-perks]')?.textContent).toBe('Managed AI + 0.60% Fee');
  expect(document.querySelector('[data-proto-ex-stake-foot]')?.textContent).toContain('+0.68 NEAR/yr sponsors ~2,250 meta-txs');
  expect(document.querySelector('[data-proto-ex-victim]')?.textContent).toBe('17.60 NEAR (88%)');
  expect(document.querySelector('[data-proto-ex-slash]')?.textContent).toBe('2.40 NEAR (12%)');
  expect(document.querySelector('[data-proto-bar-trade]')?.getAttribute('aria-label')).toBe(
    'Up to 45% Stall Owner, 41% Protocol, 14% Planet Council DAO',
  );
  expect(document.querySelector('[data-proto-bar-stake]')?.getAttribute('aria-label')).toBe(
    '85% Net APY to Pilot, 15% APY to Protocol',
  );
  expect(document.querySelector('[data-proto-bar-bond]')?.getAttribute('aria-label')).toBe(
    '88% to Betrayed Ally or Defender, 12% to Protocol',
  );
}

describe('Landing #protocol live telemetry & stream filtering', () => {
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
      // NEAR_STAKER_* overrides are the W20 ladder; with W28 on the staker fee is the Tier 1 row (65 bp)
      TA_WAVES: '..27',
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
    expect(document.querySelector('[data-proto-svg-fees]')?.textContent).toBe('FEES 75%');
    expect(document.querySelector('[data-proto-svg-yield]')?.textContent).toBe('YIELD 15%');
    expect(document.querySelector('[data-proto-svg-slash]')?.textContent).toBe('SLASH 12%');
    expect(document.querySelector('[data-proto-trade-title]')?.textContent).toBe('75% of Platform Trade Fee');
    expect(document.querySelector('[data-proto-trade-rate]')?.textContent).toBe('0.90% / 0.45%');
    expect(document.querySelector('[data-proto-dao-share-pct]')?.textContent).toBe('25%');
    expect(document.querySelector('[data-proto-yield-title]')?.textContent).toBe('15% of Validator Yield');
    expect(document.querySelector('[data-proto-yield-rate]')?.textContent).toBe('1.35% APY Slice');
    expect(document.querySelector('[data-proto-pilot-net-apy]')?.textContent).toBe('7.65%');
    expect(document.querySelector('[data-proto-slash-title]')?.textContent).toBe('12% Bond Arbitration Slash');
    expect(document.querySelector('[data-proto-slash-rate]')?.textContent).toBe('12% of Breach');
    expect(document.querySelector('[data-proto-min-stake]')?.textContent).toBe('≥15 NEAR');
    expect(document.querySelector('[data-proto-stage-staking-title]')?.textContent).toBe('85 / 15 Yield Split · Zero Pay-to-Win');
    expect(document.querySelector('[data-proto-legend-pilot-apy]')?.textContent).toBe('7.65% Net APY');
    expect(document.querySelector('[data-proto-legend-yield-apy]')?.textContent).toBe('1.35% APY');
    expect(document.querySelector('[data-proto-legend-perks-val]')?.textContent).toBe('Managed AI + 0.60% Fee');
    expect(document.querySelector('[data-proto-stage-bonds-badge]')?.textContent).toBe('88 / 12 SLASH');
    expect(document.querySelector('[data-proto-legend-victim-val]')?.textContent).toBe('88% Payout');
    expect(document.querySelector('[data-proto-legend-slash-val]')?.textContent).toBe('12% Slash Fee');
    assertHydratedReceipts();
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
    expect(document.querySelector('[data-proto-ex-trade]')?.textContent).toBe('+$0.80 ($0.40 Stk)');
    expect(document.querySelector('[data-proto-ex-pilot-yield]')?.textContent).toBe('+3.60 NEAR / yr');
    expect(document.querySelector('[data-proto-ex-victim]')?.textContent).toBe('18.00 NEAR (90%)');
  });
});

describe('Landing #protocol partial feeSchedule fallback math', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    document.body.innerHTML = `<section id="protocol"><div id="protocol-board"></div></section>`;
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

  it('computes exact protocol + DAO fee and staking splits when derived fields are omitted on partial schedules', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feeSchedule: {
          standardPlatformFeeBp: 30,
          daoCarveOutShareBp: 2_500,
          validatorGrossApyBp: 1_000,
          protocolStakingYieldShareBp: 1_500,
        },
      }),
    }) as unknown as typeof fetch;

    initProtocolSection();
    await new Promise((r) => setTimeout(r, 10));

    // 30 bp standard -> 15 bp staker; 75% protocol = floor(30*0.75)=22 bp & floor(15*0.75)=11 bp; DAO = 8 bp & 4 bp (never negative)
    expect(document.querySelector('[data-proto-trade-rate]')?.textContent).toBe('0.22% / 0.11%');
    expect(document.querySelector('[data-proto-legend-dao-val]')?.textContent).toBe('0.08% (0.04% Staker)');
    expect(document.querySelector('[data-proto-ex-trade]')?.textContent).toBe('+$0.22 ($0.11 Stk)');
    expect(document.querySelector('[data-proto-ex-dao]')?.textContent).toBe('+$0.08 ($0.04 Stk)');
    expect(document.querySelector('[data-proto-ex-trade-txs]')?.textContent).toBe('~180 gasless NEP-366 player txs');
    expect(document.querySelector<HTMLElement>('[data-proto-bar-trade-stall]')?.style.width).toBe('77%');
    expect(document.querySelector<HTMLElement>('[data-proto-bar-trade-proto]')?.style.width).toBe('17%');
    expect(document.querySelector<HTMLElement>('[data-proto-bar-trade-dao]')?.style.width).toBe('6%');
    // 10.0% gross APY * 15% protocol = 1.50% protocol APY & 8.50% pilot net APY; staker fee = 0.15%
    expect(document.querySelector('[data-proto-pilot-net-apy]')?.textContent).toBe('8.50%');
    expect(document.querySelector('[data-proto-yield-rate]')?.textContent).toBe('1.50% APY Slice');
    expect(document.querySelector('[data-proto-ex-perks]')?.textContent).toBe('Managed AI + 0.15% Fee');
  });

  it('handles zero-platform-fee and half-tie boundary schedules without >100% bar overflow or ~0 labels', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feeSchedule: {
          standardPlatformFeeBp: 0,
          daoCarveOutShareBp: 0,
          protocolStakingYieldShareBp: 0,
        },
      }),
    }) as unknown as typeof fetch;

    initProtocolSection();
    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelector('[data-proto-ex-trade-txs]')?.textContent).toBe('0 gasless NEP-366 player txs');
    expect(document.querySelector('[data-proto-ex-stake-foot]')?.textContent).toContain('+0.00 NEAR/yr sponsors 0 meta-txs');
    expect(document.querySelector<HTMLElement>('[data-proto-bar-trade-stall]')?.style.width).toBe('100%');
    expect(document.querySelector<HTMLElement>('[data-proto-bar-trade-proto]')?.style.width).toBe('0%');
    expect(document.querySelector<HTMLElement>('[data-proto-bar-trade-dao]')?.style.width).toBe('0%');
  });
});

describe('Landing #economics Day-1 staking calculator', () => {
  beforeEach(() => {
    document.body.innerHTML = `<section id="economics"><div id="economics-board"></div></section>`;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('computes exact Day-1 staking boundary (5 NEAR Cadet vs 10 NEAR Tier 1 unlock) in #economics calculator', () => {
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
    expect(feeSaved.textContent).toBe('0.00 USDC / mo (100 bp fee)');

    stakeSlider.value = '10';
    stakeSlider.dispatchEvent(new Event('input'));
    expect(banner.classList.contains('is-unlocked')).toBe(true);
    expect(userYield.textContent).toBe('0.72 NEAR / yr');
    expect(feeSaved.textContent).toBe('3.50 USDC / mo (65 bp fee)');
  });
});
