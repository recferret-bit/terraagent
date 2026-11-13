import { Body, Controller, Delete, Get, Inject, Optional, Post, Put, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import {
  UpdatePlayerAiSettingsSchema,
  type MeProfileResponse,
  type PlayerAiSettings,
} from '@terra/contracts';
import { AuthTokenService } from '../core/auth/index.js';
import { CoreException } from '../core/errors/index.js';
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

  @Get('ai-settings')
  async getAiSettings(@Req() req: IncomingMessage): Promise<PlayerAiSettings> {
    const player = resolveMePlayer(req, this.tokens, this.flags, this.env?.NODE_ENV === 'production');
    return this.service.getAiSettings(player.id);
  }

  @Put('ai-settings')
  async putAiSettings(@Req() req: IncomingMessage, @Body() body: unknown): Promise<PlayerAiSettings> {
    return this.saveAiSettings(req, body);
  }

  @Post('ai-settings')
  async postAiSettings(@Req() req: IncomingMessage, @Body() body: unknown): Promise<PlayerAiSettings> {
    return this.saveAiSettings(req, body);
  }

  @Delete('ai-settings')
  async deleteAiSettings(@Req() req: IncomingMessage): Promise<PlayerAiSettings> {
    const player = resolveMePlayer(req, this.tokens, this.flags, this.env?.NODE_ENV === 'production');
    const current = await this.service.getAiSettings(player.id);
    return this.service.updateAiSettings(player, { apiKey: null, model: current.model });
  }

  private async saveAiSettings(req: IncomingMessage, body: unknown): Promise<PlayerAiSettings> {
    const player = resolveMePlayer(req, this.tokens, this.flags, this.env?.NODE_ENV === 'production');
    const parsed = UpdatePlayerAiSettingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new CoreException('invalid_ai_settings', {
        status: 400,
        message: 'Invalid NEAR.AI settings payload',
        details: { issues: parsed.error.issues },
      });
    }
    return this.service.updateAiSettings(player, parsed.data);
  }
}
