import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CANONICAL_PLANETS,
  type HomeResponse,
  type PlanetType,
  type SectorId,
} from '@terra/contracts';
import type { PlanetState, SimEvent } from '@terra/sim';
import { Counter } from 'prom-client';
import type { LobbyPersistenceService } from '../../lobby/lobby-persistence.service';
import { HomeRepository, type ColonyRecord, type PlanetRecord } from '../home/home.repository';
import { MetricsRegistry } from '../metrics.registry';
import {
  inferAuthoritativeBaseSector,
  isValidSectorIdFormat,
  normalizeColonyStatus,
} from './anticheat.hash';
import type {
  AntiCheatCategory,
  AntiCheatTransport,
  ColonyBaseBinding,
  InputValidationVerdict,
  JoinRejectReason,
  JoinSectorVerdict,
  SectorSpaceEntry,
  ValidateCommandInputContext,
} from './anticheat.types';
import { validateInputAgainstPlanetAndSector } from './parts/command-input-checks';
import { SectorHashIndex } from './sector-hash-index';

export const ANTICHEAT_REJECTED_METRIC = 'ta_anticheat_rejected_total';

export interface VerifySectorJoinInput {
  readonly transport: AntiCheatTransport;
  readonly playerId: string;
  readonly targetPlanetId?: string;
  readonly targetPlanetType?: PlanetType;
  readonly requestedSectorId?: string;
  readonly requestedColonyId?: string;
  readonly dev?: boolean;
  readonly isScenarioPlanet?: boolean;
  readonly resolvedHome?: HomeResponse;
  readonly allowNewJoin?: boolean;
}

@Injectable()
export class SectorAntiCheatService {
  readonly index = new SectorHashIndex();
  private lobbyPersistence?: LobbyPersistenceService;
  private rejectedCounter?: Counter<'transport' | 'category' | 'reason'>;

  constructor(
    @Optional() @Inject(HomeRepository) private readonly homeRepo?: HomeRepository,
    @Optional() @Inject(MetricsRegistry) metrics?: MetricsRegistry,
  ) {
    if (metrics) {
      const existing = metrics.registry.getSingleMetric(ANTICHEAT_REJECTED_METRIC) as
        | Counter<'transport' | 'category' | 'reason'>
        | undefined;
      this.rejectedCounter =
        existing ??
        new Counter({
          name: ANTICHEAT_REJECTED_METRIC,
          help: 'Total HTTP and WebSocket inputs/joins blocked by real-time planet/sector anti-cheat',
          labelNames: ['transport', 'category', 'reason'],
          registers: [metrics.registry],
        });
    }
  }

  setLobbyPersistence(persistence?: LobbyPersistenceService): void {
    if (persistence) this.lobbyPersistence = persistence;
  }

  recordRejection(transport: AntiCheatTransport, category: AntiCheatCategory, reason: string): void {
    this.rejectedCounter?.inc({ transport, category, reason });
  }

  recordColonyBase(
    colony: ColonyRecord,
    planet?: PlanetRecord | null,
    authoritativeStatus = false,
  ): ColonyBaseBinding {
    if (planet) {
      this.index.upsertPlanetMeta({
        planetId: planet.id,
        planetRadius: planet.radius,
        capacity: planet.capacity,
        status: planet.status === 'ENDED' || planet.status === 'PLANET_ENDED' ? 'ENDED' : 'ACTIVE',
      });
    }
    return this.index.upsertColonyBase({
      playerId: colony.playerId,
      colonyId: colony.id,
      planetId: colony.planetId,
      colonyIndex: colony.colonyIndex,
      name: colony.name,
      foundingSectorId: colony.foundingSectorId,
      spawnQ: colony.spawnQ,
      spawnR: colony.spawnR,
      status: colony.status,
      authoritativeStatus,
      isRivalAi: colony.playerId.startsWith('ai:'),
    });
  }

  recordColonyStatus(colonyId: string, status: string): void {
    this.index.markColonyStatus(colonyId, status);
  }

  recordColonyRemoved(colonyId: string): void {
    this.index.removeColony(colonyId);
  }

  recordPlanetStatus(planetId: string, status: string): void {
    const norm =
      status === 'ENDED' || status === 'PLANET_ENDED'
        ? 'ENDED'
        : status === 'ARCHIVED'
          ? 'ARCHIVED'
          : status === 'PAUSED'
            ? 'PAUSED'
            : 'ACTIVE';
    this.index.upsertPlanetMeta({ planetId, status: norm });
  }

