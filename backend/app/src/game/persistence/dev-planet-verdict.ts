import { devPlanetTypeOf, GEN_VERSION, restore } from '@terra/sim';

/**
 * What boot does with a dev planet's latest snapshot (D-38):
 * - `keep`: current generator and the type its id names → restore it;
 * - `wipe`: built by an OLDER world generator / sim (or none recorded), or not the type its family names
 *   (`pl_dev` was temperate before D-38) → delete it, boot recreates the dev planet fresh;
 * - `newer`: written by a NEWER build (sim or generator version above this engine) → never delete, skip loading.
 * Non-dev planets are always `keep` (their restore errors surface as usual).
 */
export type DevSnapshotVerdict =
  | { kind: 'keep'; state: ReturnType<typeof restore> | null }
  | { kind: 'wipe'; reason: string }
  | { kind: 'newer'; reason: string };

export function devSnapshotVerdict(planetId: string, raw: Uint8Array): DevSnapshotVerdict {
  const devType = devPlanetTypeOf(planetId);
  if (devType === null) return { kind: 'keep', state: null };
  let state: ReturnType<typeof restore>;
  try {
    state = restore(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return /newer than engine/.test(msg) ? { kind: 'newer', reason: msg } : { kind: 'wipe', reason: msg };
  }
  const gv = state.meta.genVersion;
  if (gv !== undefined && gv > GEN_VERSION) return { kind: 'newer', reason: `genVersion ${gv} > ${GEN_VERSION}` };
  if (gv === undefined || gv < GEN_VERSION) return { kind: 'wipe', reason: `genVersion ${gv ?? 'none'} < ${GEN_VERSION}` };
  if (state.meta.planetType !== devType) return { kind: 'wipe', reason: `planet type ${state.meta.planetType}, family ${devType}` };
  return { kind: 'keep', state };
}
