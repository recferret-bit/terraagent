import { Global, Module } from '@nestjs/common';
import { defineEnv } from '@terra/config';
import { z } from 'zod';
import { HealthController } from './health.controller';
import { MetricsRegistry } from './metrics.registry';
import { ReadinessRegistry } from './readiness.registry';

/** Env section convention: a module file may export `env` (an `EnvSection`); the app merges them all before Nest starts. */
export const env = defineEnv('core-app', {
  /** Bind address; 127.0.0.1 by default, set 0.0.0.0 to expose. */
  TA_HOST: z.string().default('127.0.0.1'),
});

/** Health, readiness and metrics. Global: the registries are injectable from any module. */
@Global()
@Module({
  controllers: [HealthController],
  providers: [ReadinessRegistry, MetricsRegistry],
  exports: [ReadinessRegistry, MetricsRegistry],
})
export class CoreModule {}
