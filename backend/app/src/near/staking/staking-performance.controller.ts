import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { StakingOverviewResponse, StakingPerformanceResponse } from '@terra/contracts';
import { StakingPerformanceService } from './performance/staking-performance.service.js';

/** W28-05 public staking read endpoints; both answer 404 unless the `W28` wave is on. No authentication. */
@Controller('near')
export class StakingPerformanceController {
  constructor(@Inject(StakingPerformanceService) private readonly perf: StakingPerformanceService) {}

  /** `GET /v1/near/staking/overview?amount=<X>`: network, price, APY, tier table, rules, projection, ecosystem TVL. */
  @Get('staking/overview')
  getOverview(@Query('amount') amount?: string): Promise<StakingOverviewResponse> {
    return this.perf.overview(amount);
  }

  /** `GET /v1/near/staking/performance?accountId=…&window=30d|90d|1y`: wallet KPIs, income, series and txs. */
  @Get('staking/performance')
  getPerformance(@Query('accountId') accountId?: string, @Query('window') window?: string): Promise<StakingPerformanceResponse> {
    return this.perf.performance(accountId, window);
  }
}
