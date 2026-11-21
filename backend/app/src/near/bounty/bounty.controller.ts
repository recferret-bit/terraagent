import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { BountyPostArgsSchema } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { AuthTokenService } from '../../core/auth/index.js';
import { resolveTileSectorFast, SectorAntiCheatService } from '../../core/anticheat/index.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { resolveColonyAccountId } from '../cargo/cargo-export-outbox.js';
import { assertColonyOwnership } from '../identity/colony-ownership.guard.js';
import { BountyClaimService } from './claim.service.js';
import { BountyPostService } from './post.service.js';
import type { BountyView, PostedBounty } from './view.js';
import { PlanetBountyWorld, type BountyWorldSource } from './world.js';

export interface BountyListResponse {
  readonly planetId: string;
  readonly bounties: readonly BountyView[];
}

const ColonyBody = z.strictObject({
  colonyId: z.string().min(1).max(80),
  colonyIndex: z.number().int().min(0).max(32_767),
  playerId: z.string().min(1).max(80).nullable().optional(),
  sectorId: z.string().min(1).max(64).optional(),
});

const PostBody = BountyPostArgsSchema.extend({
  colonyId: ColonyBody.shape.colonyId,
  colonyIndex: ColonyBody.shape.colonyIndex,
  playerId: ColonyBody.shape.playerId,
  sectorId: ColonyBody.shape.sectorId,
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
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(SectorAntiCheatService) private readonly antiCheat?: SectorAntiCheatService,
    @Optional() @Inject(PlanetBountyWorld) private readonly world?: BountyWorldSource,
  ) {}

  @Get(':planetId')
  async list(@Param('planetId') planetId: string): Promise<BountyListResponse> {
    this.assertWave();
    return { planetId, bounties: await this.posts.list(planetId) };
  }

  @Post(':planetId')
  @HttpCode(200)
  async post(
    @Param('planetId') planetId: string,
    @Body() raw: unknown,
    @Req() req?: IncomingMessage,
  ): Promise<PostedBounty> {
    this.assertWave();
    const body = PostBody.parse(raw ?? {});
    await this.ensurePlanetSynced(planetId);
    const callerPlayerId = await assertColonyOwnership({
      req,
      tokens: this.tokens,
      env: this.env,
      prisma: this.prisma,
      port: 'Escrow',
      colonyId: body.colonyId,
      claimedPlayerId: body.playerId,
      expectedPlanetId: planetId,
      expectedColonyIndex: body.colonyIndex,
      expectedSectorId: body.sectorId,
      antiCheat: this.antiCheat,
    });
    const effectivePlayerId = callerPlayerId ?? body.playerId;
    this.assertBountyAntiCheat(planetId, body, effectivePlayerId, 'bounty.post', {
      target: body.target,
      reward: body.reward,
      expiresAt: body.expiresAt,
    });
    const accountId = await this.account(planetId, body.colonyId, body.colonyIndex, effectivePlayerId);
    const posted = await this.posts.post({
      planetId,
      colonyId: body.colonyId,
      colonyIndex: body.colonyIndex,
      accountId,
      bountyId: body.bountyId,
      args: { target: body.target, reward: body.reward, expiresAt: body.expiresAt },
    });
    this.indexPostedBounty(planetId, posted.id, body.colonyId, body.colonyIndex, body.target);
    return posted;
  }

  @Post(':planetId/:id/claim')
  @HttpCode(200)
  async claim(
    @Param('planetId') planetId: string,
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() req?: IncomingMessage,
  ): Promise<BountyView> {
    this.assertWave();
    const body = ColonyBody.parse(raw ?? {});
    await this.ensurePlanetSynced(planetId);
    const callerPlayerId = await assertColonyOwnership({
      req,
      tokens: this.tokens,
      env: this.env,
      prisma: this.prisma,
      port: 'Escrow',
      colonyId: body.colonyId,
      claimedPlayerId: body.playerId,
      expectedPlanetId: planetId,
      expectedColonyIndex: body.colonyIndex,
      expectedSectorId: body.sectorId,
      antiCheat: this.antiCheat,
    });
    const effectivePlayerId = callerPlayerId ?? body.playerId;
    const storedBounty = (await this.prisma.chainBounty?.findUnique?.({
      where: { id },
      select: { planetId: true, posterColonyId: true, colonyIndex: true, target: true },
    })) as { planetId?: string; posterColonyId?: string; colonyIndex?: number; target?: unknown } | null | undefined;
    if (storedBounty?.planetId && storedBounty.planetId !== planetId) {
      this.antiCheat?.recordRejection('http', 'economy', 'not_your_planet');
      throw new CoreException('WRONG_PLANET', {
        status: 403,
        message: 'Bounty belongs to a different planet',
        details: { code: 'not_own_colony', planetId: storedBounty.planetId },
      });
    }
    if (
      this.antiCheat &&
      storedBounty?.posterColonyId &&
      !this.antiCheat.index.getColonyById(storedBounty.posterColonyId) &&
      typeof this.prisma.colony?.findUnique === 'function'
    ) {
      const posterRow = (await this.prisma.colony.findUnique({
        where: { id: storedBounty.posterColonyId },
        select: { playerId: true, planetId: true, colonyIndex: true, foundingSectorId: true, status: true },
      })) as { playerId?: string; planetId?: string; colonyIndex?: number; foundingSectorId?: string | null; status?: string } | null;
      if (posterRow?.planetId && typeof posterRow.colonyIndex === 'number') {
        this.antiCheat.index.upsertColonyBase({
          playerId: posterRow.playerId ?? '',
          colonyId: storedBounty.posterColonyId,
          planetId: posterRow.planetId,
          colonyIndex: posterRow.colonyIndex,
          foundingSectorId: posterRow.foundingSectorId,
          status: posterRow.status,
        });
      }
    }
    this.assertBountyAntiCheat(planetId, body, effectivePlayerId, 'bounty.claim', {
      bountyId: id,
      ...(storedBounty?.posterColonyId ? { posterColonyId: storedBounty.posterColonyId } : {}),
      ...(typeof storedBounty?.colonyIndex === 'number' ? { posterColonyIndex: storedBounty.colonyIndex } : {}),
      ...(storedBounty?.target && typeof storedBounty.target === 'object' ? { target: storedBounty.target } : {}),
    });
    const accountId = await this.account(planetId, body.colonyId, body.colonyIndex, effectivePlayerId);
    return this.claims.claim({ planetId, bountyId: id, accountId });
  }

  private async ensurePlanetSynced(planetId: string): Promise<void> {
    if (this.antiCheat && !this.antiCheat.index.getPlanet(planetId)?.syncedFromSim) {
      await this.world?.load(planetId);
    }
  }

  private indexPostedBounty(
    planetId: string,
    bountyId: string,
    posterColonyId: string,
    posterColonyIndex: number,
    target: Record<string, unknown>,
  ): void {
    if (!this.antiCheat) return;
    const planet = this.antiCheat.index.getPlanet(planetId);
    const poster =
      this.antiCheat.index.getColonyById(posterColonyId) ??
      this.antiCheat.index.getColonyByPlanetIndex(planetId, posterColonyIndex);
    const targetKind = typeof target.kind === 'string' ? target.kind : 'unknown';
    const sectorId =
      targetKind === 'defend_area' && typeof target.q === 'number' && typeof target.r === 'number'
        ? planet?.hasMultiSectorGrid
          ? resolveTileSectorFast(target.q, target.r, planet.sectorRadius)
          : poster?.baseSectorId
        : targetKind === 'clear_nest' && typeof target.nestId === 'string' && /^\d+$/.test(target.nestId)
          ? (planet?.entitiesById.get(Number(target.nestId))?.sectorId ?? poster?.baseSectorId)
          : targetKind !== 'deliver_units'
            ? poster?.baseSectorId
            : undefined;
    this.antiCheat.index.registerBounty(planetId, {
      bountyId,
      posterColonyId,
      posterColonyIndex,
      targetKind,
      ...(sectorId ? { sectorId } : {}),
    });
  }

  private assertBountyAntiCheat(
    planetId: string,
    body: { colonyId: string; colonyIndex: number; sectorId?: string },
    effectivePlayerId: string | null | undefined,
    kind: 'bounty.post' | 'bounty.claim',
    args: unknown,
  ): void {
    if (!this.antiCheat) return;
    const byId = this.antiCheat.index.getColonyById(body.colonyId);
    const byIdx = this.antiCheat.index.getColonyByPlanetIndex(planetId, body.colonyIndex);
    const indexed = byId ?? byIdx;
    const verdict = this.antiCheat.validateCommand({
      transport: 'http',
      playerId: effectivePlayerId ?? indexed?.playerId ?? '',
      planetId,
      sectorId: body.sectorId,
      colony: {
        id: body.colonyId,
        colonyIndex: body.colonyIndex,
        planetId: byId?.planetId ?? planetId,
        foundingSectorId: indexed?.baseSectorId,
        status: indexed?.status,
      },
      kind,
      args,
    });
    if (!verdict.ok) {
      throw new CoreException(verdict.errorCode, {
        status: verdict.httpStatus,
        message: verdict.detail,
        details: { code: verdict.rejectCode },
      });
    }
  }

  private account(planetId: string, colonyId: string, colonyIndex: number, playerId?: string | null): Promise<string> {
    return resolveColonyAccountId(this.prisma, colonyId, playerId ?? null, planetId, colonyIndex);
  }

  private assertWave(): void {
    if (!this.flags.has('W22')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
}
