import type { IncomingMessage } from 'node:http';
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../core/dev-only.guard';
import { CoreException } from '../core/errors';
import { isSpectatorEnvAllowed } from '../core/local-host-guard';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { SimClusterService } from './cluster/sim-cluster.service';
import { DevSpectatorRequestSchema, DevSpectatorService, type DevSpectatorResponse } from './dev-spectator.service';
import { GamePlanets } from './game-planets.service';

/** Dev-only: which planets are loaded across the simulation cluster, plus persistent local-dev bot spectator worlds. 404 in production. */
@Controller('dev')
@UseGuards(DevOnlyGuard)
export class DevPlanetsController {
  constructor(
    @Inject(GamePlanets) private readonly planets: GamePlanets,
    @Optional() @Inject(SimClusterService) private readonly cluster?: SimClusterService,
    @Optional() @Inject(DevSpectatorService) private readonly spectator?: DevSpectatorService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  @Get('planets')
  list(): { planets: Array<{ id: string }> } | Promise<{ planets: Array<{ id: string }> }> {
    if (this.cluster) {
      return this.cluster.listAvailablePlanets().then((planets) => ({ planets }));
    }
    return { planets: this.planets.loadedIds().map((id) => ({ id })) };
  }

  @Post('spectator')
  @HttpCode(200)
  ensureSpectator(@Body() body: unknown, @Req() req?: IncomingMessage): Promise<DevSpectatorResponse> {
    if (!isSpectatorEnvAllowed(this.env, req?.headers, req?.socket?.remoteAddress) || !this.spectator) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const parsed = DevSpectatorRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new CoreException('VALIDATION_ERROR', {
        status: 400,
        message: parsed.error.issues[0]?.message ?? 'Invalid spectator request',
      });
    }
    return this.spectator.ensureSpectatorPlanet(parsed.data);
  }
}
