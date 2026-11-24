import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import type { JobRegistration } from '../../jobs/recurring.js';
import { OrderRelease } from './cancel-order.service.js';
import { PlanetGameClock } from './expiry-clock.js';

export const EXPIRY_SWEEP_MS = 30_000;

/**
 * TTL sweep (W13-15): every 30 s it expires OPEN/PARTIAL orders whose TTL has run out in planet game time. Without a warp that
 * is `createdAt + ttlS` on the wall clock (`expiresAt`); under a dev time warp the remaining TTL is consumed `k` times faster
 * (see `PlanetGameClock`), so a 15-minute order vanishes within one sweep of a ×100 warp. Timer starts on module init except
 * under `NODE_ENV=test`, where tests call `start()` / `sweep()` explicitly.
 */
@Injectable()
export class OrderExpirySweep implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OrderExpirySweep.name);
  private job: JobRegistration | null = null;
  private unwatchWarp: (() => void) | null = null;

  constructor(
    private readonly release: OrderRelease,
    private readonly clock: PlanetGameClock,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(GamePlanets) private readonly planets: GamePlanets,
    @Optional() @Inject(JobsService) private readonly jobs?: JobsService,
  ) {}

  onModuleInit(): void {
    this.unwatchWarp = this.planets.onWarp((planetId, k) => this.clock.record(planetId, k));
    if (this.env.NODE_ENV !== 'test') this.start();
  }

  async onModuleDestroy(): Promise<void> {
    this.unwatchWarp?.();
    this.unwatchWarp = null;
    await this.stop();
  }

  /**
   * One sweep per interval across the cluster (3.8), on a sim-hosting replica (the dev warp clock is recorded where
   * planets step). Without a job service (manual construction) nothing is scheduled.
   */
  start(intervalMs: number = EXPIRY_SWEEP_MS): void {
    if (this.job || !databaseEnabled(this.env)) return;
    this.job = this.jobs?.recurring({ name: 'market.order-expiry', scope: 'sim-host', schedule: { everyMs: intervalMs }, run: () => this.sweep() }) ?? null;
  }

  stop(): Promise<void> {
    const job = this.job;
    this.job = null;
    return job ? job.stop() : Promise.resolve();
  }

  /** Expires every due order; returns the ids it expired. */
  async sweep(nowMs: number = Date.now()): Promise<string[]> {
    const warped = this.clock.warpedPlanets();
    const candidates = await this.prisma.marketOrder.findMany({
      where: { state: { in: ['OPEN', 'PARTIAL'] }, OR: [{ expiresAt: { lte: new Date(nowMs) } }, ...(warped.length ? [{ planetId: { in: warped } }] : [])] },
      select: { orderId: true, planetId: true, createdAt: true, ttlS: true, expiresAt: true },
    });
    const expired: string[] = [];
    for (const c of candidates) {
      const due = c.expiresAt.getTime() <= nowMs || this.clock.gameMsBetween(c.planetId, c.createdAt.getTime(), nowMs) >= c.ttlS * 1000;
      if (!due) continue;
      try { // one poisoned order must not starve every later one of its expiry (the sweep would hit it first on every run)
        if ((await this.release.release(c.orderId, 'expired')).kind === 'released') expired.push(c.orderId);
      } catch (err) {
        this.log.warn(`expiring ${c.orderId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return expired;
  }
}
