import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { EconomySimService } from '../ai/economy-sim/economy-sim.service.js';
import { DevOnlyGuard } from '../core/dev-only.guard.js';

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

/** `/v1/economy-sim/*` — isolated read-only/in-memory showcase endpoint so live HTTPS judge demos work in production too. */
@Controller('economy-sim')
export class PublicEconomySimController {
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
