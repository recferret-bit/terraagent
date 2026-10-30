import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { HomeResponse } from '@terra/contracts';
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

  @Get('home')
  async getHome(
    @Req() req: AuthenticatedRequest,
    @CurrentPlayer() player: AuthenticatedPlayer,
  ): Promise<HomeResponse> {
    return this.homeService.getOrAssignHome(req.player ?? player);
  }
}
