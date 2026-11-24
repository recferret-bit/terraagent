import { Body, Controller, Delete, Get, HttpCode, Inject, Optional, Post, Put, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import {
  MANAGED_AI_MODEL,
  UpdatePilotHandleSchema,
  UpdatePlayerAiSettingsSchema,
  type MeProfileResponse,
  type PilotHandleResponse,
  type PlayerAiSettings,
} from '@terra/contracts';
import { AuthTokenService } from '../core/auth/index.js';
import { CoreException } from '../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { FlagsService } from '../flags/flags.service.js';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../db/db.module.js';
import {
  ensureLocalDevAliasWallet,
  ensureLocalMockStarterFunds,
} from '../near/infrastructure/dev/local-mock-wallet-seed.js';
import { isLocalStakingFastTimings } from '../near/staking/local-staking-timings.js';
import { W12SeedService } from '../progression/w12-seed.service.js';
import { resolveMePlayer, type ResolvedMePlayer } from './me-auth.js';
import { aliasDevPlayer } from './me-dev-alias.js';
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
    const out = await this.service.getForPlayer(player);
    const envMap = (this.env ?? process.env) as Record<string, string | undefined>;
    const fastLocal = isLocalStakingFastTimings(envMap);
    const acct = out.identity.accountId;
    if (acct && ((this.env?.NODE_ENV === 'development' && acct.endsWith('.mock')) || fastLocal)) {
      const col = out.currentColonies[0];
      const extraPlanet = col ? { id: col.planetId, name: col.planetName } : undefined;
      if (fastLocal && player.id.startsWith('pr_dev_') && acct.endsWith('.mock')) {
        await ensureLocalDevAliasWallet(this.prisma, player.id.slice('pr_dev_'.length), acct, envMap, extraPlanet).catch(
          () => undefined,
        );
      } else {
        await ensureLocalMockStarterFunds(this.prisma, acct, envMap, extraPlanet).catch(() => undefined);
      }
    }
    return out;
  }

  @Put('profile/handle')
  async putHandle(@Req() req: IncomingMessage, @Body() body: unknown): Promise<PilotHandleResponse> {
    const player = await this.mePlayer(req);
    const parsed = UpdatePilotHandleSchema.safeParse(body);
    if (!parsed.success) {
      throw new CoreException('invalid_pilot_handle', {
        status: 400,
        message: parsed.error.issues[0]?.message ?? 'Invalid pilot handle',
        details: { issues: parsed.error.issues },
      });
    }
    return this.service.updateHandle(player, parsed.data);
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
  @HttpCode(200)
  async postAiSettings(@Req() req: IncomingMessage, @Body() body: unknown): Promise<PlayerAiSettings> {
    return this.saveAiSettings(req, body);
  }

  @Delete('ai-settings')
  async deleteAiSettings(@Req() req: IncomingMessage): Promise<PlayerAiSettings> {
    const player = await this.mePlayer(req);
    return this.service.updateAiSettings(player, { apiKey: null, model: MANAGED_AI_MODEL });
  }

  @Post('ai-settings/verify')
  @HttpCode(200)
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

  private async mePlayer(req: IncomingMessage): Promise<ResolvedMePlayer> {
    const prod = this.env?.NODE_ENV === 'production';
    return aliasDevPlayer(resolveMePlayer(req, this.tokens, this.flags, prod), this.prisma, prod);
  }
}
