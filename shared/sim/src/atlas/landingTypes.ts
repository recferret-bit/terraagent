import type { LandingSlotId, SafeLandingSlotV1, SectorId, SectorKind } from '@terra/contracts';
import type { PlanetType } from '../kernel/state';

/** Default minimum global axial hex distance between any two landing slots (intra-sector and cross-sector). */
export const W11_DEFAULT_MIN_SLOT_SEPARATION = 14;

/** Default minimum flat buildable tiles required inside the R4 disk (61 tiles) around a landing slot. */
export const W11_DEFAULT_MIN_BUILDABLE_R4 = 18;

/** Default minimum hex distance from a landing slot center to its starter metals/minerals deposits. */
export const W11_DEFAULT_STARTER_RESOURCE_MIN_DIST = 2;

/** Default maximum hex distance from a landing slot center to its starter metals/minerals deposits. */
export const W11_DEFAULT_STARTER_RESOURCE_MAX_DIST = 6;

export type LandingSiteRejectionReason =
  | 'cross_sector_collision'
  | 'intra_sector_collision'
  | 'insufficient_buildable_ground'
  | 'missing_starter_resources'
  | 'ocean_sector'
  | 'sector_mismatch'
  | 'capacity_unachievable';

export interface LandingSiteValidationIssue {
  readonly reason: LandingSiteRejectionReason;
  readonly message: string;
  readonly sectorId?: SectorId;
  readonly otherSectorId?: SectorId;
  readonly slotId?: LandingSlotId;
  readonly otherSlotId?: LandingSlotId;
  readonly q?: number;
  readonly r?: number;
  readonly otherQ?: number;
  readonly otherR?: number;
  readonly distance?: number;
  readonly minRequiredDistance?: number;
  readonly buildableR4Count?: number;
  readonly minRequiredBuildableR4?: number;
  readonly missingResources?: readonly ('metals' | 'minerals')[];
  readonly requestedCapacity?: number;
  readonly achievedCapacity?: number;
}

export interface StarterResourceDepositRef {
  readonly q: number;
  readonly r: number;
  readonly sectorId: SectorId;
  readonly distance: number;
  readonly richness: number;
}

export interface ValidatedLandingSlotDetail extends SafeLandingSlotV1 {
  readonly localQ: number;
  readonly localR: number;
  readonly localDistance: number;
  readonly padFlatR1: boolean;
  readonly buildableR4Count: number;
  readonly buildableHexTileR4Count: number;
  readonly metalsTile: StarterResourceDepositRef | null;
  readonly mineralsTile: StarterResourceDepositRef | null;
  readonly crossSectorResourceAccess: boolean;
  readonly nearestSlotId: LandingSlotId | null;
  readonly nearestSlotSectorId: SectorId | null;
  readonly nearestSlotDistance: number | null;
}

export interface SectorLandingValidationSummary {
  readonly sectorId: SectorId;
  readonly kind: SectorKind;
  readonly foundingCapacity: number;
  readonly validatedSafeSites: number;
  readonly safeLandingSlots: readonly SafeLandingSlotV1[];
  readonly slotDetails: readonly ValidatedLandingSlotDetail[];
  readonly ok: boolean;
  readonly reason?: LandingSiteRejectionReason;
  readonly issues: readonly LandingSiteValidationIssue[];
}

export interface ValidateAtlasLandingSitesOptions {
  readonly minSlotSeparation?: number;
  readonly minBuildableR4?: number;
  readonly starterResourceMinDist?: number;
  readonly starterResourceMaxDist?: number;
  readonly foundingSeatsPerSector?: number;
  readonly sectorCapacities?: Readonly<Record<SectorId, number>> | ReadonlyMap<SectorId, number>;
  readonly slots?: readonly SafeLandingSlotV1[];
  readonly sectorSlots?:
    | Readonly<Record<SectorId, readonly SafeLandingSlotV1[]>>
    | ReadonlyMap<SectorId, readonly SafeLandingSlotV1[]>;
}

export interface AtlasLandingValidationReport {
  readonly ok: boolean;
  readonly reason?: LandingSiteRejectionReason;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly seed: string;
  readonly sectorRadius: number;
  readonly foundingSeatsPerSector: number;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly minSlotSeparation: number;
  readonly minBuildableR4: number;
  readonly minObservedSeparation: number | null;
  readonly minObservedCrossSectorSeparation: number | null;
  readonly minObservedIntraSectorSeparation: number | null;
  readonly safeLandingSlots: readonly SafeLandingSlotV1[];
  readonly slotDetails: readonly ValidatedLandingSlotDetail[];
  readonly sectors: readonly SectorLandingValidationSummary[];
  readonly issues: readonly LandingSiteValidationIssue[];
}

export interface PlanSectorLandingSitesOptions {
  readonly sectorId: SectorId;
  readonly kind?: SectorKind;
  readonly macroQ?: number;
  readonly macroR?: number;
  readonly sectorRadius?: number;
  readonly foundingCapacity: number;
  readonly seed?: string;
  readonly minSlotSeparation?: number;
  readonly existingSlots?: readonly SafeLandingSlotV1[];
  readonly hasLandNeighborSec10?: boolean;
}

export type PlanSectorLandingSitesResult =
  | {
      readonly ok: true;
      readonly sectorId: SectorId;
      readonly kind: SectorKind;
      readonly foundingCapacity: number;
      readonly validatedSafeSites: number;
      readonly safeLandingSlots: readonly SafeLandingSlotV1[];
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly reason: LandingSiteRejectionReason;
      readonly sectorId: SectorId;
      readonly kind: SectorKind;
      readonly foundingCapacity: number;
      readonly validatedSafeSites: number;
      readonly safeLandingSlots: readonly SafeLandingSlotV1[];
      readonly issues: readonly LandingSiteValidationIssue[];
    };

export interface SeedCorpusValidationOptions {
  readonly capacities?: readonly number[];
  readonly planetTypes?: readonly PlanetType[];
  readonly seeds?: readonly string[];
  readonly sectorRadius?: number;
  readonly minSlotSeparation?: number;
  readonly minBuildableR4?: number;
}

export interface SeedCorpusEntryReport {
  readonly planetType: PlanetType;
  readonly seed: string;
  readonly foundingSeatsPerSector: number;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly validation: AtlasLandingValidationReport;
}

export interface SeedCorpusValidationReport {
  readonly ok: boolean;
  readonly reason?: LandingSiteRejectionReason;
  readonly totalRuns: number;
  readonly passedRuns: number;
  readonly failedRuns: number;
  readonly capacities: readonly number[];
  readonly planetTypes: readonly PlanetType[];
  readonly minObservedSeparation: number | null;
  readonly minObservedCrossSectorSeparation: number | null;
  readonly minObservedIntraSectorSeparation: number | null;
  readonly entries: readonly SeedCorpusEntryReport[];
  readonly failures: readonly SeedCorpusEntryReport[];
}

export interface AtlasSamplerLandingPlan {
  readonly foundingSeatsPerSector: number;
  readonly slotsBySectorId: ReadonlyMap<SectorId, readonly SafeLandingSlotV1[]>;
  readonly allSlots: readonly SafeLandingSlotV1[];
  readonly flatOverrideCoords: ReadonlySet<number>;
  readonly starterDepositsByCoord: ReadonlyMap<number, number>;
  readonly suppressedDepositCoords: ReadonlySet<number>;
}
