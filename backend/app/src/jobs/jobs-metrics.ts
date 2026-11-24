import { Counter, Gauge, type Registry } from 'prom-client';
import type { JobQueuePort } from './job-queue.port';

/** Outcome counter of the job handlers this process ran. */
export type JobRunCounter = Counter<'queue' | 'outcome'>;

/**
 * `/v1/metrics`: queue depth, running and failed jobs per queue (read from the adapter at scrape time; pg-boss answers
 * from its queue cache, refreshed every 15 s) and a per-process count of job runs by outcome.
 */
export function installJobMetrics(registry: Registry, port: () => JobQueuePort): JobRunCounter {
  const read = async () => {
    try {
      return await port().stats();
    } catch {
      return [];
    }
  };
  const gauge = (name: string, help: string, pick: (s: Awaited<ReturnType<typeof read>>[number]) => number) =>
    new Gauge({
      name, help, labelNames: ['queue'], registers: [registry],
      async collect() {
        this.reset();
        for (const s of await read()) this.set({ queue: s.queue }, pick(s));
      },
    });
  gauge('ta_jobs_queued', 'Jobs waiting per queue (created, retry or deferred)', (s) => s.queued);
  gauge('ta_jobs_active', 'Jobs running per queue', (s) => s.active);
  gauge('ta_jobs_failed', 'Jobs failed for good per queue (still retained)', (s) => s.failed);
  return new Counter({ name: 'ta_jobs_runs_total', help: 'Job runs in this process by outcome', labelNames: ['queue', 'outcome'], registers: [registry] });
}
