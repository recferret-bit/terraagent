import { Injectable } from '@nestjs/common';
import { newId } from '@terra/contracts';
import { createScenarioPlanet, getScenario, listScenarios } from '@terra/scenarios';
import { snapshot } from '@terra/sim';
import { CoreException } from '../core/errors';
import { FlagsService } from '../flags/flags.service';
import { GamePlanets } from '../game/game-planets.service';

export interface CreatedScenario { readonly planetId: string; readonly scenario: string; readonly tick: number }

/**
 * Creates a fresh dev planet from a seed scenario: the pure loader builds it on the main thread (same code the CLI and the
 * browser local host run), then the owning sim thread restores it from that snapshot. Flags = scenario waves ∩ server flags.
 */
@Injectable()
export class ScenariosService {
  constructor(private readonly planets: GamePlanets, private readonly flags: FlagsService) {}

  list(): { id: string; title: string; waves: string }[] {
    return listScenarios().map(({ id, title, waves }) => ({ id, title, waves }));
  }

  async create(id: string): Promise<CreatedScenario> {
    const def = getScenario(id);
    if (!def) throw new CoreException('NOT_FOUND', { status: 404, message: `Unknown scenario "${id}"`, details: { known: this.list().map((s) => s.id) } });
    const planetId = newId('pl');
    const { host } = createScenarioPlanet(def.id, { planetId, flags: this.flags.list });
    const tick = host.tick;
    await this.planets.load(planetId, { snapshot: snapshot(host.state), flags: [...host.pipeline.config.flags] });
    return { planetId, scenario: def.id, tick };
  }
}
