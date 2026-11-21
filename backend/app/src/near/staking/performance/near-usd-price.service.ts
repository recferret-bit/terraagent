import { Inject, Injectable, Optional } from '@nestjs/common';
import { STAKING_RULES, type NearPriceView } from '@terra/contracts';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { nearAdapterFor } from '../../infrastructure/adapter-selection.js';
import type { NearUsdPriceProvider } from '../perks/perks-deps.js';

/** Returns a positive `NEAR/USD` or `null` when the source has none. May throw; the service treats a throw as `null`. */
export type NearUsdFetcher = () => Promise<number | null>;

export const NEAR_PRICE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 4_000;
const ONECLICK_TOKENS_URL = 'https://1click.chaindefuser.com/v0/tokens';

/** Keyless public source: the 1Click token list (`price` field of the native `NEAR` entry). */
export const oneClickNearUsdFetcher: NearUsdFetcher = async () => {
  const res = await fetch(ONECLICK_TOKENS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const list = (await res.json()) as unknown;
  if (!Array.isArray(list)) return null;
  const hit = (list as Array<{ symbol?: unknown; blockchain?: unknown; price?: unknown }>).find(
    (t) => t.symbol === 'NEAR' && (t.blockchain === 'near' || t.blockchain === undefined) && typeof t.price === 'number',
  );
  const price = hit?.price;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
};

export interface NearUsdPriceOptions {
  readonly live: boolean;
  readonly fetcher?: NearUsdFetcher;
  readonly now?: () => number;
  readonly ttlMs?: number;
}

/**
 * Cached `NEAR/USD` (`NearUsdPriceProvider`). Mock mode never calls out and answers `STAKING_RULES.estNearUsd` flagged
 * `est`. Live modes cache for `ttlMs`, share one in-flight fetch, and on failure serve the last good price (stale)
 * flagged `est`, or the table estimate when none was ever read.
 */
export class NearUsdPriceCache implements NearUsdPriceProvider {
  private good: { price: number; atMs: number } | null = null;
  private inflight: Promise<void> | null = null;
  private readonly fetcher: NearUsdFetcher;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly live: boolean;

  constructor(opts: NearUsdPriceOptions) {
    this.live = opts.live;
    this.fetcher = opts.fetcher ?? oneClickNearUsdFetcher;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? NEAR_PRICE_TTL_MS;
  }

  async view(): Promise<NearPriceView> {
    const nowMs = this.now();
    if (!this.live) return { nearUsd: STAKING_RULES.estNearUsd, source: 'est', asOfMs: nowMs };
    if (!this.good || nowMs - this.good.atMs >= this.ttlMs) await this.refresh();
    const good = this.good;
    if (!good) return { nearUsd: STAKING_RULES.estNearUsd, source: 'est', asOfMs: nowMs };
    const fresh = this.now() - good.atMs < this.ttlMs;
    return { nearUsd: good.price, source: fresh ? 'live' : 'est', asOfMs: good.atMs };
  }

  async nearUsd(): Promise<number> {
    return (await this.view()).nearUsd;
  }

  private refresh(): Promise<void> {
    this.inflight ??= this.fetcher()
      .then((p) => {
        if (typeof p === 'number' && Number.isFinite(p) && p > 0) this.good = { price: p, atMs: this.now() };
      })
      .catch(() => undefined)
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}

/** Nest wrapper: picks live vs mock from `NEAR_ADAPTER_STAKING` / `NEAR_MODE`. */
@Injectable()
export class NearUsdPriceService extends NearUsdPriceCache {
  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const bag = (env ?? process.env) as Record<string, string | undefined>;
    super({ live: nearAdapterFor('Staking', bag) !== 'mock' });
  }
}
