// Bitcoin base58 alphabet, no checksum. NEAR keys are `ed25519:` plus this encoding of the raw 32 bytes.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Encode `bytes`. Leading zero bytes become leading `1`s. */
export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] ?? 0) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leading = 0;
  while (leading < bytes.length - 1 && bytes[leading] === 0) leading += 1;
  let body = '';
  for (let q = digits.length - 1; q >= 0; q--) body += ALPHABET[digits[q] ?? 0] ?? '';
  return '1'.repeat(leading) + body;
}

/** Decode `text`. Throws on a character outside the Bitcoin alphabet; the text is not included in the error. */
export function decodeBase58(text: string): Buffer {
  if (text.length === 0) return Buffer.alloc(0);
  const bytes = [0];
  for (const char of text) {
    const value = INDEX.get(char);
    if (value === undefined) throw new Error('Invalid base58 character');
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  while (leading < text.length - 1 && text[leading] === '1') leading += 1;
  const out = Buffer.alloc(leading + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i] ?? 0;
  return out;
}
