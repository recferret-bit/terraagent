import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function wasmCodeHashBase58(wasmBytes) {
  const digest = createHash('sha256').update(wasmBytes).digest();
  const digits = [0];
  for (const byte of digest) {
    let carry = byte;
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of digest) {
    if (byte === 0) out += '1';
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]];
  return out;
}

/**
 * Reads a contract wasm. Fails with an actionable message when the file is missing and, when the spec pins a
 * `expectedSha256` (hex), when the bytes do not match it (never deploy an unverified verifier artifact).
 */
export async function loadWasm(spec) {
  const file = path.resolve(spec.wasmPath);
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    throw new Error(
      `Contract wasm for "${spec.key}" not found at ${file}. ` +
        (spec.wasmEnv
          ? `Build it with "npm run near:build-contracts" or point ${spec.wasmEnv} at a pinned build.`
          : 'Build it with "npm run near:build-contracts".'),
      { cause: err },
    );
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (spec.expectedSha256 && actual !== spec.expectedSha256.toLowerCase()) {
    throw new Error(`Contract wasm for "${spec.key}" sha256 mismatch: expected ${spec.expectedSha256}, got ${actual} (${file}).`);
  }
  return bytes;
}
