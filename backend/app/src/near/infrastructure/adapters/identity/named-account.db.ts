import type { PrismaClient, TransactionClient } from '@terra/db';
import { withTransaction } from '@terra/db';
import { playerAccountId } from '@terra/contracts';
import type { CreateNamedAccountResult } from '../../../application/ports/identity.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { labelChoices, nextFreeLabel } from '../../../identity/account-allocate.js';
import { mockTxHashFor } from '../../mock/tx-hash.js';

/** Extra attempts after a unique clash (another opId took the label, or this opId already committed). */
const RACE_RETRIES = 4;

/**
 * One transaction: replay `opId` from the receipt, or insert the next free `{label}.terraagent.mock` (kind `named`)
 * and a `mock:` receipt. A unique violation rolls the transaction back; the caller tries again.
 * No mock latency — social login must not sleep (BE-33).
 */
export async function insertNamedAccount(
  prisma: PrismaClient,
  input: { opId: string; name: string },
): Promise<CreateNamedAccountResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withTransaction(prisma, (tx) => writeOnce(tx, input));
    } catch (e) {
      if (!isUniqueConflict(e)) throw e;
      if (attempt >= RACE_RETRIES) throw new NearException('NEAR_UNAVAILABLE');
    }
  }
}

async function writeOnce(tx: TransactionClient, input: { opId: string; name: string }): Promise<CreateNamedAccountResult> {
  const prior = await replay(tx, input.opId);
  if (prior) return prior;
  const accountId = playerAccountId(await freeLabel(tx, input.name));
  await tx.mockChainAccount.create({ data: { accountId, kind: 'named' } });
  return { accountId, receipt: await writeReceipt(tx, input.opId, accountId) };
}

async function replay(tx: TransactionClient, opId: string): Promise<CreateNamedAccountResult | null> {
  const prior = await tx.mockChainReceipt.findUnique({ where: { opId } });
  if (!prior) return null;
  const accountId = accountIdFrom(prior.payload);
  if (!accountId) throw new NearException('NEAR_UNAVAILABLE');
  return { accountId, receipt: toReceipt(prior) };
}

async function freeLabel(tx: TransactionClient, base: string): Promise<string> {
  const labels = labelChoices(base);
  const rows = await tx.mockChainAccount.findMany({
    where: { accountId: { in: labels.map(playerAccountId) } },
    select: { accountId: true },
  });
  const taken = new Set(rows.map((row) => row.accountId));
  return nextFreeLabel(base, (label) => taken.has(playerAccountId(label)));
}

async function writeReceipt(tx: TransactionClient, opId: string, accountId: string): Promise<ChainReceipt> {
  const [{ h }] = await tx.$queryRaw<{ h: bigint }[]>`SELECT nextval('chain.mock_chain_block_height_seq') AS h`;
  const row = await tx.mockChainReceipt.create({
    data: {
      txHash: mockTxHashFor(opId),
      opId,
      port: 'Identity',
      method: 'createNamedAccount',
      status: 'success',
      payload: { accountId },
      blockHeight: h,
    },
  });
  return toReceipt(row);
}

function accountIdFrom(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('accountId' in payload)) return null;
  const id = (payload as { accountId: unknown }).accountId;
  return typeof id === 'string' ? id : null;
}

function toReceipt(row: { txHash: string; status: string; errorCode: string | null; blockHeight: bigint; createdAt: Date }): ChainReceipt {
  return {
    txHash: row.txHash,
    blockHeight: Number(row.blockHeight),
    status: row.status === 'success' ? 'success' : 'failure',
    network: 'mock',
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    at: row.createdAt.getTime(),
  };
}

function isUniqueConflict(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}
