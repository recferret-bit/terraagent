import type { PrismaClient } from '@terra/db';

/** One row of `GET /v1/dev/chain/accounts`. `named` is a player account; `colony` is a colony sub-account. */
export interface ExplorerAccount {
  readonly accountId: string;
  readonly kind: string;
  readonly publicKey: string | null;
  readonly ownerAccountId: string | null;
}

export interface MockAccountSource {
  readonly accountId: string;
  readonly kind: string;
  readonly publicKey: string | null;
}

export interface NearAccountSource {
  readonly accountId: string;
  readonly slot: string;
  readonly publicKey: string;
  readonly ownerAccountId: string;
}

const byAccountId = (a: ExplorerAccount, b: ExplorerAccount): number =>
  a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;

/**
 * One row per account id. A mock row's `kind` wins when both tables have the id.
 * `ownerAccountId` comes only from `near_colony_account` (null for a mock-only row).
 * `slot === 'player'` is kind `named`; any other slot is `colony`.
 */
export function mergeExplorerAccounts(
  mockRows: readonly MockAccountSource[],
  nearRows: readonly NearAccountSource[],
): ExplorerAccount[] {
  const byId = new Map<string, ExplorerAccount>();
  for (const row of nearRows) {
    byId.set(row.accountId, {
      accountId: row.accountId,
      kind: row.slot === 'player' ? 'named' : 'colony',
      publicKey: row.publicKey,
      ownerAccountId: row.ownerAccountId,
    });
  }
  for (const row of mockRows) {
    const prior = byId.get(row.accountId);
    byId.set(row.accountId, {
      accountId: row.accountId,
      kind: row.kind,
      publicKey: row.publicKey ?? prior?.publicKey ?? null,
      ownerAccountId: prior?.ownerAccountId ?? null,
    });
  }
  return [...byId.values()].sort(byAccountId);
}

/** Both account tables, deduped, capped at `limit`, optionally one exact account id. */
export async function listExplorerAccounts(
  prisma: PrismaClient,
  q: { readonly account?: string; readonly limit: number },
): Promise<ExplorerAccount[]> {
  const account = q.account ?? null;
  const ids = await prisma.$queryRaw<Array<{ account_id: string }>>`
    SELECT account_id FROM (
      SELECT account_id FROM chain.mock_chain_account
      UNION
      SELECT account_id FROM chain.near_colony_account
    ) u
    WHERE (${account}::text IS NULL OR account_id = ${account}::text)
    ORDER BY account_id
    LIMIT ${q.limit}`;
  if (ids.length === 0) return [];
  const accountIds = ids.map((row) => row.account_id);
  const [mockRows, nearRows] = await Promise.all([
    prisma.mockChainAccount.findMany({
      where: { accountId: { in: accountIds } },
      select: { accountId: true, kind: true, publicKey: true },
    }),
    prisma.nearColonyAccount.findMany({
      where: { accountId: { in: accountIds } },
      select: { accountId: true, slot: true, publicKey: true, ownerAccountId: true },
    }),
  ]);
  const order = new Map(accountIds.map((id, index) => [id, index]));
  return mergeExplorerAccounts(mockRows, nearRows).sort(
    (a, b) => (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0),
  );
}
