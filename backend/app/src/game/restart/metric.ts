import { Histogram, type Registry } from 'prom-client';

export interface FastRunSource {
  onFastRun(fn: (planetId: string, seconds: number, ticks: number) => void): void;
}

/** CONTINUITY §9 `restart_fastrun_seconds{planet}`: wall time of one planet's restart catch-up. */
export function installRestartFastRunMetric(planets: FastRunSource, registry: Registry): void {
  const seconds = new Histogram({
    name: 'restart_fastrun_seconds',
    help: 'Wall seconds to fast-run one planet after a restart (CT-51)',
    labelNames: ['planet'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600],
    registers: [registry],
  });
  planets.onFastRun((planetId, wallSeconds) => {
    seconds.observe({ planet: planetId }, wallSeconds);
  });
}
