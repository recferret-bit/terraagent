import { Global, Module } from '@nestjs/common';
import { defineEnv } from '@terra/config';
import { z } from 'zod';
import {
  AuthController,
  AuthRepository,
  AuthService,
  AuthTokenService,
  BearerAuthGuard,
} from './auth';
import { HealthController } from './health.controller';
import { MetricsRegistry } from './metrics.registry';
import { ReadinessRegistry } from './readiness.registry';

/** Env section convention: a module file may export `env` (an `EnvSection`); the app merges them all before Nest starts. */
export const env = defineEnv('core-app', {
  /** Bind address; 127.0.0.1 by default, set 0.0.0.0 to expose. */
  TA_HOST: z.string().default('127.0.0.1'),
  /** Per-layer log levels, e.g. `sim=warn,http=info` (layers: http, domain, infra, sim). */
  LOG_LEVELS: z.string().optional(),
  /** HMAC-SHA256 secret for access JWTs. */
  JWT_ACCESS_SECRET: z.string().min(16).default('terra-dev-jwt-secret-change-in-prod'),
});

/** Health, readiness, metrics and guest auth. Global: the registries and auth services are injectable from any module. */
@Global()
@Module({
  controllers: [HealthController, AuthController],
  providers: [
    ReadinessRegistry,
    MetricsRegistry,
    AuthTokenService,
    AuthRepository,
    AuthService,
    BearerAuthGuard,
  ],
  exports: [
    ReadinessRegistry,
    MetricsRegistry,
    AuthTokenService,
    AuthRepository,
    AuthService,
    BearerAuthGuard,
  ],
})
export class CoreModule {}
