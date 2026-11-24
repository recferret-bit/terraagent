import type { StakingPerformanceResponse } from '@terra/contracts';
import { STAKING_TIERS, stakingTierFor } from '@terra/contracts/staking/tiers';
import { el } from '../../../../dom';
import { createBlockHelpTip } from '../../../../parts/helpTip';
import { formatNear, formatPct, formatUsd, projectIncome } from '../../stakingMath';
import { MAX_PREVIEW_NEAR, sanitizeStakeAmount } from '../../stakingRoute';
import { totalStakedNear } from '../dashboardMath';

const SIM_PRESETS = [10, 50, 200, 500] as const;

export interface ProjectedIncomeSimOptions {
  readonly initialAmountNear?: number;
  readonly edited?: boolean;
  readonly onAmountChange?: (amountNear: number, fromUser: boolean) => void;
}

interface SimCardRefs {
  readonly card: HTMLElement;
  readonly val: HTMLElement;
  readonly sub: HTMLElement;
  readonly meta: HTMLElement;
}

function buildSimCard(id: string, heading: string): SimCardRefs {
  const val = el('b', { className: 'ta-stk-income-val' });
  const sub = el('span', { className: 'ta-stk-income-usd' });
  const meta = el('span', { className: 'ta-stk-income-meta' });
  const card = el(
    'div',
    { className: 'ta-stk-income-card plate-sm', dataset: { testid: `staking-income-${id}` } },
    el('span', { className: 'label' }, heading),
    el('div', { className: 'ta-stk-income-nums' }, val, sub),
    meta,
  );
  return { card, val, sub, meta };
}

function buildAmountInput(initialValue: number): HTMLInputElement {
  const input = el('input', {
    id: 'staking-amount',
    className: 'input ta-stk-income-input',
    type: 'number',
    dataset: { testid: 'staking-amount-input' },
  });
  input.min = '1';
  input.max = String(MAX_PREVIEW_NEAR);
  input.step = 'any';
  input.inputMode = 'decimal';
  input.value = String(initialValue);
  return input;
}

function resolveInitialSimAmount(activeStaked: number, opts: ProjectedIncomeSimOptions): number {
  if (opts.edited && opts.initialAmountNear !== undefined) return sanitizeStakeAmount(opts.initialAmountNear);
  if (activeStaked > 0) return Math.round(activeStaked * 100) / 100;
  return sanitizeStakeAmount(opts.initialAmountNear);
}

interface SimDisplayTargets {
  readonly p: StakingPerformanceResponse;
  readonly activeStaked: number;
  readonly basisBadge: HTMLElement;
  readonly daily: SimCardRefs;
  readonly monthly: SimCardRefs;
  readonly yearly: SimCardRefs;
  readonly activeBtn: HTMLButtonElement | null;
  readonly presetBtns: readonly HTMLButtonElement[];
}

function syncProjectedIncomeDisplay(t: SimDisplayTargets, amt: number): void {
  const isActiveMatch = t.activeStaked > 0 && Math.abs(amt - t.activeStaked) < 0.01;
  const proj = isActiveMatch && t.p.projection.amountNear === t.activeStaked
    ? t.p.projection
    : projectIncome(amt, t.p.apy.netApyBp, t.p.price.nearUsd);
  const tier = STAKING_TIERS[stakingTierFor(amt).id]!;

  t.basisBadge.textContent = isActiveMatch ? `ACTIVE STAKE · ${formatNear(t.activeStaked)}` : `PREVIEW · ${formatNear(amt)}`;
  t.basisBadge.dataset.source = isActiveMatch ? 'live' : 'preview';

  t.daily.val.textContent = formatNear(proj.dailyNear);
  t.daily.sub.textContent = formatUsd(proj.dailyUsd);
  t.daily.meta.textContent = `${formatPct(t.p.apy.netApyBp)} Net APY · daily pace`;

  t.monthly.val.textContent = formatNear(proj.monthlyNear);
  t.monthly.sub.textContent = formatUsd(proj.monthlyUsd);
  t.monthly.meta.textContent = `80% net staker yield · ${formatPct(t.p.apy.protocolYieldShareBp)} protocol share`;

  t.yearly.val.textContent = formatNear(proj.yearlyNear);
  t.yearly.sub.textContent = formatUsd(proj.yearlyUsd);
  const feeSuffix = tier.id === 0 ? '' : tier.warmupRequired ? ' (24h warmup)' : ' (instant)';
  t.yearly.meta.textContent = `Unlocks T${tier.id} ${tier.name} · ${formatPct(tier.takerFeeBp)} trade fee${feeSuffix}`;

  t.activeBtn?.classList.toggle('is-active', isActiveMatch);
  SIM_PRESETS.forEach((preset, idx) => t.presetBtns[idx]!.classList.toggle('is-active', !isActiveMatch && Math.abs(amt - preset) < 0.001));
}