  syncSectorSpace(input: {
    readonly planetId: string;
    readonly sectorId: SectorId;
    readonly kind: 'land' | 'ocean';
    readonly capacity: number;
    readonly reservedSeats?: number;
    readonly foundedSeats?: number;
    readonly freeSeats?: number;
  }): SectorSpaceEntry {
    return this.index.upsertSectorSpace(input);
  }

  syncFromPlanetState(planetId: string, state: PlanetState): void {
    this.index.syncFromPlanetState(planetId, state);
  }

  syncFromSnapshotBytes(planetId: string, bytes: Uint8Array): void {
    this.index.syncFromSnapshotBytes(planetId, bytes);
  }

  applyPlanetDelta(planetId: string, diff: Uint8Array, events: readonly SimEvent[]): void {
    this.index.applyDelta(planetId, diff, events);
  }

  applyPlanetEvents(planetId: string, events: readonly SimEvent[]): void {
    this.index.applyEvents(planetId, events);
  }

  removePlanet(planetId: string): void {
    this.index.removePlanet(planetId);
  }

  /**
   * Refreshes sector capacity entries in the O(1) hash index for `planetId` from `LobbyPersistenceService`
   * when wired, returning the sector entries on that planet.
   */
  async hydratePlanetSectors(planetId: string): Promise<SectorSpaceEntry[]> {
    if (this.lobbyPersistence) {
      const [world, sectors, reservations] = await Promise.all([
        this.lobbyPersistence.getCanonicalWorldById(planetId),
        this.lobbyPersistence.listSectors(planetId),
        this.lobbyPersistence.listReservations(planetId),
      ]);
      if (world) {
        this.index.upsertPlanetMeta({
          planetId,
          capacity: world.capacity,
          status:
            world.lifecycle === 'ARCHIVED'
              ? 'ARCHIVED'
              : world.admission === 'PAUSED'
                ? 'PAUSED'
                : 'ACTIVE',
        });
      }
      for (const sec of sectors) {
        const cap = Math.min(sec.foundingCapacity, sec.validatedCapacity);
        const held = reservations.filter((r) => r.sectorId === sec.sectorId && r.state === 'HELD').length;
        const comm = reservations.filter((r) => r.sectorId === sec.sectorId && r.state === 'COMMITTED').length;
        const founded = Math.max(sec.foundedSeats, comm);
        const reserved = Math.max(sec.reservedSeats, held);
        const free = sec.kind === 'ocean' ? 0 : Math.min(sec.freeSeats, Math.max(0, cap - founded - reserved));
        this.index.upsertSectorSpace({
          planetId,
          sectorId: sec.sectorId,
          kind: sec.kind,
          capacity: cap,
          reservedSeats: reserved,
          foundedSeats: founded,
          freeSeats: free,
        });
      }
    }
    return this.index.listPlanetSectors(planetId);
  }

  /**
   * Resolves the player's authoritative active base binding (O(1) hash hit first, hydrating from repo/lobby on miss).
   */
  async resolveAuthoritativeActiveBase(
    playerId: string,
    resolvedHome?: HomeResponse,
  ): Promise<ColonyBaseBinding | null> {
    if (resolvedHome?.state === 'ACTIVE') {
      const col = resolvedHome.colony;
      if (normalizeColonyStatus(col.status ?? col.state ?? 'ACTIVE') !== 'ACTIVE') {
        return null;
      }
      const existing = this.index.getColonyById(col.id);
      if (existing && existing.status !== 'ACTIVE') {
        return null;
      }
      const pl = resolvedHome.planet;
      const planetState = this.index.getPlanet(pl.id);
      const baseSectorId = inferAuthoritativeBaseSector({
        foundingSectorId: col.foundingSectorId,
        spawnQ: col.spawnQ,
        spawnR: col.spawnR,
        sectorRadius: planetState?.sectorRadius,
        hasMultiSectorGrid: planetState?.hasMultiSectorGrid,
      });
      const updated = this.index.upsertColonyBase({
        playerId,
        colonyId: col.id,
        planetId: col.planetId,
        colonyIndex: col.colonyIndex ?? 0,
        foundingSectorId: baseSectorId,
        spawnQ: col.spawnQ,
        spawnR: col.spawnR,
        status: 'ACTIVE',
      });
      return updated.status === 'ACTIVE' ? updated : null;
    }

    const cached = this.index.getActiveBaseByPlayer(playerId);
    if (cached) return cached;

    if (this.homeRepo) {
      const latest = await this.homeRepo.findLatestColonyByPlayerId(playerId);
      if (latest && latest.status === 'ACTIVE') {
        const known = this.index.getColonyById(latest.id);
        if (known?.terminalFromLive && known.status !== 'ACTIVE') return null;
        const planet = await this.homeRepo.findPlanetById(latest.planetId);
        if (!planet || (planet.status !== 'ENDED' && planet.status !== 'PLANET_ENDED')) {
          const rec = this.recordColonyBase(latest, planet, false);
          return rec.status === 'ACTIVE' ? rec : null;
        }
      }
    }
    return null;
  }

