import { Inject, Injectable, Optional } from '@nestjs/common';
import { restore, type PlanetState } from '@terra/sim';
import { GamePlanets } from '../../game/game-planets.service.js';

/** Reads the planet the poster is looking at. A nest on an unloaded planet is not visible. */
export interface BountyWorldSource {
  load(planetId: string): Promise<PlanetState | null>;
}

@Injectable()
export class PlanetBountyWorld implements BountyWorldSource {
  constructor(@Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets) {}

  async load(planetId: string): Promise<PlanetState | null> {
    if (!this.planets?.isLoaded(planetId)) return null;
    try {
      const full = await this.planets.fullState(planetId);
      return restore(full.bytes);
    } catch {
      return null;
    }
  }
}
