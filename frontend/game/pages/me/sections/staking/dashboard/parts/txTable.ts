import type { StakingTxRow } from '@terra/contracts';
import { el } from '../../../../dom';
import { buildBlockHeaderWithTip } from '../../../../parts/helpTip';
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

const safeExplorerUrl = (url: string | null): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

function row(t: StakingTxRow): HTMLElement {
  const safeUrl = safeExplorerUrl(t.explorerUrl);
  const hash = safeUrl
    ? el('a', { href: safeUrl, target: '_blank', rel: 'noopener noreferrer', dataset: { testid: 'staking-tx-link' } }, shortHash(t.txHash))
    : el('span', { className: 'ta-stk-sub', title: t.txHash }, shortHash(t.txHash));
  const amountLabel = t.asset === 'near' ? formatNear(Number(t.amountNear)) : `${Number(t.amountNear).toFixed(2)} ${t.asset}`;
  return el(
    'tr',
    { dataset: { testid: 'staking-tx-row', kind: t.kind } },
    el('td', {}, new Date(t.atMs).toISOString().slice(0, 16).replace('T', ' ')),
    el('td', {}, KIND_LABEL[t.kind]),
    el('td', {}, amountLabel),
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
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-txs',
      title: 'TRANSACTIONS',
      description:
        'Audit log of your recent stake, compound, unstake, withdraw, profit-swap, and early-exit fee transactions. On Testnet and Mainnet, hashes link directly to NearBlocks.',
    },
    el('h3', { className: 'label ta-stk-h' }, 'TRANSACTIONS'),
  );
  return el(
    'div',
    { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-tx-block' } },
    header.head,
    header.panel,
    el('div', { className: 'ta-stk-scroll' }, table),
  );
}
