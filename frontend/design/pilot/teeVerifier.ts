import { hashEip191MessageBytes, keccak256Bytes, recoverSecp256k1AddressBrowser } from './secp256k1Browser';

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HEX64_RE = /^(?:0x)?[0-9a-f]{64}$/i;
const ETH_ADDR_RE = /^0x[0-9a-f]{40}$/i;

function decodeBase58(input: string): Uint8Array {
  if (!input) return new Uint8Array(0);
  const bytes = [0];
  for (const ch of input) {
    const val = B58_ALPHABET.indexOf(ch);
    if (val < 0) throw new Error('Invalid base58 character');
    let carry = val;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === '1') leadingZeros += 1;
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[out.length - 1 - i] = bytes[i]!;
  return out;
}

function decodeBase64Strict(raw: string): Uint8Array | null {
  const std = raw.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(std) || std.length % 4 === 1 || typeof atob !== 'function') return null;
  const padded = std.padEnd(Math.ceil(std.length / 4) * 4, '=');
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function decodeHexOrEncodedBytes(raw: string, validLengths: readonly number[]): Uint8Array | null {
  const s = raw.trim().replace(/^ed25519:/i, '');
  const cleanHex = s.replace(/^0x/i, '');
  if (/^[0-9a-f]+$/i.test(cleanHex) && cleanHex.length % 2 === 0 && validLengths.includes(cleanHex.length / 2)) {
    const out = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (!s.includes('=') && !s.includes('+') && !s.includes('/')) {
    try {
      const b58 = decodeBase58(s);
      if (validLengths.includes(b58.length)) return b58;
    } catch {
      // fall through to base64
    }
  }
  const b64 = decodeBase64Strict(s);
  return b64 && validLengths.includes(b64.length) ? b64 : null;
}

export interface TeeAttestationClientInput {
  readonly chatId?: string;
  readonly model?: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly signingAlgo?: string;
  readonly signingAddress?: string | null;
  readonly signature?: string | null;
  readonly signatureText?: string | null;
  readonly signatureKind?: string;
  readonly signedText?: string | null;
  readonly cryptoVerified?: boolean;
  readonly verified?: boolean;
}

export interface TeeClientVerificationResult {
  readonly valid: boolean;
  readonly algo: string;
  readonly browserVerified: boolean;
  readonly reason: string;
}

function resolveCandidateMessages(input: TeeAttestationClientInput): string[] | null {
  const req = input.requestHash.trim().toLowerCase();
  const res = input.responseHash.trim().toLowerCase();
  const suffix = `${req}:${res}`;
  const model = input.model?.trim();
  const explicit = (input.signatureText ?? input.signedText ?? '').trim();
  if (explicit) {
    const lower = explicit.toLowerCase();
    if (lower === suffix) return [explicit];
    if (model) {
      return lower === `${model.toLowerCase()}:${suffix}` ? [explicit] : null;
    }
    const prefixLen = lower.length - suffix.length - 1;
    if (prefixLen > 0 && lower.endsWith(`:${suffix}`) && !explicit.slice(0, prefixLen).includes(' ')) {
      return [explicit];
    }
    return null;
  }
  const pair = `${input.requestHash.trim()}:${input.responseHash.trim()}`;
  const candidates: string[] = [];
  if (model) candidates.push(`${model}:${pair}`);
  candidates.push(pair);
  return candidates;
}

async function verifyEd25519InBrowser(pub: Uint8Array, sig: Uint8Array, messages: readonly string[]): Promise<boolean | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const key = await globalThis.crypto.subtle.importKey('raw', pub as unknown as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    const enc = new TextEncoder();
    for (const m of messages) {
      const ok = await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, sig as unknown as BufferSource, enc.encode(m));
      if (ok) return true;
    }
    return false;
  } catch {
    return null;
  }
}

export async function verifyTeeAttestationClient(input: TeeAttestationClientInput): Promise<TeeClientVerificationResult> {
  const reqOk = HEX64_RE.test(input.requestHash.trim());
  const resOk = HEX64_RE.test(input.responseHash.trim());
  const algo = (input.signingAlgo || (ETH_ADDR_RE.test(input.signingAddress?.trim() ?? '') ? 'ecdsa' : 'ed25519')).toLowerCase();
  if (!reqOk || !resOk) {
    return { valid: false, algo, browserVerified: false, reason: 'Invalid SHA-256 request/response hash format.' };
  }
  const messages = resolveCandidateMessages(input);
  if (!messages) {
    return { valid: false, algo, browserVerified: true, reason: 'Signed TEE text does not bind request/response hashes.' };
  }
  if (input.verified === false) {
    return { valid: false, algo, browserVerified: false, reason: 'Rejected by enclave allowlist or server TEE verifier.' };
  }

  if (algo === 'ecdsa' && input.signingAddress && input.signature && ETH_ADDR_RE.test(input.signingAddress.trim())) {
    const sigBytes = decodeHexOrEncodedBytes(input.signature, [64, 65]);
    if (sigBytes) {
      const expected = input.signingAddress.trim().toLowerCase();
      const enc = new TextEncoder();
      const matched = messages.some(
        (m) =>
          recoverSecp256k1AddressBrowser(hashEip191MessageBytes(m), sigBytes) === expected ||
          recoverSecp256k1AddressBrowser(keccak256Bytes(enc.encode(m)), sigBytes) === expected,
      );
      return {
        valid: matched,
        algo: 'ecdsa',
        browserVerified: true,
        reason: matched
          ? 'Verified secp256k1 TEE enclave signature in browser.'
          : 'secp256k1 TEE signature mismatch.',
      };
    }
  }

  if (algo === 'ed25519' && input.signingAddress && input.signature) {
    const pub = decodeHexOrEncodedBytes(input.signingAddress, [32]);
    const sig = decodeHexOrEncodedBytes(input.signature, [64]);
    if (pub && sig) {
      const ok = await verifyEd25519InBrowser(pub, sig, messages);
      if (ok !== null) {
        return {
          valid: ok,
          algo: 'ed25519',
          browserVerified: true,
          reason: ok ? 'Verified Ed25519 TEE signature via WebCrypto.' : 'Ed25519 TEE signature mismatch.',
        };
      }
    }
  }

  const rawSigTrimmed = (input.signature ?? '').trim();
  if (rawSigTrimmed.length > 32) {
    return { valid: false, algo, browserVerified: false, reason: 'Malformed TEE signature or signer encoding.' };
  }

  const serverOk = input.verified !== undefined ? Boolean(input.verified) : Boolean(input.cryptoVerified);
  return {
    valid: serverOk,
    algo,
    browserVerified: false,
    reason: serverOk
      ? `Validated ${algo.toUpperCase()} hashes + enclave proof from server verifier.`
      : 'TEE signature not yet cryptographically verified.',
  };
}
