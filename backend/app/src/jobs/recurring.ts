import { hostname } from 'node:os';
import type { JobQueuePolicy, JobRetryOptions, ScheduleSpec } from './job-queue.port';

/**
 * Where a recurring job runs:
 * - `cluster`: once per occurrence across every instance (any instance may run it).
 * - `sim-host`: once per occurrence, only on instances that host sim planets (`TA_SIM_ROLE` `all` / `sim-worker`).
 * - `instance`: once per occurrence on every sim-hosting instance (its own queue), for work over this process's
 *   loaded planets.
 */
export type JobScope = 'cluster' | 'sim-host' | 'instance';

export interface RecurringJobDef {
  /** Queue name (`[\w.-/]`), e.g. `market.order-expiry`. */
  readonly name: string;
  readonly schedule: ScheduleSpec;
  readonly run: () => Promise<unknown>;
  readonly scope?: JobScope;
  /** Default `exclusive`: a tick while the previous run is busy is dropped (the old `if (running) return`). */
  readonly policy?: JobQueuePolicy;
  readonly retry?: JobRetryOptions;
}

/** Stops one registration (its schedule and this process's worker); waits for a running job. Idempotent. */
export interface JobRegistration {
  stop(): Promise<void>;
}

/** Retries for loops: two more tries with backoff from 5 s, then the dead-letter queue. */
export const LOOP_RETRY: JobRetryOptions = { retryLimit: 2, retryDelayMs: 5_000, retryBackoff: true, retryDelayMaxMs: 60_000 };

export const deadLetterOf = (queue: string) => `${queue}.dead`;

/** Queue of an `instance`-scoped job on this instance. */
export const instanceQueue = (name: string, instanceKey: string) => `${name}@${instanceKey}`;

/**
 * Stable name of this process in queue names: `TA_WORKER_ID` when set, else host + port (stable across restarts, so
 * a restart reuses its queues instead of leaving new ones behind).
 */
export function instanceKeyOf(workerId: string | undefined, port: number): string {
  const raw = workerId?.trim() || `${hostname()}-${port}`;
  return raw.replace(/[^\w.-]/g, '-').slice(0, 80);
}

/** Can this process host sim planets (`TA_SIM_ROLE` is not `api`)? */
export const canHostSim = (role: unknown) => role !== 'api';
