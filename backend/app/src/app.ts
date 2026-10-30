import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { coreEnv, parseEnv, readEnvSource, type EnvSection } from '@terra/config';
import type { DestinationStream, Logger } from 'pino';
import { corsOrigin } from './core/cors';
import { AllExceptionsFilter } from './core/errors/all-exceptions.filter';
import { createRootLogger, layerLogger } from './core/logging/logger';
import { PinoNestLogger } from './core/logging/nest-logger';
import { requestIdMiddleware } from './core/logging/request-id';
import { APP_ENV, LOGGER, type AppEnv } from './core/tokens';
import { discoverModules } from './discovery';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export interface CreateAppOptions {
  /** Environment source; default: process.env merged with `.env` files under the repo root. */
  readonly source?: Record<string, string | undefined>;
  /** Directories scanned for `<name>/<name>.module.ts`; default: this folder (`src/`). Tests add fixture dirs. */
  readonly modulesDirs?: readonly string[];
  /** Test hook: pino output destination (default stdout). */
  readonly logDestination?: DestinationStream;
}

export interface CreatedApp {
  readonly app: INestApplication;
  readonly env: AppEnv;
  readonly modules: readonly string[];
}

@Module({})
class AppModule {
  static build(imports: DynamicModule['imports'], env: AppEnv, logger: Logger): DynamicModule {
    return { module: AppModule, global: true, imports, providers: [{ provide: APP_ENV, useValue: env }, { provide: LOGGER, useValue: logger }], exports: [APP_ENV, LOGGER] };
  }
}

/** Builds (does not listen) the app: parse env of every module, discover modules, wire CORS, prefix and shutdown hooks. Throws `EnvError` on bad env. */
export async function createApp(options: CreateAppOptions = {}): Promise<CreatedApp> {
  const found = (await Promise.all((options.modulesDirs ?? [here('./')]).map(discoverModules))).flat();
  const sections: EnvSection[] = [coreEnv, ...found.flatMap((m) => (m.env ? [m.env] : []))];
  const source = options.source ?? readEnvSource(here('../../../'));
  const env = parseEnv(sections, source) as unknown as AppEnv;
  const root = createRootLogger({ level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV, layerLevels: env.LOG_LEVELS as string | undefined, destination: options.logDestination });
  const app = await NestFactory.create(AppModule.build(found.map((m) => m.module), env, root), { logger: false });
  app.useLogger(new PinoNestLogger(layerLogger(root, 'infra', env.LOG_LEVELS as string | undefined)));
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter(layerLogger(root, 'http', env.LOG_LEVELS as string | undefined), env.NODE_ENV === 'production'));
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: corsOrigin(env) });
  app.enableShutdownHooks();
  return { app, env, modules: found.map((m) => m.name) };
}
