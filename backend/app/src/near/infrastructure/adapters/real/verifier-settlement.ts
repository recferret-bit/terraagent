import type { ChainReceipt } from '../../../domain/types.js';
import type { IntentsExecuteInput, SignedIntent } from '../../../application/ports/intents.port.js';
import { IntentsRpcError, classifyIntentsRpcFailure } from './intents-rpc-error.js';
import {
  assertAllKeysOnchain,
  syncVerifierKeys,
  verifierTarget,
  type VerifierKey,
  type VerifierKeyRole,
  type VerifierKeySyncReport,
  type VerifierRpc,
} from './verifier-key-sync.js';

export type VerifierRoleOf = (accountId: string, publicKey: string) => Promise<VerifierKeyRole> | VerifierKeyRole;

/** Sums every delta per (account, token) across the batch: what `strict_balances: true` checks per intent. */
function batchDeltas(intents: readonly SignedIntent[]): Map<string, { accountId: string; tokenId: string; delta: bigint }> {
  const out = new Map<string, { accountId: string; tokenId: string; delta: bigint }>();
  for (const it of intents) {
    for (const [tokenId, raw] of Object.entries(it.diff.deltas)) {
      const k = `${it.diff.accountId}|${tokenId}`;
      const prev = out.get(k);
      out.set(k, { accountId: it.diff.accountId, tokenId, delta: (prev?.delta ?? 0n) + BigInt(raw) });
    }
  }
  return out;
}

/**
 * `strict_balances: true` semantics, checked before anything settles: `balance_of + delta >= 0` for every
 * (account, token) of the batch against the verifier's on-chain balances. Throws a typed
 * `insufficient_onchain_balance` (or the classified RPC failure) and never partially settles.
 */
export async function verifyStrictBalances(rpc: VerifierRpc, intents: readonly SignedIntent[]): Promise<void> {
  const { verifierId } = verifierTarget(rpc);
  for (const { accountId, tokenId, delta } of batchDeltas(intents).values()) {
    if (delta >= 0n) continue;
    let have: bigint;
    try {
      have = BigInt(await rpc.view<string>(verifierId, 'balance_of', { account_id: accountId, token_id: tokenId }));
    } catch (err) {
      throw classifyIntentsRpcFailure(err, { operation: 'balance_of', accountId, tokenId });
    }
    if (have + delta < 0n) {
      throw new IntentsRpcError('insufficient_onchain_balance', `${accountId} holds ${have} ${tokenId} on ${verifierId}, intent needs ${-delta}`, {
        operation: 'verify_strict_balances',
        accountId,
        tokenId,
        required: (-delta).toString(),
        available: have.toString(),
      });
    }
  }
}

/** Syncs the signer keys of a batch (role per key) and returns the report. Throws if any key stays unregistered. */
export async function syncBatchSignerKeys(
  rpc: VerifierRpc,
  intents: readonly SignedIntent[],
  roleOf: VerifierRoleOf,
): Promise<VerifierKeySyncReport> {
  const keys: VerifierKey[] = [];
  for (const it of intents) {
    if (!it.publicKey) {
      throw new IntentsRpcError('key_not_registered', `intent of ${it.diff.accountId} carries no signer public key`, {
        operation: 'sync_batch_signer_keys',
        accountId: it.diff.accountId,
      });
    }
    keys.push({ accountId: it.diff.accountId, publicKey: it.publicKey, role: await roleOf(it.diff.accountId, it.publicKey) });
  }
  const report = await syncVerifierKeys(rpc, keys);
  assertAllKeysOnchain(report);
  return report;
}

/** Pre-settlement gate: all keys on-chain (`all_keys_onchain == true`) and strict on-chain balances cover the batch. */
export async function preflightVerifierSettlement(
  rpc: VerifierRpc,
  intents: readonly SignedIntent[],
  roleOf: VerifierRoleOf,
): Promise<VerifierKeySyncReport> {
  const report = await syncBatchSignerKeys(rpc, intents, roleOf);
  await verifyStrictBalances(rpc, intents);
  return report;
}

/** `execute_intents` on the verifier as the operator; RPC failures surface as typed errors. */
export async function executeOnVerifier(rpc: VerifierRpc, input: IntentsExecuteInput): Promise<ChainReceipt> {
  const { verifierId, operator, secret } = verifierTarget(rpc);
  try {
    const { receipt } = await rpc.call({
      signerAccountId: operator,
      signerSecretKey: secret,
      contractId: verifierId,
      methodName: 'execute_intents',
      args: { op_id: input.opId, intents: input.intents },
      gasTgas: 80,
    });
    return receipt;
  } catch (err) {
    throw classifyIntentsRpcFailure(err, { operation: 'execute_intents' });
  }
}
