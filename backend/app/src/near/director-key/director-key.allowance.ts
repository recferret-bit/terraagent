import { RESOURCE_KEYS, type AutoTradeLimits } from '@terra/contracts';
import { CoreException } from '../../core/errors/index.js';

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

/** Next public key for this colony. A revoked key stays on the mock wallet, so a re-add uses a new suffix. */
export function nextDirectorPublicKey(colonyId: string, previous: string | null): string {
  const stem = `ed25519:d:${colonyId.toLowerCase()}`;
  if (!previous || !previous.startsWith(`${stem}:`)) return `${stem}:1`;
  const n = Number(previous.slice(stem.length + 1));
  const next = Number.isSafeInteger(n) && n > 0 ? n + 1 : 1;
  return `${stem}:${next}`;
}
