import { Inject, Injectable, Optional } from '@nestjs/common';
import { CANONICAL_PLANETS, type AtlasManifestV1, type PlanetType } from '@terra/contracts';
import {
  extractPinnedAtlasManifest,
  restoreAtlasWorldSnapshot,
  validateAtlasSaveCompatibility,
  type PlanetState,
} from '@terra/sim';
import { HomeRepository } from '../core/home/home.repository';
import { GamePlanets } from '../game/game-planets.service';
import { SnapshotStore } from '../game/persistence/snapshot-store';
import { SnapshotService } from '../game/persistence/snapshot.service';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type PinnedAtlasVersionRecord,
} from './lobby-persistence.types';
import { KeyedMutex } from './lobby-store.helpers';
import { CANONICAL_PLANET_TYPES, resolveCanonicalPlanetType } from './planets.helpers';
import {
  CANONICAL_WORLD_SIM_LOADER,
  CanonicalWorldProvisioningService,
  composeProvisionOutcome,
  hashPlanetToSimThread,
  type CanonicalWorldLoaderFn,
  type CanonicalWorldSimLoader,
  type ProvisionCanonicalWorldOptions,
} from './provisioning.service';
import {
  buildNonLoadedRecoveryOutcome,
  buildPinnedResumeProvisionOptions,
  preserveExistingDevWorlds,
  reconcileCanonicalWorldColoniesAndAdmission,
  resolvePinnedManifestForExistingWorld,
  resolveSnapshotForPlanet,
} from './world-recovery.helpers';
import {
  CANONICAL_WORLD_SNAPSHOT_PROVIDER,
  composeRecoveryOutcome,
  toRecoverCanonicalWorldsReport,
  type CanonicalWorldRecoveryOutcome,
  type CanonicalWorldSnapshotLoaderFn,
  type CanonicalWorldSnapshotProvider,
  type PreservedDevWorldRecord,
  type RecoverCanonicalWorldOptions,
  type RecoverCanonicalWorldsOptions,
  type RecoverCanonicalWorldsReport,
} from './world-recovery.types';

export * from './world-recovery.helpers';
export * from './world-recovery.types';

/**
 * Restarts and resumes the three canonical persistent worlds (`desert`, `ocean`, `temperate`)
 * with their pinned `AtlasManifestV1`, sector occupancy, colonies, and admission state (`OPEN`,
 * `PAUSED`, `ARCHIVED`), while explicitly preserving existing dev saves (`pl_dev*`) without
 * converting them into canonical worlds or wiping their colonies (W11-07, MATCHMAKING §0.1, §0.2 MM-01..02, MM-49..52).
 */
@Injectable()
export class CanonicalWorldRecoveryService {
  private readonly lifecycle: WorldLifecycleService;
  private readonly provisioning: CanonicalWorldProvisioningService;
  private readonly homeRepo?: HomeRepository;
  private readonly snapshots?: SnapshotService;
  private readonly snapshotStore?: SnapshotStore;
  private readonly gamePlanets?: GamePlanets;
  private readonly mutex = new KeyedMutex();
  private customLoader?: CanonicalWorldSimLoader | CanonicalWorldLoaderFn;
  private snapshotProvider?: CanonicalWorldSnapshotProvider | CanonicalWorldSnapshotLoaderFn;

