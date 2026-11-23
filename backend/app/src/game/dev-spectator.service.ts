import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { canonicalPlanetById, flagsFromList, HomePlanetId, newId, PlanetType } from '@terra/contracts';
import { createScenarioPlanet, getScenario } from '@terra/scenarios';
import {
  createPlanet,
  hashString,
  restore,
  seedRivalAiColonies,
  SimHost,
  snapshot,
  type LedgerPosting,
} from '@terra/sim';
import { z } from 'zod';
import { ColonyAgentLoopService } from '../ai/colony-agent/colony-agent-loop.service';
import { CoreException } from '../core/errors';
import { HomeRepository } from '../core/home/home.repository';
import { EconomyProfileService } from '../economy/profile/profile.service';
import { FlagsService } from '../flags/flags.service';
import { SimClusterService, type PlanetHostLocation } from './cluster/sim-cluster.service';
import { GamePlanets } from './game-planets.service';
import { SectorStateService } from './persistence/sector-state.service';
import { SimHistoryService } from './persistence/sim-history.service';
import { SimLeaseService } from './persistence/sim-lease.service';
import { PlanetHeldError, SnapshotService } from './persistence/snapshot.service';

export const DevSpectatorRequestSchema = z
  .object({
    planetId: HomePlanetId.optional(),
    scenario: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i)
      .optional(),
    planetType: z.string().trim().min(1).max(32).optional(),
    botCount: z.coerce.number().int().min(1).max(6).optional(),
    seed: z.string().trim().min(1).max(64).optional(),
    reset: z.boolean().optional(),
  })
  .strict();

export type DevSpectatorRequest = z.infer<typeof DevSpectatorRequestSchema>;

export interface DevSpectatorResponse {
  readonly planetId: string;
  readonly tick: number;
  readonly botCount: number;
  readonly created: boolean;
  readonly reset: boolean;
}

interface EnsureContext {
  readonly planetId: string;
  readonly scenarioId?: string;
  readonly planetType: 'desert' | 'ocean' | 'temperate';
  readonly botCount: number;
  readonly seed: string;
  readonly reset: boolean;
}

const CLUSTER_WORKER_WAIT_MS = 5_000;
const CLUSTER_WORKER_POLL_MS = 150;

export function normalizeSpectatorPlanetType(raw?: string): 'desert' | 'ocean' | 'temperate' {
  const trimmed = raw?.trim();
  const aliased =
    trimmed === 'oceanForest'
      ? 'ocean'
      : trimmed === 'dune'
        ? 'desert'
        : trimmed === 'forestRock'
          ? 'temperate'
          : trimmed;
  const parsed = PlanetType.safeParse(aliased);
  return parsed.success ? parsed.data : 'ocean';
}

export function spectatorPlanetId(opts: {
  readonly planetType: 'desert' | 'ocean' | 'temperate';
  readonly botCount: number;
  readonly seed?: string;
}): string {
  const defaultSeed = `spec-${opts.planetType}`;
  const seed = opts.seed?.trim() || defaultSeed;
  if (seed === defaultSeed) {
    return `pl_spec_${opts.planetType}_${opts.botCount}`;
  }
  const safe = seed.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 20) || 'custom';
  const hash = (hashString(seed) >>> 0).toString(36).slice(0, 6);
  return `pl_spec_${opts.planetType}_${opts.botCount}_${safe}_${hash}`;
}

export function spectatorScenarioPlanetId(scenarioId: string): string {
  const safe = scenarioId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 48) || 'w00';
  return `pl_spec_sc_${safe}`;
}

@Injectable()
export class DevSpectatorService {
  private readonly locks = new Map<string, Promise<unknown>>();
  workerWaitMs = CLUSTER_WORKER_WAIT_MS;

  constructor(
    @Inject(GamePlanets) private readonly planets: GamePlanets,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(SnapshotService) private readonly snapshots?: SnapshotService,
    @Optional() @Inject(SimClusterService) private readonly cluster?: SimClusterService,
    @Optional() @Inject(SimLeaseService) private readonly simLease?: SimLeaseService,
    @Optional() @Inject(SectorStateService) private readonly sectorState?: SectorStateService,
    @Optional() @Inject(SimHistoryService) private readonly simHistory?: SimHistoryService,
    @Optional() @Inject(EconomyProfileService) private readonly profiles?: EconomyProfileService,
    @Optional() @Inject(ColonyAgentLoopService) private readonly colonyAgentLoop?: ColonyAgentLoopService,
    @Optional() @Inject(HomeRepository) private readonly homes?: HomeRepository,
  ) {}

