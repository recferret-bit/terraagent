import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { HomeResponse } from '@terra/contracts';
import { isDevPlanetType } from '@terra/sim';
import {
  type AuthenticatedPlayer,
  type AuthenticatedRequest,
  BearerAuthGuard,
  CurrentPlayer,
} from '../auth/bearer-auth.guard';
import { HomeService } from './home.service';

@Controller(['me', 'v1/me'])
@UseGuards(BearerAuthGuard)
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  /** `?type=desert|ocean|temperate`: planet type for a NEW colony (the orbit pick); ignored for an existing one. */
  @Get('home')
  async getHome(
    @Req() req: AuthenticatedRequest,
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Query('type') type?: string,
  ): Promise<HomeResponse> {
    return this.homeService.getOrAssignHome(req.player ?? player, isDevPlanetType(type) ? type : undefined);
  }
}
