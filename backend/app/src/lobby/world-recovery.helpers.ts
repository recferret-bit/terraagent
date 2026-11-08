import {
  CANONICAL_PLANETS,
  canonicalPlanetById,
  newId,
  type AtlasManifestV1,
  type LandingSlotId,
  type PlanetType,
  type SectorId,
} from '@terra/contracts';
import {
  devPlanetTypeOf,
  extractPinnedAtlasManifest,
  isAtlasSaveState,
  restoreAtlasWorldSnapshot,
  saveAtlasWorldSnapshot,
  type PlanetState,
} from '@terra/sim';
import type { ColonyRecord, HomeRepository } from '../core/home/home.repository';
import type { SnapshotStore } from '../game/persistence/snapshot-store';
import type { WorldLifecycleService } from './lifecycle.service';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import type {
  CanonicalWorldRecord,
  PinnedAtlasVersionRecord,
  SectorReservationRecord,
} from './lobby-persistence.types';
import {
  buildCanonicalProvisioningManifest,
  composeProvisionOutcome,
  DEFAULT_PROVISION_MAX_RETRIES,
  type ProvisionCanonicalWorldOptions,
} from './provisioning.types';
import {
  composeRecoveryOutcome,
  type CanonicalWorldRecoveryOutcome,
  type CanonicalWorldSnapshotLoaderFn,
  type CanonicalWorldSnapshotProvider,
  type PreservedDevWorldRecord,
  type RecoverCanonicalWorldOptions,
  type SnapshotInputValue,
  type SnapshotMapInput,
} from './world-recovery.types';

export interface ResolvedSnapshotData {
  readonly rawBytes: Uint8Array | null;
  readonly state: PlanetState | null;
}

function readSnapshotFromMap(
  map: SnapshotMapInput | undefined,
  planetId: string,
): SnapshotInputValue | undefined {
  if (!map) return undefined;
  return map instanceof Map
    ? map.get(planetId)
    : (map as Readonly<Record<string, SnapshotInputValue | undefined>>)[planetId];
}

function normalizeSnapshotValue(val: SnapshotInputValue | null | undefined): ResolvedSnapshotData {
  if (!val) return { rawBytes: null, state: null };
  if (val instanceof Uint8Array) return { rawBytes: val, state: null };
  return { rawBytes: saveAtlasWorldSnapshot(val), state: val };
}

export async function resolveSnapshotForPlanet(
  planetId: string,
  options: RecoverCanonicalWorldOptions,
  provider?: CanonicalWorldSnapshotProvider | CanonicalWorldSnapshotLoaderFn,
  snapshotStore?: SnapshotStore,
): Promise<ResolvedSnapshotData> {
  const fromMap = readSnapshotFromMap(options.snapshots, planetId);
  if (fromMap) return normalizeSnapshotValue(fromMap);

  const activeProvider = options.snapshotProvider ?? provider;
  if (typeof activeProvider === 'function') {
    const res = await activeProvider(planetId);
    if (res) return normalizeSnapshotValue(res);
  } else if (activeProvider) {
    if (activeProvider.getSnapshot) {
      const res = await activeProvider.getSnapshot(planetId);
      if (res) return normalizeSnapshotValue(res);
    }
    if (activeProvider.latest) {
      const latest = await activeProvider.latest(planetId);
      if (latest instanceof Uint8Array) return { rawBytes: latest, state: null };
      if (latest && 'raw' in latest && latest.raw instanceof Uint8Array) {
        return { rawBytes: latest.raw, state: null };
      }
    }
  }

  if (snapshotStore) {
    try {
      const loaded = await snapshotStore.latest(planetId);
      if (loaded?.raw) return { rawBytes: loaded.raw, state: null };
    } catch {
      return { rawBytes: null, state: null };
    }
  }
  return { rawBytes: null, state: null };
}

