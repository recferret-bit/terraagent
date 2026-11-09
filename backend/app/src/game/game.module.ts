import { availableParallelism } from 'node:os';
import { Inject, Module, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { PrismaClient } from '@terra/db';
import { defineEnv } from '@terra/config';
import { DEV_PLANET_CAPACITY, DEV_PLANET_RADIUS, DEV_PLANET_SEED, DEV_PLANET_TYPE, mergeOverrides, type BalanceOverrides } from '@terra/sim';
import type { Logger } from 'pino';
import { Counter, Gauge } from 'prom-client';
import { z } from 'zod';
import { EventBus } from '../bus/event-bus';
import { HomeService } from '../core/home/home.service';
import { PRISMA } from '../db/db.module';
import { FlagsService } from '../flags/flags.service';
import { MetricsRegistry } from '../core/metrics.registry';
import { ReadinessRegistry } from '../core/readiness.registry';
import { layerLogger } from '../core/logging/logger';
import { APP_ENV, LOGGER, type AppEnv } from '../core/tokens';
import { EconomyActivationService } from '../economy/activation/activation.service';
import { installAwayPolicyMetric } from './away-rejections';
import { installPlanetModeGauge } from './planet-mode-metric';
import { EconomyActivationBridge, STATIC_OVERRIDES, SWAPPER } from './economy-activation-bridge';
import { ProfileSwapper } from './profile-swap';
import { EconomyModule } from '../economy/economy.module';
import { EconomyProfileService } from '../economy/profile/profile.service';
import { WorldLifecycleService } from '../lobby/lifecycle.service';
import { loadBalanceOverrides } from './balance-overrides';
import { bridgePlanetEvents } from './bus-bridge';
import { attachAwayDigest, AwayDigestService, createDigestStory, installDigestRowsGauge, liveBaselineReader, MemoryDigestStore, PrismaDigestStore } from './digest';
import { DevPlanetsController } from './dev-planets.controller';
import { devPlanetIds, devPlanetsToGenerate } from './dev-planets';
import { GamePlanets } from './game-planets.service';
import { DevPresence } from './presence/dev-presence';
import { HardModeClock } from './presence/hard-mode-clock';
import { gameLandingHost } from './home-landing-host';
import { DevLedgerController } from './ledger/dev-ledger.controller';
import { InMemoryLedgerStore } from './ledger/in-memory-ledger-store';
import { LedgerStorePort } from './ledger/ledger-store.port';
import { EconomyTelemetry } from '../economy/telemetry/economy-telemetry';
import { PlanetLedgerService } from './ledger/planet-ledger.service';
import { PrismaLedgerStore } from './ledger/prisma-ledger-store';
import { persistenceEnabled } from '../core/persistence';
import { PlanetHeldError, SnapshotService } from './persistence/snapshot.service';
import { SnapshotStore } from './persistence/snapshot-store';
import { ProgressionEventForwarder } from './progression-events.service';
import { wirePlanetRecovery } from './planet-recovery';
import { installRestartFastRunMetric } from './restart/metric';
import { installFastRunAlertHold } from './restart/notify-hold';
import { AlertRouter } from '../notify/alert-router';
import { installNotifyMetrics } from '../notify/metrics';
import { gameSeatHost, seatAndRegisterColony } from './seat-colony';
import { SimThreadPool } from './sim-thread-pool';
import { W00_PLANET_TYPE } from './thread/protocol';

export const env = defineEnv('game', {
  /** Sim worker threads (SIM-H-01); default: cores - 1, at least 1. */
  SIM_THREADS: z.coerce.number().int().positive().default(Math.max(1, availableParallelism() - 1)),
  /** Seconds between periodic snapshots per planet (SIM-H-06); fractional allowed. */
  SNAPSHOT_EVERY_S: z.coerce.number().positive().default(60),
  /** Snapshot persistence on/off; unset = on, except NODE_ENV=test (unit tests must not read the dev database). */
  SNAPSHOTS: z.enum(['on', 'off']).optional(),
  /** Deltas per second per subscribed planet (D-31). */
  DELTA_HZ: z.coerce.number().positive().max(20).default(5),
  /** Path to `balance.overrides.json` (D-35): design-unit overrides merged over the data rows at compile time; unset = none. */
  TA_BALANCE_OVERRIDES: z.string().optional().superRefine((path, ctx) => {
    try { loadBalanceOverrides(path, []); } catch (e) { ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : String(e) }); }
  }),
  /** Number of dev planets loaded at boot, spread evenly over the threads (desert with W01, the flat W00 planet without). */
  GAME_DEV_PLANETS: z.coerce.number().int().min(0).default(0),
  /** Default real-world hours for 1 full planetary day (24 solar hours); unset = data table default (0.25 h). */
  PLANET_DAY_HOURS: z.coerce.number().min(0.005).max(168).optional(),
  /** Default planetary time-scale multiplier; unset = data table default (1). */
  PLANET_TIME_SCALE: z.coerce.number().min(0).max(1000).optional(),
  /**
   * CT-34 away paragraph. Unset is on in production and off elsewhere.
   * Only `true` or `false`; any other value aborts boot.
   */
  AWAY_STORY_ENABLED: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === '' || v === 'true' || v === 'false', { message: 'must be true or false' }),
});

