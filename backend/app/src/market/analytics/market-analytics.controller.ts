import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../../core/dev-only.guard.js';
import { MarketAnalyticsService } from './market-analytics.service.js';

/** `GET /v1/dev/market/analytics/{planetId}?hours=24`: aggregate market analytics (dev only, W13-28). 404 in production. */
@Controller('dev/market/analytics')
@UseGuards(DevOnlyGuard)
export class MarketAnalyticsController {
  constructor(private readonly analytics: MarketAnalyticsService) {}

  @Get(':planetId')
  report(@Param('planetId') planetId: string, @Query('hours') hours?: string) {
    return this.analytics.report(planetId, hours === undefined ? undefined : Number(hours));
  }
}
