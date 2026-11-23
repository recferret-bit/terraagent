import {
  JobQueuePort,
  type EnqueueOptions,
  type JobHandler,
  type QueueDefinition,
  type QueueStats,
  type ScheduleOptions,
  type ScheduleSpec,
  type WorkHandle,
  type WorkOptions,
} from '../job-queue.port';
import { ScheduleSet } from '../schedule/schedule-set';
import { MemoryQueue } from './memory-queue';

/**
 * In-process adapter (tests, `JOB_QUEUE=memory`, no database). Same contract as pg-boss, but jobs live only in this
 * process: a restart loses queued jobs and two instances do not share slots or keys.
 */
export class MemoryJobQueue extends JobQueuePort {
  readonly kind = 'memory' as const;
  private readonly queues = new Map<string, MemoryQueue>();
  private readonly workers = new Map<string, Set<{ stop(): Promise<void> }>>();
  private readonly schedules: ScheduleSet;
  private started = false;

  constructor(private readonly onError: (queue: string, err: unknown) => void = () => undefined, private readonly now: () => number = () => Date.now()) {
    super();
    this.schedules = new ScheduleSet((queue, data, key, throttleMs) => this.enqueue(queue, data, { singletonKey: key, throttleMs }), onError);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.schedules.start();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.schedules.stop();
    for (const set of this.workers.values()) for (const w of [...set]) await w.stop();
    for (const q of this.queues.values()) q.stop();
  }

  async createQueue(def: QueueDefinition): Promise<void> {
    if (this.queues.has(def.name)) return;
    if (def.deadLetter && !this.queues.has(def.deadLetter)) await this.createQueue({ name: def.deadLetter });
    this.queues.set(def.name, new MemoryQueue(def, (dlq, data) => void this.enqueue(dlq, data), this.now));
  }

  async enqueue<T extends object>(queue: string, data: T, opts?: EnqueueOptions): Promise<string | null> {
    return this.queue(queue).enqueue(data, opts);
  }

  async work<T extends object>(queue: string, opts: WorkOptions, handler: JobHandler<T>): Promise<WorkHandle> {
    const q = this.queue(queue);
    const worker = q.work(handler as JobHandler<object>, opts.concurrency ?? 1);
    let set = this.workers.get(queue);
    if (!set) this.workers.set(queue, (set = new Set()));
    const handle = {
      stop: async () => {
        set.delete(handle);
        await q.stopWorker(worker);
      },
    };
    set.add(handle);
    return handle;
  }

  async schedule<T extends object>(queue: string, spec: ScheduleSpec, data?: T, opts?: ScheduleOptions): Promise<void> {
    this.queue(queue);
    this.schedules.set(queue, spec, data ?? {}, opts?.key ?? queue);
  }

  async unschedule(queue: string, key?: string): Promise<void> {
    this.schedules.remove(queue, key ?? queue);
  }

  async stats(): Promise<QueueStats[]> {
    return [...this.queues.values()].map((q) => q.stats());
  }

  /** A queue used before `createQueue` gets the defaults (pg-boss would refuse; tests stay short). */
  private queue(name: string): MemoryQueue {
    let q = this.queues.get(name);
    if (!q) {
      q = new MemoryQueue({ name }, (dlq, data) => void this.enqueue(dlq, data), this.now);
      this.queues.set(name, q);
    }
    return q;
  }
}
