import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CANONICAL_PLANETS,
  PlanetListV1Schema,
  PlanetSummaryV1Schema,
  PublicPlanetStatsV1Schema,
  SectorSummaryV1Schema,
  type PlanetListV1,
  type PlanetSummaryV1,
  type PlanetType,
  type PublicPlanetStatsV1,
  type SectorId,
  type SectorSummaryV1,
} from '@terra/contracts';
import { HomeRepository } from '../core/home/home.repository';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import {
  buildCanonicalPlanetSummaryV1,
  CANONICAL_PLANET_TYPES,
  computePublicPlanetStatsV1,
  resolveCanonicalPlanetType,
  type PlanetLiveCountsInput,
  type PlanetLiveTelemetryProvider,
  type PlanetSectorsResponseV1,
  type PublicStatsLiveCountsInput,
  type SectorLiveCountsInput,
} from './planets.helpers';
import { MatchTicketBadRequestException, MatchTicketNotFoundException } from './tickets.types';

/**
 * Canonical planet & sector summary and public stats service (W11-08, MATCHMAKING §0.2 MM-20..24, §0.3, §4):
 * - Always represents all three canonical types (`desert`, `ocean`, `temperate`) in `PlanetListV1`.
 * - Strictly omits legacy `newPlanet`, `admissionClosesAt`, and `endsAt` fields.
 * - Derives `availability` (`open` | `full` | `paused` | `faulted` | `archived`) dynamically from validated safe landing slots.
 * - Reports exact `reservedSeats`, `foundedSeats`, `freeSeats`, and nullable live telemetry (`livingColonies`,
 *   `presentColonies`, `onlinePlayers` — `null` when unavailable/stale, never a false zero).
 */
@Injectable()
export class PlanetsService {
  private readonly lifecycle: WorldLifecycleService;
  private readonly homeRepo?: HomeRepository;
  private readonly planetLiveCounts = new Map<PlanetType, PlanetLiveCountsInput>();
  private readonly sectorLiveCounts = new Map<string, SectorLiveCountsInput>();
  private publicStatsOverride: PublicStatsLiveCountsInput | null = null;
  private telemetryProvider?: PlanetLiveTelemetryProvider;

