import { Controller, Get, Inject, Optional, Query } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { resolveDbStakerPerks } from '../../../near/staking/staker-perks.js';
import { GuildVisitService } from './guild-visit.service.js';
import { radarVisits, type RadarView } from './radar.js';

/**
 * W28-06 `GET /v1/market/guild/radar?planetId=…&colonyId=…`: Guild ships as the colony's wallet sees them. Tier 2+
 * (`guildRadarLeadMs`, `5 min`) get each `guild.arrived` notice that much earlier (`noticeAt`); without `W28` or below
 * Tier 2 `noticeAt === arriveAt`. Read-only; the live `guild.arrived` push itself is unchanged.
 */
@Controller('market')
export class GuildRadarController {
  constructor(
    @Inject(GuildVisitService) private readonly visits: GuildVisitService,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  @Get('guild/radar')
  async radar(
    @Query('planetId') planetIdRaw?: string,
    @Query('colonyId') colonyIdRaw?: string,
    @Query('colonyIndex') colonyIndexRaw?: string,
    @Query('accountId') accountIdRaw?: string,
  ): Promise<RadarView> {
    const planetId = planetIdRaw?.trim();
    if (!planetId) throw new CoreException('INVALID_REQUEST', { status: 400, message: 'planetId is required' });
    const leadMs = await this.leadFor(planetId, colonyIdRaw?.trim(), colonyIndexRaw?.trim(), accountIdRaw?.trim());
    const { nowMs, windows } = this.visits.upcoming(planetId);
    return { planetId, nowMs, leadMs, visits: radarVisits(windows, leadMs, nowMs) };
  }

  private async leadFor(
    planetId: string,
    colonyIdRaw: string | undefined,
    colonyIndexRaw: string | undefined,
    accountId: string | undefined,
  ): Promise<number> {
    if ((!colonyIdRaw && !accountId) || !this.flags.has('W28')) return 0;
    const colonyId = await this.resolveColonyRowId(planetId, colonyIdRaw, colonyIndexRaw);
    const envBag = (this.env ?? process.env) as unknown as Record<string, string | undefined>;
    return (await resolveDbStakerPerks(this.prisma, { colonyId, accountId, env: envBag, w28: true })).guildRadarLeadMs;
  }

  private async resolveColonyRowId(
    planetId: string,
    simId: string | undefined,
    colonyIndexRaw: string | undefined,
  ): Promise<string | undefined> {
    if (!simId) return undefined;
    const db = this.prisma;
    if (!db || !/^\d{1,3}$/.test(colonyIndexRaw ?? '') || typeof db.colony?.findFirst !== 'function') return simId;
    if (typeof db.colony.findUnique === 'function' && (await db.colony.findUnique({ where: { id: simId }, select: { id: true } }))) {
      return simId;
    }
    const row = await db.colony.findFirst({ where: { planetId, colonyIndex: Number(colonyIndexRaw) }, select: { id: true } });
    return row?.id ?? simId;
  }
}
