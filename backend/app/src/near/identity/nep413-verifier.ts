import { createHash, sign as edSign, type KeyObject } from 'node:crypto';
import type { Nep413Signature } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PublicKey } from 'near-api-js';
import { NearException } from '../domain/errors.js';
import type { NearNetwork } from '../domain/types.js';
import { NEP413_TAG } from '../intents/nep413-token-diff.js';
import { decodeBase58, encodeBase58 } from '../keystore/base58.js';

const NONCE_TTL_MS = 5 * 60_000;
const MAX_NONCES = 4096;
const MAINNET_NAMED_TLD_RE = /\.(near|tg|sweat)$/i;
const usedNonces = new Map<string, number>();

export function clearNep413ReplayCache(): void {
  usedNonces.clear();
}

export async function consumeNep413NoncePersistent(
  prisma: PrismaClient | null | undefined,
  signature: Pick<Nep413Signature, 'accountId' | 'nonce'>,
  purpose: string,
): Promise<void> {
  if (!prisma?.nep413UsedNonce) return;
  const nonceBytes = decodeNep413Nonce(signature.nonce);
  const nonceKey = `${purpose}:${signature.accountId.trim().toLowerCase()}:${nonceBytes.toString('base64')}`;
  try {
    await prisma.nep413UsedNonce.create({
      data: {
        nonceKey: nonceKey.slice(0, 160),
        accountId: signature.accountId.trim().toLowerCase().slice(0, 64),
        purpose: purpose.slice(0, 64),
      },
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === 'P2002' || msg.includes('Unique constraint')) {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        status: 401,
        message: 'NEP-413 claim nonce has already been used',
      });
    }
    throw err;
  }
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

function decodeNep413SignatureBytes(raw: string, isSecp256k1: boolean): Uint8Array {
  const trimmed = raw.trim();
  let bytes: Buffer;
  if (trimmed.startsWith('ed25519:') || trimmed.startsWith('secp256k1:')) {
    const body = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    if (!body) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Empty prefixed NEP-413 signature' });
    }
    bytes = Buffer.from(decodeBase58(body));
  } else {
    bytes = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }
  const validLen = isSecp256k1 ? bytes.length === 65 : bytes.length === 64;
  if (!validLen) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: isSecp256k1
        ? 'NEP-413 secp256k1 signature must be 65 bytes'
        : 'NEP-413 ed25519 signature must be 64 bytes',
    });
  }
  return new Uint8Array(bytes);
}

export function validateCallbackUrlCandidates(raw?: string): readonly (string | undefined)[] {
  if (!raw) return [undefined];
  const trimmed = raw.trim();
  if (!trimmed) return [undefined];
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

export function recordNep413Nonce(
  signature: Pick<Nep413Signature, 'accountId' | 'nonce'>,
  nowMs = Date.now(),
): void {
  const nonceBytes = decodeNep413Nonce(signature.nonce);
  const nonceKey = `${signature.accountId.trim().toLowerCase()}:${nonceBytes.toString('base64')}`;
  pruneExpiredNonces(nowMs);
  if (usedNonces.has(nonceKey)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      status: 401,
      message: 'NEP-413 claim nonce has already been used',
    });
  }
  usedNonces.set(nonceKey, nowMs + NONCE_TTL_MS);
}

/**
 * Cryptographically verifies a NEP-413 `SignedMessage` (`tag = 2147484061`), checks recipient & network
 * alignment, and enforces single-use nonce replay protection (`5m` TTL).
 */
export function verifyNep413ClaimSignature(params: {
  readonly signature: Nep413Signature;
  readonly expectedWalletAccountId: string;
  readonly expectedPublicKey?: string;
  readonly expectedMessagePrefix?: string;
  readonly allowedRecipients: readonly string[];
  readonly network: Exclude<NearNetwork, 'mock'>;
  readonly nowMs?: number;
  readonly recordNonce?: boolean;
}): void {
  const { signature } = params;
  const nowMs = params.nowMs ?? Date.now();

  if (
    params.expectedMessagePrefix &&
    !signature.message.trim().startsWith(params.expectedMessagePrefix)
  ) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      status: 401,
      message: `NEP-413 message must start with "${params.expectedMessagePrefix}"`,
    });
  }

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
  const nonceKey = `${signature.accountId.trim().toLowerCase()}:${nonceBytes.toString('base64')}`;
  pruneExpiredNonces(nowMs);
  if (usedNonces.has(nonceKey)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      status: 401,
      message: 'NEP-413 claim nonce has already been used',
    });
  }

  const callbackUrlCandidates = validateCallbackUrlCandidates(signature.callbackUrl);
  let verified = false;
  try {
    const pubKeyStr = signature.publicKey.trim();
    const pub = PublicKey.fromString(pubKeyStr);
    const isSecp256k1 = pubKeyStr.startsWith('secp256k1:');
    const sigBytes = decodeNep413SignatureBytes(signature.signature, isSecp256k1);
    for (const candidateUrl of callbackUrlCandidates) {
      const digest = computeNep413Hash({
        message: signature.message,
        nonce: nonceBytes,
        recipient: signature.recipient,
        callbackUrl: candidateUrl,
      });
      if (pub.verify(new Uint8Array(digest), sigBytes)) {
        verified = true;
        break;
      }
    }
  } catch (err) {
    if (err instanceof NearException) throw err;
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'NEP-413 signature verification failed',
    });
  }
  if (!verified) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'Invalid NEP-413 signature',
    });
  }

  if (params.recordNonce !== false) {
    usedNonces.set(nonceKey, nowMs + NONCE_TTL_MS);
  }
}
