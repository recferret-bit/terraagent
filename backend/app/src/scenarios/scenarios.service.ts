import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { newId } from '@terra/contracts';
import { createScenarioPlanet, getScenario, listScenarios } from '@terra/scenarios';
import { snapshot } from '@terra/sim';
import { CoreException } from '../core/errors';
import { EventBus } from '../bus/event-bus';
import { EconomyProfileService } from '../economy/profile/profile.service';
import { FlagsService } from '../flags/flags.service';
import { SimClusterService } from '../game/cluster/sim-cluster.service';
import { GamePlanets } from '../game/game-planets.service';
import { hasLiveColony, liveColonyIndices } from '../game/live-colony';
import { SimLeaseService } from '../game/persistence/sim-lease.service';

export interface CreatedScenario { readonly planetId: string; readonly scenario: string; readonly tick: number }

/**
 * Creates a fresh dev planet from a seed scenario: the pure loader builds it on the main thread (same code the CLI and the
 * browser local host run), then the owning sim thread restores it from that snapshot. Flags = scenario waves ∩ server flags.
 */
@Injectable()
export class ScenariosService {
  constructor(
    @Inject(GamePlanets) private readonly planets: GamePlanets,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(EconomyProfileService) private readonly profiles: EconomyProfileService,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(SimLeaseService) private readonly simLease?: SimLeaseService,
    @Optional() @Inject(SimClusterService) private readonly simCluster?: SimClusterService,
  ) {}

  list(): { id: string; title: string; waves: string }[] {
    return listScenarios().map(({ id, title, waves }) => ({ id, title, waves }));
  }

  async create(id: string): Promise<CreatedScenario> {
    const def = getScenario(id);
    if (!def) throw new CoreException('NOT_FOUND', { status: 404, message: `Unknown scenario "${id}"`, details: { known: this.list().map((s) => s.id) } });
    const planetId = newId('pl');
    // W13: the active profile's region pins the endowment at creation (without a database the loader uses the bootstrap tables)
    const region = await this.profiles.regionForNewPlanet({ planetType: def.planet.planetType ?? 'temperate', planetId });
    const { host, setupPostings } = createScenarioPlanet(def.id, { planetId, flags: this.flags.list, worldSalt: randomUUID(), ...(region ? { region } : {}) }); // hidden-ground secret (WE-07, D-38)
    const tick = host.tick;
    const scenarioSeats = hasLiveColony(host.state) ? [...liveColonyIndices(host.state)] : undefined;
    if (scenarioSeats) this.planets.markScenarioColonyPlanet(planetId, scenarioSeats); // dev sessions play colony 0 (BE-07)
    const snapBytes = snapshot(host.state);
    // the journal starts with the setup postings (e.g. the real `landing.cargo`)
    if (this.simLease && !this.simLease.canHostSim() && this.simCluster) {
      await this.simCluster.forwardLoadNew(planetId, { snapshot: snapBytes, genesis: true, setupPostings, scenarioSeats });
    } else {
      await this.planets.load(planetId, { snapshot: snapBytes, genesis: true, setupPostings });
      if (this.simLease && this.planets.isLoaded(planetId)) {
        await this.simLease.tryAcquire(planetId).catch(() => undefined);
      }
    }
    this.bus?.emit('dev.scenario.created', { planetId, scenario: def.id }); // dev fixtures that live outside the sim (W13-35)
    return { planetId, scenario: def.id, tick };
  }
}
