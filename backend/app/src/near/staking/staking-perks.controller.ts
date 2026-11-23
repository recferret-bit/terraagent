import { Controller, Get, Headers, Inject, Optional, Query, Req } from '@nestjs/common';
import type { StakerPerksResponse, StakingPrestigeResponse } from '@terra/contracts';
import type { IncomingMessage } from 'node:http';
import { AuthTokenService } from '../../core/auth/index.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { resolveOptionalBearerPlayerId } from '../identity/colony-ownership.guard.js';
import { StakingPerksService } from './perks/staking-perks.service.js';

/** W28 read endpoints of the perks engine; both answer 404 unless the `W28` wave is on. */
@Controller('near')
export class StakingPerksController {
  constructor(
    @Inject(StakingPerksService) private readonly perks: StakingPerksService,
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  /**
   * `GET /v1/near/staking/perks?accountId=…|colonyId=…`: the wallet's tier, fee, quotas and AI allowance. Without an
   * `accountId`, a Bearer session resolves to the pilot's linked wallet (HUD pill). Fees follow the staking clock
   * (`PerksDeps.clock`).
   */
  @Get('staking/perks')
  getPerks(
    @Query('colonyId') colonyId?: string,
    @Query('accountId') accountId?: string,
    @Headers('authorization') authHeader?: string,
    @Req() req?: IncomingMessage,
  ): Promise<StakerPerksResponse> {
    const playerId = accountId?.trim() ? null : (resolveOptionalBearerPlayerId(req, this.tokens, this.env, authHeader) ?? null);
    return this.perks.perksFor({ colonyId, accountId, playerId });
  }

  /** `GET /v1/near/staking/prestige?planetId=…`: lead patron plus per-colony tier (cosmetic only). */
  @Get('staking/prestige')
  getPrestige(@Query('planetId') planetId?: string): Promise<StakingPrestigeResponse> {
    return this.perks.prestigeFor(planetId);
  }
}
