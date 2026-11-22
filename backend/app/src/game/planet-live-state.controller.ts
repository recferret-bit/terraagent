import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import {
  CANONICAL_PLANETS,
  type AgentDecisionHistoryResponseV1,
  type PlanetSectorsLiveStateV1,
  type SimInputHistoryResponseV1,
} from '@terra/contracts';
import { resolveCanonicalPlanetType } from '../lobby/planets.helpers';
import { SectorStateService } from './persistence/sector-state.service';
import { SimHistoryService } from './persistence/sim-history.service';
import { SimLeaseService, type SimLeaseRecord } from './persistence/sim-lease.service';

function resolveLivePlanetId(rawId: string): string {
  const canonicalType = resolveCanonicalPlanetType(rawId);
  return canonicalType ? CANONICAL_PLANETS[canonicalType].id : rawId;
}

function parseOptionalInt(raw?: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseOptionalBool(raw?: string): boolean | undefined {
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

/**
 * Production REST endpoints exposing per-planet live sector state (humans + bots),
 * complete simulation input history, decision history, and active simulation worker leases.
 */
@Controller('planets')
export class PlanetLiveStateController {
  constructor(
    @Inject(SectorStateService) private readonly sectorState: SectorStateService,
    @Inject(SimHistoryService) private readonly history: SimHistoryService,
    @Inject(SimLeaseService) private readonly leases: SimLeaseService,
  ) {}

  @Get('workers/leases')
  async getWorkerLeases(): Promise<{ workerId: string; leases: SimLeaseRecord[] }> {
    return {
      workerId: this.leases.workerId,
      leases: await this.leases.listLeases(),
    };
  }

  @Get(':id/live')
  async getPlanetLiveState(@Param('id') id: string): Promise<PlanetSectorsLiveStateV1> {
    const planetId = resolveLivePlanetId(id);
    const live = await this.sectorState.getLivePlanetState(planetId);
    if (!live) {
      throw new NotFoundException(`No live sector state found for planet "${id}"`);
    }
    return live;
  }

  @Get(':id/inputs')
  async getPlanetInputHistory(
    @Param('id') id: string,
    @Query('sectorId') sectorId?: string,
    @Query('colonyIndex') colonyIndexRaw?: string,
    @Query('isBot') isBotRaw?: string,
    @Query('source') source?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<SimInputHistoryResponseV1> {
    const planetId = resolveLivePlanetId(id);
    return this.history.queryInputs(planetId, {
      sectorId: sectorId?.trim() || undefined,
      colonyIndex: parseOptionalInt(colonyIndexRaw),
      isBot: parseOptionalBool(isBotRaw),
      source: source?.trim() || undefined,
      limit: parseOptionalInt(limitRaw),
      cursor: cursor?.trim() || undefined,
    });
  }

  @Get(':id/decisions')
  async getPlanetDecisionHistory(
    @Param('id') id: string,
    @Query('sectorId') sectorId?: string,
    @Query('colonyIndex') colonyIndexRaw?: string,
    @Query('isBot') isBotRaw?: string,
    @Query('actorSource') actorSource?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<AgentDecisionHistoryResponseV1> {
    const planetId = resolveLivePlanetId(id);
    return this.history.queryDecisions(planetId, {
      sectorId: sectorId?.trim() || undefined,
      colonyIndex: parseOptionalInt(colonyIndexRaw),
      isBot: parseOptionalBool(isBotRaw),
      actorSource: actorSource?.trim() || undefined,
      limit: parseOptionalInt(limitRaw),
      cursor: cursor?.trim() || undefined,
    });
  }
}
