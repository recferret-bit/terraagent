import type {
  AtlasConfigV1,
  AtlasManifestV1,
  PlanetType,
  SectorId,
  SectorKind,
} from '@terra/contracts';
import { sha256Hex } from '../economy/sha256';

export { sha256Hex };

/**
 * Deterministic canonical JSON serialization with sorted object keys and normalized `-0`.
 */
export function canonicalizeManifestJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value === 0 ? 0 : value) : 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeManifestJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeManifestJson(rec[k])}`);
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

export function hashAtlasCanonicalJson(value: unknown): string {
  return `sha256:${sha256Hex(canonicalizeManifestJson(value))}`;
}

export interface ResourceProfileHashInput {
  readonly resourceProfileId: string;
  readonly planetType: PlanetType;
  readonly topologyVersion: number;
  readonly genVersion: number;
  readonly sectorId?: SectorId;
  readonly kind?: SectorKind;
  readonly archetype?: string;
}

export function computeResourceProfileHash(input: ResourceProfileHashInput): string {
  return hashAtlasCanonicalJson({
    resourceProfileId: input.resourceProfileId,
    planetType: input.planetType,
    topologyVersion: input.topologyVersion,
    genVersion: input.genVersion,
    ...(input.sectorId ? { sectorId: input.sectorId } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.archetype ? { archetype: input.archetype } : {}),
  });
}

/**
 * Computes a deterministic `sha256:...` digest for an `AtlasConfigV1`.
 */
export function computeAtlasConfigHash(config: AtlasConfigV1): string {
  const canonicalSectors = [...config.sectors]
    .map((s) => ({
      sectorId: s.sectorId,
      continentId: s.continentId,
      macroQ: s.macroQ === 0 ? 0 : s.macroQ,
      macroR: s.macroR === 0 ? 0 : s.macroR,
      kind: s.kind,
      radius: s.radius,
      foundingCapacity: s.foundingCapacity,
      ...(s.archetype !== undefined ? { archetype: s.archetype } : {}),
      ...(s.resourceProfileId !== undefined ? { resourceProfileId: s.resourceProfileId } : {}),
    }))
    .sort((a, b) => a.macroQ - b.macroQ || a.macroR - b.macroR);

  return hashAtlasCanonicalJson({
    planetId: config.planetId,
    planetType: config.planetType,
    seed: config.seed,
    topologyVersion: config.topologyVersion,
    genVersion: config.genVersion,
    configVersion: config.configVersion,
    sectorRadius: config.sectorRadius,
    foundingSeatsPerSector: config.foundingSeatsPerSector,
    ...(config.resourceProfileId !== undefined ? { resourceProfileId: config.resourceProfileId } : {}),
    sectors: canonicalSectors,
  });
}

export type AtlasManifestHashInput = Omit<AtlasManifestV1, 'atlasHash'> & {
  readonly atlasHash?: string;
};

/**
 * Computes a deterministic `sha256:...` digest for an `AtlasManifestV1` (ignoring any existing `atlasHash` property).
 */
export function computeAtlasManifestHash(manifestInput: AtlasManifestHashInput): string {
  const { atlasHash: _ignored, ...rest } = manifestInput;
  return hashAtlasCanonicalJson(rest);
}