  /**
   * Unified real-time join check for BOTH HTTP and WebSockets:
   * 1. Rejects malformed `sectorId`.
   * 2. Rejects joining any planet, colony, or sector different from the user's active base.
   * 3. Rejects joining an ocean sector, unknown sector, or a sector with 0 free space when not returning to own base.
   */
  async verifyJoin(input: VerifySectorJoinInput): Promise<JoinSectorVerdict> {
    const trimmedSector = input.requestedSectorId?.trim() || undefined;
    if (trimmedSector && !isValidSectorIdFormat(trimmedSector)) {
      return this.failJoin(input.transport, 'invalid_sector', 400, 'INVALID_SECTOR', `Sector "${trimmedSector}" has invalid format`);
    }

    const activeBase = await this.resolveAuthoritativeActiveBase(input.playerId, input.resolvedHome);
    if (activeBase && !(input.isScenarioPlanet && input.dev)) {
      if (input.targetPlanetId && input.targetPlanetId !== activeBase.planetId) {
        return this.failJoin(
          input.transport,
          'not_your_planet',
          409,
          'COLONY_PLANET_LOCKED',
          `Active colony is located on planet ${activeBase.planetId}`,
          activeBase.planetId,
          activeBase.baseSectorId,
        );
      }
      if (input.requestedColonyId && input.requestedColonyId !== activeBase.colonyId) {
        return this.failJoin(
          input.transport,
          'not_your_colony',
          403,
          'NOT_YOUR_COLONY',
          'Requested colonyId does not match caller active colony',
          activeBase.planetId,
          activeBase.baseSectorId,
        );
      }
      if (trimmedSector && trimmedSector !== activeBase.baseSectorId) {
        return this.failJoin(
          input.transport,
          'not_your_sector',
          409,
          'COLONY_SECTOR_LOCKED',
          `Active base is located in sector ${activeBase.baseSectorId}; cannot join ${trimmedSector}`,
          activeBase.planetId,
          activeBase.baseSectorId,
        );
      }
      return {
        ok: true,
        planetId: activeBase.planetId,
        sectorId: activeBase.baseSectorId,
        colonyId: activeBase.colonyId,
        colonyIndex: activeBase.colonyIndex,
        bindingHash: activeBase.bindingHash,
      };
    }

    const planetId =
      input.targetPlanetId ??
      (input.targetPlanetType && this.lobbyPersistence ? CANONICAL_PLANETS[input.targetPlanetType]?.id : undefined);

    if (planetId) {
      const isDevSpectator = Boolean(input.dev && !trimmedSector && input.transport === 'ws');
      if (!isDevSpectator) {
        const spaceErr = await this.checkNewJoinSectorSpace(
          input.transport,
          planetId,
          trimmedSector,
          Boolean(input.targetPlanetId),
        );
        if (spaceErr) return spaceErr;
      }
    }

    if (!input.allowNewJoin && !input.dev) {
      const latest = this.index.getLatestBindingByPlayer(input.playerId);
      if (latest && latest.planetId === planetId && latest.status !== 'ACTIVE') {
        return this.failJoin(
          input.transport,
          'colony_inactive',
          409,
          'COLONY_INACTIVE',
          'Colony on target planet is no longer active',
          planetId,
          latest.baseSectorId,
        );
      }
      return this.failJoin(input.transport, 'not_your_planet', 403, 'NOT_YOUR_PLANET', 'No active colony on target planet');
    }

    return {
      ok: true,
      planetId: planetId ?? 'pl_dev',
      sectorId: (trimmedSector as SectorId | undefined) ?? 'sec_0_0',
      colonyId: null,
    };
  }

