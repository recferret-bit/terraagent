/**
 * Durable background work behind one port (3.7): enqueue, schedule (interval or cron), work with bounded concurrency,
 * a singleton/coalescing key, retry with backoff and a dead-letter queue. Adapters: pg-boss on the app's Postgres
 * (`pgboss` schema) and an in-memory one for tests and no-database mode. The sim tick never runs on a queue.
 */

/**
 * How jobs that share a `singletonKey` coexist (pg-boss queue policies, same meaning in memory):
 * - `standard`: no limit; a key only matters for throttle slots.
 * - `stately`: at most one queued and one active job per key (a busy planet gets exactly one follow-up run).
 * - `exclusive`: at most one queued-or-active job per key (a tick while the last run is busy is dropped).
 */
export type JobQueuePolicy = 'standard' | 'stately' | 'exclusive';

export interface JobRetryOptions {
  /** Retries after the first failure before the job is failed (and dead-lettered). Default 2. */
  readonly retryLimit?: number;
  /** Delay before a retry, in ms (rounded up to whole seconds on pg-boss). Default 0. */
  readonly retryDelayMs?: number;
  /** Exponential backoff from `retryDelayMs` (`delay * 2^attempt`, capped by `retryDelayMaxMs`). */
  readonly retryBackoff?: boolean;
  readonly retryDelayMaxMs?: number;
}

export interface QueueDefinition extends JobRetryOptions {
  readonly name: string;
  readonly policy?: JobQueuePolicy;
  /** Queue that receives a job's payload once it failed for good. Created by `createQueue` when missing. */
  readonly deadLetter?: string;
  /** A job active longer than this is failed (and retried), which also frees its singleton key. Default 15 min. */
  readonly expireInSeconds?: number;
  /** How long a completed job row is kept. Default 7 days (pg-boss). */
  readonly deleteAfterSeconds?: number;
}

export interface EnqueueOptions extends JobRetryOptions {
  /** Coalescing key: see {@link JobQueuePolicy}. */
  readonly singletonKey?: string;
  /** Throttle: at most one job per key per slot of this many ms (`floor(now / slot)`), across every instance. */
  readonly throttleMs?: number;
  /** Run no earlier than this many ms from now. */
  readonly startAfterMs?: number;
}

export interface WorkOptions {
  /** Jobs of this queue run at most this many at a time in this process. Default 1. */
  readonly concurrency?: number;
  /** How often an idle worker looks for new jobs (pg-boss); memory dispatches at once. Default 1000 ms. */
  readonly pollMs?: number;
}

export interface JobContext<T> {
  readonly id: string;
  readonly queue: string;
  readonly data: T;
  /** 0 on the first run, 1 on the first retry, … */
  readonly retryCount: number;
}

export type JobHandler<T> = (job: JobContext<T>) => Promise<void>;

/** An interval schedule is fired by every instance into a throttle slot, so the job is created once per interval. */
export type ScheduleSpec =
  | { readonly everyMs: number }
  | { readonly cron: string; readonly tz?: string };

export interface ScheduleOptions {
  /** Distinguishes several schedules on one queue (default: the queue name). */
  readonly key?: string;
}

export interface WorkHandle {
  /** Stops fetching new jobs of this queue in this process and waits for the running ones. */
  stop(): Promise<void>;
}

export interface QueueStats {
  readonly queue: string;
  /** Jobs waiting (created or retry, including deferred ones). */
  readonly queued: number;
  readonly active: number;
  /** Jobs failed for good and still retained. */
  readonly failed: number;
}

/** Nest token and contract; see {@link JobQueuePort} adapters in `memory/` and `pgboss/`. */
export abstract class JobQueuePort {
  abstract readonly kind: 'memory' | 'pgboss';
  /** Connects (pg-boss: installs or migrates its schema). Registration before `start` is allowed and applied here. */
  abstract start(): Promise<void>;
  /** Stops schedules and workers (waiting for running jobs), then disconnects. */
  abstract stop(): Promise<void>;
  /** Creates the queue (and its dead-letter queue) when missing. Idempotent. */
  abstract createQueue(def: QueueDefinition): Promise<void>;
  /** Adds one job; resolves with its id, or `null` when a singleton key or throttle slot coalesced it. */
  abstract enqueue<T extends object>(queue: string, data: T, opts?: EnqueueOptions): Promise<string | null>;
  abstract work<T extends object>(queue: string, opts: WorkOptions, handler: JobHandler<T>): Promise<WorkHandle>;
  /** Creates jobs on a schedule. A second call with the same queue and key replaces the first. */
  abstract schedule<T extends object>(queue: string, spec: ScheduleSpec, data?: T, opts?: ScheduleOptions): Promise<void>;
  abstract unschedule(queue: string, key?: string): Promise<void>;
  /** Depth and failures of the queues this process defined or used (`/v1/metrics`). */
  abstract stats(): Promise<QueueStats[]>;
}

/** Queue names both adapters accept (pg-boss's rule): letters, digits, `_`, `-`, `.` and `/`. */
export function assertQueueName(name: string): void {
  if (!/^[\w.\-/]+$/.test(name)) throw new Error(`queue name "${name}" may only contain letters, digits, _ - . /`);
}

/** Throttle slot of `nowMs` for a slot width (shared by both adapters so they dedupe identically). */
export function throttleSlot(nowMs: number, slotMs: number): number {
  return Math.floor(nowMs / Math.max(1, slotMs));
}

/** Delay of retry `retryCount` (0-based) under `opts`. */
export function retryDelayMs(opts: JobRetryOptions, retryCount: number): number {
  const base = Math.max(0, opts.retryDelayMs ?? 0);
  if (!opts.retryBackoff) return base;
  const grown = Math.max(1_000, base) * 2 ** Math.min(16, retryCount);
  return opts.retryDelayMaxMs ? Math.min(opts.retryDelayMaxMs, grown) : grown;
}

export const DEFAULT_RETRY_LIMIT = 2;