export async function resolvePinnedManifestForExistingWorld(params: {
  readonly type: PlanetType;
  readonly existingWorld: CanonicalWorldRecord;
  readonly persistence: LobbyPersistenceService;
  readonly snapshotState?: PlanetState | null;
}): Promise<{ readonly manifest: AtlasManifestV1; readonly pinnedAtlas: PinnedAtlasVersionRecord }> {
  const { type, existingWorld, persistence, snapshotState } = params;
  const targetVersion = existingWorld.atlasVersion || 1;
  const directPinned = await persistence.getAtlasVersion(existingWorld.id, targetVersion);
  if (directPinned) return { manifest: directPinned.manifest, pinnedAtlas: directPinned };

  const allPinned = await persistence.listAtlasVersions(existingWorld.id);
  if (allPinned.length > 0) {
    const latest = allPinned[allPinned.length - 1]!;
    return { manifest: latest.manifest, pinnedAtlas: latest };
  }

  const fromSnapshot = snapshotState ? extractPinnedAtlasManifest(snapshotState) : null;
  if (fromSnapshot) {
    const saved = await persistence.saveAtlasManifest(fromSnapshot);
    return { manifest: saved.record.manifest, pinnedAtlas: saved.record };
  }

  const existingSectors = await persistence.listSectors(existingWorld.id);
  const landSector = existingSectors.find((s) => s.kind === 'land');
  const foundingSeatsPerSector =
    landSector?.foundingCapacity ??
    (existingWorld.capacity > 0 ? Math.max(1, Math.round(existingWorld.capacity / 7)) : undefined);
  const reconstructed = buildCanonicalProvisioningManifest(type, {
    seed: existingWorld.seed,
    atlasVersion: targetVersion,
    sectorRadius: landSector?.radius,
    foundingSeatsPerSector,
  });
  const saved = await persistence.saveAtlasManifest(reconstructed);
  return { manifest: saved.record.manifest, pinnedAtlas: saved.record };
}

export function buildPinnedResumeProvisionOptions(
  manifest: AtlasManifestV1,
  options: RecoverCanonicalWorldOptions,
): ProvisionCanonicalWorldOptions {
  return {
    maxRetries: options.maxRetries,
    loadTimeoutMs: options.loadTimeoutMs,
    retryDelayMs: options.retryDelayMs,
    actor: options.actor ?? 'system:recovery',
    reason: options.reason ?? `resuming canonical world ${manifest.planetId} with pinned manifest`,
    faultCode: options.faultCode,
    retryFaultCode: options.retryFaultCode,
    throwOnFault: options.throwOnFault,
    forceReload: options.forceReload ?? true,
    atlasVersion: manifest.atlasVersion,
    topologyVersion: manifest.topologyVersion,
    genVersion: manifest.genVersion,
    configVersion: manifest.configVersion,
    sectorRadius: manifest.sectorRadius,
    foundingSeatsPerSector: manifest.foundingSeatsPerSector,
    seed: manifest.seed,
    resourceProfileId: manifest.resourceProfileId,
    manifest,
    loader: options.loader,
    simLoader: options.simLoader,
  };
}

function resolveValidColonyId(rawId: unknown, planetId: string, index: number): string {
  if (typeof rawId === 'string' && rawId.length > 0) {
    if (/^co_[0-9A-HJKMNP-TV-Z]{26}$/.test(rawId) || /^col_[A-Za-z0-9_-]{1,64}$/.test(rawId)) {
      return rawId;
    }
    if (rawId.startsWith('co_')) {
      return `col_${rawId.slice(3)}`;
    }
    return `col_${rawId}`;
  }
  return `col_${planetId}_${index}`;
}

