import { Inject, Injectable, Optional, type OnApplicationShutdown } from '@nestjs/common';
import type { PlanetSectorsLiveStateV1 } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { Logger } from 'pino';
import { layerLogger } from '../../core/logging/logger';
import { persistenceEnabled } from '../../core/persistence';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import { PRISMA } from '../../db/db.module';
import { GamePlanets } from '../game-planets.service';
import type { SectorSyncPayload } from './sector-extract';
import {
  buildCachedLivePlanetState,
  persistSectorSyncPayload,
  queryDbLivePlanetState,
} from './parts/sector-state-db';

const DEFAULT_FLUSH_DEBOUNCE_MS = 1200;

/**
 * Persists every loaded planet, its sectors (`core.planet_sector`), and every player & bot
 * inside each sector (`world.sector_participant_state`) so Postgres always mirrors live multi-actor state.
 */
@Injectable()
export class SectorStateService implements OnApplicationShutdown {
  private readonly log: Logger;
  readonly enabled: boolean;
  private readonly liveCache = new Map<string, { payload: SectorSyncPayload; updatedAt: Date }>();
  private readonly pendingPayloads = new Map<string, SectorSyncPayload>();
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private unsubSync: (() => void) | undefined;
  private unsubUnloaded: (() => void) | undefined;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    @Inject(LOGGER) root: Logger,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
    this.enabled = Boolean(prisma && persistenceEnabled(env));
    if (planets) {
      this.unsubSync = planets.onSectorSync((planetId, payload) => {
        this.onSync(planetId, payload);
      });
      this.unsubUnloaded = planets.onPlanetUnloaded((planetId) => {
        void this.flushPlanet(planetId);
        this.liveCache.delete(planetId);
      });
    }
  }

  onSync(planetId: string, payload: SectorSyncPayload, immediate = false): void {
    this.liveCache.set(planetId, { payload, updatedAt: new Date() });
    if (!this.enabled) return;
    this.pendingPayloads.set(planetId, payload);
    if (immediate) {
      this.clearTimer(planetId);
      void this.flushPlanet(planetId);
      return;
    }
    if (!this.flushTimers.has(planetId)) {
      const t = setTimeout(() => {
        this.flushTimers.delete(planetId);
        void this.flushPlanet(planetId);
      }, DEFAULT_FLUSH_DEBOUNCE_MS);
      t.unref?.();
      this.flushTimers.set(planetId, t);
    }
  }

  async flushPlanet(planetId: string): Promise<void> {
    this.clearTimer(planetId);
    const active = this.inFlight.get(planetId);
    if (active) await active;
    const payload = this.pendingPayloads.get(planetId);
    if (!payload || !this.enabled || !this.prisma) return;
    this.pendingPayloads.delete(planetId);
    const run = persistSectorSyncPayload(this.prisma, payload)
      .catch((e: unknown) => {
        this.log.warn({ planetId, err: e instanceof Error ? e.message : String(e) }, 'sector state flush failed');
      })
      .finally(() => {
        if (this.inFlight.get(planetId) === run) this.inFlight.delete(planetId);
      });
    this.inFlight.set(planetId, run);
    await run;
  }

  async flushAll(): Promise<void> {
    const ids = new Set<string>([...this.flushTimers.keys(), ...this.pendingPayloads.keys()]);
    await Promise.all([...ids].map((id) => this.flushPlanet(id)));
  }

  latestCounts(planetId: string): { tick: number; alivePlayers: number; aliveBots: number } | undefined {
    const cached = this.liveCache.get(planetId);
    if (!cached) return undefined;
    return {
      tick: cached.payload.tick,
      alivePlayers: cached.payload.alivePlayers,
      aliveBots: cached.payload.aliveBots,
    };
  }

  async getLivePlanetState(planetId: string): Promise<PlanetSectorsLiveStateV1 | null> {
    const cached = this.liveCache.get(planetId);
    if (cached && (this.planets?.isLoaded(planetId) || !this.enabled)) {
      return buildCachedLivePlanetState(planetId, cached.payload, cached.updatedAt);
    }
    const db = this.prisma ? await queryDbLivePlanetState(this.prisma, planetId) : null;
    if (db) return db;
    return cached ? buildCachedLivePlanetState(planetId, cached.payload, cached.updatedAt) : null;
  }

  private clearTimer(planetId: string): void {
    const t = this.flushTimers.get(planetId);
    if (t) {
      clearTimeout(t);
      this.flushTimers.delete(planetId);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsubSync?.();
    this.unsubSync = undefined;
    this.unsubUnloaded?.();
    this.unsubUnloaded = undefined;
    for (const id of [...this.flushTimers.keys()]) this.clearTimer(id);
    await this.flushAll();
  }
}
