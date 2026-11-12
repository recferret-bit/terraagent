import type { DevPlanetType } from '@terra/sim';
import type { SessionTarget } from '../../net/types';
import type { SectorIntentInput } from '../../ui/lobby/orbitalPickerModel';
import { bootAuthAndHome, renewAccessToken, type BootAuthResult, type FetchLike, type StorageLike } from './bootOnline';
import { BootCancelledError, type JoinQueueCoordinator, type QueuedHomeStatus } from './joinQueueFlow';

export interface GuestBootOptions {
  fetch?: FetchLike;
  storage?: StorageLike;
  search: string;
  /** Planet type of a NEW colony (the orbit pick). */
  planetType?: DevPlanetType;
  /** Canonical planet id for W11 ticket enqueue. */
  planetId?: string;
  /** Sector placement intent from the W11 orbital picker. */
  sectorIntent?: SectorIntentInput;
  /** When true, polls `/v1/me/home` while `state === 'QUEUED'` until `ACTIVE` or cancelled. */
  pollQueuedHome?: boolean;
  /** When true, enqueues a match ticket if `/v1/me/home` returns `NEW`. */
  enqueueOnNew?: boolean;
  /** Poll interval (ms) while waiting in the planet queue. */
  pollIntervalMs?: number;
  /** Injectable wait for deterministic tests. */
  wait?(ms: number): Promise<void>;
  /** May an unreachable server fall back to a browser-local host (default: dev builds). */
  allowLocalFallback?: boolean;
  /** When false, skip `/v1/auth/refresh` and authenticate directly with the current `deviceSecret` (e.g. fresh orbit deploy). */
  tryRefresh?: boolean;
  /** Splash status line. */
  onStatus?(status: string): void;
  /** Queue status callback while `GET /v1/me/home` reports `QUEUED`. */
  onQueueStatus?(status: QueuedHomeStatus, cancel: () => void): void;
  /** Queue cancelled callback (`DELETE /v1/match/tickets/:id` completed). */
  onQueueCancelled?(ticketId: string | null): void;
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
  private coordinator: JoinQueueCoordinator | null = null;
  private disposed = false;
  private readonly now: () => number;

  constructor(readonly url: string, private readonly o: GuestBootOptions) {
    this.now = o.now ?? (() => Date.now());
  }

  /** The applied boot result, with the newest token. */
  get result(): BootAuthResult | null { return this.current; }

  /** First boot. Retries after each failure the error splash reports, until it succeeds; null when the splash gave up. */
  async boot(): Promise<BootAuthResult | null> {
    for (;;) {
      if (this.disposed) return null;
      try {
        const shouldRefresh = this.o.tryRefresh ?? !new URLSearchParams(this.o.search).has('as');
        return this.adopt(await bootAuthAndHome(this.authOptions(shouldRefresh)));
      } catch (e) {
        if (e instanceof BootCancelledError || this.disposed) return null;
        if (!this.o.onError) throw e;
        if (!(await this.o.onError(`Couldn't reach orbit: ${e instanceof Error ? e.message : String(e)}`))) return null;
      }
    }
  }

  async cancelQueue(ticketId?: string): Promise<boolean> {
    if (!this.coordinator) return false;
    return this.coordinator.cancelQueuedTicket(ticketId);
  }

  dispose(): void {
    this.disposed = true;
    this.coordinator?.dispose();
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
    const {
      fetch,
      storage,
      search,
      planetType,
      planetId,
      sectorIntent,
      pollQueuedHome,
      enqueueOnNew,
      pollIntervalMs,
      wait,
      allowLocalFallback,
      onStatus,
      onQueueStatus,
      onQueueCancelled,
    } = this.o;
    return {
      fetch,
      storage,
      search,
      planetType,
      planetId,
      sectorIntent,
      pollQueuedHome,
      enqueueOnNew,
      pollIntervalMs,
      wait,
      allowLocalFallback,
      tryRefresh,
      onStatus,
      onQueueStatus,
      onQueueCancelled,
      onCoordinator: (c: JoinQueueCoordinator) => {
        this.coordinator = c;
      },
    };
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

  /**
   * Social login on this same session: the boot object is mutated in place (the session holds that reference)
   * and `accessToken` is what the socket sends next. No re-boot, no reload.
   */
  applyLinkedSession(next: {
    accessToken: string;
    expiresIn?: number;
    isGuest: boolean;
    handle: string;
    accountId: string;
    playerId?: string;
  }): void {
    const cur = this.current;
    if (cur) {
      cur.accessToken = next.accessToken;
      cur.isGuest = next.isGuest;
      cur.handle = next.handle;
      cur.accountId = next.accountId;
      if (next.playerId) cur.playerId = next.playerId;
      if (next.expiresIn !== undefined) cur.tokenExpiresInS = next.expiresIn;
    }
    this.setToken(next.accessToken, next.expiresIn ?? cur?.tokenExpiresInS);
  }
}
