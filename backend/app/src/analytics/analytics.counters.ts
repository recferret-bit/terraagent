import { Injectable } from '@nestjs/common';
import { Counter } from 'prom-client';
import { MetricsRegistry } from '../core/metrics.registry';

/** Server counters API (CLIENT §10.3 server-side counterparts): `counters.count('ta_planet_ws_welcome_total')`. Aggregate only, never IDs. */
@Injectable()
export class AnalyticsCounters {
  private readonly counters = new Map<string, Counter<string>>();

  constructor(private readonly metrics: MetricsRegistry) {}

  /** Increments counter `name` (created on first use; its label set is fixed by the first call). */
  count(name: string, labels: Record<string, string> = {}, by = 1): void {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter({ name, help: `Counter ${name}`, labelNames: Object.keys(labels), registers: [this.metrics.registry] });
      this.counters.set(name, c);
    }
    c.inc(labels, by);
  }
}
