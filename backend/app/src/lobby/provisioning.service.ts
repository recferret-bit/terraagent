import { Inject, Injectable, Optional } from '@nestjs/common';
import { CANONICAL_PLANETS, type AtlasManifestV1, type PlanetType, type WorldHealthState } from '@terra/contracts';
import { HomeRepository } from '../core/home/home.repository';
import { GamePlanets } from '../game/game-planets.service';
import { SnapshotService } from '../game/persistence/snapshot.service';
import { InvalidLifecycleTransitionError, WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type PinnedAtlasVersionRecord,
} from './lobby-persistence.types';
import { KeyedMutex } from './lobby-store.helpers';
import { CANONICAL_PLANET_TYPES, resolveCanonicalPlanetType } from './planets.helpers';
import {
  buildCanonicalProvisioningManifest,
  CANONICAL_WORLD_SIM_LOADER,
  composeProvisionOutcome,
  DefaultCanonicalWorldSimLoader,
  DEFAULT_PROVISION_FAILED_FAULT_CODE,
  DEFAULT_PROVISION_MAX_RETRIES,
  DEFAULT_PROVISION_RETRY_FAULT_CODE,
  errorMessageOf,
  extractFaultCodeFromError,
  hashPlanetToSimThread,
  runCanonicalSimLoaderWithTimeout,
  toAllCanonicalWorldsResult,
  type CanonicalWorldLoaderFn,
  type CanonicalWorldLoadRequest,
  type CanonicalWorldLoadResult,
  type CanonicalWorldProvisionOutcome,
  type CanonicalWorldProvisionState,
  type CanonicalWorldSimLoader,
  type InternalWorldTrackState,
  type ProvisionAllCanonicalWorldsOptions,
  type ProvisionAllCanonicalWorldsResult,
  type ProvisionCanonicalWorldOptions,
} from './provisioning.types';

export * from './provisioning.types';

interface FinalizeLoadContext {
  readonly type: PlanetType;
  readonly created: boolean;
  readonly manifest: AtlasManifestV1;
  readonly pinnedAtlas: PinnedAtlasVersionRecord;
  readonly actor: string;
  readonly retryCount: number;
  readonly placementAttempts: number;
  readonly maxRetries: number;
  readonly attemptedPlanetIds: string[];
  readonly healthHistory: WorldHealthState[];
}

/**
 * Provisions the three canonical persistent worlds (`desert`, `ocean`, `temperate`) through the
 * existing sim-thread loader with bounded retry and fault status (W11-06, MATCHMAKING §0.1, §0.2 MM-01/02/42..44/50).
 * Never creates a 4th world, warm-pool instance, or replacement `planetId` on failure.
 */
@Injectable()
export class CanonicalWorldProvisioningService {
  private readonly lifecycle: WorldLifecycleService;
  private readonly homeRepo?: HomeRepository;
  private readonly gamePlanets?: GamePlanets;
  private readonly snapshots?: SnapshotService;
  private readonly defaultLoader = new DefaultCanonicalWorldSimLoader();
  private readonly mutex = new KeyedMutex();
  private readonly trackByType = new Map<PlanetType, InternalWorldTrackState>();
  private customLoader?: CanonicalWorldSimLoader | CanonicalWorldLoaderFn;

