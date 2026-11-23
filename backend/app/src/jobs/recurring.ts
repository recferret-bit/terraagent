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

/**
 * Loops are not retried: the next interval is the retry. A retry re-ran the whole body within seconds (three bot
 * ticks per round, three RPC sweeps of every staking account) for an error that is usually still there, and the
 * failed payloads of a loop (always `{}` or a planet id) are not worth a dead-letter queue nobody reads. A failure is
 * a `job failed` log line and `ta_jobs_runs_total{outcome="error"}`.
 */
export const LOOP_RETRY: JobRetryOptions = { retryLimit: 0 };

/** Completed loop jobs are kept one hour (a 5 s planet tick would otherwise keep a week of rows). */
export const LOOP_DELETE_AFTER_S = 3_600;

/**
 * A running loop job is failed after four intervals (2 to 15 min): a process killed mid-run frees the loop's
 * singleton key within that time instead of pg-boss's 15 min default.
 */
export function loopExpireSeconds(everyMs: number): number {
  return Math.min(900, Math.max(120, Math.ceil((everyMs * 4) / 1000)));
}

/** Queue of an `instance`-scoped job on this instance. */
export const instanceQueue = (name: string, instanceKey: string) => `${name}/${instanceKey}`;

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
