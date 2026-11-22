import { namedAccountOpId, playerAccountId } from '@terra/contracts';
import type { PrismaClient, TransactionClient } from '@terra/db';
import { withTransaction } from '@terra/db';
import { NearException } from '../domain/errors.js';
import { labelChoices, NamedAccountBook, nextFreeLabel } from './account-allocate.js';

const RACE_RETRIES = 4;

/**
 * Allocates a deterministic `{slug}.terraagent.mock` account for localhost mock login without touching Testnet RPC,
 * even when `NEAR_MODE=testnet` is active on the dev server.
 */
export async function allocateLocalMockAccount(
  prisma: PrismaClient | null,
  book: NamedAccountBook,
  input: { readonly provider: string; readonly subject: string; readonly name: string },
): Promise<string> {
  const opId = namedAccountOpId(input.provider, input.subject);
  if (!prisma) {
    return book.allocate(opId, input.name);
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withTransaction(prisma, (tx) => allocateInTx(tx, input));
    } catch (err) {
      if (!isUniqueConflict(err) || attempt >= RACE_RETRIES) {
        if (isUniqueConflict(err)) throw new NearException('NEAR_UNAVAILABLE');
        throw err;
      }
    }
  }
}

async function allocateInTx(
  tx: TransactionClient,
  input: { readonly provider: string; readonly subject: string; readonly name: string },
): Promise<string> {
  const existing = await tx.socialIdentity.findUnique({
    where: { provider_subject: { provider: input.provider, subject: input.subject } },
    select: { accountId: true },
  });
  if (existing?.accountId) return existing.accountId;

  const candidates = labelChoices(input.name);
  const candidateIds = candidates.map(playerAccountId);
  const [socialRows, mockRows, colonyRows] = await Promise.all([
    tx.socialIdentity.findMany({ where: { accountId: { in: candidateIds } }, select: { accountId: true } }),
    tx.mockChainAccount.findMany({ where: { accountId: { in: candidateIds } }, select: { accountId: true } }),
    tx.nearColonyAccount.findMany({ where: { accountId: { in: candidateIds } }, select: { accountId: true } }),
  ]);
  const taken = new Set([
    ...socialRows.map((r) => r.accountId),
    ...mockRows.map((r) => r.accountId),
    ...colonyRows.map((r) => r.accountId),
  ]);
  const freeLabel = nextFreeLabel(input.name, (label) => taken.has(playerAccountId(label)));
  const accountId = playerAccountId(freeLabel);
  await tx.mockChainAccount.upsert({
    where: { accountId },
    create: { accountId, kind: 'named' },
    update: {},
  });
  return accountId;
}

function isUniqueConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}
