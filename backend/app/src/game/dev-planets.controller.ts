import { Controller, Get, Inject, Optional, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../core/dev-only.guard';
import { SimClusterService } from './cluster/sim-cluster.service';
import { GamePlanets } from './game-planets.service';

/** Dev-only: which planets are loaded across the simulation cluster, so the client can join one. 404 in production. */
@Controller('dev')
@UseGuards(DevOnlyGuard)
export class DevPlanetsController {
  constructor(
    @Inject(GamePlanets) private readonly planets: GamePlanets,
    @Optional() @Inject(SimClusterService) private readonly cluster?: SimClusterService,
  ) {}

  @Get('planets')
  list(): { planets: Array<{ id: string }> } | Promise<{ planets: Array<{ id: string }> }> {
    if (this.cluster) {
      return this.cluster.listAvailablePlanets().then((planets) => ({ planets }));
    }
    return { planets: this.planets.loadedIds().map((id) => ({ id })) };
  }
}
