import type { AuthResponse, PlanetType } from '@terra/contracts';
import { backoffDelay } from '../../net/backoff';
import {
  BootError,
  HOME_ATTEMPTS,
  deviceSecretKey,
  getOrCreateDeviceSecret,
  refreshAccessToken,
  type BootAuthResult,
  type FetchLike,
  type StorageLike,
} from './bootOnline';
import {
  DEFAULT_QUEUE_POLL_MS,
  cancelMatchTicketRequest,
  clearPendingJoinIntent,
  enqueueMatchTicket,
  extractActiveHomePayload,
  extractQueuedHomeStatus,
  formatQueueStatusMessage,
  getOrCreatePendingJoinIntent,
  readPendingJoinIntent,
  updatePendingJoinTicketId,
  type JoinQueueOptions,
  type PersistedJoinIntent,
  type QueuedHomeStatus,
} from './joinQueueFlow';

export class BootCancelledError extends Error {
  constructor(readonly ticketId: string | null = null) {
    super('Queue wait cancelled');
    this.name = 'BootCancelledError';
  }
}

export interface PreloadedBootContext {
  readonly accessToken: string;
  readonly tokenExpiresInS?: number;
  readonly deviceSecret: string;
  readonly playerId: string;
  readonly handle: string;
  readonly isGuest: boolean;
  readonly accountId?: string;
  readonly initialHome?: unknown;
}

const realWait = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function errorCodeOf(res: { json(): Promise<unknown> }): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { errorCode?: unknown; code?: unknown } | null;
    if (typeof body?.errorCode === 'string') return body.errorCode;
    if (typeof body?.code === 'string') return body.code;
    return undefined;
  } catch {
    return undefined;
  }
}

const retryableHome = (status: number, code: string | undefined): boolean =>
  status === 429 || (status === 503 && code === 'HOME_UNAVAILABLE');

const memMap = new Map<string, string>();
const fallbackMemStorage: StorageLike = {
  getItem: (k) => memMap.get(k) ?? null,
  setItem: (k, v) => {
    memMap.set(k, v);
  },
};