  constructor(
    @Inject(LobbyPersistenceService) private readonly persistence: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) lifecycle?: WorldLifecycleService,
    @Optional() @Inject(HomeRepository) homeRepo?: HomeRepository,
    @Optional() @Inject(CANONICAL_WORLD_SIM_LOADER) simLoader?: CanonicalWorldSimLoader | CanonicalWorldLoaderFn,
    @Optional() @Inject(SnapshotService) snapshots?: SnapshotService,
    @Optional() @Inject(GamePlanets) gamePlanets?: GamePlanets,
  ) {
    this.lifecycle = lifecycle ?? new WorldLifecycleService(this.persistence);
    this.homeRepo = homeRepo;
    this.customLoader = simLoader;
    this.snapshots = snapshots;
    this.gamePlanets = gamePlanets;
  }

  setSimLoader(loader: CanonicalWorldSimLoader | CanonicalWorldLoaderFn | undefined): void {
    this.customLoader = loader;
  }

  getSimLoader(): CanonicalWorldSimLoader {
    return typeof this.customLoader === 'object' && this.customLoader !== null ? this.customLoader : this.defaultLoader;
  }

  isWorldLoaded(typeOrId: PlanetType | string): boolean {
    const type = this.resolveTypeOrThrow(typeOrId);
    const planetId = CANONICAL_PLANETS[type].id;
    if (this.trackByType.get(type)?.loaded) return true;
    if (typeof this.customLoader === 'object' && this.customLoader !== null) {
      if (this.customLoader.isWorldLoaded?.(planetId) || this.customLoader.isLoaded?.(planetId)) return true;
    }
    return Boolean(this.gamePlanets?.isLoaded(planetId) || this.defaultLoader.isWorldLoaded(planetId));
  }

  getLoadedPlanetIds(): readonly string[] {
    const out = new Set<string>(this.defaultLoader.loadedPlanetIds());
    for (const st of this.trackByType.values()) if (st.loaded) out.add(st.planetId);
    if (typeof this.customLoader === 'object' && this.customLoader !== null) {
      for (const id of this.customLoader.loadedPlanetIds?.() ?? this.customLoader.loadedIds?.() ?? []) out.add(id);
    }
    for (const id of this.gamePlanets?.loadedIds() ?? []) out.add(id);
    return CANONICAL_PLANET_TYPES.map((t) => CANONICAL_PLANETS[t].id).filter((id) => out.has(id));
  }

  async getProvisioningState(typeOrId: PlanetType | string): Promise<CanonicalWorldProvisionState> {
    const type = this.resolveTypeOrThrow(typeOrId);
    const canonical = CANONICAL_PLANETS[type];
    const world = await this.persistence.getCanonicalWorldByType(type);
    const tracked = this.trackByType.get(type);
    return {
      planetId: canonical.id,
      type,
      loaded: this.isWorldLoaded(type),
      tick: tracked?.tick ?? null,
      thread: tracked?.thread ?? hashPlanetToSimThread(canonical.id),
      retryCount: world?.retryCount ?? tracked?.retryCount ?? 0,
      placementAttempts: world?.placementAttempts ?? tracked?.placementAttempts ?? 0,
      maxRetries: tracked?.maxRetries ?? DEFAULT_PROVISION_MAX_RETRIES,
      lastFaultCode: world?.faultCode ?? tracked?.lastFaultCode ?? null,
      lastError: tracked?.lastError ?? null,
      attemptedPlanetIds: [...(tracked?.attemptedPlanetIds ?? [])],
      healthHistory: [...(tracked?.healthHistory ?? [])],
    };
  }

  async provisionAllCanonicalWorlds(
    options: ProvisionAllCanonicalWorldsOptions = {},
  ): Promise<ProvisionAllCanonicalWorldsResult> {
    const outcomes: CanonicalWorldProvisionOutcome[] = [];
    for (const type of options.types ?? CANONICAL_PLANET_TYPES) outcomes.push(await this.provisionCanonicalWorld(type, options));
    return toAllCanonicalWorldsResult(outcomes);
  }

  async provisionCanonicalWorld(
    typeOrId: PlanetType | string,
    options: ProvisionCanonicalWorldOptions = {},
  ): Promise<CanonicalWorldProvisionOutcome> {
    const type = this.resolveTypeOrThrow(typeOrId);
    return this.mutex.run(`provision:${type}`, () => this.provisionCanonicalWorldLocked(type, options));
  }

  async retryFaultedWorld(
    typeOrId: PlanetType | string,
    actorOrOptions?: string | ProvisionCanonicalWorldOptions,
  ): Promise<CanonicalWorldProvisionOutcome> {
    const opts: ProvisionCanonicalWorldOptions =
      typeof actorOrOptions === 'string' ? { actor: actorOrOptions, forceReload: true } : { ...(actorOrOptions ?? {}), forceReload: true };
    const type = this.resolveTypeOrThrow(typeOrId);
    return this.mutex.run(`provision:${type}`, () => this.provisionCanonicalWorldLocked(type, opts));
  }

  async retryAllFaultedWorlds(
    actorOrOptions?: string | ProvisionAllCanonicalWorldsOptions,
  ): Promise<readonly CanonicalWorldProvisionOutcome[]> {
    const opts: ProvisionAllCanonicalWorldsOptions =
      typeof actorOrOptions === 'string' ? { actor: actorOrOptions } : (actorOrOptions ?? {});
    const worlds = await this.persistence.listCanonicalWorlds();
    const targets = worlds.filter((w) => w.lifecycle !== 'ARCHIVED' && (w.health !== 'OK' || w.lifecycle !== 'ACTIVE'));
    const out: CanonicalWorldProvisionOutcome[] = [];
    for (const w of targets) out.push(await this.retryFaultedWorld(w.canonicalType, opts));
    return out;
  }

  private resolveTypeOrThrow(typeOrId: PlanetType | string): PlanetType {
    const resolved = resolveCanonicalPlanetType(String(typeOrId));
    if (!resolved) {
      throw new LobbyPersistenceConflictError(
        'canonical_type_conflict',
        `unsupported canonical planet identifier or type "${String(typeOrId)}": only the three canonical worlds (desert, ocean, temperate) may be provisioned`,
        { requested: String(typeOrId), allowedTypes: CANONICAL_PLANET_TYPES },
      );
    }
    return resolved;
  }

  private async resolveManifestForType(type: PlanetType, options: ProvisionCanonicalWorldOptions): Promise<AtlasManifestV1> {
    if (
      !options.manifest &&
      options.foundingSeatsPerSector === undefined &&
      options.sectorRadius === undefined
    ) {
      const existingPinned = await this.persistence.getAtlasVersion(CANONICAL_PLANETS[type].id, options.atlasVersion ?? 1);
      if (existingPinned) return existingPinned.manifest;
    }
    return buildCanonicalProvisioningManifest(type, options);
  }

  private async mirrorToHomeRepo(planetId: string, name: string, type: PlanetType, seed: string, state: string, capacity: number): Promise<void> {
    if (!this.homeRepo) return;
    const existing = await this.homeRepo.findPlanetById(planetId);
    if (!existing) return void (await this.homeRepo.upsertDevPlanet(planetId, { name, type, seed, state, capacity }));
    if (existing.status !== state) await this.homeRepo.setPlanetStatus(planetId, state);
  }

  private async provisionCanonicalWorldLocked(
    type: PlanetType,
    options: ProvisionCanonicalWorldOptions,
  ): Promise<CanonicalWorldProvisionOutcome> {
    const canonical = CANONICAL_PLANETS[type];
    const existingBefore = await this.persistence.getCanonicalWorldByType(type);
    if (existingBefore?.lifecycle === 'ARCHIVED') {
      throw new InvalidLifecycleTransitionError(
        `cannot provision or replace archived canonical world "${canonical.id}" (${type})`,
        { planetId: canonical.id, type, lifecycle: existingBefore.lifecycle },
      );
    }

    const manifest = await this.resolveManifestForType(type, options);
    const maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_PROVISION_MAX_RETRIES);
    const actor = options.actor?.trim() || 'system:provisioning';

    if (
      existingBefore &&
      existingBefore.lifecycle === 'ACTIVE' &&
      existingBefore.health === 'OK' &&
      this.isWorldLoaded(type) &&
      !options.forceReload
    ) {
      return this.buildIdempotentHealthyOutcome(type, existingBefore, manifest, maxRetries);
    }

    const { created, pinnedAtlas } = await this.ensureProvisioningWorldPersisted(type, existingBefore, manifest, actor);
    return this.executeBoundedLoadLoop(
      {
        type,
        created,
        manifest,
        pinnedAtlas,
        actor,
        retryCount: 0,
        placementAttempts: existingBefore?.placementAttempts ?? 0,
        maxRetries,
        attemptedPlanetIds: [],
        healthHistory: ['LOADING'],
      },
      options,
    );
  }

  private async buildIdempotentHealthyOutcome(
    type: PlanetType,
    existing: CanonicalWorldRecord,
    manifest: AtlasManifestV1,
    maxRetries: number,
  ): Promise<CanonicalWorldProvisionOutcome> {
    const pinnedRes = await this.persistence.saveAtlasManifest(manifest);
    await this.mirrorToHomeRepo(existing.id, existing.name, type, existing.seed, 'ACTIVE', manifest.validatedCapacity);
    const status = await this.lifecycle.getWorldStatus(existing.id);
    const tracked = this.trackByType.get(type);
    return composeProvisionOutcome({
      ok: true,
      created: false,
      status,
      manifest,
      pinnedAtlas: pinnedRes.record,
      retryCount: existing.retryCount ?? tracked?.retryCount ?? 0,
      placementAttempts: existing.placementAttempts ?? tracked?.placementAttempts ?? 1,
      maxRetries,
      attemptsUsed: 0,
      attemptedPlanetIds: [existing.id],
      healthHistory: ['OK'],
      loaded: true,
      tick: tracked?.tick ?? 0,
      thread: tracked?.thread ?? hashPlanetToSimThread(existing.id),
      error: null,
    });
  }

  private async ensureProvisioningWorldPersisted(
    type: PlanetType,
    existingBefore: CanonicalWorldRecord | null,
    manifest: AtlasManifestV1,
    actor: string,
  ): Promise<{ readonly created: boolean; readonly pinnedAtlas: PinnedAtlasVersionRecord }> {
    const canonical = CANONICAL_PLANETS[type];
    const upserted = await this.persistence.upsertCanonicalWorld({
      type,
      id: canonical.id,
      name: canonical.name,
      look: canonical.look,
      seed: manifest.seed,
      lifecycle: existingBefore?.lifecycle ?? 'PROVISIONING',
      health: 'LOADING',
      admission: existingBefore?.admission ?? 'OPEN',
      capacity: manifest.validatedCapacity,
      manifest,
    });
    const pinnedAtlas = upserted.pinnedAtlas ?? (await this.persistence.saveAtlasManifest(manifest)).record;

    if (!upserted.created && upserted.world.health !== 'LOADING') {
      await this.lifecycle.updateWorldHealth({
        planetId: canonical.id,
        health: 'LOADING',
        faultCode: null,
        retryCount: 0,
        placementAttempts: existingBefore?.placementAttempts ?? 0,
        actor,
        reason: `loading canonical world ${type} (${canonical.id}) onto sim thread`,
      });
    }

    await this.mirrorToHomeRepo(canonical.id, canonical.name, type, manifest.seed, upserted.world.lifecycle, manifest.validatedCapacity);
    return { created: upserted.created, pinnedAtlas };
  }

  private async executeBoundedLoadLoop(
    ctx: FinalizeLoadContext,
    options: ProvisionCanonicalWorldOptions,
  ): Promise<CanonicalWorldProvisionOutcome> {
    const canonical = CANONICAL_PLANETS[ctx.type];
    let retryCount = ctx.retryCount;
    let placementAttempts = ctx.placementAttempts;
    let lastError = '';
    let lastFaultCode = options.faultCode ?? DEFAULT_PROVISION_FAILED_FAULT_CODE;

    for (let attempt = 1; attempt <= ctx.maxRetries; attempt++) {
      ctx.attemptedPlanetIds.push(canonical.id);
      const request: CanonicalWorldLoadRequest = {
        planetId: canonical.id,
        type: ctx.type,
        look: canonical.look,
        name: canonical.name,
        seed: ctx.manifest.seed,
        atlasVersion: ctx.manifest.atlasVersion,
        atlasHash: ctx.manifest.atlasHash,
        configHash: ctx.manifest.configHash,
        capacity: ctx.manifest.validatedCapacity,
        sectorRadius: ctx.manifest.sectorRadius,
        manifest: ctx.manifest,
        attempt,
        maxRetries: ctx.maxRetries,
      };

      try {
        const loadRes = await runCanonicalSimLoaderWithTimeout({
          request,
          options,
          customLoader: this.customLoader,
          snapshots: this.snapshots,
          gamePlanets: this.gamePlanets,
          defaultLoader: this.defaultLoader,
        });
        placementAttempts += 1;
        return await this.finalizeSuccessfulLoad({ ...ctx, retryCount, placementAttempts }, attempt, loadRes);
      } catch (err) {
        retryCount = attempt;
        placementAttempts += 1;
        lastError = errorMessageOf(err);
        lastFaultCode = await this.handleRetryOrExhaust(
          canonical.id,
          attempt,
          { ...ctx, retryCount, placementAttempts },
          err,
          lastError,
          options,
        );
      }
    }

    return this.finalizeFaultedLoad({ ...ctx, retryCount, placementAttempts }, lastFaultCode, lastError, options.throwOnFault === true);
  }

  private async handleRetryOrExhaust(
    canonicalId: string,
    attempt: number,
    ctx: FinalizeLoadContext,
    err: unknown,
    lastError: string,
    options: ProvisionCanonicalWorldOptions,
  ): Promise<string> {
    if (ctx.retryCount < ctx.maxRetries) {
      const retryCode = extractFaultCodeFromError(err, options.retryFaultCode ?? DEFAULT_PROVISION_RETRY_FAULT_CODE);
      ctx.healthHistory.push('RETRYING');
      await this.lifecycle.updateWorldHealth({
        planetId: canonicalId,
        health: 'RETRYING',
        faultCode: retryCode,
        retryCount: ctx.retryCount,
        placementAttempts: ctx.placementAttempts,
        actor: ctx.actor,
        reason: `sim load attempt ${attempt}/${ctx.maxRetries} failed for ${canonicalId}: ${lastError}`,
      });
      if (options.retryDelayMs && options.retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs));
      }
      return retryCode;
    }
    return options.faultCode ?? extractFaultCodeFromError(err, DEFAULT_PROVISION_FAILED_FAULT_CODE);
  }

  private recordTrackedState(
    ctx: FinalizeLoadContext,
    loaded: boolean,
    tick: number | null,
    thread: number,
    lastFaultCode: string | null,
    lastError: string | null,
  ): void {
    this.trackByType.set(ctx.type, {
      planetId: CANONICAL_PLANETS[ctx.type].id,
      type: ctx.type,
      loaded,
      tick,
      thread,
      retryCount: ctx.retryCount,
      placementAttempts: ctx.placementAttempts,
      maxRetries: ctx.maxRetries,
      lastFaultCode,
      lastError,
      attemptedPlanetIds: [...ctx.attemptedPlanetIds],
      healthHistory: [...ctx.healthHistory],
    });
  }

  private async finalizeSuccessfulLoad(
    ctx: FinalizeLoadContext,
    attempt: number,
    loadRes: CanonicalWorldLoadResult,
  ): Promise<CanonicalWorldProvisionOutcome> {
    const canonical = CANONICAL_PLANETS[ctx.type];
    ctx.healthHistory.push('OK');
    const status = await this.lifecycle.markProvisioned({
      planetId: canonical.id,
      actor: ctx.actor,
      reason: `canonical world ${ctx.type} (${canonical.id}) loaded onto sim thread on attempt ${attempt}/${ctx.maxRetries}`,
      retryCount: ctx.retryCount,
      placementAttempts: ctx.placementAttempts,
    });
    await this.mirrorToHomeRepo(canonical.id, canonical.name, ctx.type, ctx.manifest.seed, 'ACTIVE', ctx.manifest.validatedCapacity);
    const thread = loadRes.thread ?? hashPlanetToSimThread(canonical.id);
    this.recordTrackedState(ctx, true, loadRes.tick, thread, null, null);
    return composeProvisionOutcome({ ...ctx, ok: true, status, attemptsUsed: attempt, loaded: true, tick: loadRes.tick, thread, error: null });
  }

  private async finalizeFaultedLoad(
    ctx: FinalizeLoadContext,
    faultCode: string,
    error: string,
    throwOnFault: boolean,
  ): Promise<CanonicalWorldProvisionOutcome> {
    const canonical = CANONICAL_PLANETS[ctx.type];
    ctx.healthHistory.push('FAULTED');
    this.defaultLoader.unloadWorld(canonical.id);
    const status = await this.lifecycle.updateWorldHealth({
      planetId: canonical.id,
      health: 'FAULTED',
      faultCode,
      retryCount: ctx.retryCount,
      placementAttempts: ctx.placementAttempts,
      actor: ctx.actor,
      reason: `provisioning failed after ${ctx.retryCount} bounded retries for ${canonical.id}: ${error}`,
    });
    this.recordTrackedState(ctx, false, null, hashPlanetToSimThread(canonical.id), faultCode, error);
    if (throwOnFault) {
      throw new Error(`Failed to provision canonical world "${canonical.id}" (${ctx.type}) after ${ctx.retryCount} attempts (${faultCode}): ${error}`);
    }
    return composeProvisionOutcome({ ...ctx, ok: false, status, attemptsUsed: ctx.retryCount, loaded: false, tick: null, thread: null, error });
  }
}
