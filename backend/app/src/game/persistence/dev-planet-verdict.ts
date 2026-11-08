import { canonicalPlanetById } from '@terra/contracts';
import { devPlanetTypeOf, GEN_VERSION, isAtlasSaveState, restore } from '@terra/sim';

export {
  atlasSnapshotVerdict,
  isCanonicalOrAtlasPlanet,
  type AtlasSnapshotVerdict,
} from './atlas-snapshot-guard';

/**
 * What boot does with a dev planet's latest snapshot (D-38, W11-40):
 * - `keep`: current generator and the type its id names, or any canonical W11 / small-atlas world → restore it;
 * - `wipe`: built by an OLDER world generator / sim (or none recorded), or not the type its family names
 *   (`pl_dev` was temperate before D-38) on a legacy pre-W11 dev planet → delete it, boot recreates the dev planet fresh;
 * - `newer`: written by a NEWER build (sim or generator version above this engine) → never delete, skip loading.
 * Canonical W11 worlds (`canonicalPlanetById(id) !== null`) and snapshots with `state.blobs.atlas` are NEVER classified as `wipe`.
 */
export type DevSnapshotVerdict =
  | { kind: 'keep'; state: ReturnType<typeof restore> | null }
  | { kind: 'wipe'; reason: string }
  | { kind: 'newer'; reason: string };

export function devSnapshotVerdict(planetId: string, raw: Uint8Array): DevSnapshotVerdict {
  const isCanonical = canonicalPlanetById(planetId) !== null;
  const devType = isCanonical ? null : devPlanetTypeOf(planetId);
  if (devType === null && !isCanonical) return { kind: 'keep', state: null };

  let state: ReturnType<typeof restore>;
  try {
    state = restore(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/newer than engine/.test(msg)) return { kind: 'newer', reason: msg };
    if (isCanonical || isAtlasSaveState(raw)) return { kind: 'keep', state: null };
    return { kind: 'wipe', reason: msg };
  }

  const gv = state.meta.genVersion;
  if (gv !== undefined && gv > GEN_VERSION) return { kind: 'newer', reason: `genVersion ${gv} > ${GEN_VERSION}` };
  if (isCanonical || isAtlasSaveState(state)) return { kind: 'keep', state };
  if (gv === undefined || gv < GEN_VERSION) return { kind: 'wipe', reason: `genVersion ${gv ?? 'none'} < ${GEN_VERSION}` };
  if (state.meta.planetType !== devType) return { kind: 'wipe', reason: `planet type ${state.meta.planetType}, family ${devType}` };
  return { kind: 'keep', state };
}
