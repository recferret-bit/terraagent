import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SECTOR_ID_REGEX,
  W11_SEVEN_SECTOR_COORDS,
  formatSectorId,
  isCanonicalPlanetId,
  type PlanetType,
  type PublicColonySummaryV1,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { SectorAntiCheatService } from '../core/anticheat';
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

function emptyColonyLists(): Record<PlanetType, PublicColonySummaryV1[]> {
  return { desert: [], ocean: [], temperate: [] };
}

function sanitizeDbColonyId(rawId: string, fallbackPrefix: string, index: number): string {
  if (/^(co|col)_[A-Za-z0-9_-]{1,64}$/.test(rawId)) return rawId;
  const safe = rawId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
  return `${fallbackPrefix}${safe || index}`;
}

function pickDbSectorId(raw: string | undefined, index: number): string {
  if (raw && SECTOR_ID_REGEX.test(raw)) return raw;
  const [mq, mr] = W11_SEVEN_SECTOR_COORDS[Math.abs(index) % W11_SEVEN_SECTOR_COORDS.length]!;
  return formatSectorId(mq, mr);
}

function mergeColonySummaries(
  primary: readonly PublicColonySummaryV1[],
  secondary: readonly PublicColonySummaryV1[],
): PublicColonySummaryV1[] {
  const out: PublicColonySummaryV1[] = [];
  const seenIds = new Set<string>();
  for (const item of [...primary, ...secondary]) {
    if (seenIds.has(item.colonyId)) continue;
    seenIds.add(item.colonyId);
    out.push(item);
  }
  return out;
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
    @Optional() @Inject(SectorAntiCheatService) private readonly antiCheat?: SectorAntiCheatService,
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
    const dbColoniesByType = emptyColonyLists();
    const planetTypes = new Map<string, PlanetType>();
    const archivedIds = new Set<string>();

    if (this.prisma && databaseEnabled(this.env)) {
      await this.collectDbCounts(seenByType, humanByType, botByType, dbColoniesByType, planetTypes, archivedIds);
    }

    const loaded = await collectLoadedPlanetTelemetry({
      gamePlanets: this.gamePlanets,
      homeRepo: this.homeRepo,
      index: this.antiCheat?.index,
      archivedIds,
      knownTypes: planetTypes,
      inferType: inferPlanetTypeFromIdOrDb,
    });

    for (const [pid, t] of loaded.planetTypes) planetTypes.set(pid, t);
    const liveColoniesByType = emptyColonyLists();
    for (const t of ['desert', 'ocean', 'temperate'] as const) {
      for (const k of loaded.humanKeysByType[t]) {
        humanByType[t].add(k);
        seenByType[t].add(k);
      }
      for (const k of loaded.aiBotKeysByType[t]) {
        botByType[t].add(k);
        seenByType[t].add(k);
      }
      liveColoniesByType[t] = mergeColonySummaries(loaded.liveColoniesByType[t], dbColoniesByType[t]);
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
      liveColoniesByType,
      planetTypes,
      totalColonies: coloniesByType.desert + coloniesByType.ocean + coloniesByType.temperate,
    };
  }

  private async collectDbCounts(
    seenByType: Record<PlanetType, Set<string>>,
    humanByType: Record<PlanetType, Set<string>>,
    botByType: Record<PlanetType, Set<string>>,
    dbColoniesByType: Record<PlanetType, PublicColonySummaryV1[]>,
    planetTypes: Map<string, PlanetType>,
    archivedIds: Set<string>,
  ): Promise<void> {
    const prisma = this.prisma!;
    const [allPlanets, colonies, reservations, stalls, botKeys] = await Promise.all([
      prisma.planet.findMany({ select: { id: true, type: true, state: true, lifecycle: true } }),
      prisma.colony.findMany({
        where: { status: { in: LIVING_COLONY_STATUSES } },
        select: { id: true, planetId: true, playerId: true, name: true, foundingSectorId: true, colonyIndex: true, createdAt: true },
      }),
      prisma.sectorReservation.findMany({
        where: { state: 'COMMITTED' },
        select: { colonyId: true, planetId: true, playerId: true, sectorId: true, slotIndex: true, createdAt: true },
      }),
      prisma.marketStall.findMany({ select: { colonyId: true, planetId: true, colonyIndex: true, name: true } }),
      prisma.tradeApiKey?.findMany
        ? prisma.tradeApiKey.findMany({
            where: { revokedAt: null },
            select: { keyId: true, label: true, colonyId: true, colonyIndex: true, planetId: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);

    for (const p of allPlanets) {
      if (ARCHIVED_PLANET_STATUSES.includes(p.state) || p.lifecycle === 'ARCHIVED') archivedIds.add(p.id);
      else planetTypes.set(p.id, inferPlanetTypeFromIdOrDb(p.id, p.type));
    }
    const ctx: DbIngestCtx = { seenByType, humanByType, botByType, dbColoniesByType, planetTypes, archivedIds, nowIso: new Date().toISOString() };
    ingestDbColonies(ctx, colonies);
    ingestDbReservations(ctx, reservations);
    ingestDbStallsAndKeys(ctx, stalls, botKeys);
  }
}

interface DbIngestCtx {
  seenByType: Record<PlanetType, Set<string>>;
  humanByType: Record<PlanetType, Set<string>>;
  botByType: Record<PlanetType, Set<string>>;
  dbColoniesByType: Record<PlanetType, PublicColonySummaryV1[]>;
  planetTypes: Map<string, PlanetType>;
  archivedIds: Set<string>;
  nowIso: string;
}

function ingestDbColonies(
  ctx: DbIngestCtx,
  colonies: ReadonlyArray<{ id: string; planetId: string; playerId: string; name?: string; foundingSectorId?: string; colonyIndex?: number; createdAt?: Date }>,
): void {
  for (const c of colonies) {
    if (ctx.archivedIds.has(c.planetId)) continue;
    const t = inferPlanetTypeFromIdOrDb(c.planetId, ctx.planetTypes.get(c.planetId));
    const key = `${c.planetId}:${c.id}`;
    ctx.seenByType[t].add(key);
    const isBot = (c.playerId ?? '').startsWith('ai:');
    if (isBot) ctx.botByType[t].add(key);
    else ctx.humanByType[t].add(key);
    if (typeof c.name === 'string' && typeof c.foundingSectorId === 'string') {
      ctx.dbColoniesByType[t].push({
        colonyId: sanitizeDbColonyId(c.id, 'col_db_', c.colonyIndex ?? 0),
        displayName: c.name.slice(0, 64),
        foundingSectorId: pickDbSectorId(c.foundingSectorId, c.colonyIndex ?? 0),
        foundedAt: c.createdAt ? c.createdAt.toISOString() : ctx.nowIso,
        ...(isBot ? { isBot: true } : {}),
      });
    }
  }
}

function ingestDbReservations(
  ctx: DbIngestCtx,
  reservations: ReadonlyArray<{ colonyId: string; planetId: string; playerId: string; sectorId?: string; slotIndex?: number; createdAt?: Date }>,
): void {
  for (const r of reservations) {
    if (ctx.archivedIds.has(r.planetId)) continue;
    const t = inferPlanetTypeFromIdOrDb(r.planetId, ctx.planetTypes.get(r.planetId));
    const key = `${r.planetId}:${r.colonyId}`;
    ctx.seenByType[t].add(key);
    const isBot = (r.playerId ?? '').startsWith('ai:');
    if (isBot) ctx.botByType[t].add(key);
    else ctx.humanByType[t].add(key);
    if (typeof r.sectorId === 'string') {
      ctx.dbColoniesByType[t].push({
        colonyId: sanitizeDbColonyId(r.colonyId, 'col_res_', r.slotIndex ?? 0),
        displayName: isBot ? 'AI Outpost' : 'Landing Pod',
        foundingSectorId: pickDbSectorId(r.sectorId, r.slotIndex ?? 0),
        foundedAt: r.createdAt ? r.createdAt.toISOString() : ctx.nowIso,
        ...(isBot ? { isBot: true } : {}),
      });
    }
  }
}

function ingestDbStallsAndKeys(
  ctx: DbIngestCtx,
  stalls: ReadonlyArray<{ colonyId: string; planetId: string; colonyIndex?: number | null; name?: string | null }>,
  botKeys: ReadonlyArray<{ keyId: string; planetId: string; label?: string; colonyId?: string; colonyIndex?: number; createdAt?: Date }>,
): void {
  for (let i = 0; i < stalls.length; i++) {
    const s = stalls[i]!;
    if (ctx.archivedIds.has(s.planetId) || !isCanonicalPlanetId(s.planetId)) continue;
    const t = inferPlanetTypeFromIdOrDb(s.planetId, ctx.planetTypes.get(s.planetId));
    const key = `${s.planetId}:${s.colonyId}`;
    ctx.seenByType[t].add(key);
    const isBot = s.colonyId.startsWith('bot-');
    if (isBot) ctx.botByType[t].add(key);
    if (typeof s.name === 'string' && s.name.length > 0) {
      ctx.dbColoniesByType[t].push({
        colonyId: sanitizeDbColonyId(s.colonyId, 'col_stl_', i),
        displayName: s.name.slice(0, 64),
        foundingSectorId: pickDbSectorId(undefined, s.colonyIndex ?? i),
        foundedAt: ctx.nowIso,
        ...(isBot ? { isBot: true } : {}),
      });
    }
  }
  for (let i = 0; i < botKeys.length; i++) {
    const bk = botKeys[i]!;
    if (ctx.archivedIds.has(bk.planetId)) continue;
    const t = inferPlanetTypeFromIdOrDb(bk.planetId, ctx.planetTypes.get(bk.planetId));
    ctx.botByType[t].add(`key:${bk.planetId}:${bk.keyId}`);
    if (typeof bk.label === 'string' && bk.label.length > 0) {
      ctx.dbColoniesByType[t].push({
        colonyId: sanitizeDbColonyId(bk.colonyId || bk.keyId, 'col_bot_', bk.colonyIndex ?? i),
        displayName: bk.label.slice(0, 64),
        foundingSectorId: pickDbSectorId(undefined, bk.colonyIndex ?? i),
        foundedAt: bk.createdAt ? bk.createdAt.toISOString() : ctx.nowIso,
        isBot: true,
      });
    }
  }
}
