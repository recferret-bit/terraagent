import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';

const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** The one shared Prometheus registry: inject it and create counters/gauges with `new Counter({ ..., registers: [m.registry] })`. */
@Injectable()
export class MetricsRegistry {
  readonly registry = new Registry();

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    new Gauge({ name: 'ta_app_info', help: 'Build info', labelNames: ['version'], registers: [this.registry] }).set({ version }, 1);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