  constructor(
    @Inject(LobbyPersistenceService) private readonly persistence: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) lifecycle?: WorldLifecycleService,
    @Optional()
    @Inject(CanonicalWorldProvisioningService)
    provisioning?: CanonicalWorldProvisioningService,
    @Optional() @Inject(HomeRepository) homeRepo?: HomeRepository,
    @Optional() @Inject(SnapshotService) snapshots?: SnapshotService,
    @Optional() @Inject(SnapshotStore) snapshotStore?: SnapshotStore,
    @Optional() @Inject(GamePlanets) gamePlanets?: GamePlanets,
    @Optional()
    @Inject(CANONICAL_WORLD_SIM_LOADER)
    simLoader?: CanonicalWorldSimLoader | CanonicalWorldLoaderFn,
    @Optional()
    @Inject(CANONICAL_WORLD_SNAPSHOT_PROVIDER)
    snapshotProvider?: CanonicalWorldSnapshotProvider | CanonicalWorldSnapshotLoaderFn,
  ) {
    this.lifecycle = lifecycle ?? new WorldLifecycleService(this.persistence);
    this.homeRepo = homeRepo;
    this.snapshots = snapshots;
    this.snapshotStore = snapshotStore;
    this.gamePlanets = gamePlanets;
    this.customLoader = simLoader;
    this.snapshotProvider = snapshotProvider;
    this.provisioning =
      provisioning ??
      new CanonicalWorldProvisioningService(
        this.persistence,
        this.lifecycle,
        this.homeRepo,
        this.customLoader,
        this.snapshots,
        this.gamePlanets,
      );
  }

  setSimLoader(loader: CanonicalWorldSimLoader | CanonicalWorldLoaderFn | undefined): void {
    this.customLoader = loader;
    this.provisioning.setSimLoader(loader);
  }

  getSimLoader(): CanonicalWorldSimLoader {
    return this.provisioning.getSimLoader();
  }

  setSnapshotProvider(
    provider: CanonicalWorldSnapshotProvider | CanonicalWorldSnapshotLoaderFn | undefined,
  ): void {
    this.snapshotProvider = provider;
  }

  getSnapshotProvider():
    | CanonicalWorldSnapshotProvider
    | CanonicalWorldSnapshotLoaderFn
    | undefined {
    return this.snapshotProvider;
  }

  /**
   * Recovers or provisions all three canonical worlds (`desert`, `ocean`, `temperate`) on boot/restart
   * and explicitly preserves any existing non-canonical dev worlds (`pl_dev*`).
   */
  async recoverOrProvisionCanonicalWorlds(
    options: RecoverCanonicalWorldsOptions = {},
  ): Promise<RecoverCanonicalWorldsReport> {
    const outcomes: CanonicalWorldRecoveryOutcome[] = [];
    for (const type of options.types ?? CANONICAL_PLANET_TYPES) {
      outcomes.push(await this.resumeCanonicalWorld(type, options));
    }
    const devWorlds = await preserveExistingDevWorlds({
      options,
      homeRepo: this.homeRepo,
      provider: this.snapshotProvider,
      snapshotStore: this.snapshotStore,
    });
    return toRecoverCanonicalWorldsReport(outcomes, devWorlds);
  }

  recoverAllCanonicalWorlds(
    options: RecoverCanonicalWorldsOptions = {},
  ): Promise<RecoverCanonicalWorldsReport> {
    return this.recoverOrProvisionCanonicalWorlds(options);
  }

  bootOrRecoverCanonicalWorlds(
    options: RecoverCanonicalWorldsOptions = {},
  ): Promise<RecoverCanonicalWorldsReport> {
    return this.recoverOrProvisionCanonicalWorlds(options);
  }

  /**
   * Resumes a single canonical world (`desert` | `ocean` | `temperate` or canonical ID) with its
   * pinned `AtlasManifestV1` and persisted status, or provisions it if not yet created.
   */
  async resumeCanonicalWorld(
    typeOrId: PlanetType | string,
    options: RecoverCanonicalWorldOptions = {},
  ): Promise<CanonicalWorldRecoveryOutcome> {
    const type = this.resolveTypeOrThrow(typeOrId);
    return this.mutex.run(`recover:${type}`, () => this.resumeCanonicalWorldLocked(type, options));
  }

  recoverCanonicalWorld(
    typeOrId: PlanetType | string,
    options: RecoverCanonicalWorldOptions = {},
  ): Promise<CanonicalWorldRecoveryOutcome> {
    return this.resumeCanonicalWorld(typeOrId, options);
  }

  /**
   * Inspects and preserves all non-canonical dev saves (`pl_dev*`) without converting them into canonical worlds.
   */
  inspectPreservedDevWorlds(
    options: RecoverCanonicalWorldOptions = {},
  ): Promise<readonly PreservedDevWorldRecord[]> {
    return preserveExistingDevWorlds({
      options,
      homeRepo: this.homeRepo,
      provider: this.snapshotProvider,
      snapshotStore: this.snapshotStore,
    });
  }

  private resolveTypeOrThrow(typeOrId: PlanetType | string): PlanetType {
    const resolved = resolveCanonicalPlanetType(String(typeOrId));
    if (!resolved) {
      throw new LobbyPersistenceConflictError(
        'canonical_type_conflict',
        `unsupported canonical planet identifier or type "${String(typeOrId)}": only the three canonical worlds (desert, ocean, temperate) may be recovered or provisioned`,
        { requested: String(typeOrId), allowedTypes: CANONICAL_PLANET_TYPES },
      );
    }
    return resolved;
  }

  private async resumeCanonicalWorldLocked(
    type: PlanetType,
    options: RecoverCanonicalWorldOptions,
  ): Promise<CanonicalWorldRecoveryOutcome> {
    const canonical = CANONICAL_PLANETS[type];
    const existingWorld =
      (await this.persistence.getCanonicalWorldByType(type)) ??
      (await this.persistence.getCanonicalWorldById(canonical.id));
    const snapData = await resolveSnapshotForPlanet(
      canonical.id,
      options,
      this.snapshotProvider,
      this.snapshotStore,
    );

    if (existingWorld) {
      return this.recoverExistingCanonicalWorld(type, existingWorld, snapData, options);
    }
    return this.provisionMissingCanonicalWorld(type, snapData, options);
  }

  private async recoverExistingCanonicalWorld(
    type: PlanetType,
    existingWorld: CanonicalWorldRecord,
    snapData: { readonly rawBytes: Uint8Array | null; readonly state: PlanetState | null },
    options: RecoverCanonicalWorldOptions,
  ): Promise<CanonicalWorldRecoveryOutcome> {
    const { manifest, pinnedAtlas } = await resolvePinnedManifestForExistingWorld({
      type,
      existingWorld,
      persistence: this.persistence,
      snapshotState: snapData.state,
    });

    if (existingWorld.lifecycle === 'ARCHIVED' || existingWorld.admission === 'ARCHIVED') {
      await this.provisioning.unloadWorld(type);
      return buildNonLoadedRecoveryOutcome({
        existingWorld,
        manifest,
        pinnedAtlas,
        lifecycle: this.lifecycle,
        persistence: this.persistence,
        homeRepo: this.homeRepo,
        action: 'archived_kept',
        error: null,
        maxRetries: options.maxRetries,
      });
    }

    const snapValidation = await this.validateAndRestoreSnapshotForExisting(
      type,
      existingWorld,
      manifest,
      pinnedAtlas,
      snapData,
      options,
    );
    if ('heldOutcome' in snapValidation) return snapValidation.heldOutcome;

    return this.executeExistingWorldResume({
      type,
      existingWorld,
      manifest,
      pinnedAtlas,
      restoredState: snapValidation.restoredState,
      options,
    });
  }

  private async validateAndRestoreSnapshotForExisting(
    type: PlanetType,
    existingWorld: CanonicalWorldRecord,
    manifest: AtlasManifestV1,
    pinnedAtlas: PinnedAtlasVersionRecord,
    snapData: { readonly rawBytes: Uint8Array | null; readonly state: PlanetState | null },
    options: RecoverCanonicalWorldOptions,
  ): Promise<
    | { readonly restoredState: PlanetState | null }
    | { readonly heldOutcome: CanonicalWorldRecoveryOutcome }
  > {
    if (!snapData.rawBytes) return { restoredState: snapData.state };
    const compatOpts = {
      flags: options.flags,
      planetId: existingWorld.id,
      expectedAtlasHash: manifest.atlasHash,
      expectedConfigHash: manifest.configHash,
      clientSupportsAtlas: options.clientSupportsAtlas,
    };
    const compat = validateAtlasSaveCompatibility(snapData.rawBytes, compatOpts);
    if (!compat.ok) {
      if (options.throwOnIncompatibleSave) {
        restoreAtlasWorldSnapshot(snapData.rawBytes, compatOpts);
      }
      await this.provisioning.unloadWorld(type);
      const heldOutcome = await buildNonLoadedRecoveryOutcome({
        existingWorld,
        manifest,
        pinnedAtlas,
        lifecycle: this.lifecycle,
        persistence: this.persistence,
        homeRepo: this.homeRepo,
        action: 'held_incompatible_save',
        error: `${compat.code}: ${compat.reason}`,
        maxRetries: options.maxRetries,
      });
      return { heldOutcome };
    }
    return { restoredState: restoreAtlasWorldSnapshot(snapData.rawBytes, compatOpts) };
  }

  private async executeExistingWorldResume(params: {
    readonly type: PlanetType;
    readonly existingWorld: CanonicalWorldRecord;
    readonly manifest: AtlasManifestV1;
    readonly pinnedAtlas: PinnedAtlasVersionRecord;
    readonly restoredState: PlanetState | null;
    readonly options: RecoverCanonicalWorldOptions;
  }): Promise<CanonicalWorldRecoveryOutcome> {
    const { type, existingWorld, manifest, pinnedAtlas, restoredState, options } = params;
    const wasProvisioning =
      existingWorld.lifecycle === 'PROVISIONING' ||
      existingWorld.health === 'RETRYING' ||
      existingWorld.health === 'LOADING' ||
      existingWorld.health === 'FAULTED';

    const resumeOpts = this.attachSnapshotAwareLoader(
      buildPinnedResumeProvisionOptions(manifest, options),
    );
    const provOutcome = await this.provisioning.provisionCanonicalWorld(type, resumeOpts);

    const { colonies, reservations } = await reconcileCanonicalWorldColoniesAndAdmission({
      planetId: existingWorld.id,
      previousWorld: existingWorld,
      manifest,
      restoredState,
      persistence: this.persistence,
      homeRepo: this.homeRepo,
    });

    const refreshedStatus = await this.lifecycle.getWorldStatus(existingWorld.id);
    const effectiveTick = restoredState
      ? Math.max(provOutcome.tick ?? 0, restoredState.meta.tick)
      : provOutcome.tick;
    const refreshedBase = composeProvisionOutcome({
      ok: provOutcome.ok,
      created: false,
      status: refreshedStatus,
      manifest,
      pinnedAtlas,
      retryCount: provOutcome.retryCount,
      placementAttempts: provOutcome.placementAttempts,
      maxRetries: provOutcome.maxRetries,
      attemptsUsed: provOutcome.attemptsUsed,
      attemptedPlanetIds: provOutcome.attemptedPlanetIds,
      healthHistory: provOutcome.healthHistory,
      loaded: provOutcome.loaded,
      tick: effectiveTick,
      thread: provOutcome.thread,
      error: provOutcome.error,
    });

    return composeRecoveryOutcome({
      base: refreshedBase,
      action: !provOutcome.ok
        ? 'faulted'
        : wasProvisioning
          ? 'resumed_provisioning'
          : 'resumed_active',
      resumed: provOutcome.ok,
      resumedFromProvisioning: wasProvisioning,
      archived: false,
      restoredFromSnapshot: Boolean(restoredState),
      previousLifecycle: existingWorld.lifecycle,
      previousHealth: existingWorld.health,
      previousAdmission: existingWorld.admission,
      colonies,
      reservations,
    });
  }

  private async provisionMissingCanonicalWorld(
    type: PlanetType,
    snapData: { readonly rawBytes: Uint8Array | null; readonly state: PlanetState | null },
    options: RecoverCanonicalWorldOptions,
  ): Promise<CanonicalWorldRecoveryOutcome> {
    const canonical = CANONICAL_PLANETS[type];
    let restoredState: PlanetState | null = snapData.state;
    let snapshotManifest = restoredState ? extractPinnedAtlasManifest(restoredState) : null;

    if (snapData.rawBytes && !restoredState) {
      restoredState = restoreAtlasWorldSnapshot(snapData.rawBytes, {
        flags: options.flags,
        planetId: canonical.id,
        clientSupportsAtlas: options.clientSupportsAtlas,
      });
      snapshotManifest = extractPinnedAtlasManifest(restoredState);
    }

    const provisionOpts: ProvisionCanonicalWorldOptions = this.attachSnapshotAwareLoader(
      snapshotManifest
        ? buildPinnedResumeProvisionOptions(snapshotManifest, options)
        : { ...options, forceReload: options.forceReload ?? true },
    );

    const provOutcome = await this.provisioning.provisionCanonicalWorld(type, provisionOpts);
    const { colonies, reservations } = await reconcileCanonicalWorldColoniesAndAdmission({
      planetId: canonical.id,
      previousWorld: null,
      manifest: provOutcome.manifest,
      restoredState,
      persistence: this.persistence,
      homeRepo: this.homeRepo,
    });

    const refreshedStatus = await this.lifecycle.getWorldStatus(canonical.id);
    const effectiveTick = restoredState
      ? Math.max(provOutcome.tick ?? 0, restoredState.meta.tick)
      : provOutcome.tick;
    const refreshedBase = composeProvisionOutcome({
      ok: provOutcome.ok,
      created: provOutcome.created,
      status: refreshedStatus,
      manifest: provOutcome.manifest,
      pinnedAtlas: provOutcome.pinnedAtlas,
      retryCount: provOutcome.retryCount,
      placementAttempts: provOutcome.placementAttempts,
      maxRetries: provOutcome.maxRetries,
      attemptsUsed: provOutcome.attemptsUsed,
      attemptedPlanetIds: provOutcome.attemptedPlanetIds,
      healthHistory: provOutcome.healthHistory,
      loaded: provOutcome.loaded,
      tick: effectiveTick,
      thread: provOutcome.thread,
      error: provOutcome.error,
    });

    return composeRecoveryOutcome({
      base: refreshedBase,
      action: !provOutcome.ok
        ? 'faulted'
        : snapshotManifest
          ? 'resumed_active'
          : 'provisioned_new',
      resumed: Boolean(provOutcome.ok && snapshotManifest),
      resumedFromProvisioning: false,
      archived: false,
      restoredFromSnapshot: Boolean(restoredState),
      previousLifecycle: null,
      previousHealth: null,
      previousAdmission: null,
      colonies,
      reservations,
    });
  }

  private attachSnapshotAwareLoader(
    options: ProvisionCanonicalWorldOptions,
  ): ProvisionCanonicalWorldOptions {
    if (options.loader || options.simLoader || this.customLoader || !this.snapshots) {
      return options;
    }
    const snapshots = this.snapshots;
    const gamePlanets = this.gamePlanets;
    return {
      ...options,
      loader: async (req) => {
        const outcome = await snapshots.loadHome(req.planetId, {
          params: {
            type: req.type,
            seed: req.seed,
            radius: req.sectorRadius,
            capacity: req.capacity,
          },
        });
        return {
          tick: 0,
          thread: gamePlanets?.threadOf(req.planetId) ?? hashPlanetToSimThread(req.planetId),
          restored: outcome === 'restored',
        };
      },
    };
  }
}
