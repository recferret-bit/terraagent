import { Inject, Injectable, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Logger } from 'pino';
import { MetricsRegistry } from '../core/metrics.registry';
import { ReadinessRegistry } from '../core/readiness.registry';
import { JobQueuePort, type JobHandler, type QueueDefinition, type WorkOptions } from './job-queue.port';
import { installJobMetrics, type JobRunCounter } from './jobs-metrics';
import { MemoryJobQueue } from './memory/memory-job-queue';
import {
  canHostSim,
  instanceQueue,
  LOOP_DELETE_AFTER_S,
  LOOP_RETRY,
  loopExpireSeconds,
  type JobRegistration,
  type JobScope,
  type RecurringJobDef,
} from './recurring';

export interface JobsServiceOptions {
  /** Process name in `instance` queue names (see `instanceKeyOf`). */
  readonly instanceKey: string;
  /** `TA_SIM_ROLE`. */
  readonly simRole: unknown;
  readonly log?: Pick<Logger, 'warn' | 'info'>;
}

export const JOBS_OPTIONS = Symbol('JOBS_OPTIONS');

const RETRY_START_MS = 5_000;
const MAX_RETRY_START_MS = 60_000;
/** A registration still not applied after this long fails `/readyz` (its loop is off). */
const REGISTRATION_GRACE_MS = 120_000;
/** Shutdown waits this long for a running job before moving on (the sim snapshots must fit the stop grace period). */
export const STOP_WAIT_MS = 5_000;

interface Pending {
  readonly apply: () => Promise<JobRegistration>;
  live?: JobRegistration;
  stopped: boolean;
  applying?: boolean;
  /** First failed apply (wall ms); cleared once applied. */
  failingSince?: number;
  retry?: ReturnType<typeof setTimeout>;
}

