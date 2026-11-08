import { Controller, Get, Inject, Param, Query, UseFilters } from '@nestjs/common';
import type {
  PlanetListV1,
  PlanetSummaryV1,
  PublicPlanetStatsV1,
  SectorId,
  SectorSummaryV1,
} from '@terra/contracts';
import type { PlanetSectorsResponseV1 } from './planets.helpers';
import { PlanetsService } from './planets.service';
import { MatchTicketsExceptionFilter } from './tickets.types';

/**
 * Public & orbital-picker planet and sector summaries REST controller (`/v1/planets`, W11-08, MATCHMAKING §0.2, §0.3, §4).
 * - `GET /v1/planets` — always returns all 3 canonical types (`desert`, `ocean`, `temperate`), never `newPlanet`.
 * - `GET /v1/planets/stats` — public landing-page stats with nullable live counts (`null` when unavailable, never false 0).
 * - `GET /v1/planets/:id` — single canonical planet summary by ID, type, or slug alias (or 404).
 * - `GET /v1/planets/:id/sectors` — sector summaries and world metadata for a canonical planet (or 404).
 * - `GET /v1/planets/:id/sectors/:sectorId` — single sector summary on a canonical planet (or 404).
 */
@Controller('planets')
@UseFilters(MatchTicketsExceptionFilter)
export class PlanetsController {
  constructor(@Inject(PlanetsService) private readonly planetsService: PlanetsService) {}

  @Get()
  listPlanets(@Query('type') type?: string): Promise<PlanetListV1> {
    return this.planetsService.listPlanets(type !== undefined ? { type } : undefined);
  }

  @Get('stats')
  getPublicStats(): Promise<PublicPlanetStatsV1> {
    return this.planetsService.getPublicStats();
  }

  @Get(':id')
  getPlanet(@Param('id') id: string): Promise<PlanetSummaryV1> {
    return this.planetsService.getPlanetSummary(id);
  }

  @Get(':id/sectors')
  getPlanetSectors(@Param('id') id: string): Promise<PlanetSectorsResponseV1> {
    return this.planetsService.getPlanetSectors(id);
  }

  @Get(':id/sectors/:sectorId')
  getPlanetSector(
    @Param('id') id: string,
    @Param('sectorId') sectorId: SectorId,
  ): Promise<SectorSummaryV1> {
    return this.planetsService.getSectorSummary(id, sectorId);
  }
}
