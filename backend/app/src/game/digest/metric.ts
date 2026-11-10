import { Gauge, type Registry } from 'prom-client';

/** `digest_rows`: rows in `world.planet_event_digest`. `rows` must be O(1); a scrape must not scan the table. */
export function installDigestRowsGauge(registry: Registry, rows: () => number): void {
  new Gauge({
    name: 'digest_rows',
    help: 'Rows in world.planet_event_digest',
    registers: [registry],
    collect() {
      this.set(rows());
    },
  });
}
