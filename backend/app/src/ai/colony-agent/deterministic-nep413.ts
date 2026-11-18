import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import type { SignedIntent, TokenDiff } from '../../near/application/ports/intents.port.js';
import { checkBatchSync, hasDuplicateNonce } from '../../near/intents/intent-checks.js';
import { signTokenDiffPayload } from '../../near/intents/nep413-token-diff.js';
import { encodeBase58 } from '../../near/keystore/base58.js';
import { ed25519PrivateKeyFromSeed } from '../../near/keystore/keys.js';

export interface SignedIntentBatchProof {
  readonly verified: boolean;
  readonly signedIntentCount: number;
  readonly intentBatchHash: string;
  readonly sampleIntent?: {
    readonly signerId: string;
    readonly publicKey: string;
    readonly signature: string;
    readonly nonce: string;
    readonly deltas: Readonly<Record<string, string>>;
  };
}

const signerCache = new Map<string, { privateKey: KeyObject; publicKey: string }>();

function deriveDeterministicSigner(seed: string, accountId: string): { privateKey: KeyObject; publicKey: string } {
  const cacheKey = `${seed}\u0000${accountId}`;
  const hit = signerCache.get(cacheKey);
  if (hit) return hit;

  const seedBytes = createHash('sha256').update(`terra-agent-key:${seed}:${accountId}`).digest();
  const privateKey = ed25519PrivateKeyFromSeed(seedBytes);
  const pubDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKey = `ed25519:${encodeBase58(pubDer.subarray(pubDer.length - 32))}`;
  const entry = { privateKey, publicKey };
  if (signerCache.size > 512) signerCache.clear();
  signerCache.set(cacheKey, entry);
  return entry;
}

/**
 * Deterministically signs a multi-party NEP-413 `token_diff` batch using RFC 8032 Ed25519 over
 * canonical Borsh (`tag = 2^31 + 413`) and verifies all signatures + $\sum \Delta = 0$ conservation
 * via `checkBatchSync` and `!hasDuplicateNonce`.
 */
export function buildVerifiedNep413Batch(params: {
  readonly seed: string;
  readonly batchLabel: string;
  readonly legs: readonly TokenDiff[];
  readonly nowMs?: number;
}): SignedIntentBatchProof {
  const nowMs = params.nowMs ?? 1_763_000_000_000;
  const deadlineMs = nowMs + 15 * 60_000;
  const registeredKeys = new Map<string, string>();
  const intents: SignedIntent[] = [];

  params.legs.forEach((leg, index) => {
    const { privateKey, publicKey } = deriveDeterministicSigner(params.seed, leg.accountId);
    registeredKeys.set(leg.accountId, publicKey);
    const nonce = createHash('sha256')
      .update(`${params.seed}:${params.batchLabel}:${index}:${leg.accountId}`)
      .digest()
      .toString('base64');
    intents.push(signTokenDiffPayload(privateKey, publicKey, leg, deadlineMs, nonce));
  });

  const staticErr = checkBatchSync(intents, nowMs, registeredKeys);
  const verified = intents.length > 0 && staticErr === null && !hasDuplicateNonce(intents);
  const sigDigest = createHash('sha256')
    .update(intents.map((i) => `${i.diff.accountId}:${i.signature}`).join('|'))
    .digest('hex')
    .slice(0, 16);

  const first = intents[0];
  return {
    verified,
    signedIntentCount: intents.length,
    intentBatchHash: `nep413:${sigDigest}`,
    ...(first
      ? {
          sampleIntent: {
            signerId: first.diff.accountId,
            publicKey: first.publicKey ?? '',
            signature: first.signature,
            nonce: first.nonce,
            deltas: first.diff.deltas,
          },
        }
      : {}),
  };
}
