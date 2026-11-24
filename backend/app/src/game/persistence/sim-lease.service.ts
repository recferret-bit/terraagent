import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable, Optional, type BeforeApplicationShutdown, type OnApplicationShutdown } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { Logger } from 'pino';
import { layerLogger } from '../../core/logging/logger';
import { persistenceEnabled } from '../../core/persistence';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import { PRISMA } from '../../db/db.module';
import { GamePlanets } from '../game-planets.service';
import { nodeLoadScore } from '../placement/node-load';
import { SectorStateService } from './sector-state.service';

export const DEFAULT_SIM_LEASE_TTL_MS = 15_000;
export const DEFAULT_SIM_LEASE_RENEW_MS = 4_000;

export type SimWorkerRole = 'all' | 'sim-worker' | 'api';

export interface SimLeaseRecord {
  readonly planetId: string;
  readonly workerId: string;
  readonly role: string;
  readonly internalUrl: string | null;
  readonly mode: string;
  readonly lastTick: number;
  readonly alivePlayers: number;
  readonly aliveBots: number;
  readonly expiresAt: string;
  readonly updatedAt: string;
}

export interface SimWorkerNodeRecord {
  readonly workerId: string;
  readonly role: string;
  readonly internalUrl: string;
  /** Load score (`nodeLoadScore`): busy per-mille of its sim threads x 1000 + planet count. Lower is less loaded. */
  readonly loadCount: number;
  readonly expiresAt: string;
}

function isUniqueViolation(e: unknown): boolean {
  return Boolean(
    e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code?: unknown }).code === 'P2002',
  );
}

/**
 * Distributed simulation ownership coordinator across backend worker processes and app replicas (`world.sim_worker_lease`).
 * Prevents split-brain stepping of the same planet on two replicas and lets healthy replicas automatically resume
 * simulations with live bots or players if another replica crashes or drains.
 */
