import { Controller, Get, Header, Res } from '@nestjs/common';
import type { HttpRes } from './logging/request-id';
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
  async readyz(@Res({ passthrough: true }) res: HttpRes) {
    const { ok, body } = await this.readiness.run();
    if (!ok) res.status(503); // probe body, not the error envelope
    return body;
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metricsText(): Promise<string> {
    return this.metrics.render();
  }
}
