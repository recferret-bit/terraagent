import { createHash, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import { decodeBase58, encodeBase58 } from '../keystore/base58.js';
import { ed25519PublicKeyFromNear } from '../keystore/keys.js';
import type { SignedIntent, TokenDiff } from '../application/ports/intents.port.js';

/**
 * NEP-413 `token_diff` payload builder and verifier for `intents.near` (W13-07). Pure functions: the mock adapter signs with the
 * custodial colony key, the real adapter (W23-22) reuses the same builder.
 *
 * Assumptions (shape of the NEAR Intents `nep413` payload as we know it, to be checked against the live verifier in W23):
 * - `message` is canonical JSON `{"signer_id","deadline","intents":[{"intent":"token_diff","diff":{<verifierTokenId>:"<signed chain-base-unit string>"}}]}`
 *   (fixed key order, diff keys sorted, `deadline` an ISO-8601 UTC string, no whitespace).
 * - `recipient` is `intents.near`; `nonce` is 32 bytes, transported as base64; `callbackUrl` is absent.
 * - The signed bytes follow NEP-413: sha256 of borsh `{ tag: u32 LE 2^31+413, message: string, nonce: [u8;32], recipient: string, callbackUrl: Option<string> }`,
 *   signed with ed25519. Signature text is `ed25519:` + base58.
 */
export const INTENTS_VERIFYING_CONTRACT = 'intents.near';
export const NEP413_TAG = 2 ** 31 + 413;

export interface TokenDiffPayload {
  readonly message: string;
  readonly nonce: string;
  readonly recipient: string;
}

export function canonicalTokenDiffMessage(signerId: string, deltas: Readonly<Record<string, string>>, deadlineMs: number): string {
  const diff: Record<string, string> = {};
  for (const id of Object.keys(deltas).sort()) diff[id] = deltas[id]!;
  return JSON.stringify({
    signer_id: signerId,
    deadline: new Date(deadlineMs).toISOString(),
    intents: [{ intent: 'token_diff', diff }],
  });
}

/** Builds the NEP-413 payload (`message`, base64 `nonce`, `recipient`) of a token diff. */
export function buildTokenDiffPayload(diff: TokenDiff, deadlineMs: number, nonceBase64: string): TokenDiffPayload {
  if (Buffer.from(nonceBase64, 'base64').length !== 32) throw new Error('intent nonce must be 32 bytes (base64)');
  return { message: canonicalTokenDiffMessage(diff.accountId, diff.deltas, deadlineMs), nonce: nonceBase64, recipient: INTENTS_VERIFYING_CONTRACT };
}

const str = (s: string): Buffer => {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

/** The 32 bytes NEP-413 signs: sha256(borsh(tag, message, nonce, recipient, callbackUrl = None)). */
export function nep413SigningHash(payload: TokenDiffPayload): Buffer {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const borsh = Buffer.concat([tag, str(payload.message), Buffer.from(payload.nonce, 'base64'), str(payload.recipient), Buffer.from([0])]);
  return createHash('sha256').update(borsh).digest();
}

/** Signs a token diff with an ed25519 private key; returns the port's `SignedIntent` (plus the signer public key). */
export function signTokenDiffPayload(privateKey: KeyObject, publicKey: string, diff: TokenDiff, deadlineMs: number, nonceBase64: string): SignedIntent {
  const payload = buildTokenDiffPayload(diff, deadlineMs, nonceBase64);
  const signature = edSign(null, nep413SigningHash(payload), privateKey);
  return { diff, signature: `ed25519:${encodeBase58(signature)}`, nonce: nonceBase64, deadlineMs, publicKey };
}

/**
 * True when `signature` is a valid ed25519 signature by `publicKey` (`ed25519:<b58>`; default `intent.publicKey`) over the payload rebuilt from
 * the intent's own diff, deadline and nonce. Any change to an amount, token, signer, deadline or nonce makes it false. Never throws.
 */
export function verifyTokenDiffIntent(intent: SignedIntent, publicKey: string | undefined = intent.publicKey): boolean {
  try {
    if (publicKey === undefined || !intent.signature.startsWith('ed25519:')) return false;
    const payload = buildTokenDiffPayload(intent.diff, intent.deadlineMs, intent.nonce);
    return edVerify(null, nep413SigningHash(payload), ed25519PublicKeyFromNear(publicKey), decodeBase58(intent.signature.slice(8)));
  } catch {
    return false;
  }
}
