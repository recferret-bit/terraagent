import type { ScheduleSpec } from '../job-queue.port';
import { nextCronMs, parseCron } from './cron';
import { ScheduleTrigger, slotNext } from './slot-trigger';

/** Creates one job for a schedule occurrence (`throttleMs` set for interval schedules). */
export type ScheduleFire = (queue: string, data: object, key: string, throttleMs: number | undefined) => Promise<unknown>;

/**
 * The local timers of every schedule an adapter owns, by `queue` + `key`. Interval schedules fire into a throttle slot;
 * the memory adapter also fires cron ones here (pg-boss runs cron itself).
 */
export class ScheduleSet {
  private readonly triggers = new Map<string, ScheduleTrigger>();
  private running = false;

  constructor(private readonly fire: ScheduleFire, private readonly onError: (queue: string, err: unknown) => void) {}

  set(queue: string, spec: ScheduleSpec, data: object, key: string): void {
    this.remove(queue, key);
    const next = 'everyMs' in spec ? slotNext(spec.everyMs) : cronNext(spec.cron);
    const throttleMs = 'everyMs' in spec ? spec.everyMs : undefined;
    const trigger = new ScheduleTrigger(next, () => this.fire(queue, data, key, throttleMs), (e) => this.onError(queue, e));
    this.triggers.set(id(queue, key), trigger);
    if (this.running) trigger.start();
  }

  remove(queue: string, key: string): void {
    this.triggers.get(id(queue, key))?.stop();
    this.triggers.delete(id(queue, key));
  }

  start(): void {
    this.running = true;
    for (const t of this.triggers.values()) t.start();
  }

  stop(): void {
    this.running = false;
    for (const t of this.triggers.values()) t.stop();
  }
}

function cronNext(expr: string): (fromMs: number) => number | null {
  const fields = parseCron(expr);
  return (fromMs) => nextCronMs(fields, fromMs);
}

const id = (queue: string, key: string) => `${queue}\0${key}`;
