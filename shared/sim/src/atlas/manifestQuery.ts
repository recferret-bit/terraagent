import type {
  AtlasConfigV1,
  AtlasManifestV1,
  LandingSlotId,
  SafeLandingSlotV1,
  SectorId,
  SectorManifestV1,
  SectorNeighbourV1,
} from '@terra/contracts';
import type { PlanetState } from '../kernel/state';
import { globalTileToSector } from './partition';
import type { AtlasBlobValue, GeneratedSmallAtlas } from './types';

export interface AtlasQueryInterface {
  getManifest(): AtlasManifestV1;
  getSector(sectorId: SectorId): SectorManifestV1 | null;
  getLandSectors(): readonly SectorManifestV1[];
  getOceanSectors(): readonly SectorManifestV1[];
  getSectorForTile(q: number, r: number): SectorManifestV1 | null;
  getSafeLandingSlot(slotId: LandingSlotId): SafeLandingSlotV1 | null;
  getSectorNeighbours(sectorId: SectorId): readonly SectorNeighbourV1[];
  getSectorNeighbors(sectorId: SectorId): readonly SectorNeighbourV1[];
}

export type AtlasQuerySource =
  | AtlasManifestV1
  | GeneratedSmallAtlas
  | AtlasConfigV1
  | PlanetState
  | AtlasBlobValue;

function cloneSlot(slot: SafeLandingSlotV1): SafeLandingSlotV1 {
  return {
    slotId: slot.slotId,
    sectorId: slot.sectorId,
    slotIndex: slot.slotIndex,
    q: slot.q,
    r: slot.r,
  };
}

function cloneNeighbour(nb: SectorNeighbourV1): SectorNeighbourV1 {
  return {
    dir: nb.dir,
    macroQ: nb.macroQ,
    macroR: nb.macroR,
    sectorId: nb.sectorId,
  };
}

function cloneSectorManifest(sec: SectorManifestV1): SectorManifestV1 {
  return {
    sectorId: sec.sectorId,
    continentId: sec.continentId,
    macroQ: sec.macroQ,
    macroR: sec.macroR,
    centerQ: sec.centerQ,
    centerR: sec.centerR,
    kind: sec.kind,
    radius: sec.radius,
    tileCount: sec.tileCount,
    foundingCapacity: sec.foundingCapacity,
    validatedSafeSites: sec.validatedSafeSites,
    safeLandingSlots: sec.safeLandingSlots.map(cloneSlot),
    neighbours: sec.neighbours.map(cloneNeighbour),
    ...(sec.resourceEndowment
      ? {
          resourceEndowment: {
            ...sec.resourceEndowment,
            ...(sec.resourceEndowment.scarceResources
              ? { scarceResources: [...sec.resourceEndowment.scarceResources] }
              : {}),
            ...(sec.resourceEndowment.sourceAttribution
              ? { sourceAttribution: { ...sec.resourceEndowment.sourceAttribution } }
              : {}),
          },
        }
      : {}),
  };
}

export function cloneAtlasManifest(manifest: AtlasManifestV1): AtlasManifestV1 {
  return {
    planetId: manifest.planetId,
    planetType: manifest.planetType,
    look: manifest.look,
    seed: manifest.seed,
    atlasVersion: manifest.atlasVersion,
    topologyVersion: manifest.topologyVersion,
    genVersion: manifest.genVersion,
    configVersion: manifest.configVersion,
    configHash: manifest.configHash,
    atlasHash: manifest.atlasHash,
    resourceProfileId: manifest.resourceProfileId,
    resourceProfileHash: manifest.resourceProfileHash,
    sectorRadius: manifest.sectorRadius,
    foundingSeatsPerSector: manifest.foundingSeatsPerSector,
    totalSectors: manifest.totalSectors,
    landSectors: manifest.landSectors,
    oceanSectors: manifest.oceanSectors,
    nominalCapacity: manifest.nominalCapacity,
    validatedCapacity: manifest.validatedCapacity,
    bounds: { ...manifest.bounds },
    sectors: manifest.sectors.map(cloneSectorManifest),
  };
}

export function createAtlasQueryViewFromManifest(manifest: AtlasManifestV1): AtlasQueryInterface {
  const frozenManifest = cloneAtlasManifest(manifest);
  const sectorById = new Map<SectorId, SectorManifestV1>();
  const landSectors: SectorManifestV1[] = [];
  const oceanSectors: SectorManifestV1[] = [];
  const slotById = new Map<LandingSlotId, SafeLandingSlotV1>();

  for (const sec of frozenManifest.sectors) {
    sectorById.set(sec.sectorId, sec);
    if (sec.kind === 'land') landSectors.push(sec);
    else oceanSectors.push(sec);
    for (const slot of sec.safeLandingSlots) {
      slotById.set(slot.slotId, slot);
    }
  }

  const getSectorNeighbours = (sectorId: SectorId): readonly SectorNeighbourV1[] => {
    const sec = sectorById.get(sectorId);
    return sec ? sec.neighbours : [];
  };

  return {
    getManifest: () => cloneAtlasManifest(frozenManifest),
    getSector: (sectorId: SectorId) => sectorById.get(sectorId) ?? null,
    getLandSectors: () => landSectors,
    getOceanSectors: () => oceanSectors,
    getSectorForTile: (q: number, r: number) => {
      if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return null;
      const lookup = globalTileToSector(q, r, frozenManifest.sectorRadius);
      return sectorById.get(lookup.sectorId) ?? null;
    },
    getSafeLandingSlot: (slotId: LandingSlotId) => slotById.get(slotId) ?? null,
    getSectorNeighbours,
    getSectorNeighbors: getSectorNeighbours,
  };
}
