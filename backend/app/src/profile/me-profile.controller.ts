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
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../db/db.module.js';
import { W12SeedService } from '../progression/w12-seed.service.js';
import { devPlayerId } from '../ws/session-verifier.js';
import { resolveMePlayer, type ResolvedMePlayer } from './me-auth.js';
import { MeProfileService } from './me-profile.service.js';

@Controller('me')
export class MeProfileController {
  constructor(
    @Inject(MeProfileService) private readonly service: MeProfileService,
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(W12SeedService) private readonly seed?: W12SeedService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  @Get('profile')
  async profile(@Req() req: IncomingMessage): Promise<MeProfileResponse> {
    const player = await this.mePlayer(req);
    if (this.env?.NODE_ENV !== 'production') {
      if (player.id === 'pr_dev_w12') await this.seed?.ensureSeeded(player.id);
    }
    return this.service.getForPlayer(player);
  }

  @Get('ai-settings')
  async getAiSettings(@Req() req: IncomingMessage): Promise<PlayerAiSettings> {
    const player = await this.mePlayer(req);
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
    const player = await this.mePlayer(req);
    const current = await this.service.getAiSettings(player.id);
    return this.service.updateAiSettings(player, { apiKey: null, model: current.model });
  }

  @Post('ai-settings/verify')
  async verifyAiEnclave(@Req() req: IncomingMessage) {
    const player = await this.mePlayer(req);
    return this.service.verifyAiEnclave(player.id);
  }

  private async saveAiSettings(req: IncomingMessage, body: unknown): Promise<PlayerAiSettings> {
    const player = await this.mePlayer(req);
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

  /**
   * W28 (dev only): `/me.html?as=<name>` resolves to `pr_dev_<name>`, while the game and staking sessions resolve
   * `dev:<name>` to `devPlayerId(name)`. When only the latter player exists (a dev pilot who played a scenario), the
   * profile follows it, so the wallet that pilot linked shows on `/me.html#staking`. Fixture ids (`pr_dev_w12`, any
   * `pr_dev_*` with its own row) are unchanged.
   */
  private async mePlayer(req: IncomingMessage): Promise<ResolvedMePlayer> {
    const player = resolveMePlayer(req, this.tokens, this.flags, this.env?.NODE_ENV === 'production');
    if (this.env?.NODE_ENV === 'production' || !player.id.startsWith('pr_dev_') || !this.prisma?.player) return player;
    const alias = devPlayerId(player.id.slice('pr_dev_'.length));
    const [own, played] = await Promise.all([
      this.prisma.player.findUnique({ where: { id: player.id }, select: { id: true } }),
      this.prisma.player.findUnique({ where: { id: alias }, select: { id: true } }),
    ]).catch(() => [null, null] as const);
    return !own && played ? { ...player, id: alias } : player;
  }
}
