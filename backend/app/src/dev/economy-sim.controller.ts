import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req, UseGuards } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { EconomySimService } from '../ai/economy-sim/economy-sim.service.js';
import { AuthTokenService } from '../core/auth/index.js';
import { DevOnlyGuard } from '../core/dev-only.guard.js';
import { CoreException } from '../core/errors/core-exception.js';
import { TokenBucketLimiter } from '../core/token-bucket.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { resolveOptionalBearerPlayerId } from '../near/identity/colony-ownership.guard.js';

const RunSimBodySchema = z.object({
  seed: z.string().min(1).max(64).optional(),
  days: z.number().int().min(1).max(14).optional(),
  useLiveLlm: z.boolean().optional(),
});

/** `/v1/dev/economy-sim/*` — dev route guarded by `DevOnlyGuard` (`404` in production per `BE-18`). */
@Controller('dev/economy-sim')
@UseGuards(DevOnlyGuard)
export class DevEconomySimController {
  constructor(private readonly sim: EconomySimService) {}

  @Get('latest')
  latest() {
    return this.sim.getLatest();
  }

  @Post('run')
  @HttpCode(200)
  run(@Body() body: unknown) {
    return this.sim.run(RunSimBodySchema.parse(body ?? {}));
  }
}

/** `/v1/economy-sim/*` — rate-limited public showcase endpoint (`useLiveLlm` requires auth or explicit env opt-in). */
@Controller('economy-sim')
export class PublicEconomySimController {
  private readonly ipLimiter = new TokenBucketLimiter({ perSecond: 0.05, burst: 3, maxKeys: 2000 });

  constructor(
    private readonly sim: EconomySimService,
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  @Get('latest')
  latest() {
    return this.sim.getLatest();
  }

  @Post('run')
  @HttpCode(200)
  run(@Body() body: unknown, @Req() req?: IncomingMessage) {
    const ip =
      (req as { ip?: string } | undefined)?.ip ??
      req?.socket?.remoteAddress ??
      'local';
    if (!this.ipLimiter.take(ip)) {
      throw new CoreException('RATE_LIMITED', {
        status: 429,
        message: 'Too many public economy-sim requests; please retry shortly.',
        details: { retryAfterMs: this.ipLimiter.retryAfterMs(ip) },
      });
    }
    const parsed = RunSimBodySchema.parse(body ?? {});
    const caller = resolveOptionalBearerPlayerId(req, this.tokens, this.env);
    const allowPublicLive =
      (this.env as Record<string, string | undefined> | undefined)?.TA_ALLOW_PUBLIC_LIVE_SIM_LLM === 'true' ||
      process.env.TA_ALLOW_PUBLIC_LIVE_SIM_LLM === 'true';
    const useLiveLlm = caller || allowPublicLive ? parsed.useLiveLlm : false;
    return this.sim.run({ ...parsed, useLiveLlm });
  }
}
