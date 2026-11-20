import { el } from '../../../dom';
import { formatNear, formatUsd, type IncomeProjectionView } from '../stakingMath';

const PERIODS = [
  { id: 'daily', label: 'DAILY', near: 'dailyNear', usd: 'dailyUsd' },
  { id: 'monthly', label: 'MONTHLY', near: 'monthlyNear', usd: 'monthlyUsd' },
  { id: 'yearly', label: 'YEARLY', near: 'yearlyNear', usd: 'yearlyUsd' },
] as const;

/** Pre-filled `<X> NEAR` income projections: daily / monthly / yearly in NEAR and USD. */
export function renderProjection(p: IncomeProjectionView, priceBadge: string): HTMLElement {
  const tiles = PERIODS.map((per) =>
    el(
      'div',
      { className: 'ta-stk-tile plate-sm', dataset: { testid: `staking-projection-${per.id}` } },
      el('span', { className: 'label' }, per.label),
      el('b', { className: 'ta-stk-tile-val' }, formatNear(p[per.near])),
      el('span', { className: 'ta-stk-tile-sub' }, formatUsd(p[per.usd])),
    ),
  );
  return el(
    'div',
    { className: 'ta-stk-block', dataset: { testid: 'staking-projection', amount: p.amountNear } },
    el(
      'h3',
      { className: 'label ta-stk-h' },
      `PROJECTED INCOME · ${p.amountNear} NEAR `,
      el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-price-badge' } }, priceBadge),
    ),
    el('div', { className: 'ta-stk-tiles' }, ...tiles),
  );
}
