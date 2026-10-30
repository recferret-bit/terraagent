import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { coreEnv, parseEnv, readEnvSource, type EnvSection } from '@terra/config';
import { corsOrigin } from './core/cors';
import { APP_ENV, type AppEnv } from './core/tokens';
import { discoverModules } from './discovery';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export interface CreateAppOptions {
  /** Environment source; default: process.env merged with `.env` files under the repo root. */
  readonly source?: Record<string, string | undefined>;
  /** Directories scanned for `<name>/<name>.module.ts`; default: this folder (`src/`). Tests add fixture dirs. */
  readonly modulesDirs?: readonly string[];
  readonly logger?: false | ('log' | 'error' | 'warn' | 'debug' | 'verbose')[];
}

export interface CreatedApp {
  readonly app: INestApplication;
  readonly env: AppEnv;
  readonly modules: readonly string[];
}

@Module({})
class AppModule {
  static build(imports: DynamicModule['imports'], env: AppEnv): DynamicModule {
    return { module: AppModule, global: true, imports, providers: [{ provide: APP_ENV, useValue: env }], exports: [APP_ENV] };
  }
}

/** Builds (does not listen) the app: parse env of every module, discover modules, wire CORS, prefix and shutdown hooks. Throws `EnvError` on bad env. */
export async function createApp(options: CreateAppOptions = {}): Promise<CreatedApp> {
  const found = (await Promise.all((options.modulesDirs ?? [here('./')]).map(discoverModules))).flat();
  const sections: EnvSection[] = [coreEnv, ...found.flatMap((m) => (m.env ? [m.env] : []))];
  const source = options.source ?? readEnvSource(here('../../../'));
  const env = parseEnv(sections, source) as unknown as AppEnv;
  const app = await NestFactory.create(AppModule.build(found.map((m) => m.module), env), {
    logger: options.logger ?? (env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error']),
  });
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: corsOrigin(env) });
  app.enableShutdownHooks();
  return { app, env, modules: found.map((m) => m.name) };
}
