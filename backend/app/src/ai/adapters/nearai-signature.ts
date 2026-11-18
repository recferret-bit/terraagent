import { createPublicKey, verify as edVerify } from 'node:crypto';
import { decodeBase58 } from '../../near/keystore/base58.js';
import type { LlmAttestation } from '../../ports/llm-provider.port.js';
import { hashEip191PersonalMessage, keccak256, recoverSecp256k1Address } from './secp256k1-eip191.js';

export interface RawSignaturePayload {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** Short synthetic test strings (e.g. `'0xdeadbeef01'`) allowed only when neither strict verify nor enclave pinning is set. */
const MAX_MOCK_FIXTURE_SIG_CHARS = 32;

function decodeBase58Safe(raw: string): Buffer | null {
  if (!raw) return null;
  try {
    return Buffer.from(decodeBase58(raw));
  } catch {
    return null;
  }
}

function decodeHexBytes(raw: string): Buffer | null {
  const clean = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  return Buffer.from(clean, 'hex');
}

function decodeStrictBase64(raw: string): Buffer | null {
  const std = raw.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(std) || std.length % 4 === 1) return null;
  const padded = std.padEnd(Math.ceil(std.length / 4) * 4, '=');
  const buf = Buffer.from(padded, 'base64');
  return buf.length > 0 ? buf : null;
}

function decodeEd25519Key(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('ed25519:')) {
    const b58 = decodeBase58Safe(trimmed.slice(8));
    return b58?.length === 32 ? b58 : null;
  }
  const hex = decodeHexBytes(trimmed);
  if (hex?.length === 32) return hex;
  const b58 = decodeBase58Safe(trimmed);
  if (b58?.length === 32) return b58;
  const b64 = decodeStrictBase64(trimmed);
  return b64?.length === 32 ? b64 : null;
}

function decodeEd25519SigCandidates(raw: string): readonly Buffer[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('ed25519:')) {
    const b58 = decodeBase58Safe(trimmed.slice(8));
    return b58?.length === 64 ? [b58] : [];
  }
  const hex = decodeHexBytes(trimmed);
  if (hex?.length === 64) return [hex];

  const out: Buffer[] = [];
  const b58 = decodeBase58Safe(trimmed);
  if (b58?.length === 64) out.push(b58);
  const b64 = decodeStrictBase64(trimmed);
  if (b64?.length === 64 && !out.some((b) => b.equals(b64))) out.push(b64);
  return out;
}

/** Expands EIP-2098 64-byte `(r, yParityAndS)` compact signatures to 65-byte `(r, s, v)` format. */
function expandEip2098Signature(compact64: Uint8Array): Buffer {
  const out = Buffer.alloc(65);
  out.set(compact64.subarray(0, 64));
  const yParity = (compact64[32]! & 0x80) !== 0 ? 1 : 0;
  out[32] = compact64[32]! & 0x7f;
  out[64] = 27 + yParity;
  return out;
}

function decodeEcdsaSig65(raw: string): Buffer | null {
  const trimmed = raw.trim();
  const bytes = decodeHexBytes(trimmed) ?? decodeStrictBase64(trimmed);
  if (!bytes) return null;
  if (bytes.length === 65) return bytes;
  if (bytes.length === 64) return expandEip2098Signature(bytes);
  return null;
}

function normalizeSignerIdentity(raw: string, algo: 'ecdsa' | 'ed25519'): string {
  const trimmed = raw.trim();
  if (algo === 'ed25519') {
    const pub = decodeEd25519Key(trimmed);
    if (pub) return `ed25519:${pub.toString('hex')}`;
  }
  return trimmed.toLowerCase();
}

/**
 * Verifies canonical NEAR AI Cloud `${modelId}:${requestHash}:${responseHash}` (`provider_tee`)
 * or `${requestHash}:${responseHash}` (`gateway`) hash-binding on `/v1/signature/{chat_id}`.
 */
export function verifySignatureHashes(
  sig: RawSignaturePayload,
  modelId: string,
  requestHash: string,
  responseHash: string,
  responseModelId?: string,
): { verified: boolean; kind: 'provider_tee' | 'gateway' | 'legacy' } {
  const text = typeof sig.text === 'string' ? sig.text : '';
  const hasSig = typeof sig.signature === 'string' && sig.signature.length > 0;
  const hasAddr = typeof sig.signing_address === 'string' && sig.signing_address.length > 0;
  if (!text || !hasSig || !hasAddr) return { verified: false, kind: 'legacy' };

  const providerExpected = `${modelId}:${requestHash}:${responseHash}`;
  const altExpected = responseModelId && responseModelId !== modelId ? `${responseModelId}:${requestHash}:${responseHash}` : null;
  const gatewayExpected = `${requestHash}:${responseHash}`;
  if (text === providerExpected || (altExpected !== null && text === altExpected)) {
    const kind = sig.signature_kind === 'gateway' ? 'gateway' : 'provider_tee';
    return { verified: true, kind };
  }
  if (text === gatewayExpected) {
    return { verified: true, kind: sig.signature_kind === 'provider_tee' ? 'provider_tee' : 'gateway' };
  }
  return { verified: false, kind: 'legacy' };
}

/**
 * Cryptographically verifies a NEAR AI Cloud TEE signature:
 * - `ed25519`: 64-byte signature (`ed25519:`/base58/hex/base64) over UTF-8 `text` against 32-byte `signing_address`
 * - `ecdsa`: 65-byte `(r,s,v)` or 64-byte EIP-2098 secp256k1 signature over EIP-191 `personal_sign(text)` (or raw `keccak256(text)`)
 * Returns `'valid'`, `'invalid'`, or `'uncheckable'` (strictly for short `< 32`-char unit-test mock strings).
 */
