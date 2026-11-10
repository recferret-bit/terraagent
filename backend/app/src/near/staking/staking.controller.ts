import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
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

  @Post('stake')
  @HttpCode(200)
  stake(@Body() raw: unknown): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    const body = this.stakePipe.transform(raw ?? {});
    return this.stakingService.stake(body);
  }

  @Post('unstake')
  @HttpCode(200)
  unstake(@Body() raw: unknown): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    const body = this.unstakePipe.transform(raw ?? {});
    return this.stakingService.unstake(body);
  }

  @Post('withdraw')
  @HttpCode(200)
  withdraw(@Body() raw: unknown): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    const normalized = this.normalizeWithdrawBody(raw);
    const body = this.withdrawPipe.transform(normalized);
    return this.stakingService.withdraw(body);
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
