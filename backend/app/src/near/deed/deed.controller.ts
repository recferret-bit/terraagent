import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  NearDeedListResponse,
  type DeedPlanetType,
  type DeedView,
  type PublicDeedResponse,
} from '@terra/contracts';
import { getColonyUnlockStage, restore } from '@terra/sim';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/index.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { devBearerPlayer } from '../../ws/session-verifier.js';
import { OutboxRelayService } from '../application/outbox/outbox.module.js';
import { DeedDebounceService } from './deed-debounce.service.js';
import { DeedImageRendererService } from './deed-image.renderer.js';
import { DeedMintOutboxService } from './deed-mint-outbox.service.js';
import { DeedSettledService } from './deed-settled.service.js';
import { DeedRepository, type StoredDeedRecord } from './deed.repository.js';
import { W20ScenarioSeedService } from './w20-scenario-seed.service.js';

const BEARER_RE = /^Bearer\s+(\S+)$/i;

interface ReplyLike extends Partial<ServerResponse> {
  header?: (name: string, value: string) => unknown;
  type?: (contentType: string) => unknown;
  send?: (body: Buffer) => unknown;
}

function setHeader(res: ReplyLike, name: string, value: string): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader(name, value);
  } else if (typeof res.header === 'function') {
    res.header(name, value);
  }
}

function sendPngBuffer(
  res: ReplyLike,
  rendered: { png: Buffer; etag: string; cached: boolean; version: number },
): Buffer | void {
  setHeader(res, 'content-type', 'image/png');
  setHeader(res, 'cache-control', 'public, max-age=31536000, immutable');
  setHeader(res, 'etag', rendered.etag);
  setHeader(res, 'x-deed-cache', rendered.cached ? 'HIT' : 'MISS');
  setHeader(res, 'x-deed-version', String(rendered.version));
  if (typeof res.end === 'function' && typeof res.setHeader === 'function') {
    res.end(rendered.png);
    return;
  }
  return rendered.png;
}

/**
 * Authenticated / player Colony Deed endpoints (`GET /v1/near/deed`, `POST /v1/near/deed/settle`,
 * `GET /v1/near/deed/:tokenId/image.png`, W20-08, W20-09, W20-15).
 */
