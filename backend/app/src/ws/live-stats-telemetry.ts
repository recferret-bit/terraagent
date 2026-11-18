import { Inject, Injectable, Optional } from '@nestjs/common';
import { isCanonicalPlanetId, type PlanetType, type PublicColonySummaryV1 } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { HomeRepository } from '../core/home/home.repository';
import { databaseEnabled } from '../core/persistence';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { PRISMA } from '../db/db.module';
import { GamePlanets } from '../game/game-planets.service';
import {
  resolveCanonicalPlanetType,
  type PlanetLiveCountsInput,
  type PlanetLiveTelemetryProvider,
  type PublicStatsLiveCountsInput,
} from '../lobby/planets.helpers';
import { collectLoadedPlanetTelemetry } from './parts/loaded-planet-counts';
import { WsGateway } from './ws.gateway';

const SNAPSHOT_TTL_MS = 5_000;
const ARCHIVED_PLANET_STATUSES = ['ENDED', 'PLANET_ENDED', 'ARCHIVED'];
const LIVING_COLONY_STATUSES = ['ACTIVE', 'ALIVE', 'FOUNDING'];

interface CachedTelemetrySnapshot {
  readonly at: number;
  readonly coloniesByType: Record<PlanetType, number>;
  readonly playerColoniesByType: Record<PlanetType, number>;
  readonly botColoniesByType: Record<PlanetType, number>;
  readonly liveColoniesByType: Record<PlanetType, PublicColonySummaryV1[]>;
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

function emptySets(): Record<PlanetType, Set<string>> {
  return { desert: new Set(), ocean: new Set(), temperate: new Set() };
}

/**
 * Bridges real DB colony state (canonical + active loaded worlds), loaded `GamePlanets` Rival AIs,
 * active `TradeApiKey` bot keys, and live WebSocket connections into `PlanetsService`.
 */
@Injectable()
export class LiveStatsTelemetry implements PlanetLiveTelemetryProvider {
  private cache: CachedTelemetrySnapshot | null = null;
  private inflight: Promise<CachedTelemetrySnapshot> | null = null;

  constructor(
    private readonly gateway: WsGateway,
    @Optional() @Inject(PRISMA) private readonly prisma: PrismaClient | undefined,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Optional() @Inject(GamePlanets) private readonly gamePlanets?: GamePlanets,
    @Optional() @Inject(HomeRepository) private readonly homeRepo?: HomeRepository,
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
    const liveColonies = snap.liveColoniesByType[type];
    return {
      livingColonies,
      presentColonies: livingColonies,
      onlinePlayers,
      playerColonies: snap.playerColoniesByType[type],
      botColonies: snap.botColoniesByType[type],
      ...(liveColonies.length > 0 ? { liveColonies } : {}),
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
    const seenByType = emptySets();
    const humanByType = emptySets();
    const botByType = emptySets();
    const planetTypes = new Map<string, PlanetType>();
    const archivedIds = new Set<string>();

    if (this.prisma && databaseEnabled(this.env)) {
      await this.collectDbCounts(seenByType, humanByType, botByType, planetTypes, archivedIds);
    }

    const loaded = await collectLoadedPlanetTelemetry({
      gamePlanets: this.gamePlanets,
      homeRepo: this.homeRepo,
      archivedIds,
      knownTypes: planetTypes,
      inferType: inferPlanetTypeFromIdOrDb,
    });

    for (const [pid, t] of loaded.planetTypes) planetTypes.set(pid, t);
    for (const t of ['desert', 'ocean', 'temperate'] as const) {
      for (const k of loaded.humanKeysByType[t]) {
        humanByType[t].add(k);
        seenByType[t].add(k);
      }
      for (const k of loaded.aiBotKeysByType[t]) {
        botByType[t].add(k);
        seenByType[t].add(k);
      }
    }

    const coloniesByType: Record<PlanetType, number> = {
      desert: seenByType.desert.size,
      ocean: seenByType.ocean.size,
      temperate: seenByType.temperate.size,
    };
    return {
      at: now,
      coloniesByType,
      playerColoniesByType: {
        desert: humanByType.desert.size,
        ocean: humanByType.ocean.size,
        temperate: humanByType.temperate.size,
      },
      botColoniesByType: {
        desert: botByType.desert.size,
        ocean: botByType.ocean.size,
        temperate: botByType.temperate.size,
      },
      liveColoniesByType: loaded.liveColoniesByType,
      planetTypes,
      totalColonies: coloniesByType.desert + coloniesByType.ocean + coloniesByType.temperate,
    };
  }

  private async collectDbCounts(
    seenByType: Record<PlanetType, Set<string>>,
    humanByType: Record<PlanetType, Set<string>>,
    botByType: Record<PlanetType, Set<string>>,
    planetTypes: Map<string, PlanetType>,
    archivedIds: Set<string>,
  ): Promise<void> {
    const prisma = this.prisma!;
    const [allPlanets, colonies, reservations, stalls, botKeys] = await Promise.all([
      prisma.planet.findMany({ select: { id: true, type: true, state: true, lifecycle: true } }),
      prisma.colony.findMany({
        where: { status: { in: LIVING_COLONY_STATUSES } },
        select: { id: true, planetId: true, playerId: true },
      }),
      prisma.sectorReservation.findMany({
        where: { state: 'COMMITTED' },
        select: { colonyId: true, planetId: true, playerId: true },
      }),
      prisma.marketStall.findMany({ select: { colonyId: true, planetId: true } }),
      prisma.tradeApiKey?.findMany
        ? prisma.tradeApiKey.findMany({
            where: { revokedAt: null },
            select: { keyId: true, planetId: true },
          })
        : Promise.resolve([]),
    ]);

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
      const key = `${c.planetId}:${c.id}`;
      seenByType[t].add(key);
      const pid = (c as { playerId?: string }).playerId ?? '';
      if (pid.startsWith('ai:')) botByType[t].add(key);
      else humanByType[t].add(key);
    }
    for (const r of reservations) {
      if (archivedIds.has(r.planetId)) continue;
      const t = inferPlanetTypeFromIdOrDb(r.planetId, planetTypes.get(r.planetId));
      const key = `${r.planetId}:${r.colonyId}`;
      seenByType[t].add(key);
      const pid = (r as { playerId?: string }).playerId ?? '';
      if (pid.startsWith('ai:')) botByType[t].add(key);
      else humanByType[t].add(key);
    }
    for (const s of stalls) {
      if (archivedIds.has(s.planetId) || !isCanonicalPlanetId(s.planetId)) continue;
      const t = inferPlanetTypeFromIdOrDb(s.planetId, planetTypes.get(s.planetId));
      const key = `${s.planetId}:${s.colonyId}`;
      seenByType[t].add(key);
      if (s.colonyId.startsWith('bot-')) botByType[t].add(key);
    }
    for (const bk of botKeys) {
      if (archivedIds.has(bk.planetId)) continue;
      const t = inferPlanetTypeFromIdOrDb(bk.planetId, planetTypes.get(bk.planetId));
      botByType[t].add(`key:${bk.planetId}:${bk.keyId}`);
    }
  }
}
