import type { StakingOverviewResponse } from '@terra/contracts';
import { stakingTierFor } from '@terra/contracts/staking/tiers';
import { el } from '../../../dom';
import { buildBlockHeaderWithTip } from '../../../parts/helpTip';
import { formatNear, formatPct, formatUsd, projectionFor } from '../stakingMath';
import { MAX_PREVIEW_NEAR, sanitizeStakeAmount } from '../stakingRoute';
import { renderConnectCta } from './connectCta';
import { createPatronageHoverTrigger } from './tierMatrix';

const PERIODS = [
  { id: 'daily', label: 'DAILY', near: 'dailyNear', usd: 'dailyUsd' },
  { id: 'monthly', label: 'MONTHLY', near: 'monthlyNear', usd: 'monthlyUsd' },
  { id: 'yearly', label: 'YEARLY', near: 'yearlyNear', usd: 'yearlyUsd' },
] as const;

const PREVIEW_PRESETS = [10, 50, 200, 500] as const;

export interface PublicProjectionPreviewOptions {
  readonly ov: StakingOverviewResponse;
  readonly amount: number;
  readonly live: boolean;
  readonly onAmountChange: (next: number) => void;
  readonly onConnect: () => void;
}

/**
 * Signed-out Projected Income & Portfolio Metrics preview (replaces the standalone Stake Calculator block).
 */
export function renderPublicProjectionPreview(opts: PublicProjectionPreviewOptions): HTMLElement {
  const { ov, amount, live } = opts;
  const reachedTier = stakingTierFor(amount);
  const input = el('input', {
    className: 'input ta-stk-input',
    type: 'number',
    id: 'staking-amount',
    dataset: { testid: 'staking-amount-input' },
  });
  input.min = '1';
  input.max = String(MAX_PREVIEW_NEAR);
  input.step = 'any';
  input.inputMode = 'decimal';
  input.value = String(amount);
  input.addEventListener('input', () => opts.onAmountChange(sanitizeStakeAmount(input.value)));

  const amountLabel = el('label', { className: 'label', dataset: { testid: 'staking-amount-label' } }, 'SIMULATE STAKE (NEAR)');
  amountLabel.htmlFor = 'staking-amount';

  const badges = el(
    'div',
    { className: 'ta-stk-badges' },
    el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-apy-badge', source: ov.apy.source, live: live ? '1' : '0' } }, `${formatPct(ov.apy.netApyBp)} ${ov.apy.source === 'live' ? 'Live APY' : 'Sim APY'}`),
    el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-price-badge' } }, `${ov.price.source === 'live' ? 'Live' : 'Est.'} $${ov.price.nearUsd.toFixed(2)}`),
    createPatronageHoverTrigger({
      id: 'staking-tiers',
      buttonTestId: 'help-tip-btn-staking-tiers',
      labelText: `ORBITAL PATRONAGE · T${reachedTier.id} ${reachedTier.name}`,
      tiers: ov.tiers,
      amount,
      feeWarmupMs: ov.rules.feeWarmupMs,
    }),
  );

  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-income',
      title: 'PROJECTED INCOME',
      description:
        'Preview passive validator rewards (80% of validator yield) and Orbital Patronage unlocks for any NEAR stake amount before connecting a wallet. Hover ORBITAL PATRONAGE to inspect all 5 tiers.',
    },
    el('h3', { className: 'label ta-stk-h c-orange' }, `PORTFOLIO METRICS · PROJECTED INCOME · ${amount} NEAR`),
    badges,
  );

  const presets = el(
    'div',
    { className: 'ta-stk-presets', role: 'group', aria: { label: 'Quick tier presets' } },
    ...PREVIEW_PRESETS.map((preset) =>
      el(
        'button',
        {
          className: `ta-stk-preset-btn${amount === preset ? ' is-active' : ''}`,
          type: 'button',
          dataset: { testid: `staking-preset-${preset}` },
          onClick: () => {
            input.value = String(preset);
            opts.onAmountChange(preset);
          },
        },
        `${preset} NEAR`,
      ),
    ),
  );

  const proj = projectionFor(ov, amount);
  const tiles = PERIODS.map((per) =>
    el(
      'div',
      { className: 'ta-stk-tile plate-sm', dataset: { testid: `staking-projection-${per.id}` } },
      el('span', { className: 'label' }, per.label),
      el('b', { className: 'ta-stk-tile-val' }, formatNear(proj[per.near])),
      el('span', { className: 'ta-stk-tile-sub' }, formatUsd(proj[per.usd])),
    ),
  );

  return el(
    'div',
    { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-projection', amount: proj.amountNear } },
    header.head,
    header.panel,
    el(
      'div',
      { className: 'ta-stk-top ta-stk-calc-controls' },
      el('div', { className: 'ta-stk-calc-input-group' }, el('div', { className: 'ta-stk-field' }, amountLabel, input), presets),
      el('span', { className: 'ta-stk-sub' }, `Gross ${formatPct(ov.apy.grossApyBp)} · ${formatPct(ov.apy.protocolYieldShareBp)} to protocol`),
    ),
    el('div', { className: 'ta-stk-tiles' }, ...tiles),
    el('div', { className: 'ta-stk-cta-row' }, renderConnectCta(amount, opts.onConnect)),
  );
}
