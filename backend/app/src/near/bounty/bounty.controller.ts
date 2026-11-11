import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { BountyPostArgsSchema } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { z } from 'zod';
import { CoreException } from '../../core/errors/core-exception.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { resolveColonyAccountId } from '../cargo/cargo-export-outbox.js';
import { BountyClaimService } from './claim.service.js';
import { BountyPostService } from './post.service.js';
import type { BountyView, PostedBounty } from './view.js';

export interface BountyListResponse {
  readonly planetId: string;
  readonly bounties: readonly BountyView[];
}

const ColonyBody = z.strictObject({
  colonyId: z.string().min(1).max(80),
  colonyIndex: z.number().int().min(0).max(32_767),
  playerId: z.string().min(1).max(80).nullable().optional(),
});

const PostBody = BountyPostArgsSchema.extend({
  colonyId: ColonyBody.shape.colonyId,
  colonyIndex: ColonyBody.shape.colonyIndex,
  playerId: ColonyBody.shape.playerId,
  bountyId: z.string().min(1).max(80).optional(),
});

/** `GET/POST /v1/bounties/:planetId` and `POST …/:id/claim`. 404 when W22 is off. */
@Controller('bounties')
export class BountyController {
  constructor(
    @Inject(BountyPostService) private readonly posts: BountyPostService,
    @Inject(BountyClaimService) private readonly claims: BountyClaimService,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  @Get(':planetId')
  async list(@Param('planetId') planetId: string): Promise<BountyListResponse> {
    this.assertWave();
    return { planetId, bounties: await this.posts.list(planetId) };
  }

  @Post(':planetId')
  @HttpCode(200)
  async post(@Param('planetId') planetId: string, @Body() raw: unknown): Promise<PostedBounty> {
    this.assertWave();
    const body = PostBody.parse(raw ?? {});
    const accountId = await this.account(planetId, body.colonyId, body.colonyIndex, body.playerId);
    return this.posts.post({
      planetId,
      colonyId: body.colonyId,
      colonyIndex: body.colonyIndex,
      accountId,
      bountyId: body.bountyId,
      args: { target: body.target, reward: body.reward, expiresAt: body.expiresAt },
    });
  }

  @Post(':planetId/:id/claim')
  @HttpCode(200)
  async claim(@Param('planetId') planetId: string, @Param('id') id: string, @Body() raw: unknown): Promise<BountyView> {
    this.assertWave();
    const body = ColonyBody.parse(raw ?? {});
    const accountId = await this.account(planetId, body.colonyId, body.colonyIndex, body.playerId);
    return this.claims.claim({ planetId, bountyId: id, accountId });
  }

  private account(planetId: string, colonyId: string, colonyIndex: number, playerId?: string | null): Promise<string> {
    return resolveColonyAccountId(this.prisma, colonyId, playerId ?? null, planetId, colonyIndex);
  }

  private assertWave(): void {
    if (!this.flags.has('W22')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
}
