import { STAKING_TIERS } from '@terra/contracts/staking/tiers';
import type { StakingPerformanceResponse } from '@terra/contracts';
import { el } from '../../../../dom';
import { buildBlockHeaderWithTip } from '../../../../parts/helpTip';
import { createPatronageHoverTrigger } from '../../parts/tierMatrix';
import { formatNear, formatPct } from '../../stakingMath';
import { formatCountdown, tierProgress, topUpAmountNear, totalStakedNear } from '../dashboardMath';
import { renderPatronZone, type PatronCardOptions } from './patronCard';
import './topUpCard.css';

export interface TopUpCardHandlers {
  readonly onTopUp: (amountNear: number) => void;
  readonly onTopUpStake?: (amountNear: number) => void;
  readonly patronOpts: PatronCardOptions;
  readonly feeWarmupMs: number;
}

export interface TopUpCardHandle {
  readonly el: HTMLElement;
  tick(nowMs: number): void;
  setBusy(busy: boolean): void;
}

function warmupLabel(warmReadyAtMs: number | null, nowMs: number): string {
  return warmReadyAtMs !== null && warmReadyAtMs > nowMs
    ? `Fee warmup ${formatCountdown(warmReadyAtMs, nowMs)}`
    : 'Full tier fee active';
}

function nextTierSummary(nextTierId: number, gapNear: number): string {
  const row = STAKING_TIERS[nextTierId];
  if (!row) return `+${gapNear} NEAR to next tier`;
  return `Unlock T${row.id} ${row.name}: ${formatPct(row.takerFeeBp)} trade fee · ${row.aiColonySlots} NEAR.AI slots · ${row.gasMultiplier}x gasless cap (+${gapNear} NEAR needed)`;
}

function buildTopUpActions(tierId: number, topUp: number | null, h: TopUpCardHandlers): HTMLElement | null {
  if (topUp === null) return null;
  const topUpBtn = el(
    'button',
    {
      className: 'btn btn-primary btn-sm',
      type: 'button',
      dataset: { testid: 'staking-topup-btn', amount: topUp },
      onClick: () => h.onTopUp(topUp),
    },
    `Top Up to Tier ${tierId + 1}`,
  );
  const instantBtn = h.onTopUpStake
    ? el(
        'button',
        {
          className: 'btn btn-hull btn-sm',
          type: 'button',
          dataset: { testid: 'staking-topup-stake-btn', amount: topUp },
          onClick: () => h.onTopUpStake?.(topUp),
        },
        `⚡ Stake +${topUp} NEAR`,
      )
    : null;
  return el('div', { className: 'ta-stk-topup-actions' }, topUpBtn, instantBtn);
}

function buildTopUpProgress(total: number, next: number | null, progress: number): HTMLElement {
  const bar = el(
    'div',
    {
      className: 'ta-stk-bar ta-stk-topup-bar',
      role: 'progressbar',
      aria: { valuemin: '0', valuemax: '100', valuenow: String(progress), label: 'Progress to next tier' },
      dataset: { testid: 'staking-tier-progress' },
    },
    el('i', { style: { width: `${progress}%` } }),
  );
  return el(
    'div',
    { className: 'ta-stk-topup-progress-row' },
    bar,
    el(
      'div',
      { className: 'ta-stk-topup-progress-meta' },
      el('span', {}, next !== null ? `${formatNear(total)} / ${formatNear(next)}` : 'Top tier reached'),
      el('span', {}, `${progress}%`),
    ),
  );
}

function buildTelemetryPill(label: string, value: string, testid?: string): HTMLElement {
  return el(
    'div',
    { className: 'ta-stk-topup-stat plate-sm' },
    el('span', { className: 'label' }, label),
    el('b', { className: 'ta-stk-topup-stat-val', dataset: testid ? { testid } : undefined }, value),
  );
}

