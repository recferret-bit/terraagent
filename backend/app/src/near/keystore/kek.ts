// KEK ring for colony key envelopes. `NEAR_KEK`, `NEAR_KEK_VERSION` and `NEAR_KEK_RING` are optional on the
// near env section: production boot must not require NEAR_KEK until a caller loads the ring (BE-29).
import { timingSafeEqual } from 'node:crypto';

/**
 * `DEV_KEK` — fixed 32-byte development key-encryption key.
 * UTF-8 of `terraagent-dev-kek-do-not-ship!!`. Not a secret: anyone with this source can open rows sealed under it.
 * `loadKekRing` uses it at `DEV_KEK_VERSION` (1) only when `NEAR_KEK` is unset.
 * When `NODE_ENV=production`, a missing `NEAR_KEK` or one that decodes to these bytes throws.
 */
export const DEV_KEK = Buffer.from('terraagent-dev-kek-do-not-ship!!', 'utf8');
export const DEV_KEK_VERSION = 1;

if (DEV_KEK.length !== 32) throw new Error('DEV_KEK must be 32 bytes');

/** Env fields `loadKekRing` reads. The function does not consult `process.env` itself. */
export interface KekEnv {
  readonly NODE_ENV?: string;
  readonly NEAR_KEK?: string;
  readonly NEAR_KEK_VERSION?: string;
  readonly NEAR_KEK_RING?: string;
}

/** Thrown when a row's `kekVersion` has no key loaded. The message names the version and nothing else. */
export class UnknownKekVersionError extends Error {
  readonly kekVersion: number;

  constructor(kekVersion: number) {
    super(`No key-encryption key for kekVersion ${String(kekVersion)}`);
    this.name = 'UnknownKekVersionError';
    this.kekVersion = kekVersion;
  }
}

/** Keys that can open existing rows, plus the version used to seal new ones. */
export class KekRing {
  readonly currentVersion: number;
  private readonly keys: Map<number, Buffer>;

  constructor(currentVersion: number, keys: Iterable<readonly [number, Buffer]>) {
    this.keys = new Map();
    for (const [version, key] of keys) {
      if (!Number.isInteger(version) || version < 1)
        throw new Error(`KEK version ${String(version)} is not a positive integer`);
      if (key.length !== 32) throw new Error(`KEK version ${String(version)} must be 32 bytes`);
      this.keys.set(version, Buffer.from(key));
    }
    if (!this.keys.has(currentVersion))
      throw new Error(`KEK ring has no key for current version ${String(currentVersion)}`);
    this.currentVersion = currentVersion;
  }

  /** Copy of the key for `version`, so a caller cannot mutate the ring. Undefined when that version was never loaded. */
  keyFor(version: number): Buffer | undefined {
    const key = this.keys.get(version);
    return key === undefined ? undefined : Buffer.from(key);
  }
}

/**
 * Current key is `NEAR_KEK` (standard base64 of 32 bytes) stored at `NEAR_KEK_VERSION` (integer, default 1).
 * `NEAR_KEK_RING` is optional JSON `{"<version>":"<base64>"}` of older keys. The current key overwrites the same version.
 * Unset `NEAR_KEK` selects `DEV_KEK` at version 1. Production refuses a missing current key or one equal to `DEV_KEK`;
 * older ring entries are not compared to `DEV_KEK`, so a rotation can still open rows sealed before the real key.
 */
export function loadKekRing(env: KekEnv): KekRing {
  const production = env.NODE_ENV === 'production';
  const configured = env.NEAR_KEK?.trim() ?? '';
  const keys = parseRing(env.NEAR_KEK_RING);
  if (configured === '') {
    if (production) throw new Error('NEAR_KEK is required when NODE_ENV=production');
    keys.set(DEV_KEK_VERSION, DEV_KEK);
    return new KekRing(DEV_KEK_VERSION, keys);
  }
  const current = decodeKek(configured, 'NEAR_KEK');
  if (production && sameKey(current, DEV_KEK))
    throw new Error('NEAR_KEK must not be the development key DEV_KEK when NODE_ENV=production');
  const version = parseKekVersion(env.NEAR_KEK_VERSION);
  keys.set(version, current);
  return new KekRing(version, keys);
}

function parseKekVersion(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return 1;
  return parseVersion(trimmed, 'NEAR_KEK_VERSION');
}

function parseVersion(raw: string, label: string): number {
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${label} must be a positive integer`);
  const version = Number(raw);
  if (!Number.isSafeInteger(version)) throw new Error(`${label} is out of range`);
  return version;
}

function parseRing(raw: string | undefined): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return keys;
  const parsed = parseRingJson(trimmed);
  for (const [versionText, value] of Object.entries(parsed)) {
    const version = parseVersion(versionText, 'NEAR_KEK_RING version');
    if (typeof value !== 'string') throw new Error(`NEAR_KEK_RING version ${String(version)} must be a base64 string`);
    keys.set(version, decodeKek(value, `NEAR_KEK_RING version ${String(version)}`));
  }
  return keys;
}

function parseRingJson(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('NEAR_KEK_RING must be a JSON object of version to base64 key');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('NEAR_KEK_RING must be a JSON object of version to base64 key');
  }
  return parsed as Record<string, unknown>;
}

/** Standard base64 (not base64url) of exactly 32 bytes. The raw text is never copied into the error. */
function decodeKek(raw: string, label: string): Buffer {
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) throw new Error(`${label} must be standard base64 of 32 bytes`);
  const key = Buffer.from(trimmed, 'base64');
  const canonical = key.toString('base64').replace(/=+$/, '');
  if (key.length !== 32 || trimmed.replace(/=+$/, '') !== canonical)
    throw new Error(`${label} must be standard base64 of 32 bytes`);
  return key;
}

function sameKey(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
