import { createHmac, createPublicKey, randomBytes } from 'node:crypto';
import { RESOURCE_KEYS, type AutoTradeLimits } from '@terra/contracts';
import { CoreException } from '../../core/errors/index.js';
import { ed25519PrivateKeyFromSeed, encodeBase58 } from '../keystore/index.js';

const PROCESS_EPHEMERAL_DIRECTOR_KEY_SECRET = randomBytes(32);

function resolveDirectorKeySecret(env?: Readonly<Record<string, unknown>>): Buffer | string {
  const source = (env ?? process.env) as Record<string, string | undefined>;
  const configured =
    source.NEAR_KEK?.trim() ||
    source.JWT_ACCESS_SECRET?.trim() ||
    source.AUTH_JWT_SECRET?.trim();
  if (configured) return configured;
  if (source.NODE_ENV === 'production') {
    throw new CoreException('CONFIG_ERROR', {
      status: 500,
      message: 'NEAR_KEK or JWT_ACCESS_SECRET is required in production to derive director keys',
    });
  }
  return PROCESS_EPHEMERAL_DIRECTOR_KEY_SECRET;
}

/** Gas allowance passed to `addLimitedKey`. No data row names a gas budget, so this stays `0` (BE-73). */
export const DIRECTOR_GAS_ALLOWANCE = '0';
/** The port takes one receiver. The director signs intents (BE-73). */
export const DIRECTOR_RECEIVER = 'intents.near';
export const DIRECTOR_METHODS = ['execute_intents'] as const;

export interface DirectorTokenCap {
  readonly token: string;
  readonly allowance: string;
}

/** `maxPerSession` whole units, one cap per resource key, in `RESOURCE_KEYS` order. */
export function tokenCapsFromLimits(limits: AutoTradeLimits): DirectorTokenCap[] {
  const caps: DirectorTokenCap[] = [];
  for (const key of RESOURCE_KEYS) {
    const row = limits[key];
    if (!row) continue;
    if (!Number.isSafeInteger(row.maxPerSession) || row.maxPerSession < 0) {
      throw new CoreException('INVALID_REQUEST', { status: 400, message: 'maxPerSession must be a whole number of units' });
    }
    caps.push({ token: key, allowance: String(row.maxPerSession) });
  }
  return caps;
}

/** First limited resource in `RESOURCE_KEYS` order. That resource fills the numeric columns (BE-73). */
export function primaryTokenOf(tokens: readonly { token: string }[]): string {
  for (const key of RESOURCE_KEYS) {
    if (tokens.some((row) => row.token === key)) return key;
  }
  return 'metals.t1';
}

export function mirrorAmounts(tokens: readonly { token: string; allowance: string; spent: string }[]): { allowance: string; spent: string } {
  const token = primaryTokenOf(tokens);
  const row = tokens.find((item) => item.token === token);
  return { allowance: row?.allowance ?? '0', spent: row?.spent ?? '0' };
}

/**
 * Caps for a replacement key. The named resource becomes `amount`. Other tokens keep their allowance.
 * Spent is not copied: a new key starts at 0 (the port cannot edit an existing cap).
 */
export function replacedTokenCaps(
  tokens: readonly { token: string; allowance: string }[],
  resource: string,
  amount: number,
): DirectorTokenCap[] {
  let seen = false;
  const caps = tokens.map((row) => {
    if (row.token !== resource) return { token: row.token, allowance: row.allowance };
    seen = true;
    return { token: row.token, allowance: String(amount) };
  });
  if (!seen) caps.push({ token: resource, allowance: String(amount) });
  return caps;
}

/** Derive an HMAC-keyed deterministic NEAR Ed25519 public key (`ed25519:<base58>`) for a colony's director rotation sequence. */
export function deriveDirectorPublicKey(
  colonyId: string,
  seq: number,
  env?: Readonly<Record<string, unknown>>,
): string {
  const safeSeq = Number.isSafeInteger(seq) && seq > 0 ? seq : 1;
  const seed = createHmac('sha256', resolveDirectorKeySecret(env))
    .update(`terra-director-key:v2:${colonyId.toLowerCase()}:${safeSeq}`)
    .digest();
  const priv = ed25519PrivateKeyFromSeed(seed);
  const spki = createPublicKey(priv).export({ format: 'der', type: 'spki' });
  return `ed25519:${encodeBase58(spki.subarray(spki.length - 32))}`;
}

/** Next public key for this colony. A revoked key stays on the mock wallet, so a re-add uses the next deterministic sequence key. */
export function nextDirectorPublicKey(
  colonyId: string,
  previous: string | null,
  env?: Readonly<Record<string, unknown>>,
): string {
  if (!previous) return deriveDirectorPublicKey(colonyId, 1, env);
  const legacyStem = `ed25519:d:${colonyId.toLowerCase()}:`;
  if (previous.startsWith(legacyStem)) {
    const n = Number(previous.slice(legacyStem.length));
    return deriveDirectorPublicKey(colonyId, Number.isSafeInteger(n) && n > 0 ? n + 1 : 1, env);
  }
  for (let seq = 1; seq <= 128; seq += 1) {
    if (deriveDirectorPublicKey(colonyId, seq, env) === previous) {
      return deriveDirectorPublicKey(colonyId, seq + 1, env);
    }
  }
  return deriveDirectorPublicKey(colonyId, 1, env);
}
