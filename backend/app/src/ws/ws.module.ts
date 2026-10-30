import { Module, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { defineEnv } from '@terra/config';
import type { Server } from 'node:http';
import { z } from 'zod';
import { MetricsRegistry } from '../core/metrics.registry';
import { layerLogger } from '../core/logging/logger';
import { APP_ENV, LOGGER, type AppEnv, type RootLogger } from '../core/tokens';
import { FlagsService } from '../flags/flags.service';
import { GameModule } from '../game/game.module';
import { GamePlanets } from '../game/game-planets.service';
import { COMMAND_INGRESS, type CommandIngress } from './command-ingress';
import { SimCommandIngress } from './sim-command-ingress';
import { DevSessionVerifier, SESSION_VERIFIER, type SessionVerifier } from './session-verifier';
import { WsGateway } from './ws.gateway';

export const env = defineEnv('ws', {
  /** A socket must send `hello` within this time (WS-10). */
  WS_HELLO_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  /** A socket silent for this long is closed with 1001 (WS-14). */
  WS_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

/** WebSocket gateway on `/ws` (PROTOCOL §4). Rebind `SESSION_VERIFIER` (W01: JWT) and `COMMAND_INGRESS` (commands) from their issues. */
@Module({
  imports: [GameModule],
  providers: [
    { provide: SESSION_VERIFIER, inject: [APP_ENV], useFactory: (e: AppEnv): SessionVerifier => new DevSessionVerifier(e.NODE_ENV === 'production') },
    {
      provide: COMMAND_INGRESS,
      inject: [APP_ENV, MetricsRegistry, FlagsService, GamePlanets],
      useFactory: (e: AppEnv, m: MetricsRegistry, flags: FlagsService, planets: GamePlanets): CommandIngress =>
        new SimCommandIngress({ planets, flags, registry: m.registry, production: e.NODE_ENV === 'production' }),
    },
    {
      provide: WsGateway,
      inject: [APP_ENV, LOGGER, MetricsRegistry, FlagsService, GamePlanets, SESSION_VERIFIER, COMMAND_INGRESS],
      useFactory: (e: AppEnv, root: RootLogger, m: MetricsRegistry, flags: FlagsService, planets: GamePlanets, verifier: SessionVerifier, ingress: CommandIngress) =>
        new WsGateway({
          env: e, planets, verifier, ingress, flags: flags.list, registry: m.registry,
          log: layerLogger(root, 'http', e.LOG_LEVELS as string | undefined),
          helloTimeoutMs: Number(e.WS_HELLO_TIMEOUT_MS), idleTimeoutMs: Number(e.WS_IDLE_TIMEOUT_MS),
        }),
    },
  ],
})
export class WsModule implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(private readonly gateway: WsGateway, private readonly host: HttpAdapterHost) {}

  onApplicationBootstrap(): void {
    this.gateway.attach(this.host.httpAdapter.getHttpServer() as Server);
  }

  /** Runs before every `onApplicationShutdown`, i.e. before the game module stops its threads. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.gateway.closeAll();
  }
}
