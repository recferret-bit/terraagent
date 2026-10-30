import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { MetricsRegistry } from './metrics.registry';
import { ReadinessRegistry } from './readiness.registry';

@Controller()
export class HealthController {
  constructor(
    private readonly readiness: ReadinessRegistry,
    private readonly metrics: MetricsRegistry,
  ) {}

  @Get('healthz')
  healthz() {
    return { ok: true };
  }

  @Get('readyz')
  async readyz() {
    const { ok, body } = await this.readiness.run();
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metricsText(): Promise<string> {
    return this.metrics.render();
  }
}