async function syncSnapshotColoniesToHomeRepo(
  planetId: string,
  restoredState: PlanetState,
  homeRepo?: HomeRepository,
): Promise<void> {
  if (!homeRepo) return;
  const existingColonies = await homeRepo.listColoniesByPlanetId(planetId);
  const existingIds = new Set(existingColonies.map((c) => c.id));
  const existingIndices = new Set(existingColonies.map((c) => c.colonyIndex));

  for (const col of restoredState.colonies) {
    if (!col || col.index < 0) continue;
    const colId = resolveValidColonyId(col.id, planetId, col.index);
    if (existingIds.has(colId) || existingIndices.has(col.index)) continue;
    const rawRec = col as unknown as Record<string, unknown>;
    const playerId = typeof rawRec.playerId === 'string' && rawRec.playerId.length > 0 ? rawRec.playerId : `pr_${colId}`;
    const foundingSectorId =
      typeof col.foundingSectorId === 'string' && col.foundingSectorId.length > 0
        ? col.foundingSectorId
        : 'sec_0_0';
    const landingSlotId =
      typeof col.landingSlotId === 'string' && col.landingSlotId.length > 0
        ? col.landingSlotId
        : null;
    await homeRepo.createColony({
      id: colId,
      playerId,
      planetId,
      colonyIndex: col.index,
      name: typeof col.name === 'string' && col.name.length > 0 ? col.name : `Colony ${col.index}`,
      status: col.state === 'eliminated' ? 'ELIMINATED' : 'ACTIVE',
      foundingSectorId,
      landingSlotId,
      spawnQ: typeof rawRec.spawnQ === 'number' ? rawRec.spawnQ : 0,
      spawnR: typeof rawRec.spawnR === 'number' ? rawRec.spawnR : 0,
    });
    existingIds.add(colId);
    existingIndices.add(col.index);
  }
}

async function ensureColonyCommittedInPersistence(params: {
  readonly planetId: string;
  readonly colonyId: string;
  readonly playerId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId | null;
  readonly persistence: LobbyPersistenceService;
  readonly existingReservations: readonly SectorReservationRecord[];
}): Promise<void> {
  const { planetId, colonyId, playerId, sectorId, landingSlotId, persistence, existingReservations } = params;
  const alreadyTracked = existingReservations.some(
    (r) =>
      (r.colonyId === colonyId || (landingSlotId && r.landingSlotId === landingSlotId)) &&
      (r.state === 'COMMITTED' || r.state === 'HELD'),
  );
  if (alreadyTracked) return;
  const sector = await persistence.getSector(planetId, sectorId);
  if (!sector || sector.kind === 'ocean') return;

  const world = await persistence.getCanonicalWorldById(planetId);
  const wasPaused = world?.admission === 'PAUSED';
  if (wasPaused) await persistence.updateCanonicalWorldState({ planetId, admission: 'OPEN' });
  try {
    const reserved = await persistence.reserveSectorSlot({
      planetId,
      sectorId,
      ...(landingSlotId ? { landingSlotId } : {}),
      playerId,
      ticketId: `tk_rec_${colonyId}`,
      colonyId,
      reservationId: `res_rec_${colonyId}`,
    });
    if (reserved.ok) await persistence.commitReservation(reserved.reservation.reservationId);
  } finally {
    if (wasPaused) await persistence.updateCanonicalWorldState({ planetId, admission: 'PAUSED' });
  }
}

export async function reconcileCanonicalWorldColoniesAndAdmission(params: {
  readonly planetId: string;
  readonly previousWorld: CanonicalWorldRecord | null;
  readonly manifest: AtlasManifestV1;
  readonly restoredState: PlanetState | null;
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
}): Promise<{
  readonly colonies: readonly ColonyRecord[];
  readonly reservations: readonly SectorReservationRecord[];
}> {
  const { planetId, previousWorld, manifest, restoredState, persistence, homeRepo } = params;
  if (restoredState) await syncSnapshotColoniesToHomeRepo(planetId, restoredState, homeRepo);

  let reservations = await persistence.listReservations(planetId);
  if (restoredState) {
    for (const col of restoredState.colonies) {
      if (!col || col.index < 0 || typeof col.foundingSectorId !== 'string' || !col.foundingSectorId) continue;
      const colId = resolveValidColonyId(col.id, planetId, col.index);
      const rawRec = col as unknown as Record<string, unknown>;
      const playerId = typeof rawRec.playerId === 'string' && rawRec.playerId.length > 0 ? rawRec.playerId : `pr_${colId}`;
      const slotId = typeof col.landingSlotId === 'string' && col.landingSlotId.length > 0 ? col.landingSlotId : null;
      await ensureColonyCommittedInPersistence({
        planetId,
        colonyId: colId,
        playerId,
        sectorId: col.foundingSectorId,
        landingSlotId: slotId,
        persistence,
        existingReservations: reservations,
      });
      reservations = await persistence.listReservations(planetId);
    }
  }

  for (const col of homeRepo ? await homeRepo.listColoniesByPlanetId(planetId) : []) {
    await ensureColonyCommittedInPersistence({
      planetId,
      colonyId: col.id,
      playerId: col.playerId,
      sectorId: col.foundingSectorId ?? 'sec_0_0',
      landingSlotId: col.landingSlotId ?? null,
      persistence,
      existingReservations: reservations,
    });
    reservations = await persistence.listReservations(planetId);
  }

  if (previousWorld && previousWorld.lifecycle !== 'ARCHIVED') {
    const current = await persistence.getCanonicalWorldById(planetId);
    if (current && current.admission !== previousWorld.admission) {
      await persistence.updateCanonicalWorldState({ planetId, admission: previousWorld.admission });
    }
  }

  if (homeRepo) {
    const canonical = CANONICAL_PLANETS[manifest.planetType];
    const desiredState = (await persistence.getCanonicalWorldById(planetId))?.lifecycle ?? 'ACTIVE';
    const existingPlanet = await homeRepo.findPlanetById(planetId);
    if (!existingPlanet) {
      await homeRepo.upsertDevPlanet(planetId, {
        name: canonical.name,
        type: manifest.planetType,
        seed: manifest.seed,
        state: desiredState,
        capacity: manifest.validatedCapacity,
      });
    } else if (existingPlanet.status !== desiredState) {
      await homeRepo.setPlanetStatus(planetId, desiredState);
    }
  }

  return {
    colonies: homeRepo ? await homeRepo.listColoniesByPlanetId(planetId) : [],
    reservations: await persistence.listReservations(planetId),
  };
}

