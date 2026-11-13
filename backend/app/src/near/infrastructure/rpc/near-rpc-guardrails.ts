import {
  Account,
  KeyPairSigner,
  PublicKey,
  actions,
  decodeSignedDelegate,
  nearToYocto,
  type JsonRpcProvider,
  type KeyPairString,
} from 'near-api-js';
import { NearException } from '../../domain/errors.js';
import type { ChainReceipt, NearNetwork } from '../../domain/types.js';
import { receiverAllowed } from '../adapters/relayer/relay-rules.js';
import { toNearException } from './near-error-map.js';
import { outcomeToReceipt } from './near-rpc.client.js';

const YOCTO_PER_NEAR = 10n ** 24n;

export interface ValidatedRelayDelegate {
  readonly decoded: ReturnType<typeof decodeSignedDelegate>;
  readonly attachedNear: number;
}

/**
 * Decodes a NEP-366 `SignedDelegate` and enforces production relayer guardrails (`R01-59`):
 * 1. Inner `senderId` and `receiverId` must match the outer `SubmitMetaTxInput` envelope when supplied.
 * 2. Inner `receiverId` must pass `receiverAllowed()`.
 * 3. Every inner action must be a `FunctionCall` (rejects `Transfer`, `DeleteAccount`, `AddKey`, `DeployContract`).
 * 4. Total attached deposit across inner actions must not exceed `maxDepositNear` (`0.05 NEAR` default).
 */
export function validateAndDecodeRelayDelegate(params: {
  readonly signedDelegateBase64: string;
  readonly expectedSenderId?: string;
  readonly expectedReceiverId?: string;
  readonly maxDepositNear: number;
}): ValidatedRelayDelegate {
  let decoded: ReturnType<typeof decodeSignedDelegate>;
  try {
    decoded = decodeSignedDelegate(Buffer.from(params.signedDelegateBase64, 'base64'));
  } catch (err) {
    throw new NearException('NEAR_RELAY_FAILED', {
      message: `Malformed NEP-366 SignedDelegate: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const { senderId, receiverId, actions: innerActions } = decoded.delegateAction;
  if (params.expectedSenderId && senderId !== params.expectedSenderId) {
    throw new NearException('NEAR_RELAY_FAILED', {
      message: `SignedDelegate senderId "${senderId}" does not match signerId "${params.expectedSenderId}"`,
    });
  }
  if (params.expectedReceiverId && receiverId !== params.expectedReceiverId) {
    throw new NearException('NEAR_RELAY_RECEIVER_NOT_ALLOWED', {
      message: `SignedDelegate receiverId "${receiverId}" does not match outer receiverId "${params.expectedReceiverId}"`,
    });
  }
  if (!receiverAllowed(receiverId)) {
    throw new NearException('NEAR_RELAY_RECEIVER_NOT_ALLOWED', {
      message: `SignedDelegate receiver "${receiverId}" is not in the relayer allow-list`,
    });
  }
  if (!innerActions || innerActions.length === 0) {
    throw new NearException('NEAR_RELAY_FAILED', { message: 'SignedDelegate contains no actions' });
  }

  const maxDepositYocto = nearToYocto(params.maxDepositNear.toFixed(6) as `${number}`);
  let totalDepositYocto = 0n;

  for (const act of innerActions) {
    const fc = (act as { functionCall?: { deposit?: bigint } }).functionCall;
    if (!fc) {
      throw new NearException('NEAR_RELAY_RECEIVER_NOT_ALLOWED', {
        message: 'Relayer only sponsors FunctionCall actions in NEP-366 meta-transactions',
      });
    }
    totalDepositYocto += BigInt(fc.deposit ?? 0n);
  }

  if (totalDepositYocto > maxDepositYocto) {
    throw new NearException('NEAR_RELAY_FAILED', {
      message: `Attached deposit exceeds relayer cap (${params.maxDepositNear} NEAR)`,
    });
  }

  const attachedNear = Number(totalDepositYocto) / Number(YOCTO_PER_NEAR);
  return { decoded, attachedNear };
}

/** Verifies at `final` finality that `publicKey` is an active `FullAccess` key on `accountId`. */
export async function verifyFullAccessKeyAtFinality(
  withFailover: <T>(op: (p: JsonRpcProvider) => Promise<T>) => Promise<T>,
  accountId: string,
  publicKey: string,
): Promise<void> {
  try {
    const res = (await withFailover((provider) =>
      provider.query({
        request_type: 'view_access_key',
        finality: 'final',
        account_id: accountId,
        public_key: publicKey,
      }),
    )) as { permission?: unknown };
    if (res.permission !== 'FullAccess') {
      throw new NearException('NEAR_NOT_OWNER', {
        message: `Key ${publicKey} on ${accountId} is not a FullAccess key`,
      });
    }
  } catch (err) {
    if (err instanceof NearException) throw err;
    throw new NearException('NEAR_NOT_OWNER', {
      message: `Public key ${publicKey} was not found as FullAccess on ${accountId}`,
    });
  }
}

/**
 * Atomically promotes a custodial colony/pilot account to self-custody in a single NEAR transaction:
 * 1. Adds `newFullAccessPublicKey` (`FullAccess`)
 * 2. Optionally adds a scoped `FunctionCall` session key (`res.<root>`, 0.01 NEAR gas allowance)
 * 3. Deletes `currentPublicKey` (the server's old custodial `FullAccess` key)
 */
export async function rotateCustodialKeysAtomic(params: {
  readonly withFailover: <T>(op: (p: JsonRpcProvider) => Promise<T>) => Promise<T>;
  readonly network: Exclude<NearNetwork, 'mock'>;
  readonly accountId: string;
  readonly currentSecretKey: string;
  readonly currentPublicKey: string;
  readonly newFullAccessPublicKey: string;
  readonly scopedSessionKey?: {
    readonly publicKey: string;
    readonly receiverId: string;
    readonly methodNames: string[];
  };
}): Promise<ChainReceipt> {
  try {
    const signer = KeyPairSigner.fromSecretKey(params.currentSecretKey as KeyPairString);
    const txActions = [actions.addFullAccessKey(PublicKey.fromString(params.newFullAccessPublicKey))];
    if (params.scopedSessionKey && params.scopedSessionKey.publicKey !== params.newFullAccessPublicKey) {
      txActions.push(
        actions.addFunctionCallAccessKey(
          PublicKey.fromString(params.scopedSessionKey.publicKey),
          params.scopedSessionKey.receiverId,
          params.scopedSessionKey.methodNames,
          nearToYocto('0.01'),
        ),
      );
    }
    if (params.currentPublicKey && params.currentPublicKey !== params.newFullAccessPublicKey) {
      txActions.push(actions.deleteKey(PublicKey.fromString(params.currentPublicKey)));
    }
    const outcome = await params.withFailover(async (provider) => {
      const account = new Account(params.accountId, provider, signer);
      return account.signAndSendTransaction({
        receiverId: params.accountId,
        actions: txActions,
      });
    });
    const status = outcome.status;
    if (typeof status === 'object' && status !== null && 'Failure' in status && status.Failure) {
      throw new Error(`Key rotation failed: ${JSON.stringify(status.Failure)}`);
    }
    return outcomeToReceipt(outcome, params.network);
  } catch (err) {
    throw toNearException(err);
  }
}
