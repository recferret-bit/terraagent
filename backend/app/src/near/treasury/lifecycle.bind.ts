import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../bus/event-bus.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { PlanetDaoLifecycleService } from './lifecycle.service.js';

/**
 * No single service inserts every planet (lobby provision, home upsert, and the sim thread).
 * The DAO opens when the sim planet loads, and on `colonyFounded` if that planet still has none.
 */
@Injectable()
export class PlanetDaoLifecycleBind implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PlanetDaoLifecycleBind.name);
  private readonly stops: Array<() => void> = [];
  private bound = false;
  private stopped = false;

  constructor(
    @Inject(PlanetDaoLifecycleService) private readonly lifecycle: PlanetDaoLifecycleService,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
  ) {}

  onModuleInit(): void {
    if (this.bound || this.stopped) return;
    this.bound = true;
    if (this.bus) {
      this.stops.push(this.bus.onPlanetEvent('colonyFounded', (event) => {
        this.ensure(event.planetId);
      }, { module: 'PlanetDaoLifecycleBind' }));
    }
    this.planets?.onPlanetLoaded((planetId) => {
      if (this.stopped) return;
      this.ensure(planetId);
    });
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const stop of this.stops.splice(0)) stop();
  }

  private ensure(planetId: string): void {
    void this.lifecycle.ensurePlanetDao(planetId).catch((err: unknown) => {
      this.log.warn(`planet dao ensure failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