function resolveStorage(s?: StorageLike): StorageLike {
  if (s) return s;
  try {
    const ls = (globalThis as unknown as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') return ls;
  } catch {
    /* ignore */
  }
  return fallbackMemStorage;
}

/**
 * Coordinates W11 join intent submission (`POST /v1/match/tickets`), queued `/v1/me/home` polling,
 * browser reload resumption without duplicate ticket reservations, queue cancellation (`DELETE /v1/match/tickets/:id`),
 * and single-descent handoff into the assigned canonical colony (W11-33).
 */
export class JoinQueueCoordinator {
  private readonly storage: StorageLike;
  private readonly doFetch: FetchLike;
  private readonly search: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly waitFn: (ms: number) => Promise<void>;
  private readonly randomFn: () => number;

  private accessToken = '';
  private tokenExpiresInS?: number;
  private deviceSecret = '';
  private playerId = 'pr_guest';
  private handle = 'Colonist';
  private isGuest = true;
  private accountId?: string;

  private latestQueue: QueuedHomeStatus | null = null;
  private assigned: BootAuthResult | null = null;
  private handedOffColonyId: string | null = null;
  private descentTriggeredCount = 0;
  private polling = false;
  private cancelled = false;
  private disposed = false;
  private wasQueued = false;
  private cancelPromise: Promise<boolean> | null = null;
  private wakeWait: (() => void) | null = null;

  constructor(
    private readonly opts: JoinQueueOptions & {
      accessToken?: string;
      strictAuth?: boolean;
      preloaded?: PreloadedBootContext;
    } = {},
  ) {
    this.storage = resolveStorage(opts.storage);
    this.doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
    this.pollIntervalMs = Math.max(10, opts.pollIntervalMs ?? DEFAULT_QUEUE_POLL_MS);
    this.maxPollAttempts = Math.max(1, opts.maxPollAttempts ?? 600);
    this.waitFn = opts.wait ?? realWait;
    this.randomFn = opts.random ?? Math.random;
    if (opts.preloaded) {
      this.accessToken = opts.preloaded.accessToken;
      this.tokenExpiresInS = opts.preloaded.tokenExpiresInS;
      this.deviceSecret = opts.preloaded.deviceSecret;
      this.playerId = opts.preloaded.playerId;
      this.handle = opts.preloaded.handle;
      this.isGuest = opts.preloaded.isGuest;
      this.accountId = opts.preloaded.accountId;
    } else if (opts.accessToken) {
      this.accessToken = opts.accessToken;
    }
  }

  get currentQueueStatus(): QueuedHomeStatus | null { return this.latestQueue; }
  get isPolling(): boolean { return this.polling; }
  get isCancelled(): boolean { return this.cancelled; }
  get assignedResult(): BootAuthResult | null { return this.assigned; }
  get descentCount(): number { return this.descentTriggeredCount; }

  async start(): Promise<BootAuthResult | null> {
    if (this.disposed || this.cancelled) return null;
    if (this.assigned) return this.assigned;

    if (!this.opts.preloaded) {
      this.opts.onStatus?.('Contacting orbit…');
      this.deviceSecret = getOrCreateDeviceSecret(this.storage, deviceSecretKey(this.search));
      await this.ensureAuthenticated();
      if (this.disposed || this.cancelled) return null;
    }

    const initialHome =
      this.opts.preloaded && 'initialHome' in this.opts.preloaded
        ? this.opts.preloaded.initialHome
        : await this.fetchHomeOnce(true);
    if (this.disposed || this.cancelled) return null;

    if (initialHome !== null) {
      const active = extractActiveHomePayload(initialHome);
      if (active) return this.completeWithActive(active);
      const queued = extractQueuedHomeStatus(initialHome, {
        planetId: this.opts.planetId,
        planetType: this.opts.planetType,
        sectorIntent: this.opts.sectorIntent,
      });
      if (queued) {
        this.wasQueued = true;
        this.recordQueueStatus(queued);
        return this.pollUntilAssigned();
      }
    }

    const shouldEnqueue =
      Boolean(this.opts.enqueueTicket) ||
      Boolean(this.opts.enqueueOnNew) ||
      Boolean(this.opts.sectorIntent) ||
      initialHome === null;

    if (!shouldEnqueue && isObject(initialHome)) {
      this.throwNonActiveHomeError(initialHome);
    }

    const intent = this.prepareJoinIntent();
    const enqueued = await enqueueMatchTicket(this.accessToken, intent, this.doFetch);
    if (this.disposed || this.cancelled) return null;

    if (enqueued.kind === 'active') {
      const active = extractActiveHomePayload(enqueued.rawHome);
      if (active) return this.completeWithActive(active);
    } else {
      this.wasQueued = true;
      this.recordQueueStatus(enqueued.status);
    }
    return this.pollUntilAssigned();
  }

  private throwNonActiveHomeError(initialHome: Record<string, unknown>): never {
    if (typeof initialHome.state !== 'string') {
      throw new BootError('GET /v1/me/home: unexpected answer', 200, 'BAD_HOME');
    }
    const st = initialHome.state;
    const types = Array.isArray(initialHome.newPlanetTypes)
      ? ` (new colonies: ${initialHome.newPlanetTypes.join(', ')})`
      : '';
    const msgMap: Record<string, string> = {
      NEW: 'No colony was seated for this player',
      QUEUED: 'Waiting in the planet queue',
      ELIMINATED: 'Your colony was eliminated',
      PLANET_ENDED: 'This planet has ended',
    };
    if (!(st in msgMap)) throw new BootError('GET /v1/me/home: unexpected answer', 200, 'BAD_HOME');
    throw new BootError(`${msgMap[st]}${types}`, 200, `HOME_${st}`);
  }

  async submitJoinIntent(input?: {
    planetType?: PlanetType;
    planetId?: string;
    sectorIntent?: JoinQueueOptions['sectorIntent'];
  }): Promise<PersistedJoinIntent> {
    this.deviceSecret = getOrCreateDeviceSecret(this.storage, deviceSecretKey(this.search));
    return getOrCreatePendingJoinIntent(this.storage, {
      search: this.search,
      planetType: input?.planetType ?? this.opts.planetType,
      planetId: input?.planetId ?? this.opts.planetId,
      sectorIntent: input?.sectorIntent ?? this.opts.sectorIntent,
      now: this.opts.now,
    });
  }

  async cancelQueuedTicket(explicitTicketId?: string): Promise<boolean> {
    if (this.cancelPromise) return this.cancelPromise;
    this.cancelled = true;
    this.polling = false;
    this.wakeWait?.();

    const stored = readPendingJoinIntent(this.storage, this.search);
    const ticketId = explicitTicketId ?? this.latestQueue?.ticketId ?? stored?.ticketId ?? 'current';

    this.cancelPromise = (async () => {
      try {
        if (!this.accessToken) {
          this.deviceSecret = getOrCreateDeviceSecret(this.storage, deviceSecretKey(this.search));
          await this.ensureAuthenticated().catch(() => undefined);
        }
        await cancelMatchTicketRequest(this.accessToken || 'jwt_guest', ticketId, this.doFetch);
      } finally {
        clearPendingJoinIntent(this.storage, this.search);
        this.opts.bootOverlay?.hideQueueStatus();
        this.opts.onStatus?.('Queue cancelled — returning to orbital picker');
        this.opts.onCancel?.(ticketId);
        this.opts.onReturnToOrbit?.();
      }
      return true;
    })();
    return this.cancelPromise;
  }

  dispose(): void {
    this.disposed = true;
    this.polling = false;
    this.wakeWait?.();
  }

  private prepareJoinIntent(): PersistedJoinIntent {
    return getOrCreatePendingJoinIntent(this.storage, {
      search: this.search,
      planetType: this.opts.planetType,
      planetId: this.opts.planetId,
      sectorIntent: this.opts.sectorIntent,
      now: this.opts.now,
    });
  }

  private recordQueueStatus(status: QueuedHomeStatus): void {
    this.latestQueue = status;
    updatePendingJoinTicketId(this.storage, status.ticketId, this.search, {
      planetId: status.planetId,
      planetType: status.planetType,
      sectorIntent: status.sectorIntent,
    });
    this.opts.onStatus?.(formatQueueStatusMessage(status));
    const triggerCancel = () => { void this.cancelQueuedTicket(status.ticketId); };
    this.opts.onQueueStatus?.(status, triggerCancel);
    this.opts.bootOverlay?.showQueueStatus(status, triggerCancel);
  }

  private async pollUntilAssigned(): Promise<BootAuthResult | null> {
    this.polling = true;
    try {
      for (let attempt = 1; attempt <= this.maxPollAttempts; attempt++) {
        if (this.disposed || this.cancelled) return null;
        await this.cancellableWait(this.pollIntervalMs);
        if (this.disposed || this.cancelled) return null;

        const rawHome = await this.fetchHomeOnce(false);
        if (this.disposed || this.cancelled) return null;
        if (!rawHome) continue;

        const active = extractActiveHomePayload(rawHome);
        if (active) {
          this.polling = false;
          return this.completeWithActive(active);
        }

        const queued = extractQueuedHomeStatus(rawHome, {
          planetId: this.latestQueue?.planetId ?? this.opts.planetId,
          planetType: this.latestQueue?.planetType ?? this.opts.planetType,
          sectorIntent: this.latestQueue?.sectorIntent ?? this.opts.sectorIntent,
        });
        if (queued) {
          if (queued.ticketState === 'CANCELLED') {
            clearPendingJoinIntent(this.storage, this.search);
            this.opts.bootOverlay?.hideQueueStatus();
            this.opts.onCancel?.(queued.ticketId);
            this.opts.onReturnToOrbit?.();
            return null;
          }
          if (queued.ticketState === 'FAILED' || queued.ticketState === 'EXPIRED') {
            clearPendingJoinIntent(this.storage, this.search);
            this.opts.bootOverlay?.hideQueueStatus();
            throw new BootError(`Queue ticket ${queued.ticketState.toLowerCase()}`, 200, `TICKET_${queued.ticketState}`);
          }
          this.recordQueueStatus(queued);
        }
      }
      throw new BootError('Timed out waiting in planet queue', 408, 'QUEUE_POLL_TIMEOUT');
    } finally {
      this.polling = false;
    }
  }

  private completeWithActive(active: {
    state: 'ACTIVE';
    planet: BootAuthResult['planet'];
    colony: BootAuthResult['colony'];
    foundingSectorId?: string;
  }): BootAuthResult {
    if (this.assigned && this.handedOffColonyId === active.colony.id) return this.assigned;
    const stored = readPendingJoinIntent(this.storage, this.search);
    const ticketId = this.latestQueue?.ticketId ?? stored?.ticketId;
    clearPendingJoinIntent(this.storage, this.search);
    this.opts.bootOverlay?.hideQueueStatus();
    this.opts.onStatus?.(`Entering orbit: ${active.planet.id}…`);

    const result: BootAuthResult = {
      mode: 'online',
      accessToken: this.accessToken,
      ...(this.tokenExpiresInS !== undefined ? { tokenExpiresInS: this.tokenExpiresInS } : {}),
      deviceSecret: this.deviceSecret,
      playerId: this.playerId,
      handle: this.handle,
      isGuest: this.isGuest,
      ...(this.accountId ? { accountId: this.accountId } : {}),
      state: 'ACTIVE',
      planet: active.planet,
      colony: active.colony,
      ...(active.foundingSectorId ? { foundingSectorId: active.foundingSectorId } : {}),
      ...(ticketId ? { ticketId } : {}),
      ...(this.wasQueued ? { wasQueued: true } : {}),
    };

    this.assigned = result;
    if (this.handedOffColonyId !== active.colony.id) {
      this.handedOffColonyId = active.colony.id;
      this.descentTriggeredCount++;
      this.opts.bootOverlay?.setColonyMeta(active.planet.id, active.colony.id, active.colony.colonyIndex);
      if (this.opts.showDescentOnAssign !== false) {
        this.opts.bootOverlay?.showDescent({
          progress: 0,
          q: active.colony.spawnQ,
          r: active.colony.spawnR,
          landed: false,
        });
      }
      this.opts.onAssigned?.(result);
      this.opts.onDescent?.({
        progress: 0,
        q: active.colony.spawnQ,
        r: active.colony.spawnR,
        colonyId: active.colony.id,
        planetId: active.planet.id,
      });
    }
    return result;
  }

  private cancellableWait(ms: number): Promise<void> {
    if (this.disposed || this.cancelled) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (this.wakeWait === done) this.wakeWait = null;
        resolve();
      };
      this.wakeWait = done;
      void this.waitFn(ms).then(done, done);
    });
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.accessToken) return;
    if (this.opts.tryRefresh) {
      const refreshed = await refreshAccessToken(this.doFetch);
      if (refreshed) {
        this.applyAuthResponse(refreshed);
        return;
      }
    }
    const res = await this.doFetch('/v1/auth/guest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ deviceSecret: this.deviceSecret }),
    });
    if (!res.ok) {
      if (res.status === 404 && !this.opts.strictAuth) {
        this.accessToken = `jwt_${this.deviceSecret.slice(0, 12)}`;
        return;
      }
      throw new BootError(`POST /v1/auth/guest: ${res.status}`, res.status);
    }
    this.applyAuthResponse((await res.json()) as AuthResponse);
  }

  private applyAuthResponse(auth: AuthResponse): void {
    this.accessToken = auth.accessToken;
    this.tokenExpiresInS = auth.expiresIn;
    this.playerId = auth.player?.id ?? 'pr_guest';
    this.handle = auth.player?.handle ?? 'Colonist';
    this.isGuest = auth.player?.isGuest !== false;
    const acc = (auth as { accountId?: unknown }).accountId;
    if (typeof acc === 'string' && acc.length > 0) this.accountId = acc;
  }

  private async fetchHomeOnce(isInitial: boolean): Promise<unknown> {
    const query = new URLSearchParams();
    if (this.opts.planetType) query.set('type', this.opts.planetType);
    const colonyId = new URLSearchParams(this.search).get('colonyId');
    if (colonyId) query.set('colonyId', colonyId);
    const url = '/v1/me/home' + (query.size ? `?${query}` : '');
    let renewed = false;

    for (let attempt = 1; ; attempt++) {
      if (this.disposed || this.cancelled) return null;
      const res = await this.doFetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.accessToken}` },
        credentials: 'include',
      });
      if (res.ok) return res.json();
      if (res.status === 404 && isInitial && !this.opts.strictAuth) return null;
      if (res.status === 401 && !renewed) {
        renewed = true;
        this.accessToken = '';
        await this.ensureAuthenticated();
        continue;
      }
      const code = await errorCodeOf(res);
      if (!retryableHome(res.status, code) || attempt >= HOME_ATTEMPTS) {
        if (!isInitial && attempt < HOME_ATTEMPTS) {
          await this.cancellableWait(backoffDelay(attempt, this.randomFn));
          continue;
        }
        throw new BootError(`GET /v1/me/home: ${res.status}${code ? ` ${code}` : ''}`, res.status, code);
      }
      this.opts.onStatus?.(
        res.status === 429
          ? `Orbit is busy, retrying (${attempt}/${HOME_ATTEMPTS - 1})…`
          : `Home planet is starting, retrying (${attempt}/${HOME_ATTEMPTS - 1})…`,
      );
      await this.cancellableWait(backoffDelay(attempt, this.randomFn));
    }
  }
}

export async function bootOrPollQueuedHome(opts: JoinQueueOptions = {}): Promise<BootAuthResult | null> {
  return new JoinQueueCoordinator(opts).start();
}