const POOL = Symbol('SIM_THREAD_POOL');

@Module({
  imports: [EconomyModule],
  controllers: [DevPlanetsController, DevLedgerController],
  providers: [
    {
      provide: POOL,
      inject: [APP_ENV, FlagsService, EconomyProfileService, STATIC_OVERRIDES],
      useFactory: async (e: AppEnv, f: FlagsService, economy: EconomyProfileService, staticOverrides: BalanceOverrides) => {
        // Pinned economy profile (D-44): the active global version is read ONCE here and compiled into plain overrides; the
        // file overrides (TA_BALANCE_OVERRIDES) and the env time settings layer on top. Sim threads never touch the DB.
        const profile = await economy.bootOverrides();
        return new SimThreadPool({ threads: Number(e.SIM_THREADS), flags: f.list, deltaHz: Number(e.DELTA_HZ), overrides: mergeOverrides(profile, staticOverrides) });
      },
    },
    {
      provide: STATIC_OVERRIDES,
      inject: [APP_ENV, FlagsService],
      useFactory: (e: AppEnv, f: FlagsService): BalanceOverrides => {
        const file = loadBalanceOverrides(e.TA_BALANCE_OVERRIDES as string | undefined, f.list);
        const realHoursPerDay = e.PLANET_DAY_HOURS as number | undefined;
        const timeScale = e.PLANET_TIME_SCALE as number | undefined;
        const envTime: BalanceOverrides =
          realHoursPerDay !== undefined || timeScale !== undefined
            ? { time: { cycle: { ...(realHoursPerDay !== undefined ? { realHoursPerDay } : {}), ...(timeScale !== undefined ? { timeScale } : {}) } } }
            : {};
        return mergeOverrides(file, envTime);
      },
    },
    { provide: SWAPPER, inject: [POOL], useFactory: (pool: SimThreadPool) => new ProfileSwapper(pool) },
    {
      provide: EconomyActivationBridge,
      inject: [EconomyProfileService, EconomyActivationService, SWAPPER, STATIC_OVERRIDES],
      useFactory: (p: EconomyProfileService, a: EconomyActivationService, sw: ProfileSwapper, st: BalanceOverrides) => new EconomyActivationBridge(p, a, sw, st),
    },
    { provide: GamePlanets, inject: [POOL, APP_ENV], useFactory: (pool: SimThreadPool, e: AppEnv) => new GamePlanets(pool, Number(e.DELTA_HZ)) },
    SnapshotStore,
    {
      // The journal persists with the snapshots (same switch): Postgres, or in memory under NODE_ENV=test / SNAPSHOTS=off.
      provide: LedgerStorePort,
      inject: [APP_ENV, PRISMA],
      useFactory: (e: AppEnv, prisma: PrismaClient) => (persistenceEnabled(e) ? new PrismaLedgerStore(prisma) : new InMemoryLedgerStore()),
    },
    PlanetLedgerService,
    EconomyTelemetry,
    SnapshotService,
    ProgressionEventForwarder,
    HardModeClock,
    DevPresence,
    {
      provide: AwayDigestService,
      inject: [APP_ENV, PRISMA, GamePlanets, LOGGER],
      useFactory: (e: AppEnv, prisma: PrismaClient, planets: GamePlanets, root: Logger) => new AwayDigestService({
        store: persistenceEnabled(e) ? new PrismaDigestStore(prisma) : new MemoryDigestStore(),
        reader: liveBaselineReader(planets),
        log: layerLogger(root, 'sim', e.LOG_LEVELS as string | undefined),
        story: createDigestStory(e),
      }),
    },
  ],
  exports: [GamePlanets, ProgressionEventForwarder, SnapshotService, AwayDigestService, HardModeClock, DevPresence],
})
export class GameModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private unsubBridge: (() => void) | undefined;
  private unsubDigest: (() => void) | undefined;
  private unsubHomeSeat: (() => void) | undefined;
  private unsubRecovery: (() => void) | undefined;
  private readonly log: Logger;

  constructor(
    @Inject(POOL) private readonly pool: SimThreadPool,
    private readonly planets: GamePlanets,
    private readonly snapshots: SnapshotService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly flags: FlagsService,
    private readonly metrics: MetricsRegistry,
    private readonly readiness: ReadinessRegistry,
    private readonly bus: EventBus,
    private readonly progressionForwarder: ProgressionEventForwarder,
    private readonly digests: AwayDigestService,
    @Inject(LOGGER) root: Logger,
    private readonly modules: ModuleRef,
    @Optional() private readonly homeService?: HomeService,
  ) {
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.snapshots.setDigestFlush((planetId, raw) => this.digests.flushPlanet(planetId, raw));
    this.unsubDigest = attachAwayDigest(this.bus, this.digests);
    try { await this.digests.restoreOpen(); } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'digest restore failed');
    }
    this.wireSnapshotSavePoints();
    await this.pool.start();
    this.unsubBridge = bridgePlanetEvents(this.planets, this.bus, this.progressionForwarder, this.log);
    const home = this.homeService;
    if (home) {
      const host = gameSeatHost(this.snapshots, this.planets, this.log, (a) => home.adoptLateLanding(a));
      this.unsubHomeSeat = home.onColonySeated((assignment) => seatAndRegisterColony(this.progressionForwarder, host, assignment));
      home.setLandingHost(gameLandingHost(this.snapshots, this.planets, host));
      home.setAwayHeadline(this.digests);
    }
    this.unsubRecovery = wirePlanetRecovery(this.planets, this.pool, this.snapshots, this.log);
    const pool = this.pool;
    const reg = this.metrics.registry;
    new Gauge({ name: 'ta_game_threads', help: 'Live sim threads', registers: [reg], collect() { this.set(pool.live); } });
    new Gauge({
      name: 'ta_game_planets', help: 'Planets loaded per sim thread', labelNames: ['thread'], registers: [reg],
      async collect() {
        this.reset();
        for (const s of await pool.stats()) this.set({ thread: String(s.thread) }, s.planets.length);
      },
    });
    installPlanetModeGauge(reg, () => pool.stats());
    new Gauge({
      name: 'ta_game_tick_lag_steps', help: 'Max steps a planet is behind its due time, per sim thread', labelNames: ['thread'], registers: [reg],
      async collect() {
        this.reset();
        for (const s of await pool.stats()) this.set({ thread: String(s.thread) }, s.maxLag);
      },
    });
    const planets = this.planets;
    new Gauge({
      name: 'ta_game_warp', help: 'Effective dev time warp per planet (only planets above 1)', labelNames: ['planet'], registers: [reg],
      collect() {
        this.reset();
        for (const [id, k] of planets.warped()) this.set({ planet: id }, k);
      },
    });
    installAwayPolicyMetric(reg);
    installNotifyMetrics(reg);
    installDigestRowsGauge(reg, () => this.digests.rowCount());
    new Counter({
      name: 'ta_game_steps_total', help: 'Engine steps executed per sim thread', labelNames: ['thread'], registers: [reg],
      async collect() {
        this.reset();
        for (const s of await pool.stats()) this.inc({ thread: String(s.thread) }, s.steps);
      },
    });
    this.readiness.register('simThreads', () => {
      if (pool.live < pool.size) throw new Error(`${pool.size - pool.live} of ${pool.size} sim threads down`); // BE-11
      return pool.live;
    });
    installRestartFastRunMetric(this.planets, this.metrics.registry);
    this.wireFastRunAlerts();
    const restored = await this.snapshots.restoreAll();
    const ids = devPlanetsToGenerate(devPlanetIds(Number(this.env.GAME_DEV_PLANETS), pool.size), this.planets.loadedIds(), restored);
    const devOpts = this.flags.has('W01')
      ? { params: { type: DEV_PLANET_TYPE, seed: DEV_PLANET_SEED, radius: DEV_PLANET_RADIUS, capacity: DEV_PLANET_CAPACITY } }
      : { params: { type: W00_PLANET_TYPE } };
    // `loadNew` refuses (logged) a planet that has snapshots, e.g. only an END one: it is not generated over them
    await Promise.all(ids.map((id) => this.snapshots.loadNew(id, devOpts).catch((e: unknown) => { if (!(e instanceof PlanetHeldError)) throw e; })));
  }

  /** Notify is a sibling module. A test that boots Game alone has no router; live play does. */
  private wireFastRunAlerts(): void {
    try {
      installFastRunAlertHold(this.planets, this.modules.get(AlertRouter, { strict: false }));
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('AlertRouter')) throw e;
    }
  }

  /** Lobby does not import this module. Resolve it after both exist so pause/archive can snapshot (SIM-H-06). */
  private wireSnapshotSavePoints(): void {
    try {
      const lifecycle = this.modules.get(WorldLifecycleService, { strict: false });
      lifecycle.setSnapshotSavePoint((planetId, kind) => this.snapshots.capture(planetId, kind));
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('WorldLifecycleService')) throw e;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsubBridge?.();
    this.unsubBridge = undefined;
    this.unsubDigest?.();
    this.unsubDigest = undefined;
    this.unsubHomeSeat?.();
    this.unsubHomeSeat = undefined;
    this.unsubRecovery?.();
    this.homeService?.setLandingHost(undefined);
    this.readiness.unregister('simThreads');
    await this.planets.shutdown();
  }
}
