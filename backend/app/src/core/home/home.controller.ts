import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { HomeResponse } from '@terra/contracts';
import { isDevPlanetType } from '@terra/sim';
import {
  type AuthenticatedPlayer,
  type AuthenticatedRequest,
  BearerAuthGuard,
  CurrentPlayer,
} from '../auth/bearer-auth.guard';
import { IpThrottleGuard } from '../ip-throttle.guard';
import { HomeService } from './home.service';

@Controller('me')
@UseGuards(IpThrottleGuard, BearerAuthGuard)
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  /** `?type=desert|ocean|temperate`: planet type for a NEW colony (the orbit pick); ignored for an existing one. */
  @Get('home')
  async getHome(
    @Req() req: AuthenticatedRequest,
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Query('type') type?: string,
    @Query('colonyId') colonyId?: string,
  ): Promise<HomeResponse> {
    if (colonyId) return this.homeService.resumeColony((req.player ?? player).id, colonyId);
    return this.homeService.getOrAssignHome(req.player ?? player, isDevPlanetType(type) ? type : undefined);
  }
}
