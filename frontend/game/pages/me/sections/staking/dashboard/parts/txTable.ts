import type { StakingTxRow } from '@terra/contracts';
import { el } from '../../../../dom';
import { formatNear } from '../../stakingMath';

const KIND_LABEL: Record<StakingTxRow['kind'], string> = {
  stake: 'Stake',
  unstake: 'Unstake',
  withdraw: 'Withdraw',
  compound: 'Compound',
  stake_profits: 'Stake profits',
  early_exit_fee: 'Early-exit fee',
};

const shortHash = (h: string): string => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

function row(t: StakingTxRow): HTMLElement {
  const hash = t.explorerUrl
    ? el('a', { href: t.explorerUrl, target: '_blank', rel: 'noopener noreferrer', dataset: { testid: 'staking-tx-link' } }, shortHash(t.txHash))
    : el('span', { className: 'ta-stk-sub', title: t.txHash }, shortHash(t.txHash));
  return el(
    'tr',
    { dataset: { testid: 'staking-tx-row', kind: t.kind } },
    el('td', {}, new Date(t.atMs).toISOString().slice(0, 16).replace('T', ' ')),
    el('td', {}, KIND_LABEL[t.kind]),
    el('td', {}, `${formatNear(Number(t.amountNear))} ${t.asset === 'near' ? '' : t.asset}`.trim()),
    el('td', {}, hash),
  );
}

/** NearBlocks transaction table (explorer link only when `explorerUrl` is non-null; mock rows show the plain hash). */
export function renderTxTable(txs: readonly StakingTxRow[]): HTMLElement {
  const emptyCell = el('td', {}, 'No staking transactions yet');
  emptyCell.colSpan = 4;
  const table = el(
    'table',
    { className: 'ta-stk-table', dataset: { testid: 'staking-tx-table' } },
    el('thead', {}, el('tr', {}, ...['WHEN (UTC)', 'ACTION', 'AMOUNT', 'TX'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...(txs.length === 0 ? [el('tr', {}, emptyCell)] : txs.map(row))),
  );
  return el('div', { className: 'ta-stk-block' }, el('h3', { className: 'label ta-stk-h' }, 'TRANSACTIONS'), el('div', { className: 'ta-stk-scroll' }, table));
}
