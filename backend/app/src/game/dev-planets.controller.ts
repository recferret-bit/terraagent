import { Controller, Get, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../core/dev-only.guard';
import { GamePlanets } from './game-planets.service';

/** Dev-only: which planets are loaded, so the client can join one before the scenario loader exists. 404 in production. */
@Controller('dev')
@UseGuards(DevOnlyGuard)
export class DevPlanetsController {
  constructor(private readonly planets: GamePlanets) {}

  @Get('planets')
  list(): { planets: Array<{ id: string }> } {
    return { planets: this.planets.loadedIds().map((id) => ({ id })) };
  }
}
