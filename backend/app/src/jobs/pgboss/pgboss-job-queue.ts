import { PgBoss, type JobWithMetadata, type SendOptions } from 'pg-boss';
import {
  JobQueuePort,
  type EnqueueOptions,
  type JobHandler,
  type JobRetryOptions,
  type QueueDefinition,
  type QueueStats,
  type ScheduleOptions,
  type ScheduleSpec,
  type WorkHandle,
  type WorkOptions,
} from '../job-queue.port';
import { ScheduleSet } from '../schedule/schedule-set';

export interface PgBossJobQueueOptions {
  readonly connectionString: string;
  /** Own schema on the app database (default `pgboss`). */
  readonly schema?: string;
  /** pg-boss's own pool size (it does not share Prisma's). */
  readonly poolMax?: number;
  readonly onError?: (queue: string, err: unknown) => void;
}

/** How often pg-boss removes finished job rows past their `deleteAfterSeconds`. */
export const MAINTENANCE_INTERVAL_S = 600;

const sec = (ms: number | undefined) => (ms === undefined ? undefined : Math.max(1, Math.ceil(ms / 1000)));

function retryOptions(o: JobRetryOptions): SendOptions {
  const out: SendOptions = {};
  if (o.retryLimit !== undefined) out.retryLimit = o.retryLimit;
  if (o.retryDelayMs !== undefined) out.retryDelay = o.retryDelayMs === 0 ? 0 : sec(o.retryDelayMs);
  if (o.retryBackoff !== undefined) out.retryBackoff = o.retryBackoff;
  if (o.retryDelayMaxMs !== undefined) out.retryDelayMax = sec(o.retryDelayMaxMs);
  return out;
}

/**
 * pg-boss 12 on the app's Postgres, in its own schema (installed and migrated by `start`). Queue policies carry the
 * singleton rule, `singletonSeconds` the interval slot shared by every instance, `deadLetter` the failed payloads.
 * Cron schedules use pg-boss's own scheduler (one job per occurrence cluster-wide); interval schedules fire a local
 * trigger into a throttle slot (pg-boss cron passes run every 30 s, too coarse for 5 s loops).
 */
export class PgBossJobQueue extends JobQueuePort {
  readonly kind = 'pgboss' as const;
  private boss: PgBoss;
  private readonly created = new Set<string>();
  private readonly schedules: ScheduleSet;
  private started = false;

  constructor(private readonly opts: PgBossJobQueueOptions) {
    super();
    this.boss = this.createBoss();
    this.schedules = new ScheduleSet(
      (queue, data, key, throttleMs) => this.enqueue(queue, data, { singletonKey: key, throttleMs }),
      (queue, err) => opts.onError?.(queue, err),
    );
  }

  /** A failed start (database down at boot) leaves a fresh instance for the next try. */
  async start(): Promise<void> {
    if (this.started) return;
    try {
      await this.boss.start();
    } catch (err) {
      await this.boss.stop({ graceful: false }).catch(() => undefined);
      this.boss = this.createBoss();
      throw err;
    }
    this.started = true;
    this.schedules.start();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.schedules.stop();
    // Workers were already asked to stop by their registrations; a job still running gets 5 s more, not 20.
    await this.boss.stop({ graceful: true, timeout: 5_000 });
  }

  async createQueue(def: QueueDefinition): Promise<void> {
    if (this.created.has(def.name)) return;
    if (def.deadLetter) await this.createQueue({ name: def.deadLetter });
    const options = {
      ...retryOptions(def),
      ...(def.expireInSeconds ? { expireInSeconds: def.expireInSeconds } : {}),
      ...(def.deleteAfterSeconds ? { deleteAfterSeconds: def.deleteAfterSeconds } : {}),
    };
    await this.boss.createQueue(def.name, { policy: def.policy ?? 'standard', ...options, ...(def.deadLetter ? { deadLetter: def.deadLetter } : {}) });
    // `createQueue` keeps an existing row as it was: settings changed since the queue was first created apply here,
    // including a dead-letter queue the definition no longer names (null clears it).
    if (Object.keys(options).length) await this.boss.updateQueue(def.name, { ...options, deadLetter: def.deadLetter ?? null });
    this.created.add(def.name);
  }

  async enqueue<T extends object>(queue: string, data: T, opts: EnqueueOptions = {}): Promise<string | null> {
    await this.createQueue({ name: queue });
    const send: SendOptions = { ...retryOptions(opts) };
    if (opts.singletonKey !== undefined) send.singletonKey = opts.singletonKey;
    if (opts.throttleMs !== undefined) {
      send.singletonSeconds = sec(opts.throttleMs);
      send.singletonNextSlot = false;
    }
    if (opts.startAfterMs) send.startAfter = sec(opts.startAfterMs);
    return this.boss.send(queue, data, send);
  }

  async work<T extends object>(queue: string, opts: WorkOptions, handler: JobHandler<T>): Promise<WorkHandle> {
    await this.createQueue({ name: queue });
    const options = {
      includeMetadata: true as const,
      batchSize: 1,
      localConcurrency: Math.max(1, opts.concurrency ?? 1),
      pollingIntervalSeconds: Math.max(0.5, (opts.pollMs ?? 1000) / 1000),
    };
    const id = await this.boss.work<T, void, typeof options>(queue, options, async (jobs: JobWithMetadata<T>[]) => {
      for (const job of jobs) await handler({ id: job.id, queue, data: job.data, retryCount: job.retryCount });
    });
    return { stop: () => this.boss.offWork(queue, { id, wait: true }) };
  }

  async schedule<T extends object>(queue: string, spec: ScheduleSpec, data?: T, opts?: ScheduleOptions): Promise<void> {
    await this.createQueue({ name: queue });
    const key = opts?.key ?? queue;
    if ('everyMs' in spec) {
      this.schedules.set(queue, spec, data ?? {}, key);
      return;
    }
    await this.boss.schedule(queue, spec.cron, data ?? {}, { key, ...(spec.tz ? { tz: spec.tz } : {}) });
  }

  async unschedule(queue: string, key?: string): Promise<void> {
    this.schedules.remove(queue, key ?? queue);
    await this.boss.unschedule(queue, key ?? queue).catch(() => undefined);
  }

  private createBoss(): PgBoss {
    const boss = new PgBoss({
      connectionString: this.opts.connectionString,
      schema: this.opts.schema ?? 'pgboss',
      max: this.opts.poolMax ?? 4,
      application_name: 'terraagent-jobs',
      queueCacheIntervalSeconds: 15,
      // pg-boss deletes finished rows once per maintenance interval, 24 h by default: a 5 s loop then keeps a day of
      // rows (17k per queue) whatever its `deleteAfterSeconds` says. Ten minutes keeps the tables small.
      maintenanceIntervalSeconds: MAINTENANCE_INTERVAL_S,
    });
    boss.on('error', (err: unknown) => this.opts.onError?.('pgboss', err));
    return boss;
  }

  async stats(): Promise<QueueStats[]> {
    if (!this.started) return [];
    if (this.created.size === 0) return [];
    // Only this process's queues: `instance` queues of replicas that are gone do not linger as metric series.
    const queues = await this.boss.getQueues([...this.created]);
    return queues.map((q) => ({ queue: q.name, queued: q.queuedCount, active: q.activeCount, failed: q.failedCount }));
  }
}
