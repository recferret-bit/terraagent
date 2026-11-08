import { createHash } from 'node:crypto';
import {
  AtlasManifestV1Schema,
  CANONICAL_PLANETS,
  type AtlasManifestV1,
  type PlanetLook,
  type PlanetType,
  type WorldAdmissionState,
  type WorldAvailability,
  type WorldHealthState,
  type WorldLifecycleState,
} from '@terra/contracts';
import { buildAtlasManifest, buildDefaultAtlasConfig } from '@terra/sim';
import type { GamePlanets } from '../game/game-planets.service';
import type { SnapshotService } from '../game/persistence/snapshot.service';
import type { SectorStatusSnapshot, WorldStatusSnapshot } from './lifecycle.types';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type PinnedAtlasVersionRecord,
} from './lobby-persistence.types';

export const CANONICAL_WORLD_SIM_LOADER = Symbol('CANONICAL_WORLD_SIM_LOADER');

export const DEFAULT_PROVISION_MAX_RETRIES = 3;
export const DEFAULT_PROVISION_LOAD_TIMEOUT_MS = 10_000;
export const DEFAULT_PROVISION_RETRY_FAULT_CODE = 'provision_load_retrying';
export const DEFAULT_PROVISION_FAILED_FAULT_CODE = 'provision_load_failed';
export const DEFAULT_PROVISION_TIMEOUT_FAULT_CODE = 'provision_load_timeout';

export class ProvisionLoadTimeoutError extends Error {
  readonly code = DEFAULT_PROVISION_TIMEOUT_FAULT_CODE;
  readonly planetId: string;
  readonly timeoutMs: number;

  constructor(planetId: string, timeoutMs: number) {
    super(`sim-thread load timed out after ${timeoutMs}ms for canonical planet "${planetId}"`);
    this.name = 'ProvisionLoadTimeoutError';
    this.planetId = planetId;
    this.timeoutMs = timeoutMs;
  }
}

export interface CanonicalWorldLoadRequest {
  readonly planetId: string;
  readonly type: PlanetType;
  readonly look: PlanetLook;
  readonly name: string;
  readonly seed: string;
  readonly atlasVersion: number;
  readonly atlasHash: string;
  readonly configHash: string;
  readonly capacity: number;
  readonly sectorRadius: number;
  readonly manifest: AtlasManifestV1;
  readonly attempt: number;
  readonly maxRetries: number;
}

export interface CanonicalWorldLoadResult {
  readonly tick: number;
  readonly thread?: number;
  readonly restored?: boolean;
}

export type CanonicalWorldLoaderFn = (
  request: CanonicalWorldLoadRequest,
) => Promise<CanonicalWorldLoadResult | number | void> | CanonicalWorldLoadResult | number | void;

export interface CanonicalWorldSimLoader {
  loadWorld?(
    request: CanonicalWorldLoadRequest,
  ): Promise<CanonicalWorldLoadResult | number | void> | CanonicalWorldLoadResult | number | void;
  load?(planetId: string, opts?: Record<string, unknown>): Promise<number | void>;
  loadNew?(planetId: string, opts?: Record<string, unknown>): Promise<void>;
  ensureLoaded?(planetId: string, opts?: Record<string, unknown>): Promise<number>;
  isWorldLoaded?(planetId: string): boolean;
  isLoaded?(planetId: string): boolean;
  threadOf?(planetId: string): number;
  loadedPlanetIds?(): readonly string[];
  loadedIds?(): readonly string[];
  unloadWorld?(planetId: string): Promise<void> | void;
}

export interface ProvisionCanonicalWorldOptions {
  readonly maxRetries?: number;
  readonly loadTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly actor?: string;
  readonly reason?: string;
  readonly faultCode?: string;
  readonly retryFaultCode?: string;
  readonly throwOnFault?: boolean;
  readonly forceReload?: boolean;
  readonly atlasVersion?: number;
  readonly topologyVersion?: number;
  readonly genVersion?: number;
  readonly configVersion?: number;
  readonly sectorRadius?: number;
  readonly foundingSeatsPerSector?: number;
  readonly seed?: string;
  readonly resourceProfileId?: string;
  readonly manifest?: AtlasManifestV1;
  readonly loader?: CanonicalWorldSimLoader | CanonicalWorldLoaderFn;
  readonly simLoader?: CanonicalWorldSimLoader | CanonicalWorldLoaderFn;
}

export interface ProvisionAllCanonicalWorldsOptions extends ProvisionCanonicalWorldOptions {
  readonly types?: readonly PlanetType[];
}

export interface CanonicalWorldProvisionOutcome {
  readonly ok: boolean;
  readonly created: boolean;
  readonly planetId: string;
  readonly id: string;
  readonly type: PlanetType;
  readonly look: PlanetLook;
  readonly name: string;
  readonly seed: string;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly availability: WorldAvailability;
  readonly faultCode: string | null;
  readonly error: string | null;
  readonly retryCount: number;
  readonly placementAttempts: number;
  readonly maxRetries: number;
  readonly attemptsUsed: number;
  readonly attemptedPlanetIds: readonly string[];
  readonly healthHistory: readonly WorldHealthState[];
  readonly loaded: boolean;
  readonly tick: number | null;
  readonly thread: number | null;
  readonly world: CanonicalWorldRecord;
  readonly status: WorldStatusSnapshot;
  readonly manifest: AtlasManifestV1;
  readonly pinnedAtlas: PinnedAtlasVersionRecord;
  readonly sectors: readonly SectorStatusSnapshot[];
}

