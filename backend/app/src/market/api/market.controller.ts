import type { IncomingMessage } from 'node:http';
import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import type { MarketSnapshotResponse } from '@terra/contracts';
import { CoreException } from '../../core/errors/index.js';
import { FlagsService } from '../../flags/flags.service.js';
import { MarketCallers } from './market-caller.js';
import { MarketSnapshotService } from './market-snapshot.service.js';

/**
 * `GET /v1/market/{planetId}` (W13-19): book snapshot + price board + recent trades + policy; with a bearer token (dev:
 * `dev:<name>` or `?as=<name>`) also the caller's orders, balances, reservations and stall. 403 `wave_disabled` when W13 is off.
 */
@Controller('market')
export class MarketController {
  constructor(
    private readonly snapshots: MarketSnapshotService,
    private readonly callers: MarketCallers,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  @Get(':planetId')
  async snapshot(@Req() req: IncomingMessage, @Param('planetId') planetId: string, @Query('as') as?: string): Promise<MarketSnapshotResponse> {
    if (!this.flags.has('W13')) throw new CoreException('wave_disabled', { status: 403, message: 'Markets are off', details: { code: 'wave_disabled' } });
    const playerId = this.callers.playerOf(req, as);
    const colony = playerId ? await this.callers.colonyOf(playerId, planetId) : null;
    return this.snapshots.snapshot(planetId, playerId && colony ? { playerId, colony } : null);
  }
}
