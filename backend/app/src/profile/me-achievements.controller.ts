import { Controller, Get, Inject, Optional, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { MeAchievementsResponse } from '@terra/contracts';
import { AuthTokenService } from '../core/auth/index.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { FlagsService } from '../flags/flags.service.js';
import { W12SeedService } from '../progression/w12-seed.service.js';
import { resolveMePlayer } from './me-auth.js';
import { MeAchievementsService } from './me-achievements.service.js';

@Controller('me')
export class MeAchievementsController {
  constructor(
    private readonly service: MeAchievementsService,
    private readonly tokens: AuthTokenService,
    private readonly flags: FlagsService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() private readonly seed?: W12SeedService,
  ) {}

  @Get('achievements')
  async achievements(@Req() req: IncomingMessage): Promise<MeAchievementsResponse> {
    const prod = this.env?.NODE_ENV === 'production';
    const player = resolveMePlayer(req, this.tokens, this.flags, prod);
    let wavesOverride: string | undefined;
    if (!prod) {
      await this.seed?.ensureSeeded(player.id);
      const qIdx = req.url?.indexOf('?') ?? -1;
      if (qIdx !== -1 && req.url) {
        wavesOverride = new URLSearchParams(req.url.slice(qIdx)).get('waves') ?? undefined;
      }
    }
    return this.service.getForPlayer(player.id, wavesOverride);
  }
}
