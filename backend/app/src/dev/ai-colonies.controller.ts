import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ColonyAgentLoopService } from '../ai/colony-agent/colony-agent-loop.service.js';
import { DevOnlyGuard } from '../core/dev-only.guard.js';

const SeedBodySchema = z.object({
  planetId: z.string().min(1).default('pl_dev'),
  count: z.union([z.literal(1), z.literal(2)]).optional(),
});

const TickBodySchema = z.object({
  planetId: z.string().min(1).default('pl_dev'),
});

/** Dev & judge endpoints for Rival AI seeding and live NEAR AI Cloud governor ticks (`404` in production). */
@Controller('dev/ai-colonies')
@UseGuards(DevOnlyGuard)
export class AiColoniesDevController {
  constructor(private readonly agentLoop: ColonyAgentLoopService) {}

  @Post('seed')
  @HttpCode(200)
  async seed(@Body() body: unknown) {
    const parsed = SeedBodySchema.parse(body ?? {});
    return this.agentLoop.seedRivalsOnPlanet(parsed.planetId, parsed.count ?? 2);
  }

  @Post('tick')
  @HttpCode(200)
  async tick(@Body() body: unknown) {
    const parsed = TickBodySchema.parse(body ?? {});
    const evaluations = await this.agentLoop.tickPlanetAgents(parsed.planetId);
    return { planetId: parsed.planetId, evaluations };
  }
}
