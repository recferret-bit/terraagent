import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query } from '@nestjs/common';
import {
  StakeRequestSchema,
  UnstakeRequestSchema,
  WithdrawRequestSchema,
  type StakingActionResponse,
  type StakingStatusResponse,
} from '@terra/contracts';
import { CoreException, ZodPipe } from '../../core/errors/index.js';
import { FlagsService } from '../../flags/flags.service.js';
import { StakingService } from './staking.service.js';
import type { StakingWalletTxDescriptor } from './staking-wallet-tx.js';

const FORBIDDEN_AI_ACTORS = new Set(['ai', 'director', 'agent', 'bot', 'autopilot', 'swarm']);

function hasBotApiCredential(authHeader?: string, apiKeyHeader?: string): boolean {
  const auth = (authHeader ?? '').trim();
  const apiKey = (apiKeyHeader ?? '').trim();
  if (apiKey.startsWith('ta_bot_')) return true;
  if (/^Bearer\s+ta_bot_/i.test(auth) || auth.startsWith('ta_bot_')) return true;
  return false;
}

@Controller('near')
export class StakingController {
  private readonly stakePipe = new ZodPipe(StakeRequestSchema);
  private readonly unstakePipe = new ZodPipe(UnstakeRequestSchema);
  private readonly withdrawPipe = new ZodPipe(WithdrawRequestSchema);

  constructor(
    @Inject(StakingService) private readonly stakingService: StakingService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  @Get('staking')
  getStatus(
    @Query('colonyId') colonyId?: string,
    @Query('accountId') accountId?: string,
  ): Promise<StakingStatusResponse> {
    this.assertWaveEnabled();
    return this.stakingService.getStatus({ colonyId, accountId });
  }

  @Get('staking/wallet-tx')
  getWalletTx(
    @Query('action') action?: string,
    @Query('poolId') poolId?: string,
    @Query('amountNear') amountNear?: string,
    @Query('accountId') accountId?: string,
  ): StakingWalletTxDescriptor {
    this.assertWaveEnabled();
    return this.stakingService.walletTxDescriptor({ action, poolId, amountNear, accountId });
  }

  @Post('stake')
  @HttpCode(200)
  stake(
    @Body() raw: unknown,
    @Headers('x-actor') actorHeader?: string,
    @Headers('authorization') authHeader?: string,
    @Headers('x-api-key') apiKeyHeader?: string,
  ): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    this.assertHumanCaller(actorHeader, authHeader, apiKeyHeader, raw);
    const body = this.stakePipe.transform(raw ?? {});
    return this.stakingService.stake(body);
  }

  @Post('unstake')
  @HttpCode(200)
  unstake(
    @Body() raw: unknown,
    @Headers('x-actor') actorHeader?: string,
    @Headers('authorization') authHeader?: string,
    @Headers('x-api-key') apiKeyHeader?: string,
  ): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    this.assertHumanCaller(actorHeader, authHeader, apiKeyHeader, raw);
    const body = this.unstakePipe.transform(raw ?? {});
    return this.stakingService.unstake(body);
  }

  @Post('withdraw')
  @HttpCode(200)
  withdraw(
    @Body() raw: unknown,
    @Headers('x-actor') actorHeader?: string,
    @Headers('authorization') authHeader?: string,
    @Headers('x-api-key') apiKeyHeader?: string,
  ): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    this.assertHumanCaller(actorHeader, authHeader, apiKeyHeader, raw);
    const normalized = this.normalizeWithdrawBody(raw);
    const body = this.withdrawPipe.transform(normalized);
    return this.stakingService.withdraw(body);
  }

  private assertHumanCaller(
    actorHeader: string | undefined,
    authHeader: string | undefined,
    apiKeyHeader: string | undefined,
    raw: unknown,
  ): void {
    const bodyObj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const actor = String(actorHeader ?? bodyObj.actor ?? bodyObj.source ?? '').trim().toLowerCase();
    if (FORBIDDEN_AI_ACTORS.has(actor) || hasBotApiCredential(authHeader, apiKeyHeader)) {
      throw new CoreException('AI_STAKING_FORBIDDEN', {
        status: 403,
        message: 'Staking requires explicit human wallet approval; AI agents and ta_bot_ keys cannot stake, unstake, or withdraw.',
      });
    }
  }

  private normalizeWithdrawBody(raw: unknown): unknown {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return raw ?? {};
    }
    const obj = raw as Record<string, unknown>;
    if ('amount' in obj && typeof obj.amount === 'string' && /^\d+(\.\d+)?$/.test(obj.amount)) {
      const { amount: _ignored, ...rest } = obj;
      return rest;
    }
    return raw;
  }

  private assertWaveEnabled(): void {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
  }
}
