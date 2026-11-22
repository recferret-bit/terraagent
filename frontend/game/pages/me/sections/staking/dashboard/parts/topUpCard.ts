import { STAKING_TIERS } from '@terra/contracts/staking/tiers';
import type { StakingPerformanceResponse } from '@terra/contracts';
import { el } from '../../../../dom';
import { buildBlockHeaderWithTip } from '../../../../parts/helpTip';
import { formatNear, formatPct } from '../../stakingMath';
import { formatCountdown, tierProgress, topUpAmountNear, totalStakedNear } from '../dashboardMath';
import './topUpCard.css';

export interface TopUpCardHandlers {
  readonly onTopUp: (amountNear: number) => void;
  readonly onTopUpStake?: (amountNear: number) => void;
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
      onClick: (e) => {
        e.stopPropagation();
        h.onTopUp(topUp);
      },
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
          onClick: (e) => {
            e.stopPropagation();
            h.onTopUpStake?.(topUp);
          },
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

/**
 * Dedicated standalone Tier Upgrade & Top-Up hero block (extracted from KPI strip so it stands out and is clickable).
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

  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-topup',
      title: 'ACTIVE TIER & TOP-UP UPGRADE',
      description:
        'Tracks your current Orbital Patronage Tier, fee warmup timer, and exact NEAR gap to unlock the next tier. Click this card or Top Up to pre-fill the Action Console, or Instant Stake to upgrade in one click.',
    },
    el('span', { className: 'label c-orange-hi' }, topUp !== null ? 'ACTIVE TIER · UPGRADE AVAILABLE' : 'ACTIVE TIER · MAX PATRONAGE'),
    warmNode,
  );

  const card = el(
    'div',
    {
      className: `plate ta-stk-topup-card ${topUp !== null ? 'is-clickable' : 'is-maxed'}`,
      dataset: { testid: 'staking-kpi-tier', topupAvailable: topUp !== null ? '1' : '0' },
      onClick: () => { if (topUp !== null) h.onTopUp(topUp); },
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
          { className: 'ta-stk-topup-meta' },
          el('span', {}, `NEAR.AI colony slots ${p.perks.activeAiColonySlots} / ${p.perks.maxAiColonySlots}`),
          topUp !== null
            ? el('span', { className: 'ta-stk-topup-hint' }, `Click card to pre-fill +${topUp} NEAR →`)
            : null,
        ),
        topUp !== null
          ? el('span', { className: 'ta-stk-topup-next' }, nextTierSummary(p.perks.tier + 1, topUp))
          : el('span', { className: 'ta-stk-sub' }, 'Maximum patronage tier unlocked'),
      ),
      buildTopUpActions(p.perks.tier, topUp, h),
    ),
    buildTopUpProgress(total, next, progress),
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
    },
  };
}
