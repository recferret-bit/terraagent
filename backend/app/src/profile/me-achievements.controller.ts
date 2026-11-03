import { Controller, Get, Inject, Optional, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { MeAchievementsResponse } from '@terra/contracts';
import { AuthTokenService } from '../core/auth/index.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { FlagsService } from '../flags/flags.service.js';
import { resolveMePlayer } from './me-auth.js';
import { MeAchievementsService } from './me-achievements.service.js';

@Controller('me')
export class MeAchievementsController {
  constructor(
    private readonly service: MeAchievementsService,
    private readonly tokens: AuthTokenService,
    private readonly flags: FlagsService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  @Get('achievements')
  async achievements(@Req() req: IncomingMessage): Promise<MeAchievementsResponse> {
    const player = resolveMePlayer(req, this.tokens, this.flags, this.env?.NODE_ENV === 'production');
    return this.service.getForPlayer(player.id);
  }
}
