// AES-256-GCM envelope. Stored `encryptedSecret` is base64(iv 12 || authTag 16 || ciphertext).
// No AAD: `kekVersion` sits beside the envelope so an old row can name the key that sealed it.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function assertAesKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
}

/** Seal `plaintext` under a 32-byte KEK. Output is base64(iv || authTag || ciphertext). */
export function sealSecret(key: Buffer, plaintext: Buffer): string {
  assertAesKey(key);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) throw new Error('AES-GCM auth tag was not 16 bytes');
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Open an envelope produced by `sealSecret`. An authentication failure throws a generic error:
 * the message does not include the envelope or the plaintext.
 */
export function openSecret(key: Buffer, envelope: string): Buffer {
  assertAesKey(key);
  const packed = Buffer.from(envelope, 'base64');
  if (packed.length < IV_LEN + TAG_LEN) throw new Error('KEK envelope is truncated');
  const iv = packed.subarray(0, IV_LEN);
  const tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = packed.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (cause) {
    throw new Error('KEK envelope failed authentication', { cause });
  }
}
