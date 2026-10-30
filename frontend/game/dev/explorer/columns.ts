import type { Row, TabId } from './api';

export interface Column { head: string; cell: (r: Row) => string; cls?: string }
export interface TabDef { id: TabId; label: string; empty: string; key: (r: Row) => string; columns: Column[] }

const s = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const short = (v: unknown, n = 48): string => { const t = s(v); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function age(ms: unknown, now = Date.now()): string {
  const d = Math.max(0, Math.round((now - Number(ms)) / 1000));
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  return d < 86400 ? `${Math.floor(d / 3600)}h` : `${Math.floor(d / 86400)}d`;
}

export const TABS: TabDef[] = [
  { id: 'receipts', label: 'Receipts', empty: 'No receipts yet. Run chain.ping in the dev console or press the ping button.', key: (r) => s(r.txHash),
    columns: [
      { head: 'BLOCK', cell: (r) => s(r.blockHeight), cls: 'num' }, { head: 'HASH', cell: (r) => s(r.txHash), cls: 'hash' },
      { head: 'CALL', cell: (r) => `${s(r.port)}.${s(r.method)}` }, { head: 'STATUS', cell: (r) => s(r.status), cls: 'status' },
      { head: 'OP ID', cell: (r) => short(r.opId, 40) }, { head: 'AGE', cell: (r) => age(r.at), cls: 'num' },
    ] },
  { id: 'balances', label: 'Balances', empty: 'No balances.', key: (r) => `${s(r.accountId)}|${s(r.tokenId)}|${s(r.amount)}`,
    columns: [{ head: 'ACCOUNT', cell: (r) => s(r.accountId) }, { head: 'TOKEN', cell: (r) => s(r.tokenId) }, { head: 'AMOUNT', cell: (r) => s(r.amount), cls: 'num' }] },
  { id: 'nfts', label: 'NFTs', empty: 'No NFTs.', key: (r) => `${s(r.collection)}|${s(r.tokenId)}|${s(r.updatedAt)}`,
    columns: [
      { head: 'COLLECTION', cell: (r) => s(r.collection) }, { head: 'TOKEN', cell: (r) => short(r.tokenId, 36) }, { head: 'OWNER', cell: (r) => s(r.ownerAccountId) },
      { head: 'METADATA', cell: (r) => short(r.metadata, 60) }, { head: 'AGE', cell: (r) => age(r.updatedAt), cls: 'num' },
    ] },
  { id: 'dao', label: 'DAO', empty: 'No DAOs.', key: (r) => `${s(r.id)}|${s(r.proposals && (r.proposals as unknown[]).length)}|${short(r.proposals, 400)}`,
    columns: [
      { head: 'DAO', cell: (r) => s(r.id) }, { head: 'POLICY', cell: (r) => short(r.policy, 50) },
      { head: 'PROPOSALS', cell: (r) => { const p = (r.proposals as Row[]) ?? []; return p.length ? p.map((x) => `#${s(x.id)} ${s(x.status)}`).join(', ') : '0'; } },
    ] },
  { id: 'escrow', label: 'Escrow', empty: 'No escrows.', key: (r) => `${s(r.id)}|${s(r.status)}`,
    columns: [
      { head: 'ID', cell: (r) => s(r.id) }, { head: 'OPENER', cell: (r) => s(r.opener) }, { head: 'BENEFICIARY', cell: (r) => s(r.beneficiary) },
      { head: 'AMOUNT', cell: (r) => `${s(r.amount)} ${s(r.tokenId)}`, cls: 'num' }, { head: 'STATUS', cell: (r) => s(r.status), cls: 'status' },
    ] },
  { id: 'outbox', label: 'Outbox', empty: 'Outbox is empty.', key: (r) => `${s(r.id)}|${s(r.status)}|${s(r.attempts)}`,
    columns: [
      { head: 'ID', cell: (r) => s(r.id), cls: 'num' }, { head: 'OP ID', cell: (r) => short(r.opId, 40) }, { head: 'CALL', cell: (r) => `${s(r.port)}.${s(r.method)}` },
      { head: 'STATUS', cell: (r) => s(r.status), cls: 'status' }, { head: 'TRIES', cell: (r) => s(r.attempts), cls: 'num' },
      { head: 'HASH', cell: (r) => s(r.txHash), cls: 'hash' }, { head: 'ERROR', cell: (r) => short(r.lastError, 50) },
    ] },
];
