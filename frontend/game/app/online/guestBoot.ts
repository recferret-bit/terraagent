import type { DevPlanetType } from '@terra/sim';
import type { SessionTarget } from '../../net/types';
import { bootAuthAndHome, renewAccessToken, type BootAuthResult, type FetchLike, type StorageLike } from './bootOnline';

export interface GuestBootOptions {
  fetch?: FetchLike;
  storage?: StorageLike;
  search: string;
  /** Planet type of a NEW colony (the orbit pick). */
  planetType?: DevPlanetType;
  /** May an unreachable server fall back to a browser-local host (default: dev builds). */
  allowLocalFallback?: boolean;
  /** Splash status line. */
  onStatus?(status: string): void;
  /** A failed boot: show `message` with a Retry button; resolve true to retry, false to give up (session disposed). Absent → the boot rejects. */
  onError?(message: string): Promise<boolean>;
  /** Every boot result (first boot, re-boot on reconnect) is applied to the session here. */
  onBooted(boot: BootAuthResult): void;
  /** Clock of `tokenExpiresAtMs` (the transport's clock; default `Date.now`). */
  now?(): number;
}

/**
 * The W01 guest session target of `WsTransport` (CLIENT §6.1, LB-02): `boot()` runs guest auth + home once (with an
 * error splash + Retry instead of a silent fallback, FA-06); `resolve()` re-uses that planet on every reconnect;
 * `refresh()` renews the access token (refresh cookie, else guest login), which the transport calls before the token
 * expires (then sends `reauth`) and before a reconnect after `4000` / `4003` (FA-01).
 */
export class GuestBootTarget implements SessionTarget {
  accessToken = '';
  tokenExpiresAtMs?: number;
  private current: BootAuthResult | null = null;
  private readonly now: () => number;

  constructor(readonly url: string, private readonly o: GuestBootOptions) {
    this.now = o.now ?? (() => Date.now());
  }

  /** The applied boot result, with the newest token. */
  get result(): BootAuthResult | null { return this.current; }

  /** First boot. Retries after each failure the error splash reports, until it succeeds; null when the splash gave up. */
  async boot(): Promise<BootAuthResult | null> {
    for (;;) {
      try {
        return this.adopt(await bootAuthAndHome(this.authOptions(false)));
      } catch (e) {
        if (!this.o.onError) throw e;
        if (!(await this.o.onError(`Couldn't reach orbit: ${e instanceof Error ? e.message : String(e)}`))) return null;
      }
    }
  }

  async resolve(): Promise<{ planetId: string }> {
    const known = this.current ?? this.adopt(await bootAuthAndHome(this.authOptions(true)));
    return { planetId: known.planet.id };
  }

  async refresh(): Promise<boolean> {
    const cur = this.current;
    if (!cur || cur.mode !== 'online') return false;
    const auth = await renewAccessToken(cur.deviceSecret, this.o.fetch);
    if (!auth) return false;
    this.current = { ...cur, accessToken: auth.accessToken, tokenExpiresInS: auth.expiresIn };
    this.setToken(auth.accessToken, auth.expiresIn);
    return true;
  }

  private authOptions(tryRefresh: boolean) {
    const { fetch, storage, search, planetType, allowLocalFallback, onStatus } = this.o;
    return { fetch, storage, search, planetType, allowLocalFallback, tryRefresh, onStatus };
  }

  private adopt(boot: BootAuthResult): BootAuthResult {
    this.current = boot;
    this.setToken(boot.accessToken, boot.tokenExpiresInS);
    this.o.onBooted(boot);
    return boot;
  }

  private setToken(token: string, expiresInS: number | undefined): void {
    this.accessToken = token;
    this.tokenExpiresAtMs = expiresInS === undefined ? undefined : this.now() + expiresInS * 1000;
  }
}
