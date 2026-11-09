import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
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
  constructor(@Inject(HomeService) private readonly homeService: HomeService) {}

  /**
   * `?type=desert|ocean|temperate`: planet type for a NEW colony (the orbit pick); ignored for an existing one.
   * `?resolve=1` / `?mode=lobby`: runs pure W11 `resolveHome` (returns `NEW` with 3 canonical worlds instead of dev auto-seat).
   * `?colonyId=...`: resumes an owned `ACTIVE` colony (`404 COLONY_UNAVAILABLE` otherwise).
   */
  @Get('home')
  async getHome(
    @Req() req: AuthenticatedRequest,
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Query('type') type?: string,
    @Query('colonyId') colonyId?: string,
    @Query('resolve') resolve?: string,
    @Query('mode') mode?: string,
  ): Promise<HomeResponse> {
    const authPlayer = req?.player ?? player;
    if (colonyId) return this.homeService.resumeColony(authPlayer.id, colonyId);
    const preferredType = isDevPlanetType(type) ? type : undefined;
    if (resolve === '1' || resolve === 'true' || mode === 'lobby') {
      return this.homeService.resolveHome(authPlayer, { preferredType });
    }
    return this.homeService.getOrAssignHome(authPlayer, preferredType);
  }

  /** Marks the player's latest (or specified) eliminated/ended colony recap as seen and returns updated `resolveHome` (`state: 'NEW'`). */
  @Post('home/recap-seen')
  @HttpCode(200)
  async markHomeRecapSeen(
    @Req() req: AuthenticatedRequest,
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Body() body?: { readonly colonyId?: string },
  ): Promise<HomeResponse> {
    const authPlayer = req?.player ?? player;
    await this.homeService.markRecapSeen(authPlayer.id, body?.colonyId);
    return this.homeService.resolveHome(authPlayer);
  }

  @Post('recap/seen')
  @HttpCode(200)
  async markRecapSeenAlias(
    @Req() req: AuthenticatedRequest,
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Body() body?: { readonly colonyId?: string },
  ): Promise<HomeResponse> {
    return this.markHomeRecapSeen(req, player, body);
  }
}
