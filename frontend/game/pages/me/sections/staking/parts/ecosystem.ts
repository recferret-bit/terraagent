import type { StakingOverviewResponse } from '@terra/contracts';
import { el } from '../../../dom';
import { buildBlockHeaderWithTip } from '../../../parts/helpTip';
import { formatTvl } from '../stakingMath';

type Ecosystem = StakingOverviewResponse['ecosystem'];

const SLOTS = [
  { id: 'metapool', label: 'Meta Pool · stNEAR' },
  { id: 'linear', label: 'LiNEAR' },
  { id: 'validator', label: 'Validators' },
] as const;

/** NEAR Ecosystem TVL scoreboard. A missing entry (or the fallback overview) shows "—" instead of a made-up number. */
export function renderEcosystem(eco: Ecosystem): HTMLElement {
  const tiles = SLOTS.map((slot) => {
    const entry = eco.entries.find((e) => e.id === slot.id);
    return el(
      'div',
      { className: 'ta-stk-tile plate-sm', dataset: { testid: `staking-ecosystem-${slot.id}`, present: entry ? '1' : '0' } },
      el('span', { className: 'label' }, entry?.label ?? slot.label),
      el('b', { className: 'ta-stk-tile-val' }, entry ? `${formatTvl(entry.tvlNear)} NEAR` : '—'),
      el('span', { className: 'ta-stk-tile-sub' }, entry ? `${entry.sharePct.toFixed(1)}% of TerraAgent TVL` : 'No data yet'),
    );
  });
  const total = eco.entries.length > 0 ? `${formatTvl(eco.totalNear)} NEAR` : '—';
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-ecosystem',
      title: 'NEAR ECOSYSTEM TVL',
      description:
        'Live breakdown of total TerraAgent stake routed across Meta Pool (stNEAR), LiNEAR liquid staking, and whitelisted native NEAR validator pools.',
    },
    el('h3', { className: 'label ta-stk-h' }, `NEAR ECOSYSTEM TVL · `, el('span', { dataset: { testid: 'staking-ecosystem-total' } }, total)),
  );
  return el(
    'div',
    { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-ecosystem' } },
    header.head,
    header.panel,
    el('div', { className: 'ta-stk-tiles' }, ...tiles),
  );
}
