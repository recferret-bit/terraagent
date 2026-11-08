import type {
  AtlasManifestV1,
  PlanetLook,
  PlanetType,
  WorldAdmissionState,
  WorldAvailability,
  WorldHealthState,
  WorldLifecycleState,
} from '@terra/contracts';
import { IncompatibleAtlasSaveError, type PlanetState, type WaveFlagsInput } from '@terra/sim';
export { IncompatibleAtlasSaveError };
import type { ColonyRecord, PlanetRecord } from '../core/home/home.store';
import type { SectorStatusSnapshot, WorldStatusSnapshot } from './lifecycle.types';
import type {
  CanonicalWorldRecord,
  PinnedAtlasVersionRecord,
  SectorReservationRecord,
} from './lobby-persistence.types';
import type {
  CanonicalWorldProvisionOutcome,
  ProvisionAllCanonicalWorldsOptions,
  ProvisionCanonicalWorldOptions,
} from './provisioning.types';

export const CANONICAL_WORLD_SNAPSHOT_PROVIDER = Symbol('CANONICAL_WORLD_SNAPSHOT_PROVIDER');

export type SnapshotInputValue = Uint8Array | PlanetState;

export type SnapshotMapInput =
  | Readonly<Record<string, SnapshotInputValue | undefined>>
  | ReadonlyMap<string, SnapshotInputValue>;

export type CanonicalWorldSnapshotLoaderFn = (
  planetId: string,
) => Promise<SnapshotInputValue | null | undefined> | SnapshotInputValue | null | undefined;

export interface CanonicalWorldSnapshotProvider {
  getSnapshot?(
    planetId: string,
  ): Promise<SnapshotInputValue | null | undefined> | SnapshotInputValue | null | undefined;
  latest?(
    planetId: string,
  ):
    | Promise<{ readonly raw: Uint8Array; readonly tick?: number } | Uint8Array | null | undefined>
    | { readonly raw: Uint8Array; readonly tick?: number }
    | Uint8Array
    | null
    | undefined;
  livePlanetIds?(): Promise<readonly string[]> | readonly string[];
}

export type CanonicalWorldRecoveryAction =
  | 'resumed_active'
  | 'resumed_provisioning'
  | 'provisioned_new'
  | 'archived_kept'
  | 'held_incompatible_save'
  | 'faulted';

export interface RecoverCanonicalWorldOptions extends ProvisionCanonicalWorldOptions {
  readonly snapshots?: SnapshotMapInput;
  readonly snapshotProvider?: CanonicalWorldSnapshotProvider | CanonicalWorldSnapshotLoaderFn;
  readonly flags?: WaveFlagsInput;
  readonly clientSupportsAtlas?: boolean;
  readonly throwOnIncompatibleSave?: boolean;
}

export interface RecoverCanonicalWorldsOptions
  extends ProvisionAllCanonicalWorldsOptions,
    RecoverCanonicalWorldOptions {}

export interface PreservedDevWorldRecord {
  readonly id: string;
  readonly planetId: string;
  readonly name: string;
  readonly devPlanetType: PlanetType | null;
  readonly planetType: PlanetType | null;
  readonly seed: string | null;
  readonly isCanonical: false;
  readonly isAtlasSave: boolean;
  readonly legacyCompatibility: boolean;
  readonly preserved: true;
  readonly convertedToCanonical: false;
  readonly wiped: false;
  readonly hasSnapshot: boolean;
  readonly restoredTick: number | null;
  readonly colonyCount: number;
  readonly colonyIds: readonly string[];
  readonly colonies: readonly ColonyRecord[];
  readonly planetRecord: PlanetRecord | null;
}

export interface CanonicalWorldRecoveryOutcome extends CanonicalWorldProvisionOutcome {
  readonly action: CanonicalWorldRecoveryAction;
  readonly resumed: boolean;
  readonly resumedFromProvisioning: boolean;
  readonly archived: boolean;
  readonly restoredFromSnapshot: boolean;
  readonly previousLifecycle: WorldLifecycleState | null;
  readonly previousHealth: WorldHealthState | null;
  readonly previousAdmission: WorldAdmissionState | null;
  readonly colonies: readonly ColonyRecord[];
  readonly reservations: readonly SectorReservationRecord[];
  readonly foundedSeats: number;
  readonly reservedSeats: number;
  readonly freeSeats: number;
  readonly validatedCapacity: number;
  readonly atlasHash: string;
  readonly configHash: string;
  readonly resourceProfileHash: string;
}

