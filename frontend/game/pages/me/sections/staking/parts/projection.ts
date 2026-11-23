import { el } from '../../../dom';
import { buildBlockHeaderWithTip } from '../../../parts/helpTip';
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
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-projection',
      title: 'PROJECTED INCOME',
      description:
        'Estimated passive NEAR and USD validator rewards for your previewed stake amount at the net staker APY (80% of validator yield), before compounding, market fee cuts, or patron revenue.',
    },
    el('h3', { className: 'label ta-stk-h' }, `PROJECTED INCOME · ${p.amountNear} NEAR`),
    el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-price-badge' } }, priceBadge),
  );
  return el(
    'div',
    { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-projection', amount: p.amountNear } },
    header.head,
    header.panel,
    el('div', { className: 'ta-stk-tiles' }, ...tiles),
  );
}
