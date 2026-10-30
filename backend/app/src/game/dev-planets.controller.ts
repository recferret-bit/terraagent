import { Controller, Get, Inject } from '@nestjs/common';
import { CoreException } from '../core/errors';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { GamePlanets } from './game-planets.service';

/** Dev-only: which planets are loaded, so the client can join one before the scenario loader exists. 404 in production. */
@Controller('dev')
export class DevPlanetsController {
  constructor(private readonly planets: GamePlanets, @Inject(APP_ENV) private readonly env: AppEnv) {}

  @Get('planets')
  list(): { planets: Array<{ id: string }> } {
    if (this.env.NODE_ENV === 'production') throw new CoreException('NOT_FOUND', { status: 404, message: 'not found' });
    return { planets: this.planets.loadedIds().map((id) => ({ id })) };
  }
}
