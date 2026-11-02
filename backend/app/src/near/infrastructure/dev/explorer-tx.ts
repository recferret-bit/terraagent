import type { PrismaClient } from '@terra/db';

/** Stored `chain.mock_chain_receipt` fields the detail view needs. Extra columns may be omitted. */
export interface StoredExplorerReceipt {
  readonly txHash: string;
  readonly status: string;
  readonly payload: unknown;
  readonly opId?: string | null;
  readonly port?: string;
  readonly method?: string;
  readonly blockHeight?: number | bigint | null;
}

/** `GET /v1/dev/chain/tx` body. `statusLabel` is display-only; stored status stays `pending|success|failure`. */
export interface ExplorerTxDetail {
  readonly txHash: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly signerId: string | null;
  readonly receiverId: string | null;
  readonly opId: string | null;
  readonly port: string;
  readonly method: string;
  readonly blockHeight: number | null;
  readonly payload: unknown;
}

function payloadField(payload: unknown, key: string): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/** Maps a stored receipt onto the detail view. `FINAL` only when the stored status is `success`. */
export function toExplorerTx(row: StoredExplorerReceipt): ExplorerTxDetail {
  const height = row.blockHeight;
  return {
    txHash: row.txHash,
    status: row.status,
    statusLabel: row.status === 'success' ? 'FINAL' : row.status,
    signerId: payloadField(row.payload, 'signerId'),
    receiverId: payloadField(row.payload, 'receiverId'),
    opId: row.opId ?? null,
    port: row.port ?? '',
    method: row.method ?? '',
    blockHeight: height === undefined || height === null ? null : Number(height),
    payload: row.payload,
  };
}

/** The receipt with this hash, or null when the mock ledger has no such row. */
export async function readExplorerTx(prisma: PrismaClient, hash: string): Promise<ExplorerTxDetail | null> {
  const row = await prisma.mockChainReceipt.findUnique({ where: { txHash: hash } });
  if (!row) return null;
  return toExplorerTx({
    txHash: row.txHash,
    status: row.status,
    payload: row.payload,
    opId: row.opId,
    port: row.port,
    method: row.method,
    blockHeight: row.blockHeight,
  });
}