export type RecoverCanonicalWorldsReport = readonly CanonicalWorldRecoveryOutcome[] & {
  readonly worlds: readonly CanonicalWorldRecoveryOutcome[];
  readonly byType: Readonly<Partial<Record<PlanetType, CanonicalWorldRecoveryOutcome>>>;
  readonly byId: Readonly<Record<string, CanonicalWorldRecoveryOutcome>>;
  readonly planetIds: readonly string[];
  readonly active: readonly CanonicalWorldRecoveryOutcome[];
  readonly resumed: readonly CanonicalWorldRecoveryOutcome[];
  readonly provisioned: readonly CanonicalWorldRecoveryOutcome[];
  readonly archived: readonly CanonicalWorldRecoveryOutcome[];
  readonly faulted: readonly CanonicalWorldRecoveryOutcome[];
  readonly held: readonly CanonicalWorldRecoveryOutcome[];
  readonly allOk: boolean;
  readonly preservedDevPlanetIds: readonly string[];
  readonly separateDevWorlds: readonly PreservedDevWorldRecord[];
  readonly preservedDevWorlds: readonly PreservedDevWorldRecord[];
  readonly devWorlds: readonly PreservedDevWorldRecord[];
};

export interface ComposeRecoveryOutcomeParams {
  readonly base: CanonicalWorldProvisionOutcome;
  readonly action: CanonicalWorldRecoveryAction;
  readonly resumed: boolean;
  readonly resumedFromProvisioning: boolean;
  readonly archived: boolean;
  readonly restoredFromSnapshot: boolean;
  readonly previousLifecycle: WorldLifecycleState | null;
  readonly previousHealth: WorldHealthState | null;
  readonly previousAdmission: WorldAdmissionState | null;
  readonly colonies: readonly ColonyRecord[];
  readonly reservations: readonly SectorReservationRecord[];
}

export function composeRecoveryOutcome(
  params: ComposeRecoveryOutcomeParams,
): CanonicalWorldRecoveryOutcome {
  const { base, colonies, reservations } = params;
  return {
    ...base,
    action: params.action,
    resumed: params.resumed,
    resumedFromProvisioning: params.resumedFromProvisioning,
    archived: params.archived,
    restoredFromSnapshot: params.restoredFromSnapshot,
    previousLifecycle: params.previousLifecycle,
    previousHealth: params.previousHealth,
    previousAdmission: params.previousAdmission,
    colonies: [...colonies],
    reservations: [...reservations],
    foundedSeats: base.status.foundedSeats,
    reservedSeats: base.status.reservedSeats,
    freeSeats: base.status.freeSeats,
    validatedCapacity: base.status.validatedCapacity,
    atlasHash: base.manifest.atlasHash,
    configHash: base.manifest.configHash,
    resourceProfileHash: base.manifest.resourceProfileHash,
  };
}

export function toRecoverCanonicalWorldsReport(
  outcomes: readonly CanonicalWorldRecoveryOutcome[],
  devWorlds: readonly PreservedDevWorldRecord[],
): RecoverCanonicalWorldsReport {
  const byType: Partial<Record<PlanetType, CanonicalWorldRecoveryOutcome>> = {};
  const byId: Record<string, CanonicalWorldRecoveryOutcome> = {};
  for (const outcome of outcomes) {
    byType[outcome.type] = outcome;
    byId[outcome.planetId] = outcome;
  }
  const active = outcomes.filter((o) => o.ok && o.lifecycle === 'ACTIVE' && o.health === 'OK');
  const resumed = outcomes.filter((o) => o.resumed);
  const provisioned = outcomes.filter((o) => o.action === 'provisioned_new');
  const archived = outcomes.filter((o) => o.archived || o.lifecycle === 'ARCHIVED');
  const faulted = outcomes.filter((o) => !o.ok || o.health === 'FAULTED');
  const held = outcomes.filter((o) => o.action === 'held_incompatible_save');
  const preservedDevPlanetIds = devWorlds.map((d) => d.planetId);

  return Object.assign([...outcomes], {
    worlds: outcomes,
    byType,
    byId,
    planetIds: outcomes.map((o) => o.planetId),
    active,
    resumed,
    provisioned,
    archived,
    faulted,
    held,
    allOk: faulted.length === 0 && held.length === 0,
    preservedDevPlanetIds,
    separateDevWorlds: devWorlds,
    preservedDevWorlds: devWorlds,
    devWorlds,
  });
}

export type {
  AtlasManifestV1,
  CanonicalWorldRecord,
  PinnedAtlasVersionRecord,
  PlanetLook,
  PlanetType,
  SectorReservationRecord,
  SectorStatusSnapshot,
  WorldAdmissionState,
  WorldAvailability,
  WorldHealthState,
  WorldLifecycleState,
  WorldStatusSnapshot,
};
