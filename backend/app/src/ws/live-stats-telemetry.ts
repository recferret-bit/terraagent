import { Inject, Injectable, Optional } from '@nestjs/common';
import { isCanonicalPlanetId, type PlanetType } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../core/persistence';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { PRISMA } from '../db/db.module';
import {
  resolveCanonicalPlanetType,
  type PlanetLiveCountsInput,
  type PlanetLiveTelemetryProvider,
  type PublicStatsLiveCountsInput,
} from '../lobby/planets.helpers';
import { WsGateway } from './ws.gateway';

const SNAPSHOT_TTL_MS = 5_000;
const ARCHIVED_PLANET_STATUSES = ['ENDED', 'PLANET_ENDED', 'ARCHIVED'];
const LIVING_COLONY_STATUSES = ['ACTIVE', 'ALIVE', 'FOUNDING'];

interface CachedTelemetrySnapshot {
  readonly at: number;
  readonly coloniesByType: Record<PlanetType, number>;
  readonly planetTypes: ReadonlyMap<string, PlanetType>;
  readonly totalColonies: number;
}

export function inferPlanetTypeFromIdOrDb(planetId: string, dbType?: string | null): PlanetType {
  const canonical = resolveCanonicalPlanetType(planetId);
  if (canonical) return canonical;
  if (dbType === 'desert' || dbType === 'ocean' || dbType === 'temperate') return dbType;
  const lower = planetId.toLowerCase();
  if (lower.includes('ocean')) return 'ocean';
  if (lower.includes('temperate') || lower.includes('forest')) return 'temperate';
  return 'desert';
}

/**
 * Bridges real DB colony state (canonical + active loaded worlds) and live WebSocket connections
 * into `PlanetsService` so `GET /v1/planets` and `GET /v1/planets/stats` never report stale `null` dashes.
 */
@Injectable()
export class LiveStatsTelemetry implements PlanetLiveTelemetryProvider {
  private cache: CachedTelemetrySnapshot | null = null;
  private inflight: Promise<CachedTelemetrySnapshot> | null = null;

  constructor(
    private readonly gateway: WsGateway,
    @Optional() @Inject(PRISMA) private readonly prisma: PrismaClient | undefined,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  async getPlanetLiveCounts(_planetId: string, type: PlanetType): Promise<PlanetLiveCountsInput> {
    const snap = await this.snapshot();
    const livingColonies = snap.coloniesByType[type];
    let onlinePlayers = 0;
    for (const [roomPlanetId, count] of this.gateway.onlinePlayersByPlanet()) {
      if (inferPlanetTypeFromIdOrDb(roomPlanetId, snap.planetTypes.get(roomPlanetId)) === type) {
        onlinePlayers += count;
      }
    }
    return {
      livingColonies,
      presentColonies: livingColonies,
      onlinePlayers,
    };
  }

  async getPublicStatsLiveCounts(): Promise<PublicStatsLiveCountsInput> {
    const snap = await this.snapshot();
    return {
      coloniesAlive: snap.totalColonies,
      playersOnline: this.gateway.onlinePlayerCount(),
    };
  }

  private async snapshot(): Promise<CachedTelemetrySnapshot> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < SNAPSHOT_TTL_MS) return this.cache;
    if (!this.inflight) {
      this.inflight = this.computeSnapshot(now).finally(() => {
        this.inflight = null;
      });
    }
    const next = await this.inflight;
    this.cache = next;
    return next;
  }

  private async computeSnapshot(now: number): Promise<CachedTelemetrySnapshot> {
    const seenByType: Record<PlanetType, Set<string>> = {
      desert: new Set(),
      ocean: new Set(),
      temperate: new Set(),
    };
    const planetTypes = new Map<string, PlanetType>();

    if (!this.prisma || !databaseEnabled(this.env)) {
      return {
        at: now,
        coloniesByType: { desert: 0, ocean: 0, temperate: 0 },
        planetTypes,
        totalColonies: 0,
      };
    }

    const [allPlanets, colonies, reservations, stalls] = await Promise.all([
      this.prisma.planet.findMany({ select: { id: true, type: true, state: true, lifecycle: true } }),
      this.prisma.colony.findMany({
        where: { status: { in: LIVING_COLONY_STATUSES } },
        select: { id: true, planetId: true },
      }),
      this.prisma.sectorReservation.findMany({
        where: { state: 'COMMITTED' },
        select: { colonyId: true, planetId: true },
      }),
      this.prisma.marketStall.findMany({ select: { colonyId: true, planetId: true } }),
    ]);

    const archivedIds = new Set<string>();
    for (const p of allPlanets) {
      if (ARCHIVED_PLANET_STATUSES.includes(p.state) || p.lifecycle === 'ARCHIVED') {
        archivedIds.add(p.id);
      } else {
        planetTypes.set(p.id, inferPlanetTypeFromIdOrDb(p.id, p.type));
      }
    }

    for (const c of colonies) {
      if (archivedIds.has(c.planetId)) continue;
      const t = inferPlanetTypeFromIdOrDb(c.planetId, planetTypes.get(c.planetId));
      seenByType[t].add(`${c.planetId}:${c.id}`);
    }
    for (const r of reservations) {
      if (archivedIds.has(r.planetId)) continue;
      const t = inferPlanetTypeFromIdOrDb(r.planetId, planetTypes.get(r.planetId));
      seenByType[t].add(`${r.planetId}:${r.colonyId}`);
    }
    for (const s of stalls) {
      if (archivedIds.has(s.planetId) || !isCanonicalPlanetId(s.planetId)) continue;
      const t = inferPlanetTypeFromIdOrDb(s.planetId, planetTypes.get(s.planetId));
      seenByType[t].add(`${s.planetId}:${s.colonyId}`);
    }

    const coloniesByType: Record<PlanetType, number> = {
      desert: seenByType.desert.size,
      ocean: seenByType.ocean.size,
      temperate: seenByType.temperate.size,
    };
    return {
      at: now,
      coloniesByType,
      planetTypes,
      totalColonies: coloniesByType.desert + coloniesByType.ocean + coloniesByType.temperate,
    };
  }
}
