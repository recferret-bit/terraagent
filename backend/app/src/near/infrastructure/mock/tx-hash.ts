import { createHash } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const MOCK_HASH_PREFIX = 'mock:';
const BODY_LEN = 44;

const encode = (bytes: Uint8Array): string => Array.from(bytes.subarray(0, BODY_LEN), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** Same `opId` always yields the same hash (retries are idempotent). */
export function mockTxHashFor(opId: string): string {
  const bytes = createHash('sha512').update(`mock-tx:${opId}`).digest();
  return MOCK_HASH_PREFIX + encode(bytes);
}

/** `mock:` + 44 base58 characters drawn from `random` ([0,1) source). */
export function randomMockTxHash(random: () => number): string {
  const bytes = Uint8Array.from({ length: BODY_LEN }, () => Math.floor(random() * 256));
  return MOCK_HASH_PREFIX + encode(bytes);
}

export const MOCK_HASH_RE = /^mock:[1-9A-HJ-NP-Za-km-z]{44}$/;
