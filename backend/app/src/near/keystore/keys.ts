// Ed25519 keys for player and colony accounts. The persisted object is the Prisma columns only.
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { decodeBase58, encodeBase58 } from './base58.js';
import { openSecret, sealSecret } from './envelope.js';
import { KekRing, UnknownKekVersionError } from './kek.js';

/** SPKI prefix for a raw ed25519 public key (RFC 8410). The key is the last 32 bytes. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** PKCS#8 prefix for an ed25519 seed (RFC 8410). The seed is the last 32 bytes. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Columns the caller inserts into `chain.near_colony_account`. No plaintext seed. */
export interface ColonyKeyRow {
  readonly publicKey: string;
  readonly encryptedSecret: string;
  readonly kekVersion: number;
}

export interface GeneratedColonyKey {
  /** Raw 32-byte ed25519 seed. Persist `row` only; do not write this into the database or a log. */
  readonly seed: Buffer;
  readonly row: ColonyKeyRow;
}

export class KeyStore {
  constructor(private readonly ring: KekRing) {}

  /** New ed25519 key. `row.publicKey` is `ed25519:` + base58 of the SPKI DER's last 32 bytes. The PKCS#8 seed is sealed. */
  generate(): GeneratedColonyKey {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const rawPublic = last32(publicKey.export({ format: 'der', type: 'spki' }));
    const seed = last32(privateKey.export({ format: 'der', type: 'pkcs8' }));
    const kekVersion = this.ring.currentVersion;
    const kek = this.ring.keyFor(kekVersion);
    if (kek === undefined) throw new UnknownKekVersionError(kekVersion);
    return {
      seed,
      row: { publicKey: `ed25519:${encodeBase58(rawPublic)}`, encryptedSecret: sealSecret(kek, seed), kekVersion },
    };
  }

  /** Decrypt `row.encryptedSecret` with the key for `row.kekVersion`. A missing version throws `UnknownKekVersionError`. */
  open(row: ColonyKeyRow): Buffer {
    const kek = this.ring.keyFor(row.kekVersion);
    if (kek === undefined) throw new UnknownKekVersionError(row.kekVersion);
    const seed = openSecret(kek, row.encryptedSecret);
    if (seed.length !== 32) throw new Error('Decrypted colony secret is not a 32-byte seed');
    return seed;
  }
}

/** Rebuild a signing key from the 32-byte seed (`open` / `generate` return that seed). */
export function ed25519PrivateKeyFromSeed(seed: Buffer): KeyObject {
  if (seed.length !== 32) throw new Error('ed25519 seed must be 32 bytes');
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

/** Public key from a stored `ed25519:` + base58 string, for `crypto.verify`. */
export function ed25519PublicKeyFromNear(publicKey: string): KeyObject {
  const prefix = 'ed25519:';
  if (!publicKey.startsWith(prefix)) throw new Error('public key must start with ed25519:');
  const raw = decodeBase58(publicKey.slice(prefix.length));
  if (raw.length !== 32) throw new Error('ed25519 public key must be 32 bytes');
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function last32(der: Buffer): Buffer {
  if (der.length < 32) throw new Error('ed25519 DER is shorter than 32 bytes');
  return Buffer.from(der.subarray(der.length - 32));
}
