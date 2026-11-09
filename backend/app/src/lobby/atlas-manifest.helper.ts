import { createHash } from 'node:crypto';
import {
  AtlasManifestV1Schema,
  CANONICAL_PLANETS,
  formatLandingSlotId,
  formatSectorId,
  planetLookForType,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_MAX_SMALL_ATLAS_COLONIES,
  W11_MAX_SMALL_ATLAS_SECTORS,
  W11_SEVEN_SECTOR_COORDS,
  type AtlasManifestV1,
  type PlanetType,
  type SafeLandingSlotV1,
  type SectorManifestV1,
  type SectorNeighbourV1,
} from '@terra/contracts';
import { LobbyPersistenceConflictError, type PinnedAtlasVersionRecord } from './lobby-persistence.types';

const AXIAL_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;

export interface BuildCanonicalAtlasManifestOptions {
  readonly atlasVersion?: number;
  readonly topologyVersion?: number;
  readonly genVersion?: number;
  readonly configVersion?: number;
  readonly sectorRadius?: number;
  readonly foundingSeatsPerSector?: number;
  readonly validatedSeatsPerSector?: number;
  readonly seed?: string;
  readonly configHash?: string;
  readonly atlasHash?: string;
  readonly resourceProfileId?: string;
  readonly resourceProfileHash?: string;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJsonStringify(obj[k])}`).join(',')}}`;
}

export function hashManifestJson(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex');
}

function buildSectorNeighbours(
  macroQ: number,
  macroR: number,
  sectorCoordSet: ReadonlySet<string>,
): SectorNeighbourV1[] {
  return AXIAL_DIRS.map(([dq, dr], dir) => {
    const nq = macroQ + dq;
    const nr = macroR + dr;
    const candidateId = formatSectorId(nq, nr);
    return {
      dir,
      macroQ: nq,
      macroR: nr,
      sectorId: sectorCoordSet.has(candidateId) ? candidateId : null,
    };
  });
}

function buildDefaultLandingSlots(
  sectorId: string,
  centerQ: number,
  centerR: number,
  validatedSeats: number,
): SafeLandingSlotV1[] {
  const offsets: readonly (readonly [number, number])[] = [
    [-6, 0],
    [6, 0],
    [0, -6],
    [0, 6],
    [-6, 6],
  ];
  const slots: SafeLandingSlotV1[] = [];
  for (let i = 0; i < validatedSeats; i++) {
    const [oq, or] = offsets[i % offsets.length]!;
    slots.push({
      slotId: formatLandingSlotId(sectorId, i),
      sectorId,
      slotIndex: i,
      q: centerQ + oq + Math.floor(i / offsets.length) * 2,
      r: centerR + or,
    });
  }
  return slots;
}

/**
 * Builds a valid W11 7-sector small-atlas `AtlasManifestV1` for a canonical `PlanetType`.
 */
