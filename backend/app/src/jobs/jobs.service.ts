import { Inject, Injectable, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Logger } from 'pino';
import { MetricsRegistry } from '../core/metrics.registry';
import { JobQueuePort, type JobHandler, type QueueDefinition, type WorkOptions } from './job-queue.port';
import { installJobMetrics, type JobRunCounter } from './jobs-metrics';
import { MemoryJobQueue } from './memory/memory-job-queue';
import {
  canHostSim,
  deadLetterOf,
  instanceQueue,
  LOOP_RETRY,
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

interface Pending {
  readonly apply: () => Promise<JobRegistration>;
  live?: JobRegistration;
  stopped: boolean;
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
  ) {
    this.runs = metrics ? installJobMetrics(metrics.registry, () => this.port) : undefined;
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
      await this.define({ name: queue, policy: def.policy ?? 'exclusive', ...(def.retry ?? LOOP_RETRY), deadLetter: deadLetterOf(def.name) });
      const worker = await this.work(queue, { concurrency: 1 }, () => def.run().then(() => undefined));
      await this.port.schedule(queue, def.schedule);
      return { stop: async () => { await this.port.unschedule(queue); await worker.stop(); } };
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
    for (const p of this.pending) await this.stopOne(p);
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

  private async apply(p: Pending): Promise<void> {
    if (p.stopped || p.live) return;
    try {
      p.live = await p.apply();
    } catch (err) {
      this.opts.log?.warn({ err: errText(err) }, 'job registration failed');
    }
  }

  private async stopOne(p: Pending): Promise<void> {
    p.stopped = true;
    const live = p.live;
    p.live = undefined;
    await live?.stop().catch(() => undefined);
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
