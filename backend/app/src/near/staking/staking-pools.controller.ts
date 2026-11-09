import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { CoreException } from '../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { FlagsService } from '../../flags/flags.service.js';
import type { StakingPoolView } from '../application/ports/staking.port.js';
import { parseStakingPoolsConfig } from './staking-pools.config.js';

export interface StakingPoolsListResponse {
  readonly pools: readonly StakingPoolView[];
}

/**
 * Admin and public read endpoints for whitelisted `NEAR_STAKING_POOLS` (W20-17 / NEAR §9).
 * `GET /v1/admin/near/staking-pools` and `GET /v1/near/staking-pools`.
 */
@Controller()
export class StakingPoolsController {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  @Get('admin/near/staking-pools')
  listAdmin(): StakingPoolsListResponse {
    return this.resolvePools();
  }

  @Get('near/staking-pools')
  listPublic(): StakingPoolsListResponse {
    return this.resolvePools();
  }

  private resolvePools(): StakingPoolsListResponse {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const bag = this.env as { NEAR_STAKING_POOLS?: string } | undefined;
    const raw = bag?.NEAR_STAKING_POOLS ?? process.env.NEAR_STAKING_POOLS;
    return { pools: parseStakingPoolsConfig(raw) };
  }
}
