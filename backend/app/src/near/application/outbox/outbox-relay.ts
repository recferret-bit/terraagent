import type { ChainOutboxRepository, ClaimedRow } from './chain-outbox.repository.js';

export interface OutboxRelayConfig {
  readonly pollMs: number;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly batch: number;
  /** Backoff base: delay = min(2^attempts * baseMs, maxMs), then jittered into [d/2, d]. */
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
}

export const DEFAULT_RELAY_CONFIG: OutboxRelayConfig = { pollMs: 1000, leaseMs: 30_000, maxAttempts: 8, batch: 10, backoffBaseMs: 1000, backoffMaxMs: 600_000 };

export interface RelayHooks {
  /** Resolves the port instance by name (the Nest container in the app). */
  resolve(port: string): object;
  onResult?(port: string, status: 'done' | 'failed' | 'dead'): void;
  onRowDone?(row: ClaimedRow, result: object, txHash: string | null): Promise<void> | void;
  onRowFailed?(row: ClaimedRow, error: string, dead: boolean): Promise<void> | void;
  /** Optional per-row maxAttempts override (e.g. fast 2-attempt retry for interactive CargoToken operations). */
  maxAttemptsFor?(row: ClaimedRow, defaultMax: number): number;
  /** Optional per-row backoffBaseMs override. */
  backoffBaseMsFor?(row: ClaimedRow, defaultBaseMs: number): number;
  onError?(row: ClaimedRow | undefined, error: unknown): void;
  random?(): number;
}

/** Delay before attempt `attempts + 1`: `2^attempts` s capped at 10 min, jittered into the upper half. */
export function backoffMs(attempts: number, cfg: Pick<OutboxRelayConfig, 'backoffBaseMs' | 'backoffMaxMs'>, random: () => number): number {
  const d = Math.min(2 ** Math.min(attempts, 30) * cfg.backoffBaseMs, cfg.backoffMaxMs);
  return Math.floor(d / 2 + random() * (d / 2));
}

const DEPENDENCY_POLL_MS = 500;

/**
 * Polls the outbox and executes due rows against the ports. Crash safety: a claim has a lease; a relay that dies mid-call leaves the
 * row RUNNING, another relay reclaims it after `lockedUntil` and calls again with the same `opId`, which the idempotent adapter
 * answers with the stored receipt (no second effect).
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inflight: Promise<unknown> = Promise.resolve();

  constructor(private readonly repo: ChainOutboxRepository, private readonly cfg: OutboxRelayConfig, private readonly hooks: RelayHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  /** Stops polling and waits for the in-flight batch (graceful shutdown). */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inflight.catch(() => undefined);
  }

  /** One poll: claims a batch and processes it. Returns how many rows were claimed. */
  async pollOnce(): Promise<number> {
    const rows = await this.repo.claimDue(this.cfg.batch, this.cfg.leaseMs);
    await Promise.all(rows.map((r) => this.process(r)));
    return rows.length;
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => {
      this.inflight = this.pollOnce().then(
        (n) => this.schedule(n >= this.cfg.batch ? 0 : this.cfg.pollMs),
        (e: unknown) => { this.hooks.onError?.(undefined, e); this.schedule(this.cfg.pollMs); },
      );
    }, ms);
    if (!this.running) clearTimeout(this.timer);
  }

  private async process(row: ClaimedRow): Promise<void> {
    try {
      if (await this.waitingFor(row)) return;
      const port = this.hooks.resolve(row.port) as Record<string, unknown>;
      const fn = port[row.method];
      if (typeof fn !== 'function') throw new Error(`port ${row.port} has no method ${row.method}`);
      const result = (await fn.call(port, { ...row.payload, opId: row.opId })) as object | undefined;
      const r = (result ?? {}) as { txHash?: unknown; receipt?: { txHash?: unknown } };
      const txHash = [r.txHash, r.receipt?.txHash].find((h): h is string => typeof h === 'string') ?? null;
      if (await this.repo.markDone(row, result ?? {}, txHash)) {
        this.hooks.onResult?.(row.port, 'done');
        await this.hooks.onRowDone?.(row, result ?? {}, txHash);
      }
    } catch (e) {
      await this.fail(row, e);
    }
  }

  /**
   * Ordering: a row with `payload.dependsOn = <opId>` runs only after that row is DONE (e.g. a cargo burn after the market withdraw that funds it).
   * Until then it is deferred without using an attempt; a DEAD dependency fails the row.
   */
  private async waitingFor(row: ClaimedRow): Promise<boolean> {
    const dep = row.payload.dependsOn;
    if (typeof dep !== 'string') return false;
    const status = (await this.repo.find(dep))?.status;
    if (status === 'DONE') return false;
    if (status === 'DEAD' || status === undefined) throw new Error(`dependency ${dep} is ${status ?? 'missing'}`);
    await this.repo.defer(row, DEPENDENCY_POLL_MS);
    return true;
  }

  private async fail(row: ClaimedRow, e: unknown): Promise<void> {
    this.hooks.onError?.(row, e);
    const code = (e as { errorCode?: string }).errorCode;
    const text = `${code ? `${code}: ` : ''}${e instanceof Error ? e.message : String(e)}`;
    const maxAttempts = this.hooks.maxAttemptsFor ? this.hooks.maxAttemptsFor(row, this.cfg.maxAttempts) : this.cfg.maxAttempts;
    const baseMs = this.hooks.backoffBaseMsFor ? this.hooks.backoffBaseMsFor(row, this.cfg.backoffBaseMs) : this.cfg.backoffBaseMs;
    const dead = row.attempts >= maxAttempts;
    const delay = backoffMs(row.attempts, { backoffBaseMs: baseMs, backoffMaxMs: this.cfg.backoffMaxMs }, this.hooks.random ?? Math.random);
    if (await this.repo.markFailed(row, text, delay, dead)) {
      this.hooks.onResult?.(row.port, dead ? 'dead' : 'failed');
      await this.hooks.onRowFailed?.(row, text, dead);
    }
  }
}
