import { randomBytes, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeBase58, encodeBase58 } from '../../src/near/keystore/base58';
import { DEV_KEK, DEV_KEK_VERSION, KekRing, loadKekRing, UnknownKekVersionError } from '../../src/near/keystore/kek';
import { ed25519PrivateKeyFromSeed, ed25519PublicKeyFromNear, KeyStore } from '../../src/near/keystore/keys';

const BASE58_VECTORS: readonly [string, string][] = [
  ['', ''],
  ['61', '2g'],
  ['626262', 'a3gV'],
  ['00000000000000000000', '1111111111'],
];

describe('colony key store', () => {
  it('generate then open returns the same seed and the signature verifies', () => {
    for (const [hex, encoded] of BASE58_VECTORS) {
      const bytes = Buffer.from(hex, 'hex');
      expect(encodeBase58(bytes)).toBe(encoded);
      expect(Buffer.compare(decodeBase58(encoded), bytes)).toBe(0);
    }
    const leadingZero = Buffer.concat([Buffer.from([0, 0]), randomBytes(30)]);
    expect(Buffer.compare(decodeBase58(encodeBase58(leadingZero)), leadingZero)).toBe(0);
    expect(() => decodeBase58('0OIl')).toThrow(/base58/);

    const store = new KeyStore(new KekRing(1, [[1, randomBytes(32)]]));
    const { seed, row } = store.generate();
    const opened = store.open(row);
    expect(opened.equals(seed)).toBe(true);
    const message = Buffer.from([0x5a]);
    const signature = sign(null, message, ed25519PrivateKeyFromSeed(opened));
    const publicKey = ed25519PublicKeyFromNear(row.publicKey);
    expect(verify(null, message, publicKey, signature)).toBe(true);
    const flipped = Buffer.from(signature);
    flipped[0] ^= 0xff;
    expect(verify(null, message, publicKey, flipped)).toBe(false);
  });

  it('opens a version-1 row after the current KEK becomes version 2', () => {
    const v1 = randomBytes(32);
    const v2 = randomBytes(32);
    const original = new KeyStore(new KekRing(1, [[1, v1]]));
    const { seed, row } = original.generate();
    expect(row.kekVersion).toBe(1);
    const rotated = new KeyStore(
      new KekRing(2, [
        [1, v1],
        [2, v2],
      ]),
    );
    expect(rotated.open(row).equals(seed)).toBe(true);
    const fresh = rotated.generate();
    expect(fresh.row.kekVersion).toBe(2);
    expect(rotated.open(fresh.row).equals(fresh.seed)).toBe(true);
    expect(() => original.open(fresh.row)).toThrow(UnknownKekVersionError);
    expect(() => rotated.open({ ...row, kekVersion: 9 })).toThrow(UnknownKekVersionError);
    try {
      rotated.open({ ...row, kekVersion: 9 });
    } catch (error) {
      const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
      expect(text).not.toContain(seed.toString('hex'));
      expect(text).not.toContain(seed.toString('base64'));
      expect(text).not.toContain(row.encryptedSecret);
    }
  });

  it('does not store the seed as hex or base64', () => {
    const store = new KeyStore(new KekRing(1, [[1, randomBytes(32)]]));
    const { seed, row } = store.generate();
    const dumped = JSON.stringify(row);
    expect(Object.keys(row).sort()).toEqual(['encryptedSecret', 'kekVersion', 'publicKey']);
    expect(dumped).not.toContain(seed.toString('hex'));
    expect(dumped).not.toContain(seed.toString('base64'));
    expect(dumped).not.toContain(seed.toString('base64url'));
  });

  it('loadKekRing refuses a missing or dev KEK in production and accepts a real 32-byte key', () => {
    expect(() => loadKekRing({ NODE_ENV: 'production' })).toThrow(/NEAR_KEK/);
    expect(() => loadKekRing({ NODE_ENV: 'production', NEAR_KEK: '' })).toThrow(/NEAR_KEK/);
    expect(() => loadKekRing({ NODE_ENV: 'production', NEAR_KEK: DEV_KEK.toString('base64') })).toThrow(/DEV_KEK/);
    const key = randomBytes(32);
    const older = randomBytes(32);
    const ring = loadKekRing({
      NODE_ENV: 'production',
      NEAR_KEK: key.toString('base64'),
      NEAR_KEK_VERSION: '2',
      NEAR_KEK_RING: JSON.stringify({ 1: older.toString('base64') }),
    });
    expect(ring.currentVersion).toBe(2);
    expect(ring.keyFor(2)?.equals(key)).toBe(true);
    expect(ring.keyFor(1)?.equals(older)).toBe(true);
    const dev = loadKekRing({});
    expect(dev.currentVersion).toBe(DEV_KEK_VERSION);
    expect(DEV_KEK.length).toBe(32);
    expect(dev.keyFor(DEV_KEK_VERSION)?.equals(DEV_KEK)).toBe(true);
    const devWithOld = loadKekRing({ NEAR_KEK_RING: JSON.stringify({ 2: older.toString('base64') }) });
    expect(devWithOld.currentVersion).toBe(DEV_KEK_VERSION);
    expect(devWithOld.keyFor(1)?.equals(DEV_KEK)).toBe(true);
    expect(devWithOld.keyFor(2)?.equals(older)).toBe(true);
  });
});