export type ProvisionAllCanonicalWorldsResult = readonly CanonicalWorldProvisionOutcome[] & {
  readonly worlds: readonly CanonicalWorldProvisionOutcome[];
  readonly byType: Readonly<Partial<Record<PlanetType, CanonicalWorldProvisionOutcome>>>;
  readonly active: readonly CanonicalWorldProvisionOutcome[];
  readonly faulted: readonly CanonicalWorldProvisionOutcome[];
  readonly allOk: boolean;
};

export interface CanonicalWorldProvisionState {
  readonly planetId: string;
  readonly type: PlanetType;
  readonly loaded: boolean;
  readonly tick: number | null;
  readonly thread: number;
  readonly retryCount: number;
  readonly placementAttempts: number;
  readonly maxRetries: number;
  readonly lastFaultCode: string | null;
  readonly lastError: string | null;
  readonly attemptedPlanetIds: readonly string[];
  readonly healthHistory: readonly WorldHealthState[];
}

export interface InternalWorldTrackState {
  planetId: string;
  type: PlanetType;
  loaded: boolean;
  tick: number | null;
  thread: number;
  retryCount: number;
  placementAttempts: number;
  maxRetries: number;
  lastFaultCode: string | null;
  lastError: string | null;
  attemptedPlanetIds: string[];
  healthHistory: WorldHealthState[];
}

export function hashPlanetToSimThread(planetId: string, simThreads = 3): number {
  const count = Math.max(1, Math.floor(simThreads));
  const digest = createHash('sha256').update(planetId).digest();
  return digest.readUInt32BE(0) % count;
}

export function extractFaultCodeFromError(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim().length > 0) return code.trim();
  }
  return fallback;
}

export function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildCanonicalProvisioningManifest(
  type: PlanetType,
  options: ProvisionCanonicalWorldOptions = {},
): AtlasManifestV1 {
  const canonical = CANONICAL_PLANETS[type];
  if (options.manifest) {
    const parsed = AtlasManifestV1Schema.parse(options.manifest);
    if (parsed.planetType !== type || parsed.planetId !== canonical.id) {
      throw new LobbyPersistenceConflictError(
        'canonical_type_conflict',
        `manifest (${parsed.planetId}, ${parsed.planetType}) does not match canonical world (${canonical.id}, ${type})`,
        { expectedPlanetId: canonical.id, actualPlanetId: parsed.planetId, type },
      );
    }
    return parsed;
  }
  const config = buildDefaultAtlasConfig({
    planetId: canonical.id,
    planetType: type,
    seed: options.seed ?? canonical.seed,
    topologyVersion: options.topologyVersion,
    genVersion: options.genVersion,
    configVersion: options.configVersion,
    sectorRadius: options.sectorRadius,
    foundingSeatsPerSector: options.foundingSeatsPerSector,
    resourceProfileId: options.resourceProfileId,
  });
  return buildAtlasManifest(config, {
    atlasVersion: options.atlasVersion ?? 1,
    resourceProfileId: options.resourceProfileId,
  });
}

export function composeProvisionOutcome(params: {
  readonly ok: boolean;
  readonly created: boolean;
  readonly status: WorldStatusSnapshot;
  readonly manifest: AtlasManifestV1;
  readonly pinnedAtlas: PinnedAtlasVersionRecord;
  readonly retryCount: number;
  readonly placementAttempts: number;
  readonly maxRetries: number;
  readonly attemptsUsed: number;
  readonly attemptedPlanetIds: readonly string[];
  readonly healthHistory: readonly WorldHealthState[];
  readonly loaded: boolean;
  readonly tick: number | null;
  readonly thread: number | null;
  readonly error: string | null;
}): CanonicalWorldProvisionOutcome {
  const { status } = params;
  return {
    ok: params.ok,
    created: params.created,
    planetId: status.id,
    id: status.id,
    type: status.type,
    look: status.look,
    name: status.name,
    seed: status.seed,
    lifecycle: status.lifecycle,
    health: status.health,
    admission: status.admission,
    availability: status.availability,
    faultCode: status.faultCode,
    error: params.error,
    retryCount: params.retryCount,
    placementAttempts: params.placementAttempts,
    maxRetries: params.maxRetries,
    attemptsUsed: params.attemptsUsed,
    attemptedPlanetIds: [...params.attemptedPlanetIds],
    healthHistory: [...params.healthHistory],
    loaded: params.loaded,
    tick: params.tick,
    thread: params.thread,
    world: status.world,
    status,
    manifest: params.manifest,
    pinnedAtlas: params.pinnedAtlas,
    sectors: status.sectors,
  };
}

