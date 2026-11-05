import { Gauge, type Registry } from 'prom-client';

/**
 * A gauge recomputed at every scrape: `fill` gets a `set(labels, value)` and runs after the previous series are cleared.
 * A failing `fill` (database down, table not migrated) leaves the gauge empty instead of failing the whole `/metrics` scrape.
 */
export function scrapeGauge<L extends string>(
  registry: Registry,
  def: { name: string; help: string; labelNames: readonly L[] },
  fill: (set: (labels: Record<L, string>, value: number) => void) => void | Promise<void>,
): Gauge<L> {
  const gauge: Gauge<L> = new Gauge({
    ...def,
    labelNames: def.labelNames,
    registers: [registry],
    async collect() {
      gauge.reset();
      try {
        await fill((labels, value) => gauge.set(labels, value));
      } catch {
        gauge.reset();
      }
    },
  });
  return gauge;
}