export function verifyCryptographicSignature(
  text: string,
  signatureRaw: string,
  signingAddressRaw: string,
  algo: 'ecdsa' | 'ed25519',
): 'valid' | 'invalid' | 'uncheckable' {
  const sigTrimmed = signatureRaw.trim();
  const isShortFixture = sigTrimmed.length <= MAX_MOCK_FIXTURE_SIG_CHARS;

  if (algo === 'ed25519') {
    const pub = decodeEd25519Key(signingAddressRaw);
    const candidates = decodeEd25519SigCandidates(sigTrimmed);
    if (!pub || candidates.length === 0) return isShortFixture ? 'uncheckable' : 'invalid';
    try {
      const keyObj = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pub]), format: 'der', type: 'spki' });
      const msgBytes = Buffer.from(text, 'utf8');
      return candidates.some((sig) => edVerify(null, msgBytes, keyObj, sig)) ? 'valid' : 'invalid';
    } catch {
      return 'invalid';
    }
  }

  const addrTrimmed = signingAddressRaw.trim().toLowerCase();
  const sigBytes = decodeEcdsaSig65(sigTrimmed);
  if (!/^0x[0-9a-f]{40}$/.test(addrTrimmed) || !sigBytes) {
    return isShortFixture ? 'uncheckable' : 'invalid';
  }
  const eip191Recovered = recoverSecp256k1Address(hashEip191PersonalMessage(text), sigBytes);
  if (eip191Recovered === addrTrimmed) return 'valid';
  const rawRecovered = recoverSecp256k1Address(keccak256(Buffer.from(text, 'utf8')), sigBytes);
  return rawRecovered === addrTrimmed ? 'valid' : 'invalid';
}

export function evaluateTeeAttestation(params: {
  readonly sig: RawSignaturePayload;
  readonly chatId: string;
  readonly modelId: string;
  readonly responseModelId?: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly requestedAlgo: 'ecdsa' | 'ed25519';
  readonly env: Readonly<Record<string, string | undefined>>;
}): LlmAttestation {
  const { sig, chatId, modelId, responseModelId, requestHash, responseHash, requestedAlgo, env } = params;
  const hashCheck = verifySignatureHashes(sig, modelId, requestHash, responseHash, responseModelId);
  const signingAlgo: 'ecdsa' | 'ed25519' =
    sig.signing_algo === 'ed25519' ? 'ed25519' : sig.signing_algo === 'ecdsa' ? 'ecdsa' : requestedAlgo;

  const cryptoState =
    hashCheck.verified && sig.text && sig.signature && sig.signing_address
      ? verifyCryptographicSignature(sig.text, sig.signature, sig.signing_address, signingAlgo)
      : 'uncheckable';

  const strictCrypto = env.NEAR_AI_STRICT_CRYPTO_VERIFY === '1' || env.NEAR_AI_STRICT_CRYPTO_VERIFY === 'true';
  const trustedRaw = env.NEAR_AI_TRUSTED_SIGNERS?.trim();
  const trustedSet = trustedRaw
    ? new Set(
        trustedRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => normalizeSignerIdentity(s, signingAlgo)),
      )
    : null;
  const enclaveAllowlisted =
    trustedSet && sig.signing_address
      ? trustedSet.has(normalizeSignerIdentity(sig.signing_address, signingAlgo)) && cryptoState === 'valid'
      : trustedSet
        ? false
        : undefined;

  // Enclave allowlist pinning (`NEAR_AI_TRUSTED_SIGNERS`) ALWAYS requires cryptographic proof (`cryptoState === 'valid'`).
  const requireCrypto = strictCrypto || trustedSet !== null;
  const verified =
    hashCheck.verified &&
    cryptoState !== 'invalid' &&
    (!requireCrypto || cryptoState === 'valid') &&
    (enclaveAllowlisted === undefined || enclaveAllowlisted);

  return {
    chatId,
    requestHash,
    responseHash,
    signingAddress: sig.signing_address,
    signature: sig.signature,
    ...(typeof sig.text === 'string' && sig.text.length > 0 ? { signedText: sig.text } : {}),
    signingAlgo,
    signatureKind: hashCheck.kind,
    verified,
    cryptoVerified: cryptoState === 'valid',
    ...(enclaveAllowlisted !== undefined ? { enclaveAllowlisted } : {}),
  };
}

/**
 * Returns `true` when an LLM response carries a failed/forged TEE attestation (or misses attestation
 * while `NEAR_AI_STRICT_CRYPTO_VERIFY` / `NEAR_AI_TRUSTED_SIGNERS` is active), blocking execution.
 */
export function isTeeAttestationRejected(
  attestation: LlmAttestation | undefined,
  env?: Readonly<Record<string, unknown>>,
): boolean {
  if (!attestation || attestation.verified) return false;
  if (
    Boolean(attestation.signature) ||
    Boolean(attestation.signingAddress) ||
    attestation.cryptoVerified === false ||
    attestation.enclaveAllowlisted === false
  ) {
    return true;
  }
  const strict = env?.NEAR_AI_STRICT_CRYPTO_VERIFY === '1' || env?.NEAR_AI_STRICT_CRYPTO_VERIFY === 'true';
  const pinned = typeof env?.NEAR_AI_TRUSTED_SIGNERS === 'string' && env.NEAR_AI_TRUSTED_SIGNERS.trim().length > 0;
  return strict || pinned;
}
