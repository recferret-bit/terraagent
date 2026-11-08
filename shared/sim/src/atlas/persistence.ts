import {
  AtlasManifestV1Schema,
  canonicalPlanetById,
  parseLandingSlotId,
  parseWaves,
  type AtlasManifestV1,
  type SectorId,
} from '@terra/contracts';
import { decodeValue } from '../codec/values';
import { restore, snapshot, type SnapshotOpts } from '../codec/snapshot';
import type { SpawnSlot } from '../gen/spawnSlots';
import {
  COLONY_EXPLORED_BLOB,
  getExploredByColony,
  hydrateStateColonyExplored,
  type ColonyExploredBlobValue,
} from '../grid/exploration';
import { setBlob, type Blob, type PlanetState } from '../kernel/state';
import { getAtlasBlob } from './generateAtlas';
import {
  cloneAtlasManifest,
  extractPinnedAtlasManifest,
  isAtlasManifestV1,
} from './manifest';
import { syncAtlasColonySectorState } from './sectorMetrics';
import type { AtlasBlobValue } from './types';

export type AtlasSaveRejectionCode =
  | 'incompatible_atlas_save'
  | 'w11_flag_required'
  | 'atlas_manifest_mismatch';

export type WaveFlagsInput =
  | readonly string[]
  | ReadonlySet<string>
  | { has(wave: string): boolean; readonly list?: readonly string[] }
  | string;

export interface AtlasSaveCompatibilityOptions {
  readonly flags?: WaveFlagsInput;
  readonly expectedAtlasHash?: string;
  readonly expectedConfigHash?: string;
  readonly clientSupportsAtlas?: boolean;
  readonly planetId?: string;
}

export type AtlasSaveCompatibilityResult =
  | {
      readonly ok: true;
      readonly isAtlasSave: boolean;
      readonly legacyCompatibility: boolean;
      readonly preserveSnapshot: true;
      readonly manifest: AtlasManifestV1 | null;
      readonly planetId: string;
    }
  | {
      readonly ok: false;
      readonly code: AtlasSaveRejectionCode;
      readonly reason: string;
      readonly preserveSnapshot: true;
      readonly isAtlasSave: true;
      readonly manifest: AtlasManifestV1 | null;
      readonly planetId: string;
    };

export class IncompatibleAtlasSaveError extends Error {
  readonly ok = false as const;
  readonly code: AtlasSaveRejectionCode;
  readonly reason: string;
  readonly preserveSnapshot = true as const;
  readonly isAtlasSave = true as const;
  readonly manifest: AtlasManifestV1 | null;
  readonly planetId: string;

