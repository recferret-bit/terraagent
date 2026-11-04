import { Global, Module } from '@nestjs/common';
import { coreEnv, defineEnv, type EnvSection } from '@terra/config';
import { z } from 'zod';
import {
  AuthController,
  AuthRepository,
  AuthService,
  AuthTokenService,
  BearerAuthGuard,
} from './auth';
import { CommandPrechecks } from './command-prechecks';
import { HealthController } from './health.controller';
import { DEFAULT_AUTH_RATE_PER_MIN, IpThrottleGuard } from './ip-throttle.guard';
import { HomeController, HomeRepository, HomeService } from './home';
import { DEV_JWT_SECRET } from './auth/auth-token.service';
import { MetricsRegistry } from './metrics.registry';
import { ReadinessRegistry } from './readiness.registry';

/**
 * Env section convention: a module file may export `env` (an `EnvSection`); the app merges them all before Nest starts.
 * `JWT_ACCESS_SECRET` falls back to the public dev literal outside production only: with `NODE_ENV=production` an
 * absent or default secret aborts boot (anyone could mint access tokens with the literal from the repository).
 */
export const env: EnvSection = (() => {
  const base = defineEnv('core-app', {
    NODE_ENV: coreEnv.schema.shape.NODE_ENV,
    /** Bind address; 127.0.0.1 by default, set 0.0.0.0 to expose. */
    TA_HOST: z.string().default('127.0.0.1'),
    /** Per-layer log levels, e.g. `sim=warn,http=info` (layers: http, domain, infra, sim). */
    LOG_LEVELS: z.string().optional(),
    /** HMAC-SHA256 secret for access JWTs (at least 16 characters; required in production). */
    JWT_ACCESS_SECRET: z.string().min(16).optional(),
    /** Guest sign-ups and `/me/home` requests per client IP per minute, each route (BE-05). */
    AUTH_RATE_PER_MIN: z.coerce.number().int().positive().default(DEFAULT_AUTH_RATE_PER_MIN),
    /** Express `trust proxy` (e.g. `loopback`, `1`): behind a reverse proxy the per-IP throttle needs the client IP. */
    TA_TRUST_PROXY: z.string().optional(),
  });
  const schema = base.schema
    .superRefine((v, ctx) => {
      if (v.NODE_ENV !== 'production') return;
      if (v.JWT_ACCESS_SECRET === undefined || v.JWT_ACCESS_SECRET === DEV_JWT_SECRET)
        ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'production requires its own JWT_ACCESS_SECRET (absent or the public dev default)' });
    })
    .transform((v) => ({ ...v, JWT_ACCESS_SECRET: v.JWT_ACCESS_SECRET ?? DEV_JWT_SECRET }));
  return { name: base.name, schema } as unknown as EnvSection;
})();

/** Health, readiness, metrics, guest auth and home routing. Global: injectable from any module. */
@Global()
@Module({
  controllers: [HealthController, AuthController, HomeController],
  providers: [
    CommandPrechecks,
    ReadinessRegistry,
    MetricsRegistry,
    AuthTokenService,
    AuthRepository,
    AuthService,
    BearerAuthGuard,
    IpThrottleGuard,
    HomeRepository,
    HomeService,
  ],
  exports: [
    CommandPrechecks,
    ReadinessRegistry,
    MetricsRegistry,
    AuthTokenService,
    AuthRepository,
    AuthService,
    BearerAuthGuard,
    HomeRepository,
    HomeService,
  ],
})
export class CoreModule {}
