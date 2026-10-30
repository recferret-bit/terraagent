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
import { bridgePlanetEvents } from './bus-bridge';
import { devPlanetIds } from './dev-planets';
import { GamePlanets } from './game-planets.service';
import { SimThreadPool } from './sim-thread-pool';

export const env = defineEnv('game', {
  /** Sim worker threads (SIM-H-01); default: cores - 1, at least 1. */
  SIM_THREADS: z.coerce.number().int().positive().default(Math.max(1, availableParallelism() - 1)),
  /** Number of flat dev planets loaded at boot, spread evenly over the threads. */
  /** Deltas per second per subscribed planet (D-31). */
  DELTA_HZ: z.coerce.number().positive().max(20).default(5),
  GAME_DEV_PLANETS: z.coerce.number().int().min(0).default(0),
});

const POOL = Symbol('SIM_THREAD_POOL');

@Module({
  providers: [
    {
      provide: POOL,
      inject: [APP_ENV, FlagsService],
      useFactory: (e: AppEnv, f: FlagsService) => new SimThreadPool({ threads: Number(e.SIM_THREADS), flags: f.list, deltaHz: Number(e.DELTA_HZ) }),
    },
    { provide: GamePlanets, inject: [POOL, APP_ENV], useFactory: (pool: SimThreadPool, e: AppEnv) => new GamePlanets(pool, Number(e.DELTA_HZ)) },
  ],
  exports: [GamePlanets],
})
export class GameModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(POOL) private readonly pool: SimThreadPool,
    private readonly planets: GamePlanets,
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
    const ids = devPlanetIds(Number(this.env.GAME_DEV_PLANETS), pool.size);
    await Promise.all(ids.map((id) => this.planets.load(id)));
  }

  async onApplicationShutdown(): Promise<void> {
    this.readiness.unregister('simThreads');
    await this.planets.shutdown();
  }
}
