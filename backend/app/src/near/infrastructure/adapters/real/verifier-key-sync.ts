import { Logger } from '@nestjs/common';
import type { ChainReceipt } from '../../../domain/types.js';
import type { NearNetworkConfig } from '../../network/near-network.config.js';
import { IntentsRpcError, classifyIntentsRpcFailure } from './intents-rpc-error.js';

/** The slice of `NearRpcClient` the verifier sync needs (tests inject a fake). */
export interface VerifierRpc {
  readonly config: Pick<NearNetworkConfig, 'contracts' | 'accounts' | 'secrets'>;
  view<T>(contractId: string, methodName: string, args?: Record<string, unknown>): Promise<T>;
  call(params: {
    signerAccountId: string;
    signerSecretKey: string;
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
    gasTgas?: number;
  }): Promise<{ receipt: ChainReceipt }>;
}

export type VerifierKeyRole = 'pilot' | 'session' | 'bot';

export interface VerifierKey {
  readonly accountId: string;
  readonly publicKey: string;
  readonly role: VerifierKeyRole;
}

export interface VerifierKeySyncReport {
  readonly verifierId: string;
  readonly registered: readonly VerifierKey[];
  readonly skipped: readonly VerifierKey[];
  readonly failed: readonly { readonly key: VerifierKey; readonly error: IntentsRpcError }[];
  /** True when every requested key is now registered on `verifier.<root>` (already-there or just-registered). */
  readonly allKeysOnchain: boolean;
}

const log = new Logger('VerifierKeySync');

export function verifierTarget(rpc: VerifierRpc): { verifierId: string; operator: string; secret: string } {
  const verifierId = rpc.config.contracts.verifier;
  const secret = rpc.config.secrets.minterSecretKey;
  if (!verifierId || !secret) {
    throw new IntentsRpcError('verifier_not_configured', 'NEAR_CONTRACT_VERIFIER and NEAR_MINTER_SECRET_KEY are both required', {
      operation: 'verifier_target',
    });
  }
  return { verifierId, operator: rpc.config.accounts.minter, secret };
}

function dedupe(keys: readonly VerifierKey[]): VerifierKey[] {
  const seen = new Map<string, VerifierKey>();
  for (const k of keys) seen.set(`${k.accountId}|${k.publicKey}`, k);
  return [...seen.values()];
}

async function isKeyRegistered(rpc: VerifierRpc, verifierId: string, key: VerifierKey): Promise<boolean> {
  try {
    return (await rpc.view<boolean>(verifierId, 'has_public_key', { account_id: key.accountId, public_key: key.publicKey })) === true;
  } catch (err) {
    throw classifyIntentsRpcFailure(err, { operation: 'has_public_key', accountId: key.accountId, publicKey: key.publicKey });
  }
}

/**
 * Idempotently registers pilot / session / bot Ed25519 keys on `verifier.<root>` through the operator-only
 * `register_account_key`. Keys already visible through `has_public_key` are skipped; one failing key never
 * hides the others: the report lists it in `failed` with a typed error and `allKeysOnchain` is false.
 */
export async function syncVerifierKeys(rpc: VerifierRpc, requested: readonly VerifierKey[]): Promise<VerifierKeySyncReport> {
  const { verifierId, secret, operator } = verifierTarget(rpc);
  const registered: VerifierKey[] = [];
  const skipped: VerifierKey[] = [];
  const failed: { key: VerifierKey; error: IntentsRpcError }[] = [];
  for (const key of dedupe(requested)) {
    try {
      if (await isKeyRegistered(rpc, verifierId, key)) {
        skipped.push(key);
        continue;
      }
      await rpc.call({
        signerAccountId: operator,
        signerSecretKey: secret,
        contractId: verifierId,
        methodName: 'register_account_key',
        args: { account_id: key.accountId, public_key: key.publicKey },
        gasTgas: 30,
      });
      registered.push(key);
    } catch (err) {
      const error = classifyIntentsRpcFailure(err, { operation: 'register_account_key', accountId: key.accountId, publicKey: key.publicKey });
      log.warn(`${error.message} (${key.role} key of ${key.accountId})`);
      failed.push({ key, error });
    }
  }
  return { verifierId, registered, skipped, failed, allKeysOnchain: failed.length === 0 };
}

/** Throws `key_not_registered` (first failure attached as cause) unless the report says every key is on-chain. */
export function assertAllKeysOnchain(report: VerifierKeySyncReport): void {
  if (report.allKeysOnchain) return;
  const first = report.failed[0];
  throw new IntentsRpcError(
    'key_not_registered',
    `${report.failed.length} key(s) could not be registered on ${report.verifierId}: ${first?.error.message ?? 'unknown'}`,
    { operation: 'sync_verifier_keys', accountId: first?.key.accountId, publicKey: first?.key.publicKey, cause: first?.error },
  );
}
