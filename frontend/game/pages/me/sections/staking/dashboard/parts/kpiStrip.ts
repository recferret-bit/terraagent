import type { StakingPerformanceResponse } from '@terra/contracts';
import { el } from '../../../../dom';
import { buildBlockHeaderWithTip, createBlockHelpTip } from '../../../../parts/helpTip';
import { formatNear, formatPct, formatUsd } from '../../stakingMath';
import { formatCountdown, formatMicroNear, lstNearValue, totalStakedNear } from '../dashboardMath';

export interface KpiHandlers {
  readonly onCompound: () => void;
}

export interface KpiStrip {
  readonly el: HTMLElement;
  /** The live micro-NEAR counter the ticker rewrites. */
  readonly yieldValue: HTMLElement;
  /** Toggles `[↻ Compound Yield]` once live-ticked yield rises above `0` without requiring a page reload. */
  readonly setCompoundVisible: (show: boolean) => void;
  /** Live-updates time-sensitive KPI chips (exit-fee countdown). */
  readonly tick: (nowMs: number) => void;
  /** Marks KPI action buttons busy while a dashboard request is in flight. */
  readonly setBusy: (busy: boolean) => void;
}

export const EFFECTIVE_FORMULA =
  'Effective APY = (staking yield + market-fee savings + stall royalties + patron revenue) over the window, annualised, divided by total staked. Trades where buyer and seller/stall owner are the same wallet are excluded.';

function tipCard(
  id: string,
  label: string,
  description: string,
  opts: { readonly buttonTestId?: string; readonly buttonTitle?: string } = {},
  ...body: Array<Node | string | null>
): HTMLElement {
  const tip = createBlockHelpTip({
    id: `staking-${id}`,
    title: label,
    description,
    buttonTestId: opts.buttonTestId,
    buttonTitle: opts.buttonTitle,
  });
  return el(
    'div',
    { className: 'ta-stk-kpi plate-sm', dataset: { testid: `staking-kpi-${id}` } },
    el('div', { className: 'ta-help-title-group' }, tip.button, el('span', { className: 'label' }, label)),
    tip.panel,
    ...body,
  );
}

const big = (text: string, testid?: string): HTMLElement =>
  el('b', { className: 'ta-stk-kpi-val', dataset: testid ? { testid } : undefined }, text);
const sub = (text: string): HTMLElement => el('span', { className: 'ta-stk-tile-sub' }, text);
const chip = (text: string, testid: string): HTMLElement => el('span', { className: 'ta-stk-badge', dataset: { testid } }, text);

function exitChipLabel(freeAtMs: number | null, feeBp: number, nowMs: number): string {
  if (freeAtMs === null || freeAtMs <= nowMs || feeBp <= 0) return 'Free exit';
  const feePct = `${(feeBp / 100).toFixed(2)}% exit fee`;
  const remainingMs = freeAtMs - nowMs;
  return remainingMs <= 3_600_000 ? `${formatCountdown(freeAtMs, nowMs)} · ${feePct}` : `<7d · ${feePct}`;
}

function totalCard(p: StakingPerformanceResponse, nowMs: number): { card: HTMLElement; exitNode: HTMLElement } {
  const total = totalStakedNear(p.balances);
  const lst = lstNearValue(p.balances);
  const exitNode = chip(exitChipLabel(p.timers.earlyExitFreeAtMs, p.timers.earlyExitFeeBp, nowMs), 'staking-exit-chip');
  const node = tipCard(
    'total',
    'TOTAL STAKED',
    'Combined active principal across native NEAR validators and whitelisted LSTs (stNEAR & LiNEAR), valued in USD, plus your early-exit maturity status.',
    {},
    big(formatNear(total)),
    sub(`${formatNear(total - lst)} native + ${formatNear(lst)} LST value`),
    el(
      'span',
      { className: 'ta-stk-sub' },
      `${formatUsd(p.balances.totalStakedUsd)} `,
      el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-price-source' } }, p.price.source === 'live' ? 'Live' : 'Est.'),
    ),
    exitNode,
  );
  return { card: node, exitNode };
}