@Controller('near/deed')
export class NearDeedController {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Inject(DeedMintOutboxService) private readonly mintService: DeedMintOutboxService,
    @Inject(DeedDebounceService) private readonly debounceService: DeedDebounceService,
    @Inject(DeedSettledService) private readonly settledService: DeedSettledService,
    @Inject(DeedImageRendererService) private readonly imageRenderer: DeedImageRendererService,
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(OutboxRelayService) private readonly outboxRelay?: OutboxRelayService,
    @Optional() @Inject(W20ScenarioSeedService) private readonly w20Seed?: W20ScenarioSeedService,
  ) {}

  @Get()
  async getOwnDeeds(
    @Req() req: IncomingMessage,
    @Query('colonyId') colonyId?: string,
    @Query('planetId') planetId?: string,
  ): Promise<NearDeedListResponse> {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    await this.w20Seed?.waitForSeed();
    const playerId = this.extractOptionalPlayerId(req);
    await this.debounceService.flushReady();

    let records = await this.deeds.listForPlayerOrColony({ playerId, colonyId, planetId });
    if (records.length === 0 && colonyId) {
      const byColony = await this.deeds.findByColonyId(colonyId);
      if (byColony) records = [byColony];
    }
    if (records.length === 0) {
      const seeded = await this.ensureDeedForLoadedColony({ colonyId, planetId, playerId });
      if (seeded) records = [seeded];
    }

    const views: DeedView[] = [];
    for (const r of records) {
      views.push(await this.deeds.toDeedView(r));
    }
    return NearDeedListResponse.parse({
      deed: views[0] ?? null,
      deeds: views,
    });
  }

  @Post('settle')
  @HttpCode(200)
  async settleDeed(
    @Body() body?: { colonyId?: string; planetId?: string },
  ): Promise<{ deed: DeedView }> {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    await this.settledService.settleColonyDeed({
      colonyId: body?.colonyId,
      planetId: body?.planetId,
      reason: 'Sealed Settled Deed from Colony Deed panel',
    });
    await this.outboxRelay?.pollOnce();
    const records = await this.deeds.listForPlayerOrColony({
      colonyId: body?.colonyId,
      planetId: body?.planetId,
    });
    const primary = records[0] ?? (await this.deeds.listAll())[0];
    if (!primary) {
      throw new CoreException('DEED_NOT_FOUND', { status: 404, message: 'Deed not found' });
    }
    return { deed: await this.deeds.toDeedView(primary) };
  }

  @Get(':tokenId/image.png')
  async getDeedImage(
    @Param('tokenId') tokenId: string,
    @Res() res: ReplyLike,
  ): Promise<Buffer | void> {
    const rendered = await this.imageRenderer.renderForToken(decodeURIComponent(tokenId));
    return sendPngBuffer(res, rendered);
  }

  private extractOptionalPlayerId(req: IncomingMessage): string | undefined {
    const raw = req.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== 'string' || !header.trim()) return undefined;
    const token = BEARER_RE.exec(header.trim())?.[1];
    if (token) {
      const dev = devBearerPlayer(token);
      if (dev) return dev.id;
    }
    if (!this.tokens) return undefined;
    try {
      return extractBearerPlayer(req, this.tokens)?.id;
    } catch {
      return undefined;
    }
  }

  private async ensureDeedForLoadedColony(opts: {
    colonyId?: string;
    planetId?: string;
    playerId?: string;
  }): Promise<StoredDeedRecord | null> {
    const targetPlanetId =
      opts.planetId ?? (this.planets ? this.planets.loadedIds()[0] : undefined);
    if (!targetPlanetId) return null;

    let stage = 4;
    let terraformBp = 4000;
    let colonyName = 'Aegis Spire';
    let planetType: DeedPlanetType = 'temperate';
    let colonyId = opts.colonyId || 'col_0';

    if (this.planets?.isLoaded(targetPlanetId)) {
      try {
        const full = await this.planets.fullState(targetPlanetId);
        const state = restore(full.bytes);
        stage = Math.max(0, getColonyUnlockStage(state, 0));
        const col = state.colonies[0] as
          | { id?: string; name?: string; terraformBp?: number }
          | undefined;
        if (typeof col?.name === 'string' && col.name.length > 0) colonyName = col.name;
        if (!opts.colonyId && typeof col?.id === 'string' && col.id.length > 0) colonyId = col.id;
        if (typeof col?.terraformBp === 'number' && Number.isFinite(col.terraformBp)) {
          terraformBp = col.terraformBp;
        }
        if (full.planetType) planetType = full.planetType as DeedPlanetType;
      } catch {
        // Fallback to defaults if fullState times out
      }
    }

    const enq = await this.mintService.mintForColony({
      colonyId,
      planetId: targetPlanetId,
      playerId: opts.playerId ?? null,
      colonyName,
      planetType,
      stage,
      terraformBp,
    });
    if (!enq) return null;
    await this.outboxRelay?.pollOnce();
    return (await this.deeds.findByColonyId(colonyId)) ?? enq.record;
  }
}

/**
 * Public unauthenticated Colony Deed endpoints (`GET /v1/deeds/:tokenId`,
 * `GET /v1/deeds/:tokenId/image.png`, W20-09, PROTOCOL F6 row).
 */
@Controller('deeds')
export class PublicDeedController {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Inject(DeedImageRendererService) private readonly imageRenderer: DeedImageRendererService,
  ) {}

  @Get(':tokenId')
  async getPublicDeed(@Param('tokenId') tokenId: string): Promise<PublicDeedResponse> {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const record = await this.deeds.findByTokenId(decodeURIComponent(tokenId));
    if (!record) {
      throw new CoreException('DEED_NOT_FOUND', { status: 404, message: 'Deed not found' });
    }
    return this.deeds.toPublicDeedResponse(record);
  }

  @Get(':tokenId/image.png')
  async getPublicDeedImage(
    @Param('tokenId') tokenId: string,
    @Res() res: ReplyLike,
  ): Promise<Buffer | void> {
    const rendered = await this.imageRenderer.renderForToken(decodeURIComponent(tokenId));
    return sendPngBuffer(res, rendered);
  }
}
