import { MARKET_TOKENS, MARKET_TOKEN_KEYS, fromChainUnits, tokenKeyOfVerifierId, type MarketTokenKey } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import { NearException } from '../../../domain/errors.js';

/** Pure DB functions over `chain.mock_chain_intents_balance` (verifier ledger; token ids are verifier ids, amounts chain base units). */

export async function creditVerifier(tx: DbClient, accountId: string, verifierId: string, chainAmount: bigint): Promise<void> {
  await tx.$executeRaw`INSERT INTO chain.mock_chain_intents_balance (account_id, token_id, amount) VALUES (${accountId}, ${verifierId}, ${chainAmount.toString()}::numeric)
    ON CONFLICT (account_id, token_id) DO UPDATE SET amount = chain.mock_chain_intents_balance.amount + EXCLUDED.amount`;
}

/** Subtracts; `NEAR_INSUFFICIENT_BALANCE` (caller's transaction rolls back) when the verifier balance is too low. */
export async function debitVerifier(tx: DbClient, accountId: string, verifierId: string, chainAmount: bigint): Promise<void> {
  const rows = await tx.$executeRaw`UPDATE chain.mock_chain_intents_balance SET amount = amount - ${chainAmount.toString()}::numeric
    WHERE account_id = ${accountId} AND token_id = ${verifierId} AND amount >= ${chainAmount.toString()}::numeric`;
  if (rows === 1) return;
  const have = await verifierChainBalance(tx, accountId, verifierId);
  throw new NearException('NEAR_INSUFFICIENT_BALANCE', {
    message: `${accountId} holds ${have} of ${verifierId} in the verifier, needs ${chainAmount}`,
    details: { accountId, tokenId: verifierId, needed: chainAmount.toString(), available: have.toString() },
  });
}

/** Verifier balance in chain base units (0 when none). */
export async function verifierChainBalance(db: DbClient, accountId: string, verifierId: string): Promise<bigint> {
  const row = await db.mockChainIntentsBalance.findUnique({ where: { accountId_tokenId: { accountId, tokenId: verifierId } } });
  return row ? BigInt(row.amount.toFixed()) : 0n;
}

/** Verifier balance in market atomic units (resources: whole units, fractions floored). Unknown verifier id: 0. */
export async function verifierBalance(db: DbClient, accountId: string, verifierId: string): Promise<bigint> {
  const key = tokenKeyOfVerifierId(verifierId);
  return key === null ? 0n : fromChainUnits(key, await verifierChainBalance(db, accountId, verifierId));
}

/** Every non-zero verifier balance of the account, keyed by market token key, in market atomic units. */
export async function verifierBalances(db: DbClient, accountId: string): Promise<Partial<Record<MarketTokenKey, bigint>>> {
  const rows = await db.mockChainIntentsBalance.findMany({ where: { accountId } });
  const out: Partial<Record<MarketTokenKey, bigint>> = {};
  for (const key of MARKET_TOKEN_KEYS) {
    const row = rows.find((r) => r.tokenId === MARKET_TOKENS[key].verifierId);
    const atomic = row ? fromChainUnits(key, row.amount.toFixed()) : 0n;
    if (atomic > 0n) out[key] = atomic;
  }
  return out;
}
