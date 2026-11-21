import { Inject, Injectable, Optional } from '@nestjs/common';
import { restore, type PlanetState } from '@terra/sim';
import { SectorAntiCheatService } from '../../core/anticheat/index.js';
import { GamePlanets } from '../../game/game-planets.service.js';

/** Reads the planet the poster is looking at. A nest on an unloaded planet is not visible. */
export interface BountyWorldSource {
  load(planetId: string): Promise<PlanetState | null>;
}

@Injectable()
export class PlanetBountyWorld implements BountyWorldSource {
  constructor(
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(SectorAntiCheatService) private readonly antiCheat?: SectorAntiCheatService,
  ) {}

  async load(planetId: string): Promise<PlanetState | null> {
    if (!this.planets?.isLoaded(planetId)) return null;
    try {
      const full = await this.planets.fullState(planetId);
      const state = restore(full.bytes);
      this.antiCheat?.syncFromPlanetState(planetId, state);
      return state;
    } catch {
      return null;
    }
  }
}
