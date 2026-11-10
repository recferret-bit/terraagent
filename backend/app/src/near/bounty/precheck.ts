import { Inject, Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BountyPostArgsSchema } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { CommandPrechecks, type CommandPrecheck, type CommandPrecheckInput } from '../../core/command-prechecks.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { resolveColonyAccountId } from '../cargo/cargo-export-outbox.js';
import { BountyPostService } from './post.service.js';

/**
 * Rejects `bounty.post` before the sim when the target, expiry, cap, or cargo would fail.
 * Does not open escrow: that happens once `bountyPosted` names the sim's bounty id.
 */
@Injectable()
export class BountyPostPrecheck implements OnModuleInit, OnModuleDestroy {
  private off: (() => void) | null = null;

  constructor(
    @Inject(CommandPrechecks) private readonly prechecks: CommandPrechecks,
    @Inject(BountyPostService) private readonly posts: BountyPostService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
  ) {}

  onModuleInit(): void {
    this.off ??= this.prechecks.register('bounty.post', this.check);
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
  }

  readonly check: CommandPrecheck = async (input) => {
    if (!databaseEnabled(this.env) || !input.colony) return input.colony ? null : { code: 'not_own_colony' };
    const parsed = BountyPostArgsSchema.safeParse(input.args);
    if (!parsed.success) return { code: 'invalid_args' };
    try {
      const colonyId = colonyKey(input, this.planets?.isScenarioColonyPlanet(input.planetId) ?? false);
      const accountId = await resolveColonyAccountId(this.prisma, colonyId, input.playerId, input.planetId, input.colony.colonyIndex);
      const problem = await this.posts.screen({
        planetId: input.planetId,
        colonyId,
        colonyIndex: input.colony.colonyIndex,
        accountId,
        args: parsed.data,
      });
      return problem ? { code: problem.code, detail: problem.detail } : null;
    } catch {
      return { code: 'internal', detail: 'bounty precheck failed' };
    }
  };
}

function colonyKey(input: CommandPrecheckInput, scenario: boolean): string {
  const colony = input.colony!;
  if (scenario || /^col_\d+$/.test(colony.id)) return `col_${colony.colonyIndex}`;
  return colony.id;
}
