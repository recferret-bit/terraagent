import type { StakingPerformanceResponse } from '@terra/contracts';
import { el } from '../../../../dom';
import { formatNear, formatPct, formatUsd } from '../../stakingMath';
import { formatCountdown, formatMicroNear, lstNearValue, tierProgress, topUpAmountNear, totalStakedNear } from '../dashboardMath';

export interface KpiHandlers {
  readonly onCompound: () => void;
  readonly onTopUp: (amountNear: number) => void;
}

export interface KpiStrip {
  readonly el: HTMLElement;
  /** The live micro-NEAR counter the ticker rewrites. */
  readonly yieldValue: HTMLElement;
}

export const EFFECTIVE_FORMULA =
  'Effective APY = (staking yield + market-fee savings + stall royalties + patron revenue) over the window, annualised, divided by total staked. Trades where buyer and seller/stall owner are the same wallet are excluded.';

const card = (id: string, label: string, ...body: Array<Node | string | null>): HTMLElement =>
  el('div', { className: 'ta-stk-kpi plate-sm', dataset: { testid: `staking-kpi-${id}` } }, el('span', { className: 'label' }, label), ...body);

const big = (text: string, testid?: string): HTMLElement =>
  el('b', { className: 'ta-stk-kpi-val', dataset: testid ? { testid } : undefined }, text);
const sub = (text: string): HTMLElement => el('span', { className: 'ta-stk-tile-sub' }, text);
const chip = (text: string, testid: string): HTMLElement => el('span', { className: 'ta-stk-badge', dataset: { testid } }, text);

function totalCard(p: StakingPerformanceResponse, nowMs: number): HTMLElement {
  const total = totalStakedNear(p.balances);
  const lst = lstNearValue(p.balances);
  const free = p.timers.earlyExitFreeAtMs;
  const exitChip = free !== null && free > nowMs ? `<7d · ${(p.timers.earlyExitFeeBp / 100).toFixed(2)}% exit fee` : 'Free exit';
  return card(
    'total',
    'TOTAL STAKED',
    big(formatNear(total)),
    sub(`${formatNear(total - lst)} native + ${formatNear(lst)} LST value`),
    el('span', { className: 'ta-stk-sub' }, `${formatUsd(p.balances.totalStakedUsd)} `, el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-price-source' } }, p.price.source === 'live' ? 'Live' : 'Est.')),
    chip(exitChip, 'staking-exit-chip'),
  );
}

function yieldCard(p: StakingPerformanceResponse, h: KpiHandlers): { card: HTMLElement; value: HTMLElement } {
  const value = big(formatMicroNear(Number(p.balances.accruedYieldNear)), 'staking-yield-live');
  const accrued = Number(p.balances.accruedYieldNear) > 0;
  const compound = accrued
    ? el('button', { className: 'btn btn-primary btn-sm', type: 'button', dataset: { testid: 'staking-compound-btn' }, onClick: h.onCompound }, '↻ Compound Yield')
    : null;
  return {
    value,
    card: card('yield', 'ACCRUED YIELD (LIVE)', el('div', { className: 'ta-stk-kpi-line' }, value, el('span', { className: 'ta-stk-sub' }, 'NEAR')), sub('0 % fee · keeps your 7-day clock'), compound),
  };
}

function apyCard(p: StakingPerformanceResponse): HTMLElement {
  const sim = p.apy.source === 'sim';
  return card(
    'apy',
    'NET / GROSS APY',
    big(`${formatPct(p.apy.netApyBp)} Net / ${formatPct(p.apy.grossApyBp)} ${sim ? 'Sim APY' : 'Gross'}`),
    sub(`${formatPct(p.apy.protocolYieldShareBp)} of yield to the Protocol`),
    chip(sim ? 'Sim APY' : 'Live APY', 'staking-apy-source'),
  );
}

function incomeCard(p: StakingPerformanceResponse): HTMLElement {
  const rows = [
    ['daily', 'Daily', p.projection.dailyNear, p.projection.dailyUsd],
    ['monthly', 'Monthly', p.projection.monthlyNear, p.projection.monthlyUsd],
    ['yearly', 'Yearly', p.projection.yearlyNear, p.projection.yearlyUsd],
  ] as const;
  return card(
    'income',
    'PROJECTED INCOME',
    ...rows.map(([id, name, near, usd]) =>
      el('div', { className: 'ta-stk-kpi-row', dataset: { testid: `staking-income-${id}` } }, el('span', {}, name), el('b', {}, formatNear(near)), el('span', { className: 'ta-stk-sub' }, formatUsd(usd))),
    ),
  );
}

function effectiveCard(p: StakingPerformanceResponse): HTMLElement {
  const info = el('span', { className: 'ta-stk-info', title: EFFECTIVE_FORMULA, tabIndex: 0, role: 'img', aria: { label: EFFECTIVE_FORMULA }, dataset: { testid: 'staking-effective-tooltip' } }, '?');
  return card(
    'effective',
    'EFFECTIVE COMBINED APY',
    el('div', { className: 'ta-stk-kpi-line' }, big(formatPct(p.effectiveApyBp)), info),
    sub('(self-fills excluded)'),
    el('span', { className: 'ta-stk-sub', dataset: { testid: 'staking-self-fills' } }, `${p.income.selfFillsExcluded} self-fill${p.income.selfFillsExcluded === 1 ? '' : 's'} excluded`),
  );
}

function tierCard(p: StakingPerformanceResponse, nowMs: number, h: KpiHandlers): HTMLElement {
  const total = totalStakedNear(p.balances);
  const next = p.perks.nextTierMinNear;
  const topUp = topUpAmountNear(total, next);
  const progress = Math.round(tierProgress(total, next) * 100);
  const warm = p.timers.feeWarmupReadyAtMs;
  const warmup = warm !== null && warm > nowMs ? `Fee warmup ${formatCountdown(warm, nowMs)}` : 'Full tier fee active';
  const bar = el('div', { className: 'ta-stk-bar', role: 'progressbar', aria: { valuemin: '0', valuemax: '100', valuenow: String(progress), label: 'Progress to next tier' }, dataset: { testid: 'staking-tier-progress' } }, el('i', { style: { width: `${progress}%` } }));
  const button =
    topUp !== null
      ? el('button', { className: 'btn btn-primary btn-sm', type: 'button', dataset: { testid: 'staking-topup-btn', amount: topUp }, onClick: () => h.onTopUp(topUp) }, `Top Up to Tier ${p.perks.tier + 1}`)
      : null;
  return card(
    'tier',
    'ACTIVE TIER',
    big(`T${p.perks.tier} ${p.perks.tierName}`),
    sub(`NEAR.AI colony slots ${p.perks.activeAiColonySlots} / ${p.perks.maxAiColonySlots}`),
    sub(warmup),
    bar,
    next !== null ? sub(`${formatNear(total)} / ${formatNear(next)}`) : sub('Top tier reached'),
    button,
  );
}

/** The six Faction Plate KPI cards (re-rendered on every performance refetch; the ticker only rewrites `yieldValue`). */
export function renderKpiStrip(p: StakingPerformanceResponse, nowMs: number, h: KpiHandlers): KpiStrip {
  const y = yieldCard(p, h);
  return {
    yieldValue: y.value,
    el: el('div', { className: 'ta-stk-kpis', dataset: { testid: 'staking-kpi-strip' } }, totalCard(p, nowMs), y.card, apyCard(p), incomeCard(p), effectiveCard(p), tierCard(p, nowMs, h)),
  };
}
