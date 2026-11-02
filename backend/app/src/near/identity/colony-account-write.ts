import type { PrismaClient, TransactionClient } from '@terra/db';
import { withTransaction } from '@terra/db';
import { deriveAccountName } from './account-name.js';
import { colonyAccountCandidates } from './colony-account-id.js';
import type { ColonyKeyRow, KeyStore } from '../keystore/keys.js';

/** Extra attempts after a unique clash (two logins, or login racing `colonyFounded`). */
const RACE_RETRIES = 4;
const PLAYER_SLOT = 'player';

export interface EnsureColonyAccountsInput {
  readonly playerId: string;
  readonly subject: string;
  /** Named account id from `createNamedAccount` (or the social row). Owner of every new colony row. */
  readonly ownerAccountId: string;
  /** When set, only these colonies. When omitted, every `core.colony` of the player. */
  readonly colonyIds?: readonly string[];
}

/**
 * Idempotent player row (`slot: 'player'`) plus one row per colony (`slot` = colony id).
 * A row that already exists keeps its account id and its key. The ed25519 seed is never written.
 */
export async function ensureColonyAccounts(
  prisma: PrismaClient,
  keys: KeyStore,
  input: EnsureColonyAccountsInput,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await withTransaction(prisma, (tx) => writeAccounts(tx, keys, input));
      return;
    } catch (e) {
      if (!isUnique(e) || attempt >= RACE_RETRIES) {
        if (isUnique(e)) throw new Error('colony account id is already used');
        throw e;
      }
    }
  }
}

async function writeAccounts(tx: TransactionClient, keys: KeyStore, input: EnsureColonyAccountsInput): Promise<void> {
  const ownerAccountId = await ensurePlayerRow(tx, keys, input.playerId, input.ownerAccountId);
  const colonyIds = input.colonyIds ?? (await idsOf(tx, input.playerId));
  const playerName = deriveAccountName(input.subject);
  const seen = new Set<string>();
  for (const colonyId of colonyIds) {
    if (seen.has(colonyId)) continue;
    seen.add(colonyId);
    await ensureColonyRow(tx, keys, { playerId: input.playerId, colonyId, playerName, ownerAccountId });
  }
}

async function idsOf(tx: TransactionClient, playerId: string): Promise<string[]> {
  const rows = await tx.colony.findMany({ where: { playerId }, select: { id: true } });
  return rows.map((row) => row.id);
}

/** Returns the stored player account id (the first write wins; a later login must not rotate it). */
async function ensurePlayerRow(tx: TransactionClient, keys: KeyStore, playerId: string, ownerAccountId: string): Promise<string> {
  const existing = await tx.nearColonyAccount.findUnique({
    where: { playerId_slot: { playerId, slot: PLAYER_SLOT } },
    select: { accountId: true },
  });
  if (existing) {
    await upsertMock(tx, existing.accountId, 'named', null);
    return existing.accountId;
  }
  const sealed = seal(keys);
  await tx.nearColonyAccount.create({
    data: {
      accountId: ownerAccountId,
      playerId,
      slot: PLAYER_SLOT,
      colonyId: null,
      ownerAccountId,
      ...sealed,
    },
  });
  await upsertMock(tx, ownerAccountId, 'named', sealed.publicKey);
  return ownerAccountId;
}

async function ensureColonyRow(
  tx: TransactionClient,
  keys: KeyStore,
  input: { playerId: string; colonyId: string; playerName: string; ownerAccountId: string },
): Promise<void> {
  const existing = await tx.nearColonyAccount.findUnique({
    where: { playerId_slot: { playerId: input.playerId, slot: input.colonyId } },
    select: { accountId: true },
  });
  if (existing) {
    await upsertMock(tx, existing.accountId, 'colony', null);
    return;
  }
  const accountId = await freeColonyAccountId(tx, input.colonyId, input.playerName);
  const sealed = seal(keys);
  await tx.nearColonyAccount.create({
    data: {
      accountId,
      playerId: input.playerId,
      slot: input.colonyId,
      colonyId: input.colonyId,
      ownerAccountId: input.ownerAccountId,
      ...sealed,
    },
  });
  await upsertMock(tx, accountId, 'colony', sealed.publicKey);
}

async function freeColonyAccountId(tx: TransactionClient, colonyId: string, playerName: string): Promise<string> {
  const candidates = colonyAccountCandidates(colonyId, playerName);
  const where = { accountId: { in: [...candidates] } };
  const [near, mock] = await Promise.all([
    tx.nearColonyAccount.findMany({ where, select: { accountId: true } }),
    tx.mockChainAccount.findMany({ where, select: { accountId: true } }),
  ]);
  const used = new Set([...near, ...mock].map((row) => row.accountId));
  const free = candidates.find((id) => !used.has(id));
  if (!free) throw new Error('colony account id is already used');
  return free;
}

/** `publicKey` is set only on insert. An existing mock row (the W06-05 named account) is left as it is. */
async function upsertMock(tx: TransactionClient, accountId: string, kind: 'named' | 'colony', publicKey: string | null): Promise<void> {
  await tx.mockChainAccount.upsert({
    where: { accountId },
    create: publicKey ? { accountId, kind, publicKey } : { accountId, kind },
    update: {},
  });
}

/** Persist `row` only. The seed on `generate()` is not copied into the returned object. */
function seal(keys: KeyStore): ColonyKeyRow {
  const { publicKey, encryptedSecret, kekVersion } = keys.generate().row;
  return { publicKey, encryptedSecret, kekVersion };
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}
