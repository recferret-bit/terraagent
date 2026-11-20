import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { StakerPerksResponse, StakingPrestigeResponse } from '@terra/contracts';
import { StakingPerksService } from './perks/staking-perks.service.js';

/** W28 read endpoints of the perks engine; both answer 404 unless the `W28` wave is on. */
@Controller('near')
export class StakingPerksController {
  constructor(@Inject(StakingPerksService) private readonly perks: StakingPerksService) {}

  /** `GET /v1/near/staking/perks?accountId=…|colonyId=…`: the wallet's tier, fee, quotas and AI allowance. */
  @Get('staking/perks')
  getPerks(@Query('colonyId') colonyId?: string, @Query('accountId') accountId?: string): Promise<StakerPerksResponse> {
    return this.perks.perksFor({ colonyId, accountId });
  }

  /** `GET /v1/near/staking/prestige?planetId=…`: lead patron plus per-colony tier (cosmetic only). */
  @Get('staking/prestige')
  getPrestige(@Query('planetId') planetId?: string): Promise<StakingPrestigeResponse> {
    return this.perks.prestigeFor(planetId);
  }
}