export function buildDefaultCanonicalAtlasManifest(
  type: PlanetType,
  options: BuildCanonicalAtlasManifestOptions = {},
): AtlasManifestV1 {
  const canonical = CANONICAL_PLANETS[type];
  const atlasVersion = options.atlasVersion ?? 1;
  const topologyVersion = options.topologyVersion ?? 1;
  const genVersion = options.genVersion ?? 1;
  const configVersion = options.configVersion ?? 1;
  const sectorRadius = options.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const foundingSeats = options.foundingSeatsPerSector ?? W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
  const validatedSeats = options.validatedSeatsPerSector ?? foundingSeats;
  const seed = options.seed ?? canonical.seed;
  const resourceProfileId = options.resourceProfileId ?? `w11-bootstrap-${type}-v1`;
  const resourceProfileHash =
    options.resourceProfileHash ?? hashManifestJson({ resourceProfileId, type, topologyVersion, genVersion });

  const tileCountPerSector = 1 + 3 * sectorRadius * (sectorRadius + 1);
  const coordSet = new Set(W11_SEVEN_SECTOR_COORDS.map(([q, r]) => formatSectorId(q, r)));
  const stride = sectorRadius * 2 + 1;

  const sectors: SectorManifestV1[] = W11_SEVEN_SECTOR_COORDS.map(([macroQ, macroR]) => {
    const sectorId = formatSectorId(macroQ, macroR);
    const centerQ = macroQ * stride;
    const centerR = macroR * stride;
    return {
      sectorId,
      continentId: 'cont_0',
      macroQ,
      macroR,
      centerQ,
      centerR,
      kind: 'land',
      radius: sectorRadius,
      tileCount: tileCountPerSector,
      foundingCapacity: foundingSeats,
      validatedSafeSites: validatedSeats,
      safeLandingSlots: buildDefaultLandingSlots(sectorId, centerQ, centerR, validatedSeats),
      neighbours: buildSectorNeighbours(macroQ, macroR, coordSet),
      resourceEndowment: {
        profileId: resourceProfileId,
        endowmentHash: resourceProfileHash,
        sourceLayer: 'planetType',
        depositDensityPer1000Tiles: 12,
        mainResource: type === 'desert' ? 'metals.t1' : type === 'ocean' ? 'bio.water' : 'minerals.t1',
        scarceResources: type === 'desert' ? ['bio.water'] : type === 'ocean' ? ['minerals.t1'] : ['metals.t2'],
      },
    };
  });

  const configHash =
    options.configHash ??
    hashManifestJson({
      planetId: canonical.id,
      type,
      seed,
      topologyVersion,
      genVersion,
      configVersion,
      sectorRadius,
      foundingSeats,
    });
  const boundExtent = sectorRadius * 3;
  const baseManifest = {
    planetId: canonical.id,
    planetType: type,
    look: planetLookForType(type),
    seed,
    atlasVersion,
    topologyVersion,
    genVersion,
    configVersion,
    configHash,
    resourceProfileId,
    resourceProfileHash,
    sectorRadius,
    foundingSeatsPerSector: foundingSeats,
    totalSectors: sectors.length,
    landSectors: sectors.length,
    oceanSectors: 0,
    nominalCapacity: sectors.length * foundingSeats,
    validatedCapacity: sectors.length * validatedSeats,
    bounds: {
      minQ: -boundExtent,
      maxQ: boundExtent,
      minR: -boundExtent,
      maxR: boundExtent,
      totalTiles: sectors.length * tileCountPerSector,
      maxColonies: W11_MAX_SMALL_ATLAS_COLONIES,
      maxSectors: W11_MAX_SMALL_ATLAS_SECTORS,
    },
    sectors,
  };
  const atlasHash = options.atlasHash ?? hashManifestJson(baseManifest);
  return AtlasManifestV1Schema.parse({ ...baseManifest, atlasHash });
}

/**
 * Verifies that an incoming `AtlasManifestV1` matches an already-pinned `PinnedAtlasVersionRecord` for `(planetId, atlasVersion)`.
 * Throws `LobbyPersistenceConflictError('atlas_version_immutable')` if any hash, version, or manifest content differs.
 */
export function assertAtlasVersionImmutable(
  existing: PinnedAtlasVersionRecord,
  incoming: AtlasManifestV1,
): void {
  const existingJson = stableJsonStringify(existing.manifest);
  const incomingJson = stableJsonStringify(incoming);
  if (
    existing.atlasHash !== incoming.atlasHash ||
    existing.configHash !== incoming.configHash ||
    existing.topologyVersion !== incoming.topologyVersion ||
    existing.genVersion !== incoming.genVersion ||
    existing.configVersion !== incoming.configVersion ||
    existing.resourceProfileId !== incoming.resourceProfileId ||
    existing.resourceProfileHash !== incoming.resourceProfileHash ||
    existingJson !== incomingJson
  ) {
    throw new LobbyPersistenceConflictError(
      'atlas_version_immutable',
      `atlas version ${incoming.atlasVersion} on planet ${incoming.planetId} is immutable and cannot be overwritten with a different manifest or hash`,
      {
        planetId: incoming.planetId,
        atlasVersion: incoming.atlasVersion,
        existingAtlasHash: existing.atlasHash,
        incomingAtlasHash: incoming.atlasHash,
        existingConfigHash: existing.configHash,
        incomingConfigHash: incoming.configHash,
      },
    );
  }
}
