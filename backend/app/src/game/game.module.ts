import { availableParallelism } from 'node:os';
import { Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { defineEnv } from '@terra/config';
import { Counter, Gauge } from 'prom-client';
import { z } from 'zod';
import { EventBus } from '../bus/event-bus';
import { FlagsService } from '../flags/flags.service';
import { MetricsRegistry } from '../core/metrics.registry';
import { ReadinessRegistry } from '../core/readiness.registry';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { loadBalanceOverrides } from './balance-overrides';
import { bridgePlanetEvents } from './bus-bridge';
import { DevPlanetsController } from './dev-planets.controller';
import { devPlanetIds } from './dev-planets';
import { GamePlanets } from './game-planets.service';
import { SnapshotService } from './persistence/snapshot.service';
import { SnapshotStore } from './persistence/snapshot-store';
import { SimThreadPool } from './sim-thread-pool';

export const env = defineEnv('game', {
  /** Sim worker threads (SIM-H-01); default: cores - 1, at least 1. */
  SIM_THREADS: z.coerce.number().int().positive().default(Math.max(1, availableParallelism() - 1)),
  /** Seconds between periodic snapshots per planet (SIM-H-06); fractional allowed. */
  SNAPSHOT_EVERY_S: z.coerce.number().positive().default(60),
  /** Snapshot persistence on/off; unset = on, except NODE_ENV=test (unit tests must not read the dev database). */
  SNAPSHOTS: z.enum(['on', 'off']).optional(),
  /** Deltas per second per subscribed planet (D-31). */
  DELTA_HZ: z.coerce.number().positive().max(20).default(5),
  /** Number of flat dev planets loaded at boot, spread evenly over the threads. */
  /** Path to `balance.overrides.json` (D-35): design-unit overrides merged over the data rows at compile time; unset = none. */
  TA_BALANCE_OVERRIDES: z.string().optional().superRefine((path, ctx) => {
    try { loadBalanceOverrides(path, []); } catch (e) { ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : String(e) }); }
  }),
  GAME_DEV_PLANETS: z.coerce.number().int().min(0).default(0),
});

const POOL = Symbol('SIM_THREAD_POOL');

@Module({
  controllers: [DevPlanetsController],
  providers: [
    {
      provide: POOL,
      inject: [APP_ENV, FlagsService],
      useFactory: (e: AppEnv, f: FlagsService) => new SimThreadPool({ threads: Number(e.SIM_THREADS), flags: f.list, deltaHz: Number(e.DELTA_HZ), overrides: loadBalanceOverrides(e.TA_BALANCE_OVERRIDES as string | undefined, f.list) }),
    },
    { provide: GamePlanets, inject: [POOL, APP_ENV], useFactory: (pool: SimThreadPool, e: AppEnv) => new GamePlanets(pool, Number(e.DELTA_HZ)) },
    SnapshotStore,
    SnapshotService,
  ],
  exports: [GamePlanets],
})
export class GameModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(POOL) private readonly pool: SimThreadPool,
    private readonly planets: GamePlanets,
    private readonly snapshots: SnapshotService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly metrics: MetricsRegistry,
    private readonly readiness: ReadinessRegistry,
    private readonly bus: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.pool.start();
    bridgePlanetEvents(this.planets, this.bus);
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
    new Counter({
      name: 'ta_game_steps_total', help: 'Engine steps executed per sim thread', labelNames: ['thread'], registers: [reg],
      async collect() {
        this.reset();
        for (const s of await pool.stats()) this.inc({ thread: String(s.thread) }, s.steps);
      },
    });
    this.readiness.register('simThreads', () => {
      if (pool.live === 0) throw new Error('no live sim threads');
      return pool.live;
    });
    await this.snapshots.restoreAll();
    const have = new Set(this.planets.loadedIds());
    const ids = devPlanetIds(Number(this.env.GAME_DEV_PLANETS), pool.size).filter((id) => !have.has(id));
    await Promise.all(ids.map((id) => this.planets.load(id)));
  }

  async onApplicationShutdown(): Promise<void> {
    this.readiness.unregister('simThreads');
    await this.planets.shutdown();
  }
}
