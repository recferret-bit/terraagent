import { availableParallelism } from 'node:os';
import { Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { defineEnv } from '@terra/config';
import { Gauge } from 'prom-client';
import { z } from 'zod';
import { MetricsRegistry } from '../core/metrics.registry';
import { ReadinessRegistry } from '../core/readiness.registry';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { devPlanetIds } from './dev-planets';
import { GamePlanets } from './game-planets.service';
import { SnapshotService } from './persistence/snapshot.service';
import { SnapshotStore } from './persistence/snapshot-store';
import { SimThreadPool } from './sim-thread-pool';
import { ALL_WAVES } from './thread/assign';

export const env = defineEnv('game', {
  /** Sim worker threads (SIM-H-01); default: cores - 1, at least 1. */
  SIM_THREADS: z.coerce.number().int().positive().default(Math.max(1, availableParallelism() - 1)),
  /** Number of flat dev planets loaded at boot, spread evenly over the threads. */
  /** Seconds between periodic snapshots per planet (SIM-H-06); fractional allowed. */
  SNAPSHOT_EVERY_S: z.coerce.number().positive().default(60),
  GAME_DEV_PLANETS: z.coerce.number().int().min(0).default(0),
});

const POOL = Symbol('SIM_THREAD_POOL');

@Module({
  providers: [
    {
      provide: POOL,
      inject: [APP_ENV],
      useFactory: (e: AppEnv) => new SimThreadPool({ threads: Number(e.SIM_THREADS), flags: ALL_WAVES }),
    },
    { provide: GamePlanets, inject: [POOL], useFactory: (pool: SimThreadPool) => new GamePlanets(pool) },
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
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.pool.start();
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
