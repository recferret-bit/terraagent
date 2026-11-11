import type { DbClient } from '@terra/db';
import type { AddLimitedKeyInput, KeyStatus } from '../../../application/ports/agent-wallet.port.js';
import { NearException } from '../../../domain/errors.js';
import {
  ZERO_ALLOWANCE,
  decimalToBigInt,
  nextAllowance,
  toAllowanceView,
  type AllowanceMove,
  type AllowanceTotals,
} from './agent-wallet-ledger.js';

export async function insertSubAccount(
  tx: DbClient,
  parent: string,
  accountId: string,
): Promise<{ accountId: string }> {
  await ensureChainAccount(tx, parent, 'named');
  const existing = await tx.mockChainAccount.findUnique({ where: { accountId } });
  if (existing) throw new NearException('NEAR_ACCOUNT_EXISTS', { message: `${accountId} already exists` });
  try {
    await tx.mockChainAccount.create({ data: { accountId, kind: 'sub' } });
  } catch (e) {
    if (isUnique(e)) throw new NearException('NEAR_ACCOUNT_EXISTS', { message: `${accountId} already exists` });
    throw e;
  }
  return { accountId };
}

/** Inserts the key and its token caps. A second key row for the same pair rejects; it does not raise the cap. */
export async function insertLimitedKey(
  tx: DbClient,
  input: AddLimitedKeyInput,
): Promise<{ accountId: string; publicKey: string }> {
  await ensureChainAccount(tx, input.accountId, 'named');
  try {
    await tx.mockChainAgentKey.create({
      data: {
        accountId: input.accountId,
        publicKey: input.publicKey,
        receiverId: input.receiverId,
        methodNames: [...input.methodNames],
        gasAllowance: input.allowance,
        gasSpent: '0',
      },
    });
    if (input.tokens && input.tokens.length > 0) {
      await tx.mockChainAgentAllowance.createMany({
        data: input.tokens.map((row) => ({
          accountId: input.accountId,
          publicKey: input.publicKey,
          token: row.token,
          allowance: row.allowance,
        })),
      });
    }
  } catch (e) {
    if (isUnique(e)) {
      throw new NearException('NEAR_ACCOUNT_EXISTS', {
        message: `Key ${input.publicKey} is already on ${input.accountId}`,
      });
    }
    throw e;
  }
  return { accountId: input.accountId, publicKey: input.publicKey };
}

export async function revokeLimitedKey(tx: DbClient, accountId: string, publicKey: string): Promise<{ revoked: true }> {
  const row = await lockKey(tx, accountId, publicKey);
  if (!row.revoked) {
    await tx.mockChainAgentKey.update({
      where: { accountId_publicKey: { accountId, publicKey } },
      data: { revoked: true, revokedAt: new Date() },
    });
  }
  return { revoked: true };
}

/** Locks the key, then the token row, then applies one move. A shortage throws and the caller's transaction writes nothing. */
export async function applyAllowanceMove(
  tx: DbClient,
  accountId: string,
  publicKey: string,
  token: string,
  move: AllowanceMove,
  amount: bigint,
): Promise<void> {
  const key = await lockKey(tx, accountId, publicKey);
  if (key.revoked) throw new NearException('NEAR_KEY_REVOKED');
  const current = await lockAllowance(tx, accountId, publicKey, token);
  const next = nextAllowance(current ?? ZERO_ALLOWANCE, move, amount);
  if (!current || (next.reserved === current.reserved && next.spent === current.spent)) return;
  await tx.mockChainAgentAllowance.update({
    where: { accountId_publicKey_token: { accountId, publicKey, token } },
    data: { reserved: next.reserved.toString(), spent: next.spent.toString() },
  });
}

export async function loadKeyStatus(db: DbClient, accountId: string, publicKey: string): Promise<KeyStatus> {
  const key = await db.mockChainAgentKey.findUnique({ where: { accountId_publicKey: { accountId, publicKey } } });
  if (!key)
    throw new NearException('NEAR_ACCOUNT_NOT_FOUND', { message: `No limited key ${publicKey} on ${accountId}` });
  const rows = await db.mockChainAgentAllowance.findMany({
    where: { accountId, publicKey },
    orderBy: { token: 'asc' },
  });
  return {
    accountId,
    publicKey,
    revoked: key.revoked,
    receiverId: key.receiverId,
    methodNames: asMethodNames(key.methodNames),
    tokens: rows.map((row) => toAllowanceView(row.token, totalsOf(row))),
    gasAllowance: key.gasAllowance.toFixed(0),
    gasSpent: key.gasSpent.toFixed(0),
  };
}

async function ensureChainAccount(tx: DbClient, accountId: string, kind: string): Promise<void> {
  await tx.mockChainAccount.upsert({ where: { accountId }, create: { accountId, kind }, update: {} });
}

/** `FOR UPDATE` on the key row so reserve and revoke cannot pass each other. */
async function lockKey(tx: DbClient, accountId: string, publicKey: string): Promise<{ revoked: boolean }> {
  const rows = await tx.$queryRaw<Array<{ revoked: boolean }>>`
    SELECT revoked FROM chain.mock_chain_agent_key
    WHERE account_id = ${accountId} AND public_key = ${publicKey}
    FOR UPDATE`;
  const row = rows[0];
  if (!row)
    throw new NearException('NEAR_ACCOUNT_NOT_FOUND', { message: `No limited key ${publicKey} on ${accountId}` });
  return { revoked: row.revoked === true };
}

async function lockAllowance(
  tx: DbClient,
  accountId: string,
  publicKey: string,
  token: string,
): Promise<AllowanceTotals | null> {
  const rows = await tx.$queryRaw<Array<{ allowance: unknown; reserved: unknown; spent: unknown }>>`
    SELECT allowance, reserved, spent FROM chain.mock_chain_agent_allowance
    WHERE account_id = ${accountId} AND public_key = ${publicKey} AND token = ${token}
    FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  return {
    allowance: decimalToBigInt(row.allowance),
    reserved: decimalToBigInt(row.reserved),
    spent: decimalToBigInt(row.spent),
  };
}

function totalsOf(row: {
  allowance: { toFixed(n?: number): string };
  reserved: { toFixed(n?: number): string };
  spent: { toFixed(n?: number): string };
}): AllowanceTotals {
  return {
    allowance: BigInt(row.allowance.toFixed(0)),
    reserved: BigInt(row.reserved.toFixed(0)),
    spent: BigInt(row.spent.toFixed(0)),
  };
}

function asMethodNames(value: unknown): readonly string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  throw new NearException('NEAR_UNAVAILABLE', { message: 'Limited key method names are not a string list' });
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}