  constructor(rejection: Extract<AtlasSaveCompatibilityResult, { readonly ok: false }>) {
    super(`${rejection.code}: ${rejection.reason}`);
    this.name = 'IncompatibleAtlasSaveError';
    this.code = rejection.code;
    this.reason = rejection.reason;
    this.manifest = rejection.manifest;
    this.planetId = rejection.planetId;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function unwrapAtlasBlobCandidate(stateOrRaw: unknown): AtlasBlobValue | null {
  if (!stateOrRaw) return null;
  if (stateOrRaw instanceof Uint8Array) {
    try {
      return getAtlasBlob(restore(stateOrRaw));
    } catch {
      try {
        const decoded = decodeValue(stateOrRaw);
        if (isRecord(decoded) && isRecord(decoded.state)) {
          return unwrapAtlasBlobCandidate(decoded.state);
        }
      } catch {
        return null;
      }
      return null;
    }
  }
  if (!isRecord(stateOrRaw)) return null;
  if ('blobs' in stateOrRaw && isRecord(stateOrRaw.blobs)) {
    const rawAtlas = stateOrRaw.blobs.atlas;
    if (!isRecord(rawAtlas)) return null;
    if ('value' in rawAtlas && isRecord(rawAtlas.value)) {
      return rawAtlas.value as unknown as AtlasBlobValue;
    }
    return rawAtlas as unknown as AtlasBlobValue;
  }
  if ('state' in stateOrRaw && isRecord(stateOrRaw.state)) {
    return unwrapAtlasBlobCandidate(stateOrRaw.state);
  }
  if ('sectors' in stateOrRaw && 'sectorRadius' in stateOrRaw && 'planetType' in stateOrRaw) {
    return stateOrRaw as unknown as AtlasBlobValue;
  }
  return null;
}

/**
 * Returns `true` when `state` (or raw snapshot bytes) contains a pinned W11/W27 small-atlas blob
 * (`state.blobs.atlas` with `manifest` / `atlasVersion` / `sectors`).
 * Legacy pre-W11 dev worlds have no `atlas` blob and return `false`.
 */
export function isAtlasSaveState(stateOrRaw: unknown): boolean {
  const blob = unwrapAtlasBlobCandidate(stateOrRaw);
  if (!blob || !isRecord(blob)) return false;
  if (isAtlasManifestV1(blob.manifest)) return true;
  if (typeof blob.atlasVersion === 'number' && blob.atlasVersion >= 1) return true;
  if (
    Array.isArray(blob.sectors) &&
    blob.sectors.length > 0 &&
    typeof blob.sectorRadius === 'number' &&
    blob.sectorRadius > 0
  ) {
    return true;
  }
  return false;
}

function resolveStateFromInput(stateOrRaw: unknown): PlanetState | null {
  if (!stateOrRaw) return null;
  if (stateOrRaw instanceof Uint8Array) {
    return restore(stateOrRaw);
  }
  if (isRecord(stateOrRaw)) {
    if ('meta' in stateOrRaw && 'grid' in stateOrRaw && 'blobs' in stateOrRaw) {
      return stateOrRaw as unknown as PlanetState;
    }
    if ('state' in stateOrRaw && isRecord(stateOrRaw.state)) {
      return resolveStateFromInput(stateOrRaw.state);
    }
  }
  return null;
}

function isWaveEnabled(flags: WaveFlagsInput | undefined, wave: string): boolean {
  if (flags === undefined) return true;
  if (typeof flags === 'string') {
    return parseWaves(flags).has(wave);
  }
  if (flags instanceof Set) {
    return flags.has(wave);
  }
  if (Array.isArray(flags)) {
    if (flags.includes(wave)) return true;
    const compound = flags.filter(
      (f): f is string =>
        typeof f === 'string' && (f.includes('..') || f === 'all' || f === 'none' || f.includes(',')),
    );
    if (compound.length > 0) {
      return parseWaves(compound.join(',')).has(wave);
    }
    return false;
  }
  if (isRecord(flags) && typeof (flags as { has?: unknown }).has === 'function') {
    return (flags as { has(w: string): boolean }).has(wave);
  }
  return false;
}

/**
 * Validates whether `stateOrRaw` can be opened under the active wave flags, client capabilities,
 * and expected manifest hashes (`MATCHMAKING.md` §0.1, §0.4; `W11-40`):
 * - Occupied / canonical W11 small-atlas saves reject missing `W11` (`w11_flag_required`),
 *   atlas-incapable clients (`incompatible_atlas_save`), or mismatched manifest/config hashes
 *   (`atlas_manifest_mismatch`) with `preserveSnapshot: true` (never wiping or regenerating!).
 * - Legacy pre-W11 dev worlds (`isAtlasSaveState(state) === false`) are allowed both when `W11`
 *   is off and when `W11` is on, preserving legacy non-atlas behavior without conversion.
 */
export function validateAtlasSaveCompatibility(
  stateOrRaw: unknown,
  options: AtlasSaveCompatibilityOptions = {},
): AtlasSaveCompatibilityResult {
  const state = resolveStateFromInput(stateOrRaw);
  const isAtlas = isAtlasSaveState(state ?? stateOrRaw);
  const planetId =
    options.planetId ??
    state?.meta?.planetId ??
    unwrapAtlasBlobCandidate(stateOrRaw)?.planetId ??
    '';
  const isCanonical = Boolean(planetId && canonicalPlanetById(planetId) !== null);

  if (!isAtlas && !isCanonical) {
    return {
      ok: true,
      isAtlasSave: false,
      legacyCompatibility: true,
      preserveSnapshot: true,
      manifest: null,
      planetId,
    };
  }

  const manifest = extractPinnedAtlasManifest(
    (state ?? unwrapAtlasBlobCandidate(stateOrRaw)) as Parameters<typeof extractPinnedAtlasManifest>[0],
  );
  const resolvedPlanetId = planetId || manifest?.planetId || 'unknown';

  if (options.flags !== undefined && !isWaveEnabled(options.flags, 'W11')) {
    return {
      ok: false,
      code: 'w11_flag_required',
      reason: `Planet ${resolvedPlanetId} is a W11 small-atlas save and requires wave flag W11; snapshot is held without reset or regeneration.`,
      preserveSnapshot: true,
      isAtlasSave: true,
      manifest,
      planetId: resolvedPlanetId,
    };
  }

  if (options.clientSupportsAtlas === false) {
    return {
      ok: false,
      code: 'incompatible_atlas_save',
      reason: `Planet ${resolvedPlanetId} is a W11 small-atlas save and cannot be opened by a client without atlas support; snapshot is preserved without regeneration.`,
      preserveSnapshot: true,
      isAtlasSave: true,
      manifest,
      planetId: resolvedPlanetId,
    };
  }

  if (
    options.expectedAtlasHash !== undefined &&
    manifest &&
    manifest.atlasHash !== options.expectedAtlasHash
  ) {
    return {
      ok: false,
      code: 'atlas_manifest_mismatch',
      reason: `Planet ${resolvedPlanetId} pinned atlasHash "${manifest.atlasHash}" does not match expected "${options.expectedAtlasHash}"; snapshot is preserved without reset.`,
      preserveSnapshot: true,
      isAtlasSave: true,
      manifest,
      planetId: resolvedPlanetId,
    };
  }

  if (
    options.expectedConfigHash !== undefined &&
    manifest &&
    manifest.configHash !== options.expectedConfigHash
  ) {
    return {
      ok: false,
      code: 'atlas_manifest_mismatch',
      reason: `Planet ${resolvedPlanetId} pinned configHash "${manifest.configHash}" does not match expected "${options.expectedConfigHash}"; snapshot is preserved without reset.`,
      preserveSnapshot: true,
      isAtlasSave: true,
      manifest,
      planetId: resolvedPlanetId,
    };
  }

  return {
    ok: true,
    isAtlasSave: true,
    legacyCompatibility: false,
    preserveSnapshot: true,
    manifest,
    planetId: resolvedPlanetId,
  };
}

function syncColonyLandingSlotIds(state: PlanetState): void {
  const rawSlots = state.blobs.spawnSlots?.value;
  const slots = Array.isArray(rawSlots) ? (rawSlots as SpawnSlot[]) : [];
  for (const col of state.colonies) {
    if (!col || col.index < 0) continue;
    if (typeof col.landingSlotId === 'string') {
      const parsed = parseLandingSlotId(col.landingSlotId);
      if (parsed && !col.foundingSectorId) {
        col.foundingSectorId = parsed.sectorId;
      }
      const matching = slots.find(
        (s) => s.landingSlotId === col.landingSlotId || s.slotId === col.landingSlotId,
      );
      if (matching && matching.claimedBy === undefined) {
        matching.claimedBy = col.index;
      }
      continue;
    }
    const claimed = slots.find((s) => s.claimedBy === col.index);
    const slotId = claimed?.landingSlotId ?? claimed?.slotId;
    if (typeof slotId === 'string') {
      col.landingSlotId = slotId;
      if (!col.foundingSectorId && typeof claimed?.sectorId === 'string') {
        col.foundingSectorId = claimed.sectorId;
      }
    }
  }
}

function flushColonyExploredBitsets(state: PlanetState): void {
  hydrateStateColonyExplored(state);
  const byColony = getExploredByColony(state);
  const entries = Object.entries(byColony).filter(([, bits]) => bits.some((b) => b !== 0));
  if (entries.length === 0) return;
  const existing = state.blobs[COLONY_EXPLORED_BLOB] as Blob | undefined;
  const existingVal = isRecord(existing?.value)
    ? (existing.value as unknown as ColonyExploredBlobValue)
    : undefined;
  const normalized: Record<number, Uint8Array> = {};
  for (const [k, bits] of entries) {
    normalized[Number(k)] = bits;
  }
  state.blobs[COLONY_EXPLORED_BLOB] = {
    changedAt: existing?.changedAt ?? state.meta.tick,
    value: {
      version: existingVal?.version && existingVal.version > 0 ? existingVal.version : 1,
      tileCount: state.grid.count,
      byColony: normalized,
    } satisfies ColonyExploredBlobValue,
  };
}

function ensurePinnedAtlasBlobMetadata(state: PlanetState): AtlasManifestV1 | null {
  const blob = getAtlasBlob(state);
  if (!blob) return null;
  syncColonyLandingSlotIds(state);
  syncAtlasColonySectorState(state, state.meta.tick);
  const refreshed = getAtlasBlob(state) ?? blob;
  const manifest = extractPinnedAtlasManifest(refreshed);
  if (!manifest) return null;

  const needsPin =
    !refreshed.manifest ||
    refreshed.atlasHash !== manifest.atlasHash ||
    refreshed.configHash !== manifest.configHash ||
    refreshed.atlasVersion !== manifest.atlasVersion;
  if (needsPin) {
    const pinned = cloneAtlasManifest(AtlasManifestV1Schema.parse(manifest));
    const currentTick = state.blobs.atlas?.changedAt ?? state.meta.tick;
    setBlob(
      state,
      'atlas',
      {
        ...refreshed,
        atlasVersion: pinned.atlasVersion,
        topologyVersion: pinned.topologyVersion,
        configVersion: pinned.configVersion,
        configHash: pinned.configHash,
        atlasHash: pinned.atlasHash,
        resourceProfileId: pinned.resourceProfileId,
        resourceProfileHash: pinned.resourceProfileHash,
        manifest: pinned,
      } satisfies AtlasBlobValue,
      currentTick,
    );
  }
  return manifest;
}

/**
 * Saves a `PlanetState` snapshot while pinning the `AtlasManifestV1`, synchronizing all 19 sector
 * summaries, colony `foundingSectorId` / `landingSlotId` / `presentSectorIds`, wide `Int16Array`
 * ownership, and per-colony exploration bitsets (`colonyExplored`).
 * Legacy pre-W11 non-atlas worlds are saved as-is without converting them into atlas worlds.
 */
export function saveAtlasWorldSnapshot(state: PlanetState, opts: SnapshotOpts = {}): Uint8Array {
  if (isAtlasSaveState(state)) {
    ensurePinnedAtlasBlobMetadata(state);
  }
  flushColonyExploredBitsets(state);
  return snapshot(state, opts);
}

/**
 * Restores a `PlanetState` from snapshot bytes while verifying `validateAtlasSaveCompatibility`.
 * Throws `IncompatibleAtlasSaveError` (with `preserveSnapshot: true` and structured `code`) when
 * an occupied/canonical W11 atlas save is opened with `W11` disabled, an incompatible client, or
 * a mismatched `expectedAtlasHash` / `expectedConfigHash`.
 */
export function restoreAtlasWorldSnapshot(
  raw: Uint8Array,
  options: AtlasSaveCompatibilityOptions = {},
): PlanetState {
  const state = restore(raw);
  const compat = validateAtlasSaveCompatibility(state, options);
  if (!compat.ok) {
    throw new IncompatibleAtlasSaveError(compat);
  }
  let manifest = compat.manifest;
  if (compat.isAtlasSave) {
    manifest = ensurePinnedAtlasBlobMetadata(state) ?? manifest;
  }
  Object.defineProperties(state, {
    ok: { value: true, enumerable: false, configurable: true },
    state: { value: state, enumerable: false, configurable: true },
    isAtlasSave: { value: compat.isAtlasSave, enumerable: false, configurable: true },
    legacyCompatibility: { value: compat.legacyCompatibility, enumerable: false, configurable: true },
    preserveSnapshot: { value: true, enumerable: false, configurable: true },
    manifest: { value: manifest, enumerable: false, configurable: true },
  });
  return state;
}
