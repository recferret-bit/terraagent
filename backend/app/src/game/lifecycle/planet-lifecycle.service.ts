import { Inject, Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { Logger } from 'pino';
import { layerLogger } from '../../core/logging/logger';
import { persistenceEnabled } from '../../core/persistence';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import { PRISMA } from '../../db/db.module';
import type { JobRegistration } from '../../jobs/recurring';
import { GamePlanets } from '../game-planets.service';
import { SectorStateService } from '../persistence/sector-state.service';
import { SnapshotService } from '../persistence/snapshot.service';
import { armRestoredPlanet } from '../presence/restored-away';
import { idleUnloadEligible, isIdle, lifecycleConfig, type LifecycleConfig } from './idle-policy';
import { prismaUnloadDeps, unloadIdlePlanet, type IdleUnloadDeps, type IdleUnloadOutcome } from './idle-unloader';
import { MemoryPlanetActivity, PrismaPlanetActivity, type PlanetActivityStore } from './planet-activity.store';
import { PlanetJobsService } from './planet-jobs.service';

export const PLANET_LIFECYCLE_JOB = 'planet.lifecycle';

/**
 * Planet lifecycle (3.5): a planet with no human for `TA_PLANET_IDLE_UNLOAD_H` is snapshotted and unloaded by its
 * lease holder (a planet job), and stays dormant (not restored at boot, not reclaimed) until a join or a landing
 * restores it through `SnapshotService.restoreIfPersisted`. The clock is `world.planet_activity`.
 */
@Injectable()
export class PlanetLifecycleService implements OnModuleInit, OnModuleDestroy {
  readonly config: LifecycleConfig;
  readonly store: PlanetActivityStore;
  private readonly log: Logger;
  private readonly unloadDeps: Pick<IdleUnloadDeps, 'latestSnapshotAt' | 'quietLease'>;
  private job: JobRegistration | undefined;
  private offLoaded: (() => void) | undefined;
  now: () => number = () => Date.now();

  constructor(
    private readonly planets: GamePlanets,
    private readonly snapshots: SnapshotService,
    private readonly planetJobs: PlanetJobsService,
    @Inject(APP_ENV) env: AppEnv,
    @Inject(LOGGER) root: Logger,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
    @Optional() private readonly sectorState?: SectorStateService,
  ) {
    this.config = lifecycleConfig(env);
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
    const db = prisma && persistenceEnabled(env) ? prisma : undefined;
    this.store = db ? new PrismaPlanetActivity(db) : new MemoryPlanetActivity();
    this.unloadDeps = db ? prismaUnloadDeps(db) : { latestSnapshotAt: async () => null, quietLease: async () => undefined };
  }

  onModuleInit(): void {
    this.snapshots.setBootRestoreFilter((ids) => this.withoutDormant(ids));
    this.offLoaded = this.planets.onPlanetLoaded((planetId, _tick, info) => void this.onLoaded(planetId, info.restored));
    if (this.config.idleMs <= 0) return;
    this.job = this.planetJobs.register({
      name: PLANET_LIFECYCLE_JOB,
      everyMs: this.config.checkMs,
      run: (planetId) => this.check(planetId),
      eligible: (planetId) => this.eligible(planetId),
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.offLoaded?.();
    await this.job?.stop();
  }

  eligible(planetId: string): boolean {
    return idleUnloadEligible(planetId, (id) => this.planets.isScenarioColonyPlanet(id));
  }

  /** One planet's idle check on its lease holder. */
  async check(planetId: string): Promise<IdleUnloadOutcome | 'active' | 'ineligible'> {
    if (!this.eligible(planetId)) return 'ineligible';
    const row = await this.store.ensure(planetId, new Date(this.now()));
    if (!isIdle(row, this.now(), this.config.idleMs)) return 'active';
    return unloadIdlePlanet(
      { ...this.unloadDeps, snapshots: this.snapshots, planets: this.planets, sectorState: this.sectorState, store: this.store, idleMs: this.config.idleMs, now: this.now, log: this.log },
      planetId,
    );
  }

  async isDormant(planetId: string): Promise<boolean> {
    return Boolean((await this.store.get(planetId))?.dormantSince);
  }

  dormantIds(): Promise<string[]> {
    return this.store.dormantIds();
  }

  /** Lease reclaim guard: a dormant planet is not restored by another replica; its lease counts are zeroed instead. */
  async keepDormant(planetId: string): Promise<boolean> {
    if (!(await this.isDormant(planetId).catch(() => false))) return false;
    await this.unloadDeps.quietLease(planetId).catch(() => undefined);
    return true;
  }

  /** Boot restore skips dormant planets (on a database error every planet is restored, as before). */
  async withoutDormant(ids: readonly string[]): Promise<readonly string[]> {
    try {
      const dormant = new Set(await this.store.dormantIds());
      return ids.filter((id) => !dormant.has(id));
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'dormant planets unknown: boot restores every planet');
      return ids;
    }
  }

  /**
   * A restored dormant planet is awake again; its clock starts now (the joining player's socket follows). Any restored
   * planet's present human colonies get their away timer armed, so a player gone since before the restart is posted
   * away instead of pinning the planet "human present".
   */
  private async onLoaded(planetId: string, restored: boolean): Promise<void> {
    const warn = (what: string) => (err: unknown) =>
      this.log.warn({ planetId, err: err instanceof Error ? err.message : String(err) }, what);
    await this.store.wake(planetId, new Date(this.now())).then(
      (woke) => { if (woke) this.log.info({ planetId }, `woke ${planetId}`); },
      warn('planet wake not recorded'),
    );
    if (restored) await armRestoredPlanet(this.planets, planetId).catch(warn('away timers of a restored planet not armed'));
  }
}