export async function buildNonLoadedRecoveryOutcome(params: {
  readonly existingWorld: CanonicalWorldRecord;
  readonly manifest: AtlasManifestV1;
  readonly pinnedAtlas: PinnedAtlasVersionRecord;
  readonly lifecycle: WorldLifecycleService;
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
  readonly action: 'archived_kept' | 'held_incompatible_save';
  readonly error: string | null;
  readonly maxRetries?: number;
}): Promise<CanonicalWorldRecoveryOutcome> {
  const { existingWorld, manifest, pinnedAtlas, lifecycle, persistence, homeRepo, action, error } = params;
  if (action === 'archived_kept' && existingWorld.admission !== 'ARCHIVED') {
    await persistence.updateCanonicalWorldState({ planetId: existingWorld.id, admission: 'ARCHIVED' });
  }
  if (homeRepo && action === 'archived_kept') {
    const homePlanet = await homeRepo.findPlanetById(existingWorld.id);
    if (homePlanet && homePlanet.status !== 'ARCHIVED') await homeRepo.setPlanetStatus(existingWorld.id, 'ARCHIVED');
  }
  const status = await lifecycle.getWorldStatus(existingWorld.id);
  const colonies = homeRepo ? await homeRepo.listColoniesByPlanetId(existingWorld.id) : [];
  const reservations = await persistence.listReservations(existingWorld.id);
  const base = composeProvisionOutcome({
    ok: action === 'archived_kept',
    created: false,
    status,
    manifest,
    pinnedAtlas,
    retryCount: existingWorld.retryCount ?? 0,
    placementAttempts: existingWorld.placementAttempts ?? 0,
    maxRetries: params.maxRetries ?? DEFAULT_PROVISION_MAX_RETRIES,
    attemptsUsed: 0,
    attemptedPlanetIds: [],
    healthHistory: [status.health],
    loaded: false,
    tick: null,
    thread: null,
    error,
  });
  return composeRecoveryOutcome({
    base,
    action,
    resumed: false,
    resumedFromProvisioning: false,
    archived: status.lifecycle === 'ARCHIVED',
    restoredFromSnapshot: false,
    previousLifecycle: existingWorld.lifecycle,
    previousHealth: existingWorld.health,
    previousAdmission: existingWorld.admission,
    colonies,
    reservations,
  });
}