  constructor(
    @Inject(LobbyPersistenceService) private readonly persistence: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) lifecycle?: WorldLifecycleService,
    @Optional() @Inject(HomeRepository) homeRepo?: HomeRepository,
  ) {
    this.lifecycle = lifecycle ?? new WorldLifecycleService(this.persistence);
    this.homeRepo = homeRepo;
  }

  /**
   * Sets or clears live colony/player telemetry for a canonical planet (`desert` | `ocean` | `temperate` or canonical ID).
   */
  setPlanetLiveCounts(planetIdOrType: string, counts: PlanetLiveCountsInput | null): void {
    const type = resolveCanonicalPlanetType(planetIdOrType);
    if (!type) {
      throw new MatchTicketNotFoundException(`Planet "${planetIdOrType}" not found`, {
        planetId: planetIdOrType,
      });
    }
    if (counts === null) {
      this.planetLiveCounts.delete(type);
      return;
    }
    this.planetLiveCounts.set(type, counts);
  }

  /**
   * Sets or clears live colony/player telemetry for a specific sector on a canonical planet.
   */
  setSectorLiveCounts(
    planetIdOrType: string,
    sectorId: SectorId,
    counts: SectorLiveCountsInput | null,
  ): void {
    const type = resolveCanonicalPlanetType(planetIdOrType);
    if (!type) {
      throw new MatchTicketNotFoundException(`Planet "${planetIdOrType}" not found`, {
        planetId: planetIdOrType,
      });
    }
    const key = `${type}:${sectorId}`;
    if (counts === null) {
      this.sectorLiveCounts.delete(key);
      return;
    }
    this.sectorLiveCounts.set(key, counts);
  }

  /**
   * Sets or clears an explicit public stats telemetry override (`coloniesAlive`, `playersOnline`).
   */
  setPublicStatsLiveCounts(counts: PublicStatsLiveCountsInput | null): void {
    this.publicStatsOverride = counts;
  }

  /**
   * Attaches an optional live telemetry provider (sim/presence bridge).
   */
  setLiveTelemetryProvider(provider: PlanetLiveTelemetryProvider | undefined): void {
    this.telemetryProvider = provider;
  }

  /**
   * Clears all manually injected live telemetry overrides.
   */
  clearLiveTelemetry(): void {
    this.planetLiveCounts.clear();
    this.sectorLiveCounts.clear();
    this.publicStatsOverride = null;
    this.telemetryProvider = undefined;
  }

  /**
   * Lists all three canonical planets (`desert`, `ocean`, `temperate`) as a validated `PlanetListV1`.
   * Always includes all 3 canonical types even when one or all are `full`, `paused`, `faulted`, or `archived`.
   */
  async listPlanets(options?: { readonly type?: string }): Promise<PlanetListV1> {
    if (options?.type !== undefined && options.type.trim() !== '') {
      const resolved = resolveCanonicalPlanetType(options.type);
      if (!resolved) {
        throw new MatchTicketBadRequestException(
          'validation_error',
          `Invalid planet type "${options.type}": expected desert, ocean, or temperate`,
          { type: options.type },
        );
      }
    }

    const planets = await this.listPlanetSummaries();
    const latestMs = planets.reduce((max, p) => {
      const ms = new Date(p.updatedAt).getTime();
      return Number.isNaN(ms) ? max : Math.max(max, ms);
    }, Date.now());

    return PlanetListV1Schema.parse({
      planets,
      queuePaused: this.lifecycle.isQueuePaused(),
      updatedAt: new Date(latestMs).toISOString(),
    });
  }

  /**
   * Builds validated `PlanetSummaryV1` objects for all three canonical planet types.
   */
  async listPlanetSummaries(): Promise<PlanetSummaryV1[]> {
    const out: PlanetSummaryV1[] = [];
    for (const type of CANONICAL_PLANET_TYPES) {
      out.push(await this.buildSummaryForCanonicalType(type));
    }
    return out;
  }

  /**
   * Returns a single canonical planet summary by canonical ID (`pl_01J...`), planet type (`desert` | `ocean` | `temperate`),
   * or slug alias (`planet_desert_prime` | `planet_ocean_prime` | `planet_temperate_prime`).
   * Throws 404 `MatchTicketNotFoundException` if unknown.
   */
  async getPlanetSummary(idOrType: string): Promise<PlanetSummaryV1> {
    const type = await this.resolveExistingPlanetTypeOrThrow(idOrType);
    return this.buildSummaryForCanonicalType(type);
  }

  /**
   * Alias for `getPlanetSummary(idOrType)`.
   */
  getPlanetById(idOrType: string): Promise<PlanetSummaryV1> {
    return this.getPlanetSummary(idOrType);
  }

  /**
   * Returns sector summaries and canonical world metadata for `GET /v1/planets/:id/sectors`.
   * Throws 404 `MatchTicketNotFoundException` if unknown planet ID.
   */
  async getPlanetSectors(idOrType: string): Promise<PlanetSectorsResponseV1> {
    const summary = await this.getPlanetSummary(idOrType);
    return {
      planetId: summary.id,
      type: summary.type,
      look: summary.look,
      lifecycle: summary.lifecycle,
      health: summary.health,
      admission: summary.admission,
      availability: summary.availability,
      atlasVersion: summary.atlasVersion,
      atlasHash: summary.atlasHash,
      configHash: summary.configHash,
      totalSectors: summary.totalSectors,
      landSectors: summary.landSectors,
      oceanSectors: summary.oceanSectors,
      nominalCapacity: summary.nominalCapacity,
      validatedCapacity: summary.validatedCapacity,
      reservedSeats: summary.reservedSeats,
      foundedSeats: summary.foundedSeats,
      freeSeats: summary.freeSeats,
      updatedAt: summary.updatedAt,
      sectors: summary.sectors,
    };
  }

  /**
   * Returns a single sector summary on a canonical planet (`GET /v1/planets/:id/sectors/:sectorId`).
   */
  async getSectorSummary(idOrType: string, sectorId: SectorId): Promise<SectorSummaryV1> {
    const summary = await this.getPlanetSummary(idOrType);
    const sector = summary.sectors.find((s) => s.sectorId === sectorId);
    if (!sector) {
      throw new MatchTicketNotFoundException(
        `Sector "${sectorId}" not found on planet "${summary.id}"`,
        { planetId: summary.id, sectorId },
      );
    }
    return SectorSummaryV1Schema.parse(sector);
  }

  /**
   * Returns public landing-page planet stats (`GET /v1/planets/stats`) validated against `PublicPlanetStatsV1Schema`.
   * Nullable live counts (`coloniesAlive`, `playersOnline`) are `null` when live telemetry is unavailable/stale,
   * never a false zero.
   */
  async getPublicStats(): Promise<PublicPlanetStatsV1> {
    const planets = await this.listPlanetSummaries();
    const providerStats = this.telemetryProvider?.getPublicStatsLiveCounts
      ? await this.telemetryProvider.getPublicStatsLiveCounts()
      : null;
    const effectiveOverride: PublicStatsLiveCountsInput | null =
      this.publicStatsOverride || providerStats
        ? {
            ...(providerStats ?? {}),
            ...(this.publicStatsOverride ?? {}),
          }
        : null;

    const stats = computePublicPlanetStatsV1(planets, effectiveOverride);
    return PublicPlanetStatsV1Schema.parse(stats);
  }

  private async resolveExistingPlanetTypeOrThrow(idOrType: string): Promise<PlanetType> {
    const resolved = resolveCanonicalPlanetType(idOrType);
    if (resolved) return resolved;
    const world = await this.persistence.getCanonicalWorldById(idOrType);
    if (world) return world.canonicalType;
    throw new MatchTicketNotFoundException(`Planet "${idOrType}" not found`, {
      planetId: idOrType,
    });
  }

  private async buildSummaryForCanonicalType(type: PlanetType): Promise<PlanetSummaryV1> {
    const def = CANONICAL_PLANETS[type];
    const world =
      (await this.persistence.getCanonicalWorldByType(type)) ??
      (await this.persistence.getCanonicalWorldById(def.id));
    const planetId = world?.id ?? def.id;

    const [sectors, reservations, planetRecord, repoColonies] = await Promise.all([
      this.persistence.listSectors(planetId),
      this.persistence.listReservations(planetId),
      this.homeRepo ? this.homeRepo.findPlanetById(planetId) : Promise.resolve(null),
      this.homeRepo ? this.homeRepo.listColoniesByPlanetId(planetId) : Promise.resolve([]),
    ]);

    const providerLive = this.telemetryProvider?.getPlanetLiveCounts
      ? await this.telemetryProvider.getPlanetLiveCounts(planetId, type)
      : null;
    const directLive = this.planetLiveCounts.get(type) ?? null;
    const mergedPlanetLive: PlanetLiveCountsInput | null =
      providerLive || directLive
        ? {
            ...(providerLive ?? {}),
            ...(directLive ?? {}),
            sectors: {
              ...(providerLive?.sectors ?? {}),
              ...(directLive?.sectors ?? {}),
            },
          }
        : null;

    const perSectorLive = new Map<string, SectorLiveCountsInput>();
    for (const [key, val] of this.sectorLiveCounts.entries()) {
      if (key.startsWith(`${type}:`)) {
        perSectorLive.set(key.slice(type.length + 1), val);
      }
    }

    const raw = buildCanonicalPlanetSummaryV1({
      world,
      sectors,
      fallbackPlanetId: planetId,
      fallbackType: type,
      planetRecord,
      reservations,
      repoColonies,
      planetLiveCounts: mergedPlanetLive,
      sectorLiveCounts: perSectorLive,
    });

    return PlanetSummaryV1Schema.parse(raw);
  }
}