export function toAllCanonicalWorldsResult(
  outcomes: readonly CanonicalWorldProvisionOutcome[],
): ProvisionAllCanonicalWorldsResult {
  const byType: Partial<Record<PlanetType, CanonicalWorldProvisionOutcome>> = {};
  for (const o of outcomes) byType[o.type] = o;
  const active = outcomes.filter((o) => o.ok && o.lifecycle === 'ACTIVE' && o.health === 'OK');
  const faulted = outcomes.filter((o) => !o.ok || o.health === 'FAULTED');
  return Object.assign([...outcomes], {
    worlds: outcomes,
    byType,
    active,
    faulted,
    allOk: faulted.length === 0 && active.length === outcomes.length,
  });
}

export class DefaultCanonicalWorldSimLoader implements CanonicalWorldSimLoader {
  private readonly loadedPlanets = new Map<
    string,
    { readonly tick: number; readonly thread: number; readonly atlasHash: string }
  >();

  constructor(private readonly simThreads = 3) {}

  threadOf(planetId: string): number {
    return hashPlanetToSimThread(planetId, this.simThreads);
  }
  isWorldLoaded(planetId: string): boolean {
    return this.loadedPlanets.has(planetId);
  }
  isLoaded(planetId: string): boolean {
    return this.loadedPlanets.has(planetId);
  }
  loadedPlanetIds(): readonly string[] {
    return [...this.loadedPlanets.keys()];
  }
  loadedIds(): readonly string[] {
    return [...this.loadedPlanets.keys()];
  }
  unloadWorld(planetId: string): void {
    this.loadedPlanets.delete(planetId);
  }
  clear(): void {
    this.loadedPlanets.clear();
  }

  async loadWorld(request: CanonicalWorldLoadRequest): Promise<CanonicalWorldLoadResult> {
    const existing = this.loadedPlanets.get(request.planetId);
    const thread = this.threadOf(request.planetId);
    const tick = existing?.tick ?? 0;
    this.loadedPlanets.set(request.planetId, { tick, thread, atlasHash: request.atlasHash });
    return { tick, thread, restored: Boolean(existing) };
  }
}

export async function runCanonicalSimLoaderWithTimeout(params: {
  readonly request: CanonicalWorldLoadRequest;
  readonly options: ProvisionCanonicalWorldOptions;
  readonly customLoader?: CanonicalWorldSimLoader | CanonicalWorldLoaderFn;
  readonly snapshots?: SnapshotService;
  readonly gamePlanets?: GamePlanets;
  readonly defaultLoader: DefaultCanonicalWorldSimLoader;
}): Promise<CanonicalWorldLoadResult> {
  const { request, options, defaultLoader } = params;
  const timeoutMs = Math.max(10, options.loadTimeoutMs ?? DEFAULT_PROVISION_LOAD_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProvisionLoadTimeoutError(request.planetId, timeoutMs)), timeoutMs);
  });

  try {
    const raw = await Promise.race([invokeActiveSimLoader(params), timeoutPromise]);
    await defaultLoader.loadWorld(request);
    if (typeof raw === 'number') {
      return { tick: raw, thread: hashPlanetToSimThread(request.planetId) };
    }
    if (typeof raw === 'object' && raw !== null && 'tick' in raw) {
      return {
        tick: raw.tick,
        thread: raw.thread ?? hashPlanetToSimThread(request.planetId),
        restored: raw.restored,
      };
    }
    return { tick: 0, thread: hashPlanetToSimThread(request.planetId) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function invokeActiveSimLoader(params: {
  readonly request: CanonicalWorldLoadRequest;
  readonly options: ProvisionCanonicalWorldOptions;
  readonly customLoader?: CanonicalWorldSimLoader | CanonicalWorldLoaderFn;
  readonly snapshots?: SnapshotService;
  readonly gamePlanets?: GamePlanets;
  readonly defaultLoader: DefaultCanonicalWorldSimLoader;
}): Promise<CanonicalWorldLoadResult | number | void> {
  const { request, options, customLoader, snapshots, gamePlanets, defaultLoader } = params;
  const activeLoader = options.loader ?? options.simLoader ?? customLoader;
  if (typeof activeLoader === 'function') return activeLoader(request);
  const loadParams = {
    params: {
      type: request.type,
      seed: request.seed,
      radius: request.sectorRadius,
      capacity: request.capacity,
    },
  };
  if (activeLoader) {
    if (activeLoader.loadWorld) return activeLoader.loadWorld(request);
    if (activeLoader.loadNew) return activeLoader.loadNew(request.planetId, loadParams);
    if (activeLoader.ensureLoaded) return activeLoader.ensureLoaded(request.planetId, loadParams);
    if (activeLoader.load) return activeLoader.load(request.planetId, loadParams);
  }
  if (snapshots) {
    await snapshots.loadNew(request.planetId, loadParams);
    return { tick: 0, thread: gamePlanets?.threadOf(request.planetId) ?? hashPlanetToSimThread(request.planetId) };
  }
  if (gamePlanets) {
    const tick = await gamePlanets.ensureLoaded(request.planetId, loadParams);
    return { tick, thread: gamePlanets.threadOf(request.planetId) };
  }
  return defaultLoader.loadWorld(request);
}
