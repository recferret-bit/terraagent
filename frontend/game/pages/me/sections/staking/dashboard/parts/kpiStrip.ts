import type { StakingPerformanceResponse } from '@terra/contracts';
import { el, type DomChild } from '../../../../dom';
import { buildBlockHeaderWithTip, createBlockHelpTip } from '../../../../parts/helpTip';
import { formatNear, formatPct, formatUsd } from '../../stakingMath';
import { formatCountdown, formatMicroNear, lstNearValue, totalStakedNear } from '../dashboardMath';
import { renderProjectedIncomePanel, type ProjectedIncomeSimOptions } from './kpiProjection';
import './kpiStrip.css';

export interface KpiHandlers {
  readonly onCompound: () => void;
  readonly projection?: ProjectedIncomeSimOptions;
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

interface MetricCardOptions {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly hero: HTMLElement;
  readonly rows: readonly HTMLElement[];
  readonly footer: HTMLElement;
  readonly buttonTestId?: string;
  readonly buttonTitle?: string;
}

function nearNumberText(n: number): string {
  return formatNear(n).replace(/\s*NEAR$/, '');
}

function exitChipLabel(freeAtMs: number | null, feeBp: number, nowMs: number): string {
  if (freeAtMs === null || freeAtMs <= nowMs || feeBp <= 0) return 'Free exit';
  const feePct = `${(feeBp / 100).toFixed(2)}% fee`;
  const remainingMs = freeAtMs - nowMs;
  return remainingMs <= 3_600_000 ? `${formatCountdown(freeAtMs, nowMs)} · ${feePct}` : `<7d · ${feePct}`;
}

function kvRow(label: string, value: DomChild, testid?: string): HTMLElement {
  return el(
    'div',
    { className: 'ta-stk-kpi-kv', dataset: testid ? { testid } : undefined },
    el('span', { className: 'ta-stk-kpi-kv-k' }, label),
    typeof value === 'string' || typeof value === 'number'
      ? el('b', { className: 'ta-stk-kpi-kv-v' }, String(value))
      : value,
  );
}

const heroBlock = (valueEl: HTMLElement, unit: string): HTMLElement =>
  el('div', { className: 'ta-stk-kpi-hero' }, valueEl, ' ', el('span', { className: 'ta-stk-kpi-unit' }, unit));

const chip = (text: string, testid?: string, extraClass = ''): HTMLElement =>
  el('span', { className: `ta-stk-badge${extraClass ? ` ${extraClass}` : ''}`, dataset: testid ? { testid } : undefined }, text);

/** Uniform 4-zone KPI card template (head with floating hover `?`, hero metric, 3 KV rows, bottom footer). */
function metricCard(opts: MetricCardOptions): HTMLElement {
  const tip = createBlockHelpTip({
    id: `staking-${opts.id}`,
    title: opts.label,
    description: opts.description,
    openOnHover: true,
    floating: true,
    buttonTestId: opts.buttonTestId,
    buttonTitle: opts.buttonTitle,
  });
  return el(
    'article',
    { className: 'ta-stk-kpi plate-sm', dataset: { testid: `staking-kpi-${opts.id}` } },
    el('div', { className: 'ta-stk-kpi-head' }, tip.button, el('span', { className: 'label' }, opts.label), tip.panel),
    opts.hero,
    el('div', { className: 'ta-stk-kpi-details' }, ...opts.rows),
    opts.footer,
  );
}

function totalCard(p: StakingPerformanceResponse, nowMs: number): { card: HTMLElement; exitNode: HTMLElement } {
  const total = totalStakedNear(p.balances);
  const lst = lstNearValue(p.balances);
  const exitNode = chip(exitChipLabel(p.timers.earlyExitFreeAtMs, p.timers.earlyExitFeeBp, nowMs), 'staking-exit-chip');
  const priceNode = chip(p.price.source === 'live' ? 'Live' : 'Est.', 'staking-price-source');
  if (p.price.source === 'live') priceNode.dataset.source = 'live';
  const card = metricCard({
    id: 'total',
    label: 'TOTAL STAKED',
    description: 'Combined active principal across native NEAR validators and whitelisted LSTs (stNEAR & LiNEAR), valued in USD, plus your early-exit maturity status.',
    hero: heroBlock(el('b', { className: 'ta-stk-kpi-val' }, nearNumberText(total)), 'NEAR'),
    rows: [
      kvRow('USD value', formatUsd(p.balances.totalStakedUsd)),
      kvRow('Native', formatNear(total - lst)),
      kvRow('LST value', formatNear(lst)),
    ],
    footer: el('div', { className: 'ta-stk-kpi-foot' }, priceNode, exitNode),
  });
  return { card, exitNode };
}

function yieldCard(p: StakingPerformanceResponse, h: KpiHandlers): {
  card: HTMLElement;
  value: HTMLElement;
  setCompoundVisible: (show: boolean) => void;
  setBusy: (busy: boolean) => void;
} {
  const value = el('b', { className: 'ta-stk-kpi-val', dataset: { testid: 'staking-yield-live' } }, formatMicroNear(Number(p.balances.accruedYieldNear)));
  const compoundBtn = el('button', { className: 'btn btn-primary btn-sm ta-stk-kpi-btn', type: 'button', dataset: { testid: 'staking-compound-btn' }, onClick: h.onCompound }, '↻ Compound Yield');
  const idleTag = chip('Live · 0% fee', undefined, 'ta-stk-kpi-tag');
  const footer = el('div', { className: 'ta-stk-kpi-foot' }, Number(p.balances.accruedYieldNear) > 0 ? compoundBtn : idleTag);
  const card = metricCard({
    id: 'yield',
    label: 'ACCRUED YIELD',
    description: 'Uncompounded net staking rewards ticking upward in real time (accelerated 10,080x in local 1-minute mode). Compounding rolls yield into principal at 0% fee without resetting your maturity clock.',
    hero: heroBlock(value, 'NEAR'),
    rows: [
      kvRow('Cadence', 'Real-time'),
      kvRow('Compound fee', '0%'),
      kvRow('Maturity clock', 'Preserved'),
    ],
    footer,
  });
  return {
    value,
    card,
    setCompoundVisible: (show) => {
      const target = show ? compoundBtn : idleTag;
      if (footer.firstChild !== target || footer.childElementCount !== 1) footer.replaceChildren(target);
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
  const badge = chip(sim ? 'Sim APY' : 'Live APY', 'staking-apy-source');
  if (!sim) badge.dataset.source = 'live';
  return metricCard({
    id: 'apy',
    label: 'NET / GROSS APY',
    description: 'Compares your 80% net staker APY against total validator pool APY; the 20% protocol yield share funds gasless NEP-366 relays and Managed NEAR.AI TEE compute.',
    hero: heroBlock(el('b', { className: 'ta-stk-kpi-val' }, formatPct(p.apy.netApyBp)), 'NET APY'),
    rows: [
      kvRow('Gross pool', formatPct(p.apy.grossApyBp)),
      kvRow('Protocol share', formatPct(p.apy.protocolYieldShareBp)),
      kvRow('Custody', '100% yours'),
    ],
    footer: el('div', { className: 'ta-stk-kpi-foot' }, badge),
  });
}

function effectiveCard(p: StakingPerformanceResponse): HTMLElement {
  const selfFills = `${p.income.selfFillsExcluded} self-fill${p.income.selfFillsExcluded === 1 ? '' : 's'} excluded`;
  return metricCard({
    id: 'effective',
    label: 'EFFECTIVE APY',
    description: EFFECTIVE_FORMULA,
    buttonTestId: 'staking-effective-tooltip',
    buttonTitle: EFFECTIVE_FORMULA,
    hero: heroBlock(el('b', { className: 'ta-stk-kpi-val' }, formatPct(p.effectiveApyBp)), 'COMBINED'),
    rows: [
      kvRow('Sources', 'Yield + Perks'),
      kvRow('Window', 'Annualized'),
      kvRow('Filter', el('b', { className: 'ta-stk-kpi-kv-v ta-stk-kpi-kv-compact', dataset: { testid: 'staking-self-fills' } }, selfFills)),
    ],
    footer: el('div', { className: 'ta-stk-kpi-foot' }, chip('No self-fills', undefined, 'ta-stk-kpi-tag')),
  });
}

/**
 * Portfolio Metrics block: 4 uniform top KPI cards + extended Projected Income section with live amount simulation.
 */
export function renderKpiStrip(p: StakingPerformanceResponse, nowMs: number, h: KpiHandlers): KpiStrip {
  const tot = totalCard(p, nowMs);
  const y = yieldCard(p, h);
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-kpis',
      title: 'PORTFOLIO METRICS',
      description:
        'Live summary of your staked NEAR & LST principal, ticking yield (0% compound fee), net validator APY, Effective Combined APY excluding self-fills, and extended Projected Income simulation.',
    },
    el('h4', { className: 'label ta-stk-h' }, 'PORTFOLIO METRICS'),
    el('span', { className: 'ta-stk-badge ta-stk-wallet-chip', dataset: { testid: 'staking-wallet-avail' } }, `Available wallet: ${formatNear(Number(p.balances.walletNear))}`),
  );
  const grid = el('div', { className: 'ta-stk-kpis', dataset: { testid: 'staking-kpi-strip' } }, tot.card, y.card, apyCard(p), effectiveCard(p));
  const incomePanel = renderProjectedIncomePanel(p, h.projection);
  return {
    yieldValue: y.value,
    setCompoundVisible: y.setCompoundVisible,
    setBusy: y.setBusy,
    tick(nextNowMs: number) {
      tot.exitNode.textContent = exitChipLabel(p.timers.earlyExitFreeAtMs, p.timers.earlyExitFeeBp, nextNowMs);
    },
    el: el('div', { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-kpi-block' } }, header.head, header.panel, grid, incomePanel),
  };
}
