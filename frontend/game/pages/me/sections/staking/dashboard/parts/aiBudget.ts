import type { AiBudgetView } from '@terra/contracts';
import { el } from '../../../../dom';
import { formatUsdSmall } from '../../stakingMath';

const pct = (used: number, cap: number): number => (cap > 0 ? Math.min(100, Math.max(0, Math.round((used / cap) * 100))) : 0);

function meter(label: string, used: number, cap: number, text: string, testid: string): HTMLElement {
  const value = pct(used, cap);
  return el(
    'div',
    { className: 'ta-stk-meter', dataset: { testid } },
    el('div', { className: 'ta-stk-meter-head' }, el('span', { className: 'label' }, label), el('b', {}, text)),
    el('div', { className: 'ta-stk-bar', role: 'progressbar', aria: { valuemin: '0', valuemax: '100', valuenow: String(value), label } }, el('i', { style: { width: `${value}%` } })),
  );
}

/** Colony slot bar: one segment per slot, filled for the slots in use (max 12 drawn, the count text is exact). */
export function renderSlotBar(used: number, max: number): HTMLElement {
  const drawn = Math.min(Math.max(max, 0), 12);
  const segs = Array.from({ length: drawn }, (_, i) => el('i', { className: i < used ? 'is-used' : '' }));
  return el(
    'div',
    { className: 'ta-stk-slots', dataset: { testid: 'staking-slot-bar', used, max }, role: 'img', aria: { label: `${used} of ${max} NEAR.AI colony slots in use` } },
    el('span', { className: 'label' }, 'NEAR.AI COLONY SLOTS'),
    el('div', { className: 'ta-stk-slot-row' }, ...segs),
    el('b', {}, `${used} / ${max}`),
  );
}

/** `⚡ AI Compute Budget`: dynamic daily USD cap, daily calls, T0 trial turns, trade bonus calls, slot bar. */
export function renderAiBudget(b: AiBudgetView, tier: number): HTMLElement {
  const lines: HTMLElement[] = [];
  if (tier === 0 || b.mode === 'trial') {
    lines.push(el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-trial-turns' } }, b.trialEligible ? `Trial turns left ${b.freeTrialTurnsRemaining} / ${b.freeTrialTurnsTotal}` : 'Trial needs a verified pilot'));
  }
  lines.push(el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-trade-bonus' } }, `Trade bonus +${b.tradeBonusCalls} calls`));
  lines.push(el('span', { className: 'ta-stk-sub', dataset: { testid: 'staking-ai-mode' } }, `Mode ${b.mode.toUpperCase()} · ${b.model}`));
  return el(
    'div',
    { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-ai-budget', mode: b.mode } },
    el('h3', { className: 'label ta-stk-h' }, '⚡ AI COMPUTE BUDGET'),
    meter('Daily budget', b.dailyBudgetUsedUsd, b.dailyBudgetUsd, `${formatUsdSmall(b.dailyBudgetUsedUsd)} / ${formatUsdSmall(b.dailyBudgetUsd)}`, 'staking-ai-budget-usd'),
    meter('Daily calls', b.dailyCallsUsed, b.dailyCallLimit, `${b.dailyCallsUsed} / ${b.dailyCallLimit}`, 'staking-ai-budget-calls'),
    el('div', { className: 'ta-stk-chips' }, ...lines),
    renderSlotBar(b.colonySlotsUsed, b.colonySlotsMax),
  );
}