  ensureSpectatorPlanet(rawInput: DevSpectatorRequest = {}): Promise<DevSpectatorResponse> {
    const rawScenario = rawInput.scenario?.trim().toLowerCase();
    const scenarioId = rawScenario && rawScenario !== 'spectator' ? rawScenario : undefined;
    const scenarioDef = scenarioId ? getScenario(scenarioId) : undefined;
    if (scenarioId && !scenarioDef) {
      throw new CoreException('NOT_FOUND', { status: 404, message: `Unknown scenario "${scenarioId}"` });
    }
    const planetType = normalizeSpectatorPlanetType(rawInput.planetType ?? scenarioDef?.planet.planetType);
    const botCount = Math.max(1, Math.min(6, rawInput.botCount ?? 2));
    const seed = rawInput.seed?.trim() || `spec-${planetType}`;
    const planetId =
      rawInput.planetId ??
      (scenarioDef ? spectatorScenarioPlanetId(scenarioDef.id) : spectatorPlanetId({ planetType, botCount, seed }));
    const reset = Boolean(rawInput.reset);

    if (reset && canonicalPlanetById(planetId) !== null) {
      throw new CoreException('FORBIDDEN', {
        status: 403,
        message: `Canonical planet "${planetId}" cannot be wiped via spectator reset`,
      });
    }

    return this.withPlanetLock(planetId, () =>
      this.runEnsure({ planetId, scenarioId: scenarioDef?.id, planetType, botCount, seed, reset }),
    );
  }

  private async withPlanetLock<T>(planetId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(planetId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.locks.set(planetId, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(planetId) === run) this.locks.delete(planetId);
    }
  }

  private async assertResetSafe(planetId: string): Promise<void> {
    if (planetId.startsWith('pl_spec_') || !this.homes) return;
    const rows = await this.homes.listColoniesByPlanetId(planetId);
    const hasHuman = rows.some(
      (c) => c.status === 'ACTIVE' && !c.playerId.startsWith('ai:') && !c.playerId.startsWith('bot:'),
    );
    if (hasHuman) {
      throw new CoreException('FORBIDDEN', {
        status: 403,
        message: `Planet "${planetId}" has active human colonies and cannot be wiped via spectator reset`,
      });
    }
  }

  private async runEnsure(ctx: EnsureContext): Promise<DevSpectatorResponse> {
    const { planetId, reset, botCount } = ctx;
    if (reset) {
      await this.assertResetSafe(planetId);
      await this.wipeEverywhere(planetId);
      return this.seedAndLoadFresh({ ...ctx, reset: true });
    }

    const loc = await this.tryEnsureHosted(planetId);
    if (!loc) return this.seedAndLoadFresh({ ...ctx, reset: false });

    const full = this.cluster
      ? await this.cluster.fullStateAnywhere(planetId)
      : await this.planets.fullState(planetId);
    const state = restore(full.bytes);
    const activeBots = state.colonies.filter((c) => Boolean(c && c.isBot && c.status !== 'eliminated')).length;
    const activeHumans = state.colonies.filter((c) => Boolean(c && !c.isBot && c.status !== 'eliminated')).length;

    if (activeBots > 0 || (Boolean(ctx.scenarioId) && activeHumans > 0)) {
      if (this.planets.isLoaded(planetId)) this.planets.requestSectorSync(planetId);
      await this.sectorState?.flushPlanet(planetId);
      return { planetId, tick: full.tick, botCount: activeBots || activeHumans, created: false, reset: false };
    }

    if (activeHumans === 0 && canonicalPlanetById(planetId) === null) {
      await this.wipeEverywhere(planetId);
      return this.seedAndLoadFresh({ ...ctx, reset: false });
    }

    const seededCount = Math.min(2, botCount) as 1 | 2;
    const seedCmd = {
      colonyIndex: 0,
      source: 'system' as const,
      commandId: newId('cm'),
      kind: 'system.seedRivalAi',
      args: { count: seededCount },
    };
    if (this.cluster) await this.cluster.submitAnywhere(planetId, seedCmd);
    else await this.planets.submit(planetId, seedCmd);
    if (this.planets.isLoaded(planetId)) {
      this.planets.requestSectorSync(planetId);
      await this.snapshots?.capture(planetId, 'SEAL', 5_000);
    }
    await this.sectorState?.flushPlanet(planetId);
    return { planetId, tick: full.tick, botCount: seededCount, created: false, reset: false };
  }

  private async tryEnsureHosted(planetId: string): Promise<PlanetHostLocation | null> {
    try {
      if (this.cluster) return await this.tryEnsureHostedInCluster(planetId);
      if (this.planets.isLoaded(planetId)) return { kind: 'local' };
      if (this.snapshots) {
        const out = await this.snapshots.restoreIfPersisted(planetId);
        return out !== 'absent' && this.planets.isLoaded(planetId) ? { kind: 'local' } : null;
      }
      return null;
    } catch (err) {
      if (err instanceof PlanetHeldError && planetId.startsWith('pl_spec_')) {
        await this.wipeEverywhere(planetId);
        return null;
      }
      throw err;
    }
  }

