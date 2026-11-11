import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../bus/event-bus.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { PlanetDaoLifecycleService } from './lifecycle.service.js';
import { PlanetDaoMembershipService } from './membership.service.js';

/**
 * No single service inserts every planet (lobby provision, home upsert, and the sim thread).
 * The DAO opens when the sim planet loads, and on `colonyFounded` if that planet still has none.
 * That same founding event adds the colony account. Elimination removes it.
 * `deedSettled` (W20) keeps the member and clears propose rights. `colonySettled` is not a contract event here.
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
    @Optional() @Inject(PlanetDaoMembershipService) private readonly membership?: PlanetDaoMembershipService,
  ) {}

  onModuleInit(): void {
    if (this.bound || this.stopped) return;
    this.bound = true;
    if (this.bus) {
      this.stops.push(this.bus.onPlanetEvent('colonyFounded', (event) => {
        this.ensure(event.planetId);
        this.membership?.onFounded(event.planetId, event.data.colonyId);
      }, { module: 'PlanetDaoLifecycleBind' }));
      this.stops.push(this.bus.onPlanetEvent('colonyEliminated', (event) => {
        const colId =
          event.data.colonyId ??
          event.colonyIds[0] ??
          (event.data.colonyIndex !== undefined ? `col_${event.data.colonyIndex}` : undefined);
        if (colId) this.membership?.onEliminated(event.planetId, colId);
      }, { module: 'PlanetDaoLifecycleBind' }));
      this.stops.push(this.bus.onPlanetEvent('deedSettled', (event) => {
        this.membership?.onSettled(event.planetId, event.data.colonyId);
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