/**
 * Extended Projected Income panel embedded inside `PORTFOLIO METRICS`: defaults to active stake (or URL preview
 * when 0 NEAR is staked) and lets users simulate any NEAR amount across Daily, Monthly, and Yearly horizons.
 */
export function renderProjectedIncomePanel(p: StakingPerformanceResponse, opts: ProjectedIncomeSimOptions = {}): HTMLElement {
  const activeStaked = totalStakedNear(p.balances);
  const initialSim = resolveInitialSimAmount(activeStaked, opts);
  const input = buildAmountInput(initialSim);
  const basisBadge = el('span', { className: 'ta-stk-badge ta-stk-income-basis', dataset: { testid: 'staking-income-basis' } });
  const presetsWrap = el('div', { className: 'ta-stk-presets', role: 'group', aria: { label: 'Projection stake presets' } });

  const daily = buildSimCard('daily', 'DAILY (24H)');
  const monthly = buildSimCard('monthly', 'MONTHLY (30D)');
  const yearly = buildSimCard('yearly', 'YEARLY (365D)');

  let activeBtn: HTMLButtonElement | null = null;
  let presetBtns: HTMLButtonElement[] = [];
  const applyAmount = (next: number, notify: boolean): void => {
    syncProjectedIncomeDisplay({ p, activeStaked, basisBadge, daily, monthly, yearly, activeBtn, presetBtns }, next);
    if (notify) opts.onAmountChange?.(next, true);
  };

  if (activeStaked > 0) {
    activeBtn = el('button', {
      className: 'ta-stk-preset-btn',
      type: 'button',
      dataset: { testid: 'staking-preset-active' },
      onClick: () => {
        const rounded = Math.round(activeStaked * 100) / 100;
        input.value = String(rounded);
        applyAmount(rounded, true);
      },
    }, 'Active');
    presetsWrap.append(activeBtn);
  }
  presetBtns = SIM_PRESETS.map((preset) =>
    el('button', {
      className: 'ta-stk-preset-btn',
      type: 'button',
      dataset: { testid: `staking-preset-${preset}` },
      onClick: () => { input.value = String(preset); applyAmount(preset, true); },
    }, `${preset} NEAR`),
  );
  presetsWrap.append(...presetBtns);

  input.addEventListener('input', () => applyAmount(sanitizeStakeAmount(input.value), true));
  applyAmount(initialSim, false);

  const tip = createBlockHelpTip({
    id: 'staking-income',
    title: 'PROJECTED INCOME',
    description:
      'Forward-looking daily, monthly, and yearly net staking yield (80% of validator APY) and tier unlocks. Defaults to your active staked balance; enter any NEAR amount or preset to simulate returns without altering your position.',
    openOnHover: true,
    floating: true,
  });
  const simLabel = el('label', { className: 'label ta-stk-income-sim-lbl' }, 'SIMULATE NEAR');
  simLabel.htmlFor = 'staking-amount';

  return el(
    'div',
    { className: 'ta-stk-income-panel', dataset: { testid: 'staking-kpi-income' } },
    el(
      'div',
      { className: 'ta-stk-income-head' },
      el('div', { className: 'ta-help-title-group' }, tip.button, el('span', { className: 'label' }, 'PROJECTED INCOME'), basisBadge, tip.panel),
      el('div', { className: 'ta-stk-income-controls' }, simLabel, input, presetsWrap),
    ),
    el('div', { className: 'ta-stk-income-grid' }, daily.card, monthly.card, yearly.card),
  );
}
