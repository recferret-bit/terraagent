import { Inject, Module, Optional, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { HttpAdapterHost } from '@nestjs/core';
import { defineEnv } from '@terra/config';
import type { Server } from 'node:http';
import { z } from 'zod';
import { AuthTokenService } from '../core/auth/auth-token.service';
import { EventBus } from '../bus/event-bus';
import { CoreModule } from '../core/core.module';
import { HomeRepository } from '../core/home/home.repository';
import { HomeService } from '../core/home/home.service';
import { MetricsRegistry } from '../core/metrics.registry';
import { layerLogger } from '../core/logging/logger';
import { databaseEnabled } from '../core/persistence';
import { APP_ENV, LOGGER, type AppEnv, type RootLogger } from '../core/tokens';
import { PRISMA } from '../db/db.module';
import { seatDevScenarioPlayer } from '../near/identity/dev-scenario-seat';
import { FlagsService } from '../flags/flags.service';
import { AwayDigestService } from '../game/digest';
import { GameModule } from '../game/game.module';
import { GamePlanets } from '../game/game-planets.service';
import { createPresenceTracker } from '../game/presence';
import { CommandPrechecks } from '../core/command-prechecks';
import { SectorAntiCheatService } from '../core/anticheat';
import { PlanetsService } from '../lobby/planets.service';
import { COMMAND_INGRESS, type CommandIngress } from './command-ingress';
import { DbHomeProvider, HOME_PROVIDER, type HomeProvider } from './home-provider';
import { HttpCommandController } from './http-commands.controller';
import { LiveStatsTelemetry } from './live-stats-telemetry';
import { SimCommandIngress } from './sim-command-ingress';
import { JwtSessionVerifier, SESSION_VERIFIER, type SessionVerifier } from './session-verifier';
import { WsGateway } from './ws.gateway';

export const env = defineEnv('ws', {
  /** A socket must send `hello` within this time (WS-10). */
  WS_HELLO_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  /** A socket silent for this long is closed with 1001 (WS-14). */
  WS_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

/** WebSocket gateway on `/ws` (PROTOCOL §4). */
@Module({
  imports: [CoreModule, GameModule],
  controllers: [HttpCommandController],
  providers: [
    {
      provide: SESSION_VERIFIER,
      inject: [APP_ENV, AuthTokenService],
      useFactory: (e: AppEnv, tokens: AuthTokenService): SessionVerifier =>
        new JwtSessionVerifier(tokens, e.NODE_ENV === 'production'),
    },
    {
      provide: HOME_PROVIDER,
      inject: [{ token: HomeService, optional: true }],
      useFactory: (homeService?: HomeService): HomeProvider => new DbHomeProvider(homeService),
    },
    {
      provide: COMMAND_INGRESS,
      inject: [
        APP_ENV,
        MetricsRegistry,
        FlagsService,
        GamePlanets,
        { token: HomeRepository, optional: true },
        { token: CommandPrechecks, optional: true },
        { token: SectorAntiCheatService, optional: true },
      ],
      useFactory: (
        e: AppEnv,
        m: MetricsRegistry,
        flags: FlagsService,
        planets: GamePlanets,
        homeRepo?: HomeRepository,
        prechecks?: CommandPrechecks,
        antiCheat?: SectorAntiCheatService,
      ): CommandIngress =>
        new SimCommandIngress({
          planets,
          flags,
          registry: m.registry,
          production: e.NODE_ENV === 'production',
          homeRepo,
          prechecks,
          antiCheat,
        }),
    },
    {
      provide: WsGateway,
      inject: [
        APP_ENV,
        LOGGER,
        MetricsRegistry,
        FlagsService,
        GamePlanets,
        SESSION_VERIFIER,
        COMMAND_INGRESS,
        HOME_PROVIDER,
        AwayDigestService,
        { token: PRISMA, optional: true },
        { token: EventBus, optional: true },
        { token: SectorAntiCheatService, optional: true },
      ],
      useFactory: (
        e: AppEnv,
        root: RootLogger,
        m: MetricsRegistry,
        flags: FlagsService,
        planets: GamePlanets,
        verifier: SessionVerifier,
        ingress: CommandIngress,
        home: HomeProvider,
        digests: AwayDigestService,
        prisma?: PrismaClient,
        bus?: EventBus,
        antiCheat?: SectorAntiCheatService,
      ) =>
        new WsGateway({
          env: e, planets, verifier, ingress, home, antiCheat, flags: flags.list, registry: m.registry,
          log: layerLogger(root, 'http', e.LOG_LEVELS as string | undefined),
          helloTimeoutMs: Number(e.WS_HELLO_TIMEOUT_MS), idleTimeoutMs: Number(e.WS_IDLE_TIMEOUT_MS),
          digests,
          presence: createPresenceTracker({
            commands: planets,
            prisma: prisma && databaseEnabled(e) ? prisma : undefined,
            log: layerLogger(root, 'http', e.LOG_LEVELS as string | undefined),
            onTransition: (info) => digests.onPresence(info),
          }),
          seatDevScenario: prisma && databaseEnabled(e)
            ? async (input) => {
                const colonyIndex = await seatDevScenarioPlayer(prisma, input);
                if (colonyIndex !== undefined) bus?.emit('dev.scenario.seated', { planetId: input.planetId, playerId: input.playerId, colonyIndex }); // dev fixtures (W13-35)
              }
            : undefined,
          bus,
        }),
    },
    LiveStatsTelemetry,
  ],
})
export class WsModule implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private unsubSeatTelemetry: (() => void) | null = null;

  constructor(
    private readonly gateway: WsGateway,
    private readonly host: HttpAdapterHost,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Optional() private readonly planetsService?: PlanetsService,
    @Optional() private readonly telemetry?: LiveStatsTelemetry,
    @Optional() private readonly homeService?: HomeService,
    @Optional() private readonly gamePlanets?: GamePlanets,
  ) {}

  onApplicationBootstrap(): void {
    this.gateway.attach(this.host.httpAdapter.getHttpServer() as Server);
    if (this.env.NODE_ENV !== 'test' && this.planetsService && this.telemetry) {
      this.planetsService.setLiveTelemetryProvider(this.telemetry);
      this.unsubSeatTelemetry?.();
      this.unsubSeatTelemetry = this.homeService?.onColonySeated(() => {
        this.telemetry?.invalidate();
      }) ?? null;
      this.gamePlanets?.onPlanetLoaded(() => {
        this.telemetry?.invalidate();
      });
    }
  }

  /** Runs before every `onApplicationShutdown`, i.e. before the game module stops its threads. */
  async beforeApplicationShutdown(): Promise<void> {
    this.unsubSeatTelemetry?.();
    this.unsubSeatTelemetry = null;
    this.planetsService?.setLiveTelemetryProvider(undefined);
    await this.gateway.closeAll();
  }
}