function yieldCard(p: StakingPerformanceResponse, h: KpiHandlers): {
  card: HTMLElement;
  value: HTMLElement;
  setCompoundVisible: (show: boolean) => void;
  setBusy: (busy: boolean) => void;
} {
  const value = big(formatMicroNear(Number(p.balances.accruedYieldNear)), 'staking-yield-live');
  const compoundBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'button', dataset: { testid: 'staking-compound-btn' }, onClick: h.onCompound }, '↻ Compound Yield');
  const accrued = Number(p.balances.accruedYieldNear) > 0;
  const host = tipCard(
    'yield',
    'ACCRUED YIELD (LIVE)',
    'Uncompounded net staking rewards ticking upward in real time (accelerated 10,080x in local 1-minute mode). Compounding rolls yield into principal at 0% fee without resetting your maturity clock.',
    {},
    el('div', { className: 'ta-stk-kpi-line' }, value, el('span', { className: 'ta-stk-sub' }, 'NEAR')),
    sub('0 % fee · keeps your maturity clock'),
    accrued ? compoundBtn : null,
  );
  return {
    value,
    card: host,
    setCompoundVisible: (show) => {
      if (show && compoundBtn.parentElement !== host) host.append(compoundBtn);
      else if (!show && compoundBtn.parentElement === host) compoundBtn.remove();
    },
    setBusy: (busy) => {
      compoundBtn.disabled = busy;
      if (busy) compoundBtn.setAttribute('aria-busy', 'true');
      else compoundBtn.removeAttribute('aria-busy');
    },
  };
}

function apyCard(p: StakingPerformanceResponse): HTMLElement {
  const sim = p.apy.source === 'sim';
  return tipCard(
    'apy',
    'NET / GROSS APY',
    'Compares your 80% net staker APY against total validator pool APY; the 20% protocol yield share funds gasless NEP-366 relays and Managed NEAR.AI TEE compute.',
    {},
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
  return tipCard(
    'income',
    'PROJECTED INCOME',
    'Forward-looking daily, monthly, and yearly passive validator rewards for your current active stake in NEAR and USD.',
    {},
    ...rows.map(([id, name, near, usd]) =>
      el('div', { className: 'ta-stk-kpi-row', dataset: { testid: `staking-income-${id}` } }, el('span', {}, name), el('b', {}, formatNear(near)), el('span', { className: 'ta-stk-sub' }, formatUsd(usd))),
    ),
  );
}

function effectiveCard(p: StakingPerformanceResponse): HTMLElement {
  return tipCard(
    'effective',
    'EFFECTIVE COMBINED APY',
    EFFECTIVE_FORMULA,
    { buttonTestId: 'staking-effective-tooltip', buttonTitle: EFFECTIVE_FORMULA },
    big(formatPct(p.effectiveApyBp)),
    sub('(self-fills excluded)'),
    el('span', { className: 'ta-stk-sub', dataset: { testid: 'staking-self-fills' } }, `${p.income.selfFillsExcluded} self-fill${p.income.selfFillsExcluded === 1 ? '' : 's'} excluded`),
  );
}

/** The five financial KPI cards (Active Tier & Top-Up now lives in its own dedicated hero block `topUpCard.ts`). */
export function renderKpiStrip(p: StakingPerformanceResponse, nowMs: number, h: KpiHandlers): KpiStrip {
  const tot = totalCard(p, nowMs);
  const y = yieldCard(p, h);
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-kpis',
      title: 'PORTFOLIO METRICS',
      description:
        'Live summary of your staked NEAR & LST principal, real-time ticking yield (0% compound fee), net validator APY, projected passive income, and Effective Combined APY excluding wash/self-fills.',
    },
    el('h4', { className: 'label ta-stk-h' }, 'PORTFOLIO METRICS'),
    el('span', { className: 'ta-stk-sub', dataset: { testid: 'staking-wallet-avail' } }, `Available wallet: ${formatNear(Number(p.balances.walletNear))}`),
  );
  const grid = el('div', { className: 'ta-stk-kpis', dataset: { testid: 'staking-kpi-strip' } }, tot.card, y.card, apyCard(p), incomeCard(p), effectiveCard(p));
  return {
    yieldValue: y.value,
    setCompoundVisible: y.setCompoundVisible,
    setBusy: y.setBusy,
    tick(nextNowMs: number) {
      tot.exitNode.textContent = exitChipLabel(p.timers.earlyExitFreeAtMs, p.timers.earlyExitFeeBp, nextNowMs);
    },
    el: el('div', { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-kpi-block' } }, header.head, header.panel, grid),
  };
}
