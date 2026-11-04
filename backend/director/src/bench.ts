import { summarizeRelevant, syntheticWorld } from '@terra/sim';
import { arch, cpus, totalmem } from 'node:os';

export interface LoadReport {
  readonly hardware: string;
  readonly samples: number;
  readonly p95Ms: number;
  readonly rssMb: number;
  readonly pool: string;
  readonly oldestJobAgeMs: number;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

/** Times bounded sector summaries. Does not allocate a planet or call a provider. */
export function loadReport(samples = 50): LoadReport {
  const world = syntheticWorld(450);
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    summarizeRelevant(world);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const cpu = cpus()[0]?.model ?? 'unknown';
  return {
    hardware: `${cpu} ${arch()} ${cpus().length} cores ${Math.round(totalmem() / 2 ** 30)}gb`,
    samples,
    p95Ms: Math.round(percentile(times, 95) * 1000) / 1000,
    rssMb: Math.round(process.memoryUsage().rss / 2 ** 20),
    pool: 'in-memory 1',
    oldestJobAgeMs: 0,
  };
}