/**
 * Unified Hero Card combining Active Tier & Upgrade Top-Up, Orbital Patronage hover matrix,
 * Lead Patron seat nomination, and Social Broadcast sharing. Only explicit buttons act; card background is static.
 */
export function renderTopUpCard(
  p: StakingPerformanceResponse,
  nowMs: number,
  h: TopUpCardHandlers,
): TopUpCardHandle {
  const total = totalStakedNear(p.balances);
  const next = p.perks.nextTierMinNear;
  const topUp = topUpAmountNear(total, next);
  const progress = Math.round(tierProgress(total, next) * 100);
  const warmNode = el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-warmup-chip' } }, warmupLabel(p.timers.feeWarmupReadyAtMs, nowMs));
  const patronageTrigger = createPatronageHoverTrigger({
    id: 'staking-patronage',
    buttonTestId: 'help-tip-btn-staking-patronage',
    labelText: 'ORBITAL PATRONAGE',
    tiers: STAKING_TIERS,
    amount: total,
    feeWarmupMs: h.feeWarmupMs,
    matrixTestId: 'staking-active-tier-matrix',
    rowTestIdPrefix: 'staking-active-tier-row-',
  });
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-topup',
      title: 'ACTIVE TIER & ORBITAL PATRON',
      description:
        'Tracks your live Orbital Patronage Tier, staked principal, effective APY, fee warmup timer, and next-tier gap alongside Lead Patron planet nomination and social sharing. Hover ORBITAL PATRONAGE for the full tier table.',
      openOnHover: true,
      floating: true,
    },
    el('span', { className: 'label c-orange-hi' }, topUp !== null ? 'ACTIVE TIER & ORBITAL PATRON · UPGRADE AVAILABLE' : 'ACTIVE TIER & ORBITAL PATRON · MAX PATRONAGE'),
    el('div', { className: 'ta-stk-chips' }, patronageTrigger, warmNode),
  );
  const patron = renderPatronZone(p, h.patronOpts);

  const card = el(
    'div',
    {
      className: `plate ta-stk-topup-card${topUp === null ? ' is-maxed' : ''}`,
      dataset: { testid: 'staking-kpi-tier', topupAvailable: topUp !== null ? '1' : '0' },
    },
    header.head,
    header.panel,
    el(
      'div',
      { className: 'ta-stk-topup-main' },
      el(
        'div',
        { className: 'ta-stk-topup-info' },
        el('b', { className: 'ta-stk-topup-tier' }, `T${p.perks.tier} ${p.perks.tierName}`),
        el(
          'div',
          { className: 'ta-stk-topup-telemetry' },
          buildTelemetryPill('STAKED', patron.stakedText, 'staking-patron-staked'),
          buildTelemetryPill('EFFECTIVE APY', patron.effectiveApyText, 'staking-patron-apy'),
          buildTelemetryPill('NEAR.AI SLOTS', `${p.perks.activeAiColonySlots} / ${p.perks.maxAiColonySlots}`),
        ),
        topUp !== null
          ? el('span', { className: 'ta-stk-topup-next' }, nextTierSummary(p.perks.tier + 1, topUp))
          : el('span', { className: 'ta-stk-sub' }, 'Maximum patronage tier unlocked'),
      ),
      buildTopUpActions(p.perks.tier, topUp, h),
    ),
    buildTopUpProgress(total, next, progress),
    patron.zoneEl,
  );

  return {
    el: el('div', { className: 'ta-stk-topup-block', dataset: { testid: 'staking-topup-block' } }, card),
    tick(nextNowMs: number) {
      warmNode.textContent = warmupLabel(p.timers.feeWarmupReadyAtMs, nextNowMs);
    },
    setBusy(busy: boolean) {
      for (const b of card.querySelectorAll<HTMLButtonElement>('.ta-stk-topup-actions button')) {
        b.disabled = busy;
        if (busy) b.setAttribute('aria-busy', 'true');
        else b.removeAttribute('aria-busy');
      }
      patron.setBusy(busy);
    },
  };
}
