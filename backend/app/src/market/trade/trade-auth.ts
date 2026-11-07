import type { IncomingMessage } from 'node:http';
import { Injectable } from '@nestjs/common';
import type { TradeScope } from '@terra/contracts';
import { TokenBucketLimiter } from '../../core/token-bucket.js';
import { MarketCallers } from '../api/market-caller.js';
import type { MarketColony } from '../orders/market-colonies.js';
import { TradeKeyRepository, type KeyRecord } from './trade-key.repository.js';
import { TradeError } from './trade-error.js';
import { hasScope, isKeyShaped, keyIdOfSecret, secretMatches } from './trade-keys.js';

/** Who calls: an API key (actor `bot`) or a session / dev identity (actor `player`). */
export interface TradePrincipal {
  readonly actorKind: 'player' | 'bot';
  readonly ownerId: string;
  /** `key:<keyId>` or `player:<playerId>`: the scope of idempotency keys and rate limits. */
  readonly ownerRef: string;
  readonly key: KeyRecord | null;
  readonly scopes: readonly TradeScope[];
  /** The caller's colony on a planet (a key has exactly one); null when none. */
  colonyFor(planetId: string): Promise<MarketColony | null>;
}

export const DEFAULT_KEY_RATE = { perSecond: 10, burst: 20 } as const;
export const SESSION_RATE = { perSecond: 20, burst: 40 } as const;
/** All keys of one owner share this bucket on top of their own: minting many keys never multiplies the allowed request rate. */
export const OWNER_KEYS_RATE = { perSecond: 100, burst: 200 } as const;
const ALL_SCOPES: readonly TradeScope[] = ['read', 'trade', 'manage'];
const BEARER_RE = /^Bearer\s+(\S+)$/i;

/** Authenticates trade API calls and applies the per-caller token bucket (`rate_limited`, 429). */
@Injectable()
export class TradeAuth {
  private readonly limiters = new Map<string, TokenBucketLimiter>();
  private ownerLimiter: TokenBucketLimiter | null = null;
  private readonly touched = new Map<string, number>();
  /** Test seam. */
  now: () => number = () => Date.now();

  constructor(private readonly keys: TradeKeyRepository, private readonly callers: MarketCallers) {}

  async authenticate(req: IncomingMessage, asName?: string): Promise<TradePrincipal> {
    const header = req.headers?.authorization;
    const raw = (Array.isArray(header) ? header[0] : header)?.trim();
    const token = raw ? BEARER_RE.exec(raw)?.[1] : undefined;
    const principal = token && isKeyShaped(token) ? await this.byKey(token) : await this.bySession(req, asName);
    this.limit(principal);
    return principal;
  }

  /** Throws `forbidden_scope` unless the principal holds `scope` (sessions hold every scope). */
  static require(p: TradePrincipal, scope: TradeScope): void {
    if (!hasScope(p.scopes, scope)) throw new TradeError('forbidden_scope', `This key lacks the "${scope}" scope.`, { scope });
  }

  private async byKey(secret: string): Promise<TradePrincipal> {
    const keyId = keyIdOfSecret(secret);
    const key = keyId ? await this.keys.find(keyId) : null;
    if (!key || !secretMatches(secret, key.secretHash)) throw new TradeError('unauthorized', 'Unknown API key.');
    if (key.revokedAt) throw new TradeError('key_revoked', 'This API key was revoked.');
    this.touch(key.keyId);
    const colony: MarketColony = { colonyId: key.colonyId, colonyIndex: key.colonyIndex, accountId: key.accountId };
    return { actorKind: 'bot', ownerId: key.ownerId, ownerRef: `key:${key.keyId}`, key, scopes: key.scopes, colonyFor: async (planetId) => (planetId === key.planetId ? colony : null) };
  }

  private async bySession(req: IncomingMessage, asName?: string): Promise<TradePrincipal> {
    const playerId = this.callers.playerOf(req, asName);
    if (!playerId) throw new TradeError('unauthorized', 'Sign in (or pass an API key as a bearer token).');
    return { actorKind: 'player', ownerId: playerId, ownerRef: `player:${playerId}`, key: null, scopes: ALL_SCOPES, colonyFor: (planetId) => this.callers.colonyOf(playerId, planetId) };
  }

  private limit(p: TradePrincipal): void {
    const rate = p.key ? { perSecond: p.key.ratePerSecond ?? DEFAULT_KEY_RATE.perSecond, burst: p.key.rateBurst ?? DEFAULT_KEY_RATE.burst } : SESSION_RATE;
    const id = `${rate.perSecond}/${rate.burst}`;
    let limiter = this.limiters.get(id);
    if (!limiter) this.limiters.set(id, (limiter = new TokenBucketLimiter({ ...rate, now: () => this.now() })));
    this.ownerLimiter ??= new TokenBucketLimiter({ ...OWNER_KEYS_RATE, now: () => this.now() });
    if (p.key && !this.ownerLimiter.take(`owner:${p.ownerId}`)) throw new TradeError('rate_limited', `More than ${OWNER_KEYS_RATE.perSecond} requests per second across the keys of one owner.`, { ...OWNER_KEYS_RATE });
    if (!limiter.take(p.ownerRef)) throw new TradeError('rate_limited', `More than ${rate.perSecond} requests per second.`, { perSecond: rate.perSecond, burst: rate.burst });
  }

  /** `lastUsedAt` is written at most once a minute per key. */
  private touch(keyId: string): void {
    const at = this.now();
    if (at - (this.touched.get(keyId) ?? 0) < 60_000) return;
    this.touched.set(keyId, at);
    void this.keys.touch(keyId).catch(() => undefined);
  }
}