async function gatherCandidateDevPlanetIds(
  options: RecoverCanonicalWorldOptions,
  homeRepo?: HomeRepository,
  provider?: CanonicalWorldSnapshotProvider | CanonicalWorldSnapshotLoaderFn,
  snapshotStore?: SnapshotStore,
): Promise<readonly string[]> {
  const ids = new Set<string>();
  if (homeRepo) {
    for (const p of await homeRepo.listPlanets()) if (canonicalPlanetById(p.id) === null) ids.add(p.id);
    for (const c of await homeRepo.listColonies()) if (canonicalPlanetById(c.planetId) === null) ids.add(c.planetId);
  }
  if (options.snapshots) {
    const keys = options.snapshots instanceof Map ? [...options.snapshots.keys()] : Object.keys(options.snapshots);
    for (const id of keys) if (canonicalPlanetById(id) === null) ids.add(id);
  }
  const activeProvider = options.snapshotProvider ?? provider;
  if (activeProvider && typeof activeProvider === 'object' && activeProvider.livePlanetIds) {
    for (const id of await activeProvider.livePlanetIds()) if (canonicalPlanetById(id) === null) ids.add(id);
  }
  if (snapshotStore) {
    try {
      for (const id of await snapshotStore.livePlanetIds()) if (canonicalPlanetById(id) === null) ids.add(id);
    } catch {
      // Ignore unavailable DB during dev planet enumeration
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export async function preserveExistingDevWorlds(params: {
  readonly options: RecoverCanonicalWorldOptions;
  readonly homeRepo?: HomeRepository;
  readonly provider?: CanonicalWorldSnapshotProvider | CanonicalWorldSnapshotLoaderFn;
  readonly snapshotStore?: SnapshotStore;
}): Promise<readonly PreservedDevWorldRecord[]> {
  const { options, homeRepo, provider, snapshotStore } = params;
  const devIds = await gatherCandidateDevPlanetIds(options, homeRepo, provider, snapshotStore);
  const results: PreservedDevWorldRecord[] = [];

  for (const planetId of devIds) {
    const devType = devPlanetTypeOf(planetId);
    const snapData = await resolveSnapshotForPlanet(planetId, options, provider, snapshotStore);
    let restoredState: PlanetState | null = snapData.state;
    let isAtlas = false;
    let restoredTick: number | null = null;
    if (snapData.rawBytes) {
      try {
        restoredState = restoreAtlasWorldSnapshot(snapData.rawBytes, { flags: options.flags, planetId });
        isAtlas = isAtlasSaveState(restoredState);
        restoredTick = restoredState.meta.tick;
      } catch {
        isAtlas = isAtlasSaveState(snapData.rawBytes);
      }
    }
    if (homeRepo && restoredState) {
      if (!(await homeRepo.findPlanetById(planetId))) {
        await homeRepo.upsertDevPlanet(planetId, {
          type: devType ?? restoredState.meta.planetType ?? 'desert',
          seed: String(restoredState.meta.seed ?? 'dev-seed'),
          state: 'ACTIVE',
        });
      }
      await syncSnapshotColoniesToHomeRepo(planetId, restoredState, homeRepo);
    }
    const planetRecord = homeRepo ? await homeRepo.findPlanetById(planetId) : null;
    const colonies = homeRepo ? await homeRepo.listColoniesByPlanetId(planetId) : [];
    const simColonyIds =
      colonies.length === 0 && restoredState
        ? restoredState.colonies
            .filter((c): c is NonNullable<typeof c> => Boolean(c && c.index >= 0))
            .map((c) => (typeof c.id === 'string' && c.id.length > 0 ? c.id : newId('co')))
        : [];
    const colonyIds = colonies.length > 0 ? colonies.map((c) => c.id) : simColonyIds;
    results.push({
      id: planetId,
      planetId,
      name: planetRecord?.name ?? (planetId === 'pl_dev' ? 'Dev Planet' : planetId),
      devPlanetType: devType,
      planetType: planetRecord?.type ?? devType ?? restoredState?.meta?.planetType ?? null,
      seed: planetRecord?.seed ?? (restoredState ? String(restoredState.meta.seed) : null),
      isCanonical: false,
      isAtlasSave: isAtlas,
      legacyCompatibility: !isAtlas,
      preserved: true,
      convertedToCanonical: false,
      wiped: false,
      hasSnapshot: Boolean(snapData.rawBytes),
      restoredTick,
      colonyCount: colonyIds.length,
      colonyIds,
      colonies,
      planetRecord,
    });
  }
  return results;
}
