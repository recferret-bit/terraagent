import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { TRADE_KEY_PREFIX, type TradeAllowance, type TradeScope } from '@terra/contracts';

/** A fresh key: `ta_bot_<keyId>_<24 random bytes>`; only `hash` (SHA-256 hex of the whole secret) is stored. */
export interface NewKey { readonly keyId: string; readonly secret: string; readonly hash: string }

export const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

export function newKey(random: (n: number) => Buffer = randomBytes): NewKey {
  const keyId = `key_${random(8).toString('hex')}`;
  const secret = `${TRADE_KEY_PREFIX}${keyId}_${random(24).toString('base64url')}`;
  return { keyId, secret, hash: hashSecret(secret) };
}

const KEY_RE = new RegExp(`^${TRADE_KEY_PREFIX}(key_[0-9a-f]{16})_[A-Za-z0-9_-]{20,}$`);

/** The key id inside a secret, or null when the string is not shaped like an API key (a session token, junk). */
export function keyIdOfSecret(secret: string): string | null {
  return KEY_RE.exec(secret)?.[1] ?? null;
}

/** Constant-time comparison of a presented secret with the stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const isKeyShaped = (bearer: string): boolean => bearer.startsWith(TRADE_KEY_PREFIX);

export const hasScope = (scopes: readonly string[], need: TradeScope): boolean => scopes.includes(need);

/** USDC has 6 decimals: 100 USDC per order, 1000 USDC per day, 50 % band around the organic reference, 10 open orders. */
export function defaultAllowance(allowedPairs: readonly string[]): TradeAllowance {
  return { maxOpenOrders: 10, maxOrderNotional: '100000000', dailyBudget: '1000000000', allowedPairs: [...allowedPairs], priceBandBp: 5000, killSwitch: false };
}

/** Defaults with the caller's overrides applied (unknown keys are impossible: the contract is strict). */
export const mergeAllowance = (base: TradeAllowance, patch: Partial<TradeAllowance> | undefined): TradeAllowance => ({ ...base, ...(patch ?? {}) });
