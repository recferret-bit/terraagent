import type { RejectCode, SectorId } from '@terra/contracts';

export type AntiCheatTransport = 'http' | 'ws';

export type AntiCheatCategory =
  | 'join'
  | 'base'
  | 'terraform'
  | 'attack'
  | 'units'
  | 'economy'
  | 'diplomacy'
  | 'goal'
  | 'ownership';

export interface ColonyBaseBinding {
  readonly playerId: string;
  readonly colonyId: string;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly name?: string;
  readonly baseSectorId: SectorId;
  readonly baseQ: number;
  readonly baseR: number;
  readonly status: 'ACTIVE' | 'ELIMINATED' | 'ENDED';
  readonly terminalFromLive?: boolean;
  readonly isRivalAi?: boolean;
  readonly bindingHash: string;
  readonly updatedAtMs: number;
}

export interface BountySpatialRecord {
  readonly bountyId: string;
  readonly posterColonyIndex: number;
  readonly posterColonyId?: string;
  readonly targetKind: string;
  readonly sectorId?: SectorId;
}

export interface DiplomacyOfferSpatialRecord {
  readonly offerId: string;
  readonly fromColonyIndex: number;
  readonly toColonyIndex: number;
}

export interface DiplomacyTruceSpatialRecord {
  readonly truceId: string;
  readonly colonyAIndex: number;
  readonly colonyBIndex: number;
}

export interface DiplomacyWarSpatialRecord {
  readonly warId: string;
  readonly attackerColonyIndex: number;
  readonly defenderColonyIndex: number;
}

export interface EntitySpatialRecord {
  readonly entityId: number;
  readonly ownerColonyIndex: number;
  readonly kind: number;
  readonly q: number;
  readonly r: number;
  readonly sectorId: SectorId;
  readonly alive: boolean;
}

export interface RivalAnchorRecord {
  readonly colonyIndex: number;
  readonly anchorQ: number;
  readonly anchorR: number;
}

export interface PlanetSpatialState {
  readonly planetId: string;
  planetRadius: number;
  sectorRadius: number;
  /** True when the live sim grid spans multiple sectors (`planetRadius > sectorRadius` with atlas sectors). */
  hasMultiSectorGrid: boolean;
  crossSectorEnabled: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED' | 'ARCHIVED';
  capacity: number;
  nextEntityId: number;
  maxEntityId: number;
  readonly knownSectorIds: Set<SectorId>;
  readonly landSectorIds: Set<SectorId>;
  readonly entitiesById: Map<number, EntitySpatialRecord>;
  readonly bountiesById: Map<string, BountySpatialRecord>;
  readonly diplomacyOffersById: Map<string, DiplomacyOfferSpatialRecord>;
  readonly diplomacyTrucesById: Map<string, DiplomacyTruceSpatialRecord>;
  readonly diplomacyWarsById: Map<string, DiplomacyWarSpatialRecord>;
  readonly tileOwnerByPackedCoord: Map<number, number>;
  readonly rivalColonyIndices: Set<number>;
  rivalAnchors: readonly RivalAnchorRecord[];
  syncedFromSim?: boolean;
  stateHash: string;
}

export interface SectorSpaceEntry {
  readonly planetId: string;
  readonly sectorId: SectorId;
  kind: 'land' | 'ocean';
  capacity: number;
  reservedSeats: number;
  untrackedFoundedSeats: number;
  foundedSeats: number;
  readonly foundedColonyIds: Set<string>;
  freeSeats: number;
  spaceHash: string;
}

export type JoinRejectReason =
  | 'not_your_planet'
  | 'not_your_colony'
  | 'not_your_sector'
  | 'sector_full'
  | 'sector_not_land'
  | 'invalid_sector'
  | 'planet_unavailable'
  | 'colony_inactive';

export type JoinSectorVerdict =
  | {
      readonly ok: true;
      readonly planetId: string;
      readonly sectorId: SectorId;
      readonly colonyId: string | null;
      readonly colonyIndex?: number;
      readonly bindingHash?: string;
    }
  | {
      readonly ok: false;
      readonly reason: JoinRejectReason;
      readonly httpStatus: number;
      readonly errorCode: string;
      readonly detail: string;
      readonly expectedPlanetId?: string;
      readonly expectedSectorId?: SectorId;
    };

export interface ValidateCommandInputContext {
  readonly transport: AntiCheatTransport;
  readonly playerId: string;
  readonly planetId: string;
  readonly sectorId?: string;
  readonly bindingHash?: string;
  readonly colony: {
    readonly id: string;
    readonly colonyIndex: number;
    readonly planetId?: string;
    readonly foundingSectorId?: string;
    readonly spawnQ?: number;
    readonly spawnR?: number;
    readonly status?: string;
    readonly state?: string;
  } | null;
  readonly kind: string;
  readonly args: unknown;
  readonly rawArgs?: unknown;
  readonly dev?: boolean;
  readonly production?: boolean;
  readonly isScenarioPlanet?: boolean;
}

export type InputValidationVerdict =
  | {
      readonly ok: true;
      readonly bindingHash?: string;
    }
  | {
      readonly ok: false;
      readonly category: AntiCheatCategory;
      readonly rejectCode: RejectCode;
      readonly httpStatus: number;
      readonly errorCode: string;
      readonly detail: string;
    };
