import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RETRY_LIMIT,
  retryDelayMs,
  throttleSlot,
  type EnqueueOptions,
  type JobHandler,
  type JobRetryOptions,
  type QueueDefinition,
  type QueueStats,
} from '../job-queue.port';

type JobState = 'created' | 'retry' | 'active';

interface MemJob {
  readonly id: string;
  readonly data: object;
  readonly key: string;
  readonly retry: JobRetryOptions;
  state: JobState;
  retryCount: number;
  startAfter: number;
}

interface Worker {
  readonly handler: JobHandler<object>;
  readonly concurrency: number;
  readonly running: Set<Promise<void>>;
  stopped: boolean;
}

/** Sink for a job that failed for good (the owning adapter forwards it to the dead-letter queue). */
export type DeadLetterSink = (queue: string, data: object) => void;

/**
 * One in-memory queue with the pg-boss rules the port promises: policy per singleton key, throttle slots, retries with
 * backoff, dead letter, bounded concurrency. Jobs live only in this process.
 */
export class MemoryQueue {
  private readonly jobs: MemJob[] = [];
  private readonly slots = new Map<string, number>();
  private worker: Worker | undefined;
  private wake: ReturnType<typeof setTimeout> | undefined;
  private failed = 0;

  constructor(
    readonly def: QueueDefinition,
    private readonly deadLetter: DeadLetterSink,
    private readonly now: () => number = () => Date.now(),
  ) {}

  enqueue(data: object, opts: EnqueueOptions = {}): string | null {
    const key = opts.singletonKey ?? '';
    if (opts.throttleMs !== undefined) {
      const slot = throttleSlot(this.now(), opts.throttleMs);
      if (this.slots.get(key) === slot) return null;
      this.slots.set(key, slot);
    }
    if (this.blockedByPolicy(key)) return null;
    const job: MemJob = {
      id: randomUUID(), data, key, state: 'created', retryCount: 0,
      startAfter: this.now() + Math.max(0, opts.startAfterMs ?? 0),
      retry: { ...this.def, ...pickRetry(opts) },
    };
    this.jobs.push(job);
    this.dispatch();
    return job.id;
  }

  work(handler: JobHandler<object>, concurrency: number): Worker {
    if (this.worker && !this.worker.stopped) throw new Error(`queue ${this.def.name} already has a worker in this process`);
    this.worker = { handler, concurrency: Math.max(1, concurrency), running: new Set(), stopped: false };
    this.dispatch();
    return this.worker;
  }

  async stopWorker(worker: Worker): Promise<void> {
    worker.stopped = true;
    while (worker.running.size > 0) await Promise.allSettled([...worker.running]);
  }

  stop(): void {
    clearTimeout(this.wake);
    this.wake = undefined;
  }

  stats(): QueueStats {
    let queued = 0;
    let active = 0;
    for (const j of this.jobs) {
      if (j.state === 'active') active++;
      else queued++;
    }
    return { queue: this.def.name, queued, active, failed: this.failed };
  }

  private blockedByPolicy(key: string): boolean {
    const policy = this.def.policy ?? 'standard';
    if (policy === 'standard') return false;
    return this.jobs.some((j) => j.key === key && (j.state !== 'active' || policy === 'exclusive'));
  }

  /** Starts every ready job the worker has room for; arms one timer for the earliest deferred job. */
  private dispatch(): void {
    const w = this.worker;
    if (!w || w.stopped) return;
    const now = this.now();
    let nextAt = Number.POSITIVE_INFINITY;
    for (const job of this.jobs) {
      if (w.running.size >= w.concurrency) break;
      if (job.state === 'active') continue;
      if (job.startAfter > now) { nextAt = Math.min(nextAt, job.startAfter); continue; }
      if (this.keyBusy(job)) continue;
      this.run(w, job);
    }
    this.armWake(nextAt);
  }

  /** `stately` and `exclusive` run one job per key at a time. */
  private keyBusy(job: MemJob): boolean {
    if ((this.def.policy ?? 'standard') === 'standard') return false;
    return this.jobs.some((j) => j !== job && j.key === job.key && j.state === 'active');
  }

  private armWake(at: number): void {
    clearTimeout(this.wake);
    this.wake = undefined;
    if (!Number.isFinite(at)) return;
    this.wake = setTimeout(() => this.dispatch(), Math.max(0, at - this.now()));
    this.wake.unref?.();
  }

  private run(w: Worker, job: MemJob): void {
    job.state = 'active';
    const p = (async () => {
      try {
        await w.handler({ id: job.id, queue: this.def.name, data: job.data, retryCount: job.retryCount });
        this.remove(job);
      } catch {
        this.settleFailure(job);
      }
    })().finally(() => {
      w.running.delete(p);
      this.dispatch();
    });
    w.running.add(p);
  }

  private settleFailure(job: MemJob): void {
    const limit = job.retry.retryLimit ?? DEFAULT_RETRY_LIMIT;
    if (job.retryCount < limit) {
      job.state = 'retry';
      job.startAfter = this.now() + retryDelayMs(job.retry, job.retryCount);
      job.retryCount++;
      return;
    }
    this.remove(job);
    this.failed++;
    if (this.def.deadLetter) this.deadLetter(this.def.deadLetter, job.data);
  }

  private remove(job: MemJob): void {
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
  }
}

function pickRetry(opts: JobRetryOptions): JobRetryOptions {
  const out: { -readonly [K in keyof JobRetryOptions]: JobRetryOptions[K] } = {};
  if (opts.retryLimit !== undefined) out.retryLimit = opts.retryLimit;
  if (opts.retryDelayMs !== undefined) out.retryDelayMs = opts.retryDelayMs;
  if (opts.retryBackoff !== undefined) out.retryBackoff = opts.retryBackoff;
  if (opts.retryDelayMaxMs !== undefined) out.retryDelayMaxMs = opts.retryDelayMaxMs;
  return out;
}

export type { Worker as MemoryWorker };
