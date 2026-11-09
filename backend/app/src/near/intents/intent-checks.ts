import type { SignedIntent } from '../application/ports/intents.port.js';
import type { NearErrorCode } from '../domain/errors.js';
import { verifyTokenDiffIntent } from './nep413-token-diff.js';

/** Shared, pure parts of `simulate`/`execute` (mock and in-memory adapters; the real verifier does these on chain). */

/** Registered public key (`ed25519:<b58>`) of a signer, or undefined when unknown. */
export type SignerKeyLookup = (accountId: string) => Promise<string | undefined> | string | undefined;

const INT_RE = /^-?\d+$/;

/**
 * Signature, deadline and per-token zero-sum checks, in that order. The signature is verified against the **registered** key
 * of `diff.accountId` (never the key the intent carries). Returns the first failing code, or null. Nonce and balance checks need state.
 */
export async function checkBatchStatic(intents: readonly SignedIntent[], nowMs: number, keyOf: SignerKeyLookup): Promise<NearErrorCode | null> {
  const keys = new Map<string, string | undefined>();
  for (const it of intents) if (!keys.has(it.diff.accountId)) keys.set(it.diff.accountId, await keyOf(it.diff.accountId));
  return checkBatchSync(intents, nowMs, keys);
}

/** Same checks with the registered keys already resolved (in-memory fake, where lookups are sync). */
export function checkBatchSync(intents: readonly SignedIntent[], nowMs: number, keys: ReadonlyMap<string, string | undefined>): NearErrorCode | null {
  for (const it of intents) {
    const key = keys.get(it.diff.accountId);
    if (key === undefined || !Object.values(it.diff.deltas).every((v) => INT_RE.test(v)) || !verifyTokenDiffIntent(it, key)) return 'NEAR_INTENT_BAD_SIGNATURE';
  }
  if (intents.some((it) => it.deadlineMs <= nowMs)) return 'NEAR_INTENT_EXPIRED';
  const sums = new Map<string, bigint>();
  for (const it of intents) for (const [token, v] of Object.entries(it.diff.deltas)) sums.set(token, (sums.get(token) ?? 0n) + BigInt(v));
  return [...sums.values()].some((n) => n !== 0n) ? 'NEAR_INTENT_DIFF_NOT_ZERO' : null;
}

/** First `(signer, nonce)` repeated inside the batch, as a reuse error. */
export function hasDuplicateNonce(intents: readonly SignedIntent[]): boolean {
  const seen = new Set<string>();
  for (const it of intents) {
    const k = `${it.diff.accountId}\u0000${it.nonce}`;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/** Net signed delta per `[accountId, tokenId]` over the whole batch (zero nets dropped). */
export function netLegs(intents: readonly SignedIntent[]): { accountId: string; tokenId: string; delta: bigint }[] {
  const net = new Map<string, { accountId: string; tokenId: string; delta: bigint }>();
  for (const it of intents) {
    for (const [tokenId, v] of Object.entries(it.diff.deltas)) {
      const k = `${it.diff.accountId}\u0000${tokenId}`;
      const cur = net.get(k) ?? { accountId: it.diff.accountId, tokenId, delta: 0n };
      cur.delta += BigInt(v);
      net.set(k, cur);
    }
  }
  return [...net.values()].filter((l) => l.delta !== 0n);
}