@Injectable()
export class SimLeaseService implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly log: Logger;
  readonly workerId: string;
  readonly role: SimWorkerRole;
  readonly enabled: boolean;
  readonly configuredInternalUrl: string | null;
  ttlMs: number = DEFAULT_SIM_LEASE_TTL_MS;
  private internalUrlValue: string | null;
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private reclaimHandler: ((planetId: string) => Promise<void>) | undefined;
  private leaseLostHandler: ((planetId: string) => Promise<void>) | undefined;
  private listenersBound = false;
  private loopActive = false;
  private released = false;
  private offDown: (() => void) | undefined;
  nowMs: () => number = () => Date.now();

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    @Inject(LOGGER) root: Logger,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(SectorStateService) private readonly sectorState?: SectorStateService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
    const customId = typeof (env as Record<string, unknown>).TA_WORKER_ID === 'string'
      ? String((env as Record<string, unknown>).TA_WORKER_ID).trim()
      : '';
    this.workerId = customId || `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    const rawRole = (env as Record<string, unknown>).TA_SIM_ROLE;
    this.role = rawRole === 'sim-worker' || rawRole === 'api' ? rawRole : 'all';
    const rawUrl = (env as Record<string, unknown>).TA_INTERNAL_URL;
    this.configuredInternalUrl = typeof rawUrl === 'string' && rawUrl.trim() ? rawUrl.trim().replace(/\/+$/, '') : null;
    this.internalUrlValue = null;
    this.enabled = Boolean(prisma && persistenceEnabled(env));
  }

  get internalUrl(): string | null {
    return this.internalUrlValue;
  }

  setInternalUrl(url: string | null | undefined): Promise<void> {
    const clean = typeof url === 'string' && url.trim() ? url.trim().replace(/\/+$/, '') : null;
    if (!clean) return Promise.resolve();
    this.internalUrlValue = clean;
    this.released = false;
    if (!this.enabled || !this.prisma || !this.canHostSim()) return Promise.resolve();
    const prisma = this.prisma;
    return (async () => {
      await prisma.simWorkerLease
        .updateMany({ where: { workerId: this.workerId }, data: { internalUrl: clean } })
        .catch(() => undefined);
      await this.registerNodeHeartbeat().catch(() => undefined);
    })();
  }

  /** Scrubs any stale `SimWorkerNode` or `internalUrl` left behind if this `workerId` crashed (`SIGKILL`) on a prior run. */
  async clearBootStaleEndpoints(): Promise<void> {
    if (!this.enabled || !this.prisma || !this.canHostSim() || this.internalUrlValue) return;
    await this.prisma.simWorkerNode.deleteMany({ where: { workerId: this.workerId } }).catch(() => undefined);
    await this.prisma.simWorkerLease
      .updateMany({ where: { workerId: this.workerId }, data: { internalUrl: null } })
      .catch(() => undefined);
  }

  setTtlMsForTest(ms: number): void {
    this.ttlMs = ms;
  }

  canHostSim(): boolean {
    return this.role !== 'api';
  }

  startLoop(opts?: {
    onReclaim?: (planetId: string) => Promise<void>;
    onLeaseLost?: (planetId: string) => Promise<void>;
    intervalMs?: number;
  }): void {
    if (opts?.onReclaim) this.reclaimHandler = opts.onReclaim;
    if (opts?.onLeaseLost) this.leaseLostHandler = opts.onLeaseLost;
    if (this.enabled && this.canHostSim() && this.internalUrlValue) {
      void this.registerNodeHeartbeat().catch(() => undefined);
    }
    if (!this.timer && this.enabled && this.canHostSim()) {
      const interval = opts?.intervalMs ?? DEFAULT_SIM_LEASE_RENEW_MS;
      this.timer = setInterval(() => {
        void this.tick();
      }, interval);
      this.timer.unref?.();
    }
    this.loopActive = true;
    if (!this.listenersBound && this.planets) {
      this.listenersBound = true;
      this.planets.onPlanetLoaded?.((planetId, tick) => {
        if (this.loopActive) void this.tryAcquire(planetId, { lastTick: tick });
      });
      this.planets.onPlanetUnloaded?.((planetId) => {
        if (this.loopActive) void this.releasePlanet(planetId).catch(() => undefined);
      });
    }
    if (!this.offDown && this.planets) {
      this.offDown = this.planets.onPlanetDown?.((planetId) => {
        void this.releasePlanet(planetId).catch(() => undefined);
      });
    }
  }

  stopLoop(): void {
    this.loopActive = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.offDown) {
      this.offDown();
      this.offDown = undefined;
    }
  }

  async tryAcquire(
    planetId: string,
    stats?: { lastTick?: number; alivePlayers?: number; aliveBots?: number; mode?: 'active' | 'coarse' },
  ): Promise<boolean> {
    if (!this.canHostSim()) return false;
    this.released = false;
    if (!this.enabled || !this.prisma) return true;

    const now = new Date(this.nowMs());
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const cached = this.sectorState?.latestCounts(planetId);
    const lastTick = stats?.lastTick ?? cached?.tick ?? 0;
    const alivePlayers = stats?.alivePlayers ?? cached?.alivePlayers ?? 0;
    const aliveBots = stats?.aliveBots ?? cached?.aliveBots ?? 0;
    const mode = stats?.mode ?? this.planets?.modeOf(planetId) ?? 'active';

    const updated = await this.prisma.simWorkerLease.updateMany({
      where: {
        planetId,
        OR: [{ workerId: this.workerId }, { expiresAt: { lte: now } }],
      },
      data: {
        workerId: this.workerId,
        role: this.role,
        internalUrl: this.internalUrlValue,
        mode,
        lastTick,
        alivePlayers,
        aliveBots,
        leasedAt: now,
        expiresAt,
      },
    });
    if (updated.count > 0) return true;

    try {
      await this.prisma.simWorkerLease.create({
        data: {
          planetId,
          workerId: this.workerId,
          role: this.role,
          internalUrl: this.internalUrlValue,
          mode,
          lastTick,
          alivePlayers,
          aliveBots,
          leasedAt: now,
          expiresAt,
        },
      });
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  }

  async renewPlanet(planetId: string): Promise<boolean> {
    if (!this.enabled || !this.prisma) return true;
    const now = new Date(this.nowMs());
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const cached = this.sectorState?.latestCounts(planetId);
    const res = await this.prisma.simWorkerLease.updateMany({
      where: { planetId, workerId: this.workerId },
      data: {
        role: this.role,
        ...(this.internalUrlValue ? { internalUrl: this.internalUrlValue } : {}),
        mode: this.planets?.modeOf(planetId) ?? 'active',
        ...(cached
          ? {
              lastTick: cached.tick,
              alivePlayers: cached.alivePlayers,
              aliveBots: cached.aliveBots,
            }
          : {}),
        expiresAt,
      },
    });
    if (res.count > 0) return true;
    return this.tryAcquire(planetId);
  }

  async tick(): Promise<void> {
    if (!this.enabled || !this.prisma || !this.canHostSim() || this.ticking) return;
    this.ticking = true;
    try {
      await this.registerNodeHeartbeat().catch(() => undefined);
      for (const planetId of this.planets?.loadedIds() ?? []) {
        const ok = await this.renewPlanet(planetId);
        if (!ok) {
          this.log.warn({ planetId, workerId: this.workerId }, 'lost simulation lease; unloading planet');
          await (this.leaseLostHandler?.(planetId) ?? this.planets?.unload(planetId));
        }
      }

      if (this.reclaimHandler) {
        const now = new Date(this.nowMs());
        const expired = await this.prisma.simWorkerLease.findMany({
          where: {
            expiresAt: { lte: now },
            OR: [{ alivePlayers: { gt: 0 } }, { aliveBots: { gt: 0 } }],
          },
          take: 16,
          orderBy: { expiresAt: 'asc' },
        });
        for (const row of expired) {
          if (this.planets?.isLoaded(row.planetId)) continue;
          const won = await this.tryAcquire(row.planetId, {
            lastTick: row.lastTick,
            alivePlayers: row.alivePlayers,
            aliveBots: row.aliveBots,
            mode: row.mode === 'coarse' ? 'coarse' : 'active',
          });
          if (!won) continue;
          this.log.info(
            { planetId: row.planetId, workerId: this.workerId, alivePlayers: row.alivePlayers, aliveBots: row.aliveBots },
            'reclaimed expired simulation lease',
          );
          await this.reclaimHandler(row.planetId).catch(async (e: unknown) => {
            this.log.warn({ planetId: row.planetId, err: e instanceof Error ? e.message : String(e) }, 'lease reclaim restore failed');
            await this.releasePlanet(row.planetId).catch(() => undefined);
          });
        }
      }
    } catch (e) {
      this.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'sim lease tick failed');
    } finally {
      this.ticking = false;
    }
  }

  async listLeases(): Promise<SimLeaseRecord[]> {
    if (!this.enabled || !this.prisma) {
      const iso = new Date(this.nowMs() + this.ttlMs).toISOString();
      const nowIso = new Date(this.nowMs()).toISOString();
      return (this.planets?.loadedIds() ?? []).map((planetId) => {
        const counts = this.sectorState?.latestCounts(planetId);
        return {
          planetId,
          workerId: this.workerId,
          role: this.role,
          internalUrl: this.internalUrlValue,
          mode: this.planets?.modeOf(planetId) ?? 'active',
          lastTick: counts?.tick ?? 0,
          alivePlayers: counts?.alivePlayers ?? 0,
          aliveBots: counts?.aliveBots ?? 0,
          expiresAt: iso,
          updatedAt: nowIso,
        };
      });
    }
    const rows = await this.prisma.simWorkerLease.findMany({ orderBy: { planetId: 'asc' } });
    return rows.map((r) => ({
      planetId: r.planetId,
      workerId: r.workerId,
      role: r.role,
      internalUrl: r.internalUrl,
      mode: r.mode,
      lastTick: r.lastTick,
      alivePlayers: r.alivePlayers,
      aliveBots: r.aliveBots,
      expiresAt: r.expiresAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async getOwnerLease(planetId: string): Promise<SimLeaseRecord | null> {
    if (!this.enabled || !this.prisma) return null;
    const now = new Date(this.nowMs());
    const r = await this.prisma.simWorkerLease.findUnique({ where: { planetId } });
    if (!r || r.expiresAt.getTime() <= now.getTime()) return null;
    return {
      planetId: r.planetId,
      workerId: r.workerId,
      role: r.role,
      internalUrl: r.internalUrl,
      mode: r.mode,
      lastTick: r.lastTick,
      alivePlayers: r.alivePlayers,
      aliveBots: r.aliveBots,
      expiresAt: r.expiresAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async findActiveLeases(): Promise<SimLeaseRecord[]> {
    if (!this.enabled || !this.prisma) return this.listLeases();
    const now = new Date(this.nowMs());
    const rows = await this.prisma.simWorkerLease.findMany({
      where: { expiresAt: { gt: now } },
      orderBy: { planetId: 'asc' },
    });
    return rows.map((r) => ({
      planetId: r.planetId,
      workerId: r.workerId,
      role: r.role,
      internalUrl: r.internalUrl,
      mode: r.mode,
      lastTick: r.lastTick,
      alivePlayers: r.alivePlayers,
      aliveBots: r.aliveBots,
      expiresAt: r.expiresAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async registerNodeHeartbeat(): Promise<void> {
    if (!this.enabled || !this.prisma || !this.canHostSim() || !this.internalUrlValue) return;
    const now = new Date(this.nowMs());
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    // measured load (3.3), in the existing column: an old worker's raw planet count orders as an idle worker
    const loadCount = nodeLoadScore(this.planets?.pool?.cachedStats?.() ?? [], this.planets?.loadedIds().length ?? 0);
    await this.prisma.simWorkerNode.upsert({
      where: { workerId: this.workerId },
      update: { role: this.role, internalUrl: this.internalUrlValue, loadCount, expiresAt },
      create: { workerId: this.workerId, role: this.role, internalUrl: this.internalUrlValue, loadCount, expiresAt },
    });
  }

  async countHealthyWorkers(): Promise<number> {
    if (!this.enabled || !this.prisma) return 0;
    const now = new Date(this.nowMs());
    return this.prisma.simWorkerNode.count({ where: { role: { in: ['sim-worker', 'all'] }, expiresAt: { gt: now } } });
  }

  /** The live sim worker with the lowest load score (least busy threads, then fewest planets). */
  async pickHealthyWorker(): Promise<SimWorkerNodeRecord | null> {
    if (!this.enabled || !this.prisma) return null;
    const now = new Date(this.nowMs());
    const row = await this.prisma.simWorkerNode.findFirst({
      where: {
        role: { in: ['sim-worker', 'all'] },
        expiresAt: { gt: now },
      },
      orderBy: [{ loadCount: 'asc' }, { updatedAt: 'desc' }],
    });
    if (!row) return null;
    return {
      workerId: row.workerId,
      role: row.role,
      internalUrl: row.internalUrl,
      loadCount: row.loadCount,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async releasePlanet(planetId: string): Promise<void> {
    if (!this.enabled || !this.prisma) return;
    const now = new Date(this.nowMs());
    await this.prisma.simWorkerLease.updateMany({
      where: { planetId, workerId: this.workerId },
      data: { expiresAt: now },
    });
  }

  /** Evicts an unreachable/crashed remote worker's node heartbeat and expires its leases so healthy workers can take over immediately. */
  async evictWorker(workerId: string): Promise<void> {
    if (!this.enabled || !this.prisma || !workerId) return;
    const now = new Date(this.nowMs());
    await this.prisma.simWorkerNode.deleteMany({ where: { workerId } }).catch(() => undefined);
    await this.prisma.simWorkerLease
      .updateMany({ where: { workerId }, data: { expiresAt: now, internalUrl: null } })
      .catch(() => undefined);
  }

  /** Expires a single planet lease when the remote worker reports it is no longer hosting `planetId`. */
  async evictPlanetLease(planetId: string, workerId: string): Promise<void> {
    if (!this.enabled || !this.prisma || !planetId || !workerId) return;
    const now = new Date(this.nowMs());
    await this.prisma.simWorkerLease
      .updateMany({ where: { planetId, workerId }, data: { expiresAt: now } })
      .catch(() => undefined);
  }

  async releaseAll(): Promise<void> {
    this.released = true;
    if (!this.enabled || !this.prisma) return;
    const now = new Date(this.nowMs());
    await this.prisma.simWorkerLease.updateMany({
      where: { workerId: this.workerId },
      data: { expiresAt: now, internalUrl: null },
    });
    await this.prisma.simWorkerNode.deleteMany({
      where: { workerId: this.workerId },
    }).catch(() => undefined);
  }

  beforeApplicationShutdown(): void {
    // Stop lease renewals first, keeping active leases held until GameModule stops sim threads and flushes SHUTDOWN snapshots.
    this.stopLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopLoop();
    if (!this.released) {
      await this.releaseAll().catch(() => undefined);
    }
  }
}
