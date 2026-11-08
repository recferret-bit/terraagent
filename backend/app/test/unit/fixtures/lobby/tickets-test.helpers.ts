import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { AuthResponseSchema, type AuthResponse } from '@terra/contracts';
import { expect } from 'vitest';
import { createApp } from '../../../../src/app';
import {
  AuthController,
  AuthRepository,
  AuthService,
  AuthTokenService,
  BearerAuthGuard,
} from '../../../../src/core/auth';
import { HealthController } from '../../../../src/core/health.controller';
import { HomeController, HomeRepository, HomeService } from '../../../../src/core/home';
import { MetricsRegistry } from '../../../../src/core/metrics.registry';
import { ReadinessRegistry } from '../../../../src/core/readiness.registry';
import {
  LobbyPersistenceService,
  MatchTicketsController,
  MatchTicketsService,
  MemoryLobbyStore,
  PlanetsController,
  PlanetsService,
  WorldLifecycleService,
} from '../../../../src/lobby';

const coreOnlyDir = fileURLToPath(new URL('../../../core/fixtures/base/', import.meta.url));
const lobbyOnlyDir = fileURLToPath(new URL('./', import.meta.url));

function ensureParamMetadata(target: object, types: readonly unknown[]): void {
  if (!Reflect.getMetadata('design:paramtypes', target)) {
    Reflect.defineMetadata('design:paramtypes', [...types], target);
  }
}

export function ensureDiMetadata(): void {
  ensureParamMetadata(HealthController, [ReadinessRegistry, MetricsRegistry]);
  ensureParamMetadata(AuthController, [AuthService, Object]);
  ensureParamMetadata(AuthService, [AuthRepository, AuthTokenService]);
  ensureParamMetadata(BearerAuthGuard, [AuthTokenService]);
  ensureParamMetadata(HomeController, [HomeService]);
  ensureParamMetadata(HomeService, [HomeRepository, Object]);
}

export function createTicketFixture() {
  const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
  const lifecycle = new WorldLifecycleService(persistence);
  const homeRepo = new HomeRepository();
  const homeService = new HomeService(homeRepo, undefined, persistence, lifecycle);
  const homeController = new HomeController(homeService);
  const planets = new PlanetsService(persistence, lifecycle, homeRepo);
  const planetsController = new PlanetsController(planets);
  const tickets = new MatchTicketsService(persistence, lifecycle, homeRepo, homeService);
  const controller = new MatchTicketsController(tickets);
  return {
    persistence,
    lifecycle,
    homeRepo,
    homeService,
    homeController,
    planets,
    planetsController,
    tickets,
    controller,
  };
}

export async function bootTicketsHttpApp(onAppCreated?: (app: INestApplication) => void) {
  ensureDiMetadata();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-w11-tickets-jwt-secret-0123456789',
    },
    modulesDirs: [coreOnlyDir, lobbyOnlyDir],
  });
  onAppCreated?.(created.app);
  const persistence = created.app.get(LobbyPersistenceService);
  await persistence.provisionAllCanonicalWorlds({
    foundingSeatsPerSector: 4,
    validatedSeatsPerSector: 4,
  });
  await created.app.listen(0, '127.0.0.1');
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return {
    app: created.app,
    url,
    persistence,
    lifecycle: created.app.get(WorldLifecycleService),
    homeRepo: created.app.get(HomeRepository),
    homeService: created.app.get(HomeService),
    planets: created.app.get(PlanetsService),
    tickets: created.app.get(MatchTicketsService),
  };
}

export async function registerGuest(
  url: string,
  secret: string,
  handle: string,
): Promise<AuthResponse> {
  const res = await fetch(`${url}/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceSecret: secret, handle }),
  });
  expect(res.status).toBe(200);
  return AuthResponseSchema.parse(await res.json());
}
