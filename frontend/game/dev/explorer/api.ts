/** Read-only dev routes of the mock chain (`/v1/dev/chain/*`, 404 in production). */
export type TabId = 'receipts' | 'balances' | 'nfts' | 'dao' | 'escrow' | 'outbox';
export type Row = Record<string, unknown>;

export interface Query { account: string }

const PATH: Record<TabId, string> = { receipts: 'receipts', balances: 'balances', nfts: 'nfts', dao: 'dao', escrow: 'escrow', outbox: 'outbox' };

export async function fetchRows(tab: TabId, q: Query, signal?: AbortSignal): Promise<Row[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (q.account && tab !== 'dao') params.set('account', q.account);
  const res = await fetch(`/v1/dev/chain/${PATH[tab]}?${params}`, { signal });
  if (!res.ok) throw new Error(res.status === 404 ? 'dev routes not available (production or non-mock chain)' : `HTTP ${res.status}`);
  return (await res.json()) as Row[];
}

/** Writes a ping receipt through the mock chain (takes 300-1500 ms). */
export async function ping(): Promise<Row> {
  const res = await fetch('/v1/dev/chain/ping', { method: 'POST' });
  if (!res.ok) throw new Error(`ping failed: HTTP ${res.status}`);
  return (await res.json()) as Row;
}
