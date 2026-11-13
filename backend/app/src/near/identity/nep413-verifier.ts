import { createHash, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import type { Nep413Signature } from '@terra/contracts';
import { NearException } from '../domain/errors.js';
import type { NearNetwork } from '../domain/types.js';
import { NEP413_TAG } from '../intents/nep413-token-diff.js';
import { decodeBase58, encodeBase58 } from '../keystore/base58.js';
import { ed25519PublicKeyFromNear } from '../keystore/keys.js';

const NONCE_TTL_MS = 5 * 60_000;
const MAX_NONCES = 4096;
const MAINNET_NAMED_TLD_RE = /\.(near|tg|sweat)$/i;
const usedNonces = new Map<string, number>();

export function clearNep413ReplayCache(): void {
  usedNonces.clear();
}

function borshStr(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

function borshOptStr(value?: string | null): Buffer {
  if (!value) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), borshStr(value)]);
}

export function decodeNep413Nonce(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 32) return decoded;
  throw new NearException('NEAR_PROVIDER_REJECTED', {
    message: 'NEP-413 nonce must decode to exactly 32 bytes (base64 or 64-char hex)',
  });
}

function decodeNep413SignatureBytes(raw: string): Buffer {
  const trimmed = raw.trim();
  const bytes = trimmed.startsWith('ed25519:')
    ? Buffer.from(decodeBase58(trimmed.slice(8)))
    : Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (bytes.length !== 64) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'NEP-413 ed25519 signature must be 64 bytes',
    });
  }
  return bytes;
}

function validateCallbackUrlCandidates(raw?: string): readonly (string | undefined)[] {
  if (!raw) return [undefined];
  const trimmed = raw.trim();
  let normalized: string;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    normalized = parsed.toString();
  } catch {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'NEP-413 callbackUrl must be a valid HTTP(S) URL',
    });
  }
  return normalized === trimmed ? [trimmed, undefined] : [trimmed, normalized, undefined];
}

/** Computes `sha256(borsh({ tag: 2147484061, message, nonce: [u8;32], recipient, callbackUrl }))`. */
export function computeNep413Hash(params: {
  readonly message: string;
  readonly nonce: Buffer;
  readonly recipient: string;
  readonly callbackUrl?: string | null;
}): Buffer {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const serialized = Buffer.concat([
    tag,
    borshStr(params.message),
    params.nonce,
    borshStr(params.recipient),
    borshOptStr(params.callbackUrl),
  ]);
  return createHash('sha256').update(serialized).digest();
}

/** Signs a canonical NEP-413 message with an ed25519 private key (used by tests & CLI helpers). */
export function signNep413Message(params: {
  readonly accountId: string;
  readonly publicKey: string;
  readonly privateKey: KeyObject;
  readonly message: string;
  readonly nonceBase64: string;
  readonly recipient: string;
  readonly callbackUrl?: string | null;
}): Nep413Signature {
  const nonceBytes = decodeNep413Nonce(params.nonceBase64);
  const digest = computeNep413Hash({
    message: params.message,
    nonce: nonceBytes,
    recipient: params.recipient,
    callbackUrl: params.callbackUrl,
  });
  const sig = edSign(null, digest, params.privateKey);
  return {
    accountId: params.accountId,
    publicKey: params.publicKey,
    signature: `ed25519:${encodeBase58(sig)}`,
    message: params.message,
    nonce: nonceBytes.toString('base64'),
    recipient: params.recipient,
    ...(params.callbackUrl ? { callbackUrl: params.callbackUrl } : {}),
  };
}

function pruneExpiredNonces(nowMs: number): void {
  for (const [key, expiresAt] of usedNonces) {
    if (expiresAt <= nowMs) usedNonces.delete(key);
  }
  while (usedNonces.size >= MAX_NONCES) {
    const oldest = usedNonces.keys().next().value;
    if (!oldest) break;
    usedNonces.delete(oldest);
  }
}

export function assertWalletNetworkMatches(accountId: string, network: Exclude<NearNetwork, 'mock'>): void {
  const lower = accountId.trim().toLowerCase();
  if (lower.endsWith('.mock')) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: `Mock wallet account "${accountId}" cannot claim on ${network}`,
    });
  }
  if (/^[0-9a-f]{64}$/.test(lower)) return;
  if (network === 'mainnet') {
    if (lower.endsWith('.testnet')) {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        message: `Testnet wallet "${accountId}" cannot claim on mainnet`,
      });
    }
    if (!MAINNET_NAMED_TLD_RE.test(lower) && lower !== 'aurora') {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        message: `Invalid NEAR Mainnet account "${accountId}"`,
      });
    }
    return;
  }
  if (MAINNET_NAMED_TLD_RE.test(lower) || lower === 'aurora') {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: `Mainnet wallet "${accountId}" cannot claim on testnet`,
    });
  }
  if (!lower.endsWith('.testnet')) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: `Invalid NEAR Testnet account "${accountId}"`,
    });
  }
}

/**
 * Cryptographically verifies a NEP-413 `SignedMessage` (`tag = 2147484061`), checks recipient & network
 * alignment, and enforces single-use nonce replay protection (`5m` TTL).
 */
export function verifyNep413ClaimSignature(params: {
  readonly signature: Nep413Signature;
  readonly expectedWalletAccountId: string;
  readonly expectedPublicKey?: string;
  readonly allowedRecipients: readonly string[];
  readonly network: Exclude<NearNetwork, 'mock'>;
  readonly nowMs?: number;
}): void {
  const { signature } = params;
  const nowMs = params.nowMs ?? Date.now();

  if (signature.accountId.trim().toLowerCase() !== params.expectedWalletAccountId.trim().toLowerCase()) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'NEP-413 signature accountId does not match walletAccountId',
    });
  }
  if (
    params.expectedPublicKey
    && params.expectedPublicKey !== 'ed25519:mock-wallet-key'
    && signature.publicKey.trim() !== params.expectedPublicKey.trim()
  ) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'NEP-413 signature publicKey does not match requested newPublicKey',
    });
  }

  assertWalletNetworkMatches(signature.accountId, params.network);

  if (!params.allowedRecipients.includes(signature.recipient)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: `NEP-413 recipient "${signature.recipient}" is not an authorized TerraAgent claim target`,
    });
  }

  const nonceBytes = decodeNep413Nonce(signature.nonce);
  const nonceKey = `${signature.accountId.toLowerCase()}:${nonceBytes.toString('base64')}`;
  pruneExpiredNonces(nowMs);
  if (usedNonces.has(nonceKey)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'NEP-413 claim nonce has already been used',
    });
  }

  const callbackUrlCandidates = validateCallbackUrlCandidates(signature.callbackUrl);
  let verified = false;
  try {
    const pub = ed25519PublicKeyFromNear(signature.publicKey);
    const sigBytes = decodeNep413SignatureBytes(signature.signature);
    for (const candidateUrl of callbackUrlCandidates) {
      const digest = computeNep413Hash({
        message: signature.message,
        nonce: nonceBytes,
        recipient: signature.recipient,
        callbackUrl: candidateUrl,
      });
      if (edVerify(null, digest, pub, sigBytes)) {
        verified = true;
        break;
      }
    }
  } catch (err) {
    if (err instanceof NearException) throw err;
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'NEP-413 ed25519 signature verification failed',
    });
  }
  if (!verified) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'Invalid NEP-413 ed25519 signature',
    });
  }

  usedNonces.set(nonceKey, nowMs + NONCE_TTL_MS);
}
