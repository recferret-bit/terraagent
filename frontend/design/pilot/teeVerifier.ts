const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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

export interface TeeAttestationClientInput {
  readonly chatId?: string;
  readonly model?: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly signingAlgo?: string;
  readonly signingAddress?: string | null;
  readonly signature?: string | null;
  readonly cryptoVerified?: boolean;
  readonly verified?: boolean;
}

export interface TeeClientVerificationResult {
  readonly valid: boolean;
  readonly algo: string;
  readonly browserVerified: boolean;
  readonly reason: string;
}

const HEX64_RE = /^(?:0x)?[0-9a-f]{64}$/i;

function decodeSigBytes(raw: string): Uint8Array | null {
  const s = raw.trim().replace(/^ed25519:/i, '');
  if (/^(?:0x)?[0-9a-f]+$/i.test(s) && s.replace(/^0x/i, '').length === 128) {
    const clean = s.replace(/^0x/i, '');
    const out = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  try {
    const decoded = decodeBase58(s);
    if (decoded.length === 64) return decoded;
  } catch {
    // ignore non-base58
  }
  return null;
}

function decodePubBytes(raw: string): Uint8Array | null {
  const s = raw.trim().replace(/^ed25519:/i, '');
  if (/^(?:0x)?[0-9a-f]{64}$/i.test(s)) {
    const clean = s.replace(/^0x/i, '');
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  try {
    const decoded = decodeBase58(s);
    if (decoded.length === 32) return decoded;
  } catch {
    // ignore
  }
  return null;
}

export async function verifyTeeAttestationClient(input: TeeAttestationClientInput): Promise<TeeClientVerificationResult> {
  const reqOk = HEX64_RE.test(input.requestHash.trim());
  const resOk = HEX64_RE.test(input.responseHash.trim());
  const algo = (input.signingAlgo || 'ecdsa').toLowerCase();
  if (!reqOk || !resOk) {
    return { valid: false, algo, browserVerified: false, reason: 'Invalid SHA-256 request/response hash format.' };
  }
  if (algo === 'ed25519' && input.signingAddress && input.signature && globalThis.crypto?.subtle) {
    const pub = decodePubBytes(input.signingAddress);
    const sig = decodeSigBytes(input.signature);
    if (pub && sig) {
      try {
        const key = await globalThis.crypto.subtle.importKey('raw', pub as unknown as BufferSource, { name: 'Ed25519' }, false, ['verify']);
        const msg = new TextEncoder().encode(`${input.requestHash}:${input.responseHash}`);
        const ok = await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, sig as unknown as BufferSource, msg);
        return {
          valid: ok,
          algo: 'ed25519',
          browserVerified: true,
          reason: ok ? 'Verified Ed25519 TEE signature via WebCrypto.' : 'Ed25519 TEE signature mismatch.',
        };
      } catch {
        // Fallback if runtime lacks WebCrypto Ed25519 support
      }
    }
  }
  const serverOk = Boolean(input.cryptoVerified || input.verified);
  return {
    valid: serverOk,
    algo,
    browserVerified: false,
    reason: serverOk
      ? `Validated ${algo.toUpperCase()} hashes + enclave proof from server verifier.`
      : 'TEE signature not yet cryptographically verified.',
  };
}