/**
 * Owns the queue adapter for the app: starts it on bootstrap, applies the registrations made before that (modules
 * register in `onModuleInit`), and drains workers on module destroy, before Prisma disconnects and sim threads stop.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly pending: Pending[] = [];
  private readonly runs: JobRunCounter | undefined;
  private started = false;
  private stopping = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private startup: Promise<void> = Promise.resolve();

  constructor(
    @Inject(JobQueuePort) readonly port: JobQueuePort,
    @Inject(JOBS_OPTIONS) private readonly opts: JobsServiceOptions,
    @Optional() metrics?: MetricsRegistry,
    @Optional() private readonly readiness?: ReadinessRegistry,
  ) {
    this.runs = metrics ? installJobMetrics(metrics.registry, () => this.port) : undefined;
    // `/readyz` names a job queue that never started (every background loop would be off).
    readiness?.register('jobs', () => {
      if (!this.started) throw new Error(`${this.port.kind} job queue not started`);
      const stuck = this.pending.filter((p) => !p.stopped && p.failingSince !== undefined && Date.now() - p.failingSince > REGISTRATION_GRACE_MS).length;
      if (stuck > 0) throw new Error(`${stuck} job registration(s) could not be applied: their loops are off`);
      return this.port.kind;
    });
  }

  get instanceKey(): string {
    return this.opts.instanceKey;
  }

  get hostsSim(): boolean {
    return canHostSim(this.opts.simRole);
  }

  /** Queue name a job of `scope` uses on this instance. */
  queueFor(name: string, scope: JobScope): string {
    return scope === 'instance' ? instanceQueue(name, this.instanceKey) : name;
  }

  /** Registers a recurring job (synchronous; applied at bootstrap, or now when already started). */
  recurring(def: RecurringJobDef): JobRegistration {
    const scope = def.scope ?? 'cluster';
    if (scope !== 'cluster' && !this.hostsSim) return { stop: async () => undefined };
    const queue = this.queueFor(def.name, scope);
    return this.register(async () => {
      const everyMs = 'everyMs' in def.schedule ? def.schedule.everyMs : 60_000;
      await this.define({
        name: queue, policy: def.policy ?? 'exclusive', ...(def.retry ?? LOOP_RETRY),
        expireInSeconds: loopExpireSeconds(everyMs), deleteAfterSeconds: LOOP_DELETE_AFTER_S,
      });
      const worker = await this.work(queue, { concurrency: 1 }, () => def.run().then(() => undefined));
      await this.port.schedule(queue, def.schedule);
      const localOrMemory = 'everyMs' in def.schedule || this.port.kind !== 'pgboss';
      return { stop: async () => { if (localOrMemory) await this.port.unschedule(queue); await worker.stop(); } };
    });
  }

  /** Registers a queue and this process's worker for it (applied at bootstrap, or now). */
  worker<T extends object>(def: QueueDefinition, opts: WorkOptions, handler: JobHandler<T>): JobRegistration {
    return this.register(async () => {
      await this.define(def);
      return this.work(def.name, opts, handler);
    });
  }

  /**
   * Starts in the background: boot does not wait for pg-boss to install or migrate its schema, and the app boots
   * without Postgres (readyz reports it); a failed start is retried with backoff. Await {@link whenStarted} to wait.
   */
  onApplicationBootstrap(): void {
    this.startup = this.tryStart(RETRY_START_MS);
  }

  /** Resolves once the first start attempt settled (and its registrations were applied). */
  whenStarted(): Promise<void> {
    return this.startup;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    await this.startup;
    this.readiness?.unregister('jobs');
    await Promise.all(this.pending.map((p) => this.stopOne(p)));
    await this.port.stop().catch((err: unknown) => this.opts.log?.warn({ err: errText(err) }, 'job queue stop failed'));
  }

  /** Creates a queue definition (dead-letter queue included). */
  define(def: QueueDefinition): Promise<void> {
    return this.port.createQueue(def);
  }

  private async tryStart(delayMs: number): Promise<void> {
    if (this.stopping) return;
    try {
      await this.port.start();
    } catch (err) {
      this.opts.log?.warn({ err: errText(err), retryInMs: delayMs }, 'job queue start failed');
      this.retryTimer = setTimeout(() => void this.tryStart(Math.min(delayMs * 2, MAX_RETRY_START_MS)), delayMs);
      this.retryTimer.unref?.();
      return;
    }
    this.started = true;
    for (const p of this.pending) await this.apply(p);
    this.opts.log?.info({ adapter: this.port.kind, registrations: this.pending.length }, 'job queue started');
  }

  private register(apply: () => Promise<JobRegistration>): JobRegistration {
    const p: Pending = { apply, stopped: false };
    this.pending.push(p);
    if (this.started && !this.stopping) void this.apply(p);
    return { stop: () => this.stopOne(p) };
  }

  /**
   * Applies one registration. A failure (a database blip while queues are created) is retried with backoff until it
   * lands: a loop must never stay off for the life of the process because its first try failed.
   */
  private async apply(p: Pending, delayMs = RETRY_START_MS): Promise<void> {
    if (p.stopped || p.live || p.applying || this.stopping) return;
    p.applying = true;
    try {
      const live = await p.apply();
      p.failingSince = undefined;
      // stopped while the apply was in flight: do not leave a worker nobody holds
      if (p.stopped || this.stopping) await this.bounded(live.stop());
      else p.live = live;
    } catch (err) {
      p.failingSince ??= Date.now();
      this.opts.log?.warn({ err: errText(err), retryInMs: delayMs }, 'job registration failed');
      p.retry = setTimeout(() => void this.apply(p, Math.min(delayMs * 2, MAX_RETRY_START_MS)), delayMs);
      p.retry.unref?.();
    } finally {
      p.applying = false;
    }
  }

  private async stopOne(p: Pending): Promise<void> {
    p.stopped = true;
    clearTimeout(p.retry);
    const live = p.live;
    p.live = undefined;
    if (live) await this.bounded(live.stop());
  }

  /** Waits for `work` at most {@link STOP_WAIT_MS}: a slow job handler must not eat the shutdown's snapshot time. */
  private async bounded(work: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, STOP_WAIT_MS); timer.unref?.(); });
    await Promise.race([work.then(() => undefined, () => undefined), timeout]);
    clearTimeout(timer);
  }

  private work<T extends object>(queue: string, opts: WorkOptions, handler: JobHandler<T>) {
    return this.port.work<T>(queue, opts, async (job) => {
      try {
        await handler(job);
        this.runs?.inc({ queue, outcome: 'ok' });
      } catch (err) {
        this.runs?.inc({ queue, outcome: 'error' });
        this.opts.log?.warn({ queue, retryCount: job.retryCount, err: errText(err) }, 'job failed');
        throw err;
      }
    });
  }
}

/** A `JobsService` over a fresh in-memory adapter (unit tests and manual construction). */
export function memoryJobs(opts: Partial<JobsServiceOptions> = {}): JobsService {
  return new JobsService(new MemoryJobQueue(), { instanceKey: opts.instanceKey ?? 'test', simRole: opts.simRole ?? 'all', ...(opts.log ? { log: opts.log } : {}) });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
