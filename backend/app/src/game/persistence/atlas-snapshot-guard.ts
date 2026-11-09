import { canonicalPlanetById, type AtlasManifestV1 } from '@terra/contracts';
import {
  devPlanetTypeOf,
  GEN_VERSION,
  isAtlasSaveState,
  restore,
  validateAtlasSaveCompatibility,
  type AtlasSaveCompatibilityOptions,
  type AtlasSaveRejectionCode,
} from '@terra/sim';

/**
 * Verdict for restoring a planet snapshot under W11 small-atlas & legacy pre-W11 compatibility rules (`W11-40`):
 * - `keep`: valid snapshot compatible with active wave flags / client / manifest hashes;
 * - `held`: written by a newer build, corrupt, or an occupied/canonical W11 small-atlas save opened with `W11`
 *   disabled or incompatible client/manifest hash (NEVER wipe or regenerate over it!);
 * - `wipe`: ONLY legacy pre-W11 dev planets (`devPlanetTypeOf(id) !== null`, not canonical, no `blobs.atlas`)
 *   whose generator version is older than `GEN_VERSION` or whose planet type mismatches the dev family.
 */
export type AtlasSnapshotVerdict =
  | {
      readonly kind: 'keep';
      readonly state: ReturnType<typeof restore>;
      readonly isAtlasSave: boolean;
      readonly legacyCompatibility: boolean;
      readonly manifest: AtlasManifestV1 | null;
    }
  | {
      readonly kind: 'held';
      readonly code: AtlasSaveRejectionCode | 'newer_build' | 'corrupt_snapshot';
      readonly reason: string;
      readonly preserveSnapshot: true;
      readonly manifest: AtlasManifestV1 | null;
    }
  | {
      readonly kind: 'wipe';
      readonly reason: string;
    };

export function isCanonicalOrAtlasPlanet(planetId: string, stateOrRaw?: unknown): boolean {
  if (canonicalPlanetById(planetId) !== null) return true;
  if (stateOrRaw !== undefined && isAtlasSaveState(stateOrRaw)) return true;
  return false;
}

export function atlasSnapshotVerdict(
  planetId: string,
  raw: Uint8Array,
  options: AtlasSaveCompatibilityOptions = {},
): AtlasSnapshotVerdict {
  const isCanonical = canonicalPlanetById(planetId) !== null;
  const devType = isCanonical ? null : devPlanetTypeOf(planetId);

  let state: ReturnType<typeof restore>;
  try {
    state = restore(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/newer than engine/.test(msg)) {
      return { kind: 'held', code: 'newer_build', reason: msg, preserveSnapshot: true, manifest: null };
    }
    if (devType !== null && !isAtlasSaveState(raw)) {
      return { kind: 'wipe', reason: msg };
    }
    return { kind: 'held', code: 'corrupt_snapshot', reason: msg, preserveSnapshot: true, manifest: null };
  }

  const isAtlas = isAtlasSaveState(state);
  const gv = state.meta.genVersion;
  if (devType !== null && !isCanonical && !isAtlas) {
    if (gv !== undefined && gv > GEN_VERSION) {
      return {
        kind: 'held',
        code: 'newer_build',
        reason: `genVersion ${gv} > ${GEN_VERSION}`,
        preserveSnapshot: true,
        manifest: null,
      };
    }
    if (gv === undefined || gv < GEN_VERSION) {
      return { kind: 'wipe', reason: `genVersion ${gv ?? 'none'} < ${GEN_VERSION}` };
    }
    if (state.meta.planetType !== devType) {
      return { kind: 'wipe', reason: `planet type ${state.meta.planetType}, family ${devType}` };
    }
  } else if ((isCanonical || isAtlas) && gv !== undefined && gv > GEN_VERSION) {
    return {
      kind: 'held',
      code: 'newer_build',
      reason: `genVersion ${gv} > ${GEN_VERSION}`,
      preserveSnapshot: true,
      manifest: null,
    };
  }

  const compat = validateAtlasSaveCompatibility(state, {
    ...options,
    planetId,
  });
  if (!compat.ok) {
    return {
      kind: 'held',
      code: compat.code,
      reason: compat.reason,
      preserveSnapshot: true,
      manifest: compat.manifest,
    };
  }

  return {
    kind: 'keep',
    state,
    isAtlasSave: compat.isAtlasSave,
    legacyCompatibility: compat.legacyCompatibility,
    manifest: compat.manifest,
  };
}
