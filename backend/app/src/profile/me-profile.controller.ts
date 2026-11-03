import { Controller, Get, Inject, Optional, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { MeProfileResponse } from '@terra/contracts';
import { AuthTokenService } from '../core/auth/index.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { FlagsService } from '../flags/flags.service.js';
import { W12SeedService } from '../progression/w12-seed.service.js';
import { resolveMePlayer } from './me-auth.js';
import { MeProfileService } from './me-profile.service.js';

@Controller('me')
export class MeProfileController {
  constructor(
    @Inject(MeProfileService) private readonly service: MeProfileService,
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(W12SeedService) private readonly seed?: W12SeedService,
  ) {}

  @Get('profile')
  async profile(@Req() req: IncomingMessage): Promise<MeProfileResponse> {
    const player = resolveMePlayer(req, this.tokens, this.flags, this.env?.NODE_ENV === 'production');
    if (this.env?.NODE_ENV !== 'production') {
      if (player.id === 'pr_dev_w12') await this.seed?.ensureSeeded(player.id);
    }
    return this.service.getForPlayer(player);
  }
}
