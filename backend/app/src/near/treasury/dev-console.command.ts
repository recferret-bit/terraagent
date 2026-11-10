import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { BountyReward, BountyTarget, TreasuryEffectKind } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { z } from 'zod';
import { defineDevCommand, DevCommandRegistry } from '../../dev/dev-command.registry.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { BountyRepository } from '../bounty/bounty.repository.js';
import { BountyPayService } from '../bounty/pay.service.js';
import { BountyPostService } from '../bounty/post.service.js';
import { TreasuryDaoPort } from '../application/ports/treasury-dao.port.js';
import { PlanetBountyWorld } from '../bounty/world.js';
import {
  runBountyComplete,
  runBountyPost,
  runMercHire,
  runTreasuryEffect,
  runTreasuryFund,
  type ConsoleDeps,
} from './dev-console.handlers.js';
import { PlanetDaoLifecycleService } from './lifecycle.service.js';

const planetId = z.string().min(1).max(80);
const colonyIndex = z.number().int().min(0).max(32_767);
const tile = z.number().int().min(-32_768).max(32_767);

const effectArgs = z.object({ planetId, kind: TreasuryEffectKind }).strict();
const fundArgs = z.object({ planetId, amount: z.number().int().positive().max(1_000_000_000) }).strict();
const postArgs = z
  .object({
    planetId,
    colonyIndex,
    colonyId: z.string().min(1).max(80).optional(),
    target: BountyTarget,
    reward: BountyReward,
  })
  .strict();
const completeArgs = z
  .object({
    id: z.string().min(1).max(80),
    claimer: z.string().min(2).max(64).optional(),
  })
  .strict();
const hireArgs = z
  .object({
    planetId,
    colonyIndex,
    hours: z.number().positive().max(168),
    q: tile.optional(),
    r: tile.optional(),
  })
  .strict();

/**
 * W22 dev console (W22-35). Hidden in production with the rest of `DevCommandRegistry`.
 * W22 off rejects every command. The client feature is also dropped when the flag is off.
 */
@Injectable()
export class W22DevCommands implements OnModuleInit {
  constructor(
    private readonly registry: DevCommandRegistry,
    private readonly flags: FlagsService,
    @Inject(TreasuryDaoPort) private readonly dao: TreasuryDaoPort,
    private readonly lifecycle: PlanetDaoLifecycleService,
    private readonly planets: GamePlanets,
    private readonly posts: BountyPostService,
    private readonly pay: BountyPayService,
    private readonly repo: BountyRepository,
    private readonly world: PlanetBountyWorld,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      defineDevCommand({
        name: 'treasury.fund',
        help: 'Deposit whole metals.t1 into the planet DAO (creates the DAO if it is missing).',
        args: fundArgs,
        run: (args) => runTreasuryFund(this.deps(), args),
      }),
    );
    this.registry.register(
      defineDevCommand({
        name: 'treasury.effect',
        help: 'Post system.treasuryEffect on a loaded planet (meteor_shield, terraform_boost, guild_subsidy).',
        args: effectArgs,
        run: (args) => runTreasuryEffect(this.deps(), args),
      }),
    );
    this.registry.register(
      defineDevCommand({
        name: 'bounty.post',
        help: 'Open bounty escrow for this colony through BountyPostService. Does not send the sim command.',
        args: postArgs,
        run: (args) => runBountyPost(this.deps(), args),
      }),
    );
    this.registry.register(
      defineDevCommand({
        name: 'bounty.complete',
        help: 'Mark a chain bounty completed and pay it when a claimer is stored or passed.',
        args: completeArgs,
        run: (args) => runBountyComplete(this.deps(), args),
      }),
    );
    this.registry.register(
      defineDevCommand({
        name: 'merc.hire',
        help: 'Spawn the light recon squad (mercenary.spawn). Does not open escrow.',
        args: hireArgs,
        run: (args) => runMercHire(this.deps(), args),
      }),
    );
  }

  private deps(): ConsoleDeps {
    return {
      flags: this.flags,
      dao: this.dao,
      lifecycle: this.lifecycle,
      sim: this.planets,
      posts: this.posts,
      pay: this.pay,
      repo: this.repo,
      world: this.world,
      prisma: this.prisma,
    };
  }
}