  private async checkNewJoinSectorSpace(
    transport: AntiCheatTransport,
    planetId: string,
    requestedSectorId: string | undefined,
    explicitPlanetTarget: boolean,
  ): Promise<JoinSectorVerdict | null> {
    const sectors = await this.hydratePlanetSectors(planetId);
    if (requestedSectorId) {
      const sec = this.index.getSectorSpace(planetId, requestedSectorId);
      if (sec) {
        if (sec.kind === 'ocean') {
          return this.failJoin(transport, 'sector_not_land', 400, 'INVALID_SECTOR', `Sector ${requestedSectorId} is an ocean sector`);
        }
        if (sec.freeSeats <= 0) {
          return this.failJoin(transport, 'sector_full', 409, 'SECTOR_FULL', `Sector ${requestedSectorId} on ${planetId} has no free space`);
        }
        return null;
      }
      if (sectors.length > 0) {
        return this.failJoin(transport, 'invalid_sector', 400, 'INVALID_SECTOR', `Sector ${requestedSectorId} does not exist on ${planetId}`);
      }
    } else if (sectors.length > 0) {
      const landWithSpace = sectors.some((s) => s.kind === 'land' && s.freeSeats > 0);
      if (!landWithSpace) {
        return this.failJoin(transport, 'sector_full', 409, 'SECTOR_FULL', `Planet ${planetId} has no sectors with free space`);
      }
      return null;
    }

    if (explicitPlanetTarget && this.homeRepo) {
      const repoPlanet = await this.homeRepo.findPlanetById(planetId);
      if (repoPlanet) {
        const cap = repoPlanet.capacity;
        const taken = Math.max(repoPlanet.seatsTaken ?? 0, this.index.countActiveColoniesOnPlanet(planetId));
        const planetMeta = this.index.getPlanet(planetId);
        const isMulti = Boolean(planetMeta?.hasMultiSectorGrid) || sectors.length > 1;
        if (!isMulti && requestedSectorId && requestedSectorId !== 'sec_0_0') {
          return this.failJoin(transport, 'invalid_sector', 400, 'INVALID_SECTOR', `Sector ${requestedSectorId} does not exist on ${planetId}`);
        }
        if (cap > 0 && taken >= cap) {
          return this.failJoin(transport, 'sector_full', 409, 'SECTOR_FULL', `Sector ${requestedSectorId ?? 'sec_0_0'} on ${planetId} has no free space`);
        }
      }
    }

    const planetMeta = this.index.getPlanet(planetId);
    if (explicitPlanetTarget && planetMeta) {
      if (!planetMeta.hasMultiSectorGrid && sectors.length <= 1 && requestedSectorId && requestedSectorId !== 'sec_0_0') {
        return this.failJoin(transport, 'invalid_sector', 400, 'INVALID_SECTOR', `Sector ${requestedSectorId} does not exist on ${planetId}`);
      }
      if (planetMeta.capacity > 0 && this.index.countActiveColoniesOnPlanet(planetId) >= planetMeta.capacity) {
        return this.failJoin(transport, 'sector_full', 409, 'SECTOR_FULL', `Sector ${requestedSectorId ?? 'sec_0_0'} on ${planetId} has no free space`);
      }
    }
    return null;
  }

  /**
   * Synchronous O(1) hash-based validation of any gameplay/action command input against planet & sector.
   */
  validateCommand(ctx: ValidateCommandInputContext): InputValidationVerdict {
    const verdict = validateInputAgainstPlanetAndSector(this.index, ctx);
    if (!verdict.ok) {
      this.recordRejection(ctx.transport, verdict.category, verdict.rejectCode);
    }
    return verdict;
  }

  private failJoin(
    transport: AntiCheatTransport,
    reason: JoinRejectReason,
    httpStatus: number,
    errorCode: string,
    detail: string,
    expectedPlanetId?: string,
    expectedSectorId?: SectorId,
  ): JoinSectorVerdict {
    this.recordRejection(transport, 'join', reason);
    return {
      ok: false,
      reason,
      httpStatus,
      errorCode,
      detail,
      ...(expectedPlanetId ? { expectedPlanetId } : {}),
      ...(expectedSectorId ? { expectedSectorId } : {}),
    };
  }
}
