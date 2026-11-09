import { DEFAULT_POOL_SIZE } from '@terra/db';
import { TradeError } from './trade-error.js';

/** Default most time a request queues for a slot before it is answered 503 `server_busy`. */
export const DEFAULT_QUEUE_WAIT_MS = 8000;

/**
 * Concurrency cap on in-flight order placements / cancels, sized BELOW the database pool: an admitted request needs up to two
 * connections at once (the host's place transaction and the API's outcome poll), so `limit * 2 + 2` fits the pool and the
 * other routes (reads, auth lookups) always find a free connection. Excess requests queue for `maxWaitMs`, in arrival order,
 * and then fail as 503 `server_busy` with a `Retry-After`; none holds a connection while it queues.
 */
export class InflightGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly limit: number, private readonly maxWaitMs: number = DEFAULT_QUEUE_WAIT_MS) {}

  /** Slots for a pool: `TA_TRADE_MAX_INFLIGHT` when set, else `floor(pool / 2) - 1` (at least 1). */
  static fromEnv(env: Readonly<Record<string, unknown>>): InflightGate {
    const pool = Number(env.TA_DB_POOL_SIZE ?? DEFAULT_POOL_SIZE);
    const explicit = Number(env.TA_TRADE_MAX_INFLIGHT);
    const limit = Number.isInteger(explicit) && explicit >= 1 ? explicit : Math.max(1, Math.floor(pool / 2) - 1);
    const wait = Number(env.TA_TRADE_QUEUE_WAIT_MS);
    return new InflightGate(limit, Number.isFinite(wait) && wait >= 0 ? wait : DEFAULT_QUEUE_WAIT_MS);
  }

  get inFlight(): number { return this.active; }
  get queued(): number { return this.waiters.length; }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) { this.active++; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const wake = (): void => { clearTimeout(timer); resolve(); }; // the releasing request hands its slot over (`active` stays)
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(wake);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(TradeError.busy(`More than ${this.limit} orders are being processed; retry shortly.`, { inFlight: this.active, queued: this.waiters.length, limit: this.limit }));
      }, this.maxWaitMs);
      this.waiters.push(wake);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}