  private async tryEnsureHostedInCluster(planetId: string): Promise<PlanetHostLocation | null> {
    const immediate = await this.cluster!.ensureHosted(planetId);
    if (immediate) return immediate;
    if (!this.simLease || this.simLease.canHostSim()) return null;

    const hasSaved = (await this.snapshots?.hasPersistedSnapshots(planetId).catch(() => false)) ?? false;
    const noWorker = (await this.simLease.pickHealthyWorker()) === null;
    if (hasSaved || noWorker) {
      const deadline = Date.now() + this.workerWaitMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, CLUSTER_WORKER_POLL_MS));
        const retried = await this.cluster!.ensureHosted(planetId);
        if (retried) return retried;
      }
    }

    const stillSaved = hasSaved || ((await this.snapshots?.hasPersistedSnapshots(planetId).catch(() => false)) ?? false);
    if (stillSaved) {
      throw new CoreException('SERVICE_UNAVAILABLE', {
        status: 503,
        message: `Simulation worker is not ready to restore persisted planet "${planetId}" yet`,
      });
    }
    return null;
  }

  private async waitForClusterWorker(): Promise<void> {
    if (!this.simLease || this.simLease.canHostSim()) return;
    if (await this.simLease.pickHealthyWorker()) return;
    const deadline = Date.now() + this.workerWaitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CLUSTER_WORKER_POLL_MS));
      if (await this.simLease.pickHealthyWorker()) return;
    }
    throw new CoreException('SERVICE_UNAVAILABLE', {
      status: 503,
      message: 'No healthy simulation worker is ready yet',
    });
  }

  private async wipeEverywhere(planetId: string): Promise<void> {
    this.colonyAgentLoop?.clearPlanetCache(planetId);
    if (this.cluster) {
      await this.cluster.wipeAnywhere(planetId);
    } else if (this.snapshots) {
      await this.snapshots.wipeLoadedOrHeld(planetId);
    } else {
      await this.planets.unload(planetId);
    }
    await this.sectorState?.clearPlanet(planetId);
    await this.simHistory?.clearPlanet(planetId);
  }

  private buildFreshHost(
    ctx: EnsureContext,
    region: Awaited<ReturnType<EconomyProfileService['regionForNewPlanet']>> | undefined,
  ): { host: SimHost; setupPostings: LedgerPosting[]; colonyCount: number } {
    const { planetId, scenarioId, planetType, botCount, seed } = ctx;
    if (scenarioId) {
      const built = createScenarioPlanet(scenarioId, {
        planetId,
        flags: this.flags.list,
        worldSalt: randomUUID(),
        ...(region ? { region } : {}),
      });
      const setupPostings: LedgerPosting[] = [...built.setupPostings];
      const liveCols = built.host.state.colonies.filter((c) => Boolean(c && c.status !== 'eliminated')).length;
      if (liveCols === 0) {
        const colonyIndices = Array.from({ length: botCount }, (_, idx) => idx);
        seedRivalAiColonies(built.host.state, {
          count: botCount,
          colonyIndices,
          capacity: 8,
          tick: built.host.tick,
          data: built.host.pipeline.config.data,
          recordPosting: (p) => { setupPostings.push(p); },
        });
      }
      const colonyCount =
        built.host.state.colonies.filter((c) => Boolean(c && c.status !== 'eliminated')).length || botCount;
      return { host: built.host, setupPostings, colonyCount };
    }

    const host = new SimHost({ flags: flagsFromList(this.flags.list), hostRole: 'authority_external_bots' });
    const state = createPlanet({
      type: 'temperate',
      planetType,
      seed,
      planetId,
      radius: 36,
      capacity: 8,
      worldSalt: randomUUID(),
      ...(region ? { region } : {}),
    });
    const setupPostings: LedgerPosting[] = [];
    const off = host.onPostings((p) => setupPostings.push(...p));
    try {
      host.load(state);
      const colonyIndices = Array.from({ length: botCount }, (_, idx) => idx);
      seedRivalAiColonies(host.state, {
        count: botCount,
        colonyIndices,
        capacity: 8,
        tick: 0,
        data: host.pipeline.config.data,
        recordPosting: (p) => { setupPostings.push(p); },
      });
    } finally {
      off();
    }
    return { host, setupPostings, colonyCount: botCount };
  }

  private async seedAndLoadFresh(ctx: EnsureContext): Promise<DevSpectatorResponse> {
    const { planetId, planetType, reset } = ctx;
    const region = await this.profiles?.regionForNewPlanet({ planetType, planetId });
    const { host, setupPostings, colonyCount } = this.buildFreshHost(ctx, region);
    const snapBytes = snapshot(host.state);

    if (this.simLease && !this.simLease.canHostSim() && this.cluster) {
      await this.waitForClusterWorker();
      await this.cluster.forwardLoadNew(planetId, {
        snapshot: snapBytes,
        genesis: true,
        setupPostings,
        captureInitial: true,
      });
    } else {
      await this.planets.load(planetId, { snapshot: snapBytes, genesis: true, setupPostings });
      if (this.simLease && this.planets.isLoaded(planetId)) {
        await this.simLease.tryAcquire(planetId).catch(() => undefined);
      }
      this.planets.requestSectorSync(planetId);
      await this.snapshots?.capture(planetId, 'SEAL', 5_000);
      await this.sectorState?.flushPlanet(planetId);
    }

    return { planetId, tick: host.tick, botCount: colonyCount, created: true, reset };
  }
}
