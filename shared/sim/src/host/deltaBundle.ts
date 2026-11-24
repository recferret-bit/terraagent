import { decodeValue, encodeValue } from '../codec/values';
import type { PlanetState } from '../kernel/state';
import type { ColonyPatchEntry } from './deltaShadow';
import { applyPatch } from './structPatch';

/**
 * Per-viewer client deltas. A window's shared part is the engine diff (every colony's summary fields, entities, tiles,
 * blobs); the owner fields of each changed colony travel as one small "own" frame per colony. A socket gets the shared
 * diff plus the own frame of its colony; full viewers (spectators, colony-less dev sessions, the local host) get every
 * own frame. A host thread hands both to the socket layer as one byte string (`packDeltaBundle`), so the thread
 * protocol, the cluster relay and the anti-cheat replica stay byte-opaque; `applyDiff` applies a bundle whole.
 */

/** Wire format of an own frame (inside the MessagePack map). */
export const OWN_FRAME_FORMAT = 1;

/** One colony's owner-field patch at `toTick`. */
export interface OwnColonyFrame { v: number; toTick: number; i: number; p: ColonyPatchEntry['p'] }

/** An encoded own frame and the colony it belongs to. */
export interface OwnColonyBytes { colony: number; bytes: Uint8Array }

export const encodeOwnFrame = (toTick: number, e: ColonyPatchEntry): OwnColonyBytes =>
  ({ colony: e.i, bytes: encodeValue({ v: OWN_FRAME_FORMAT, toTick, i: e.i, p: e.p } satisfies OwnColonyFrame) });

const decodeOwnFrame = (bytes: Uint8Array): OwnColonyFrame => {
  const f = decodeValue(bytes) as OwnColonyFrame;
  if (f?.v !== OWN_FRAME_FORMAT) throw new Error(`unsupported own frame format ${String(f?.v)}`);
  return f;
};

/** The colony an own frame patches. */
export const ownFrameColony = (bytes: Uint8Array): number => decodeOwnFrame(bytes).i;

/** Applies own frames after their window's engine diff (the replica must already be at their `toTick`). */
export function applyOwnFrames(state: PlanetState, frames: readonly Uint8Array[]): void {
  for (const bytes of frames) {
    const f = decodeOwnFrame(bytes);
    if (f.toTick !== state.meta.tick) throw new Error(`own frame for tick ${f.toTick}, replica at ${state.meta.tick}`);
    applyColonyPatch(state, f);
  }
}

/** Patches colony `e.i` of `state` in place (throws when the replica does not hold it: the caller resyncs). */
export function applyColonyPatch(state: PlanetState, e: Pick<ColonyPatchEntry, 'i' | 'p'>): void {
  const col = state.colonies[e.i];
  if (!col) throw new Error(`colony patch for unknown colony ${e.i}`);
  applyPatch(col, e.p);
}

// ---- thread → socket container --------------------------------------------------------------------------------------

/** MessagePack fixarray of 3: an engine diff is always a map, so the first byte tells the two apart. */
const BUNDLE_HEAD = 0x93;
const BUNDLE_TAG = 'ownv1';

/** The shared diff plus every own frame, as one byte string (frames without own frames stay plain diffs). */
export function packDeltaBundle(diff: Uint8Array, own: readonly OwnColonyBytes[]): Uint8Array {
  if (own.length === 0) return diff;
  return encodeValue([BUNDLE_TAG, diff, own.map((o) => [o.colony, o.bytes])]);
}

export const isDeltaBundle = (bytes: Uint8Array): boolean => bytes.length > 0 && bytes[0] === BUNDLE_HEAD;

/** Splits a host delta into its shared diff and own frames (a plain diff has none). */
export function unpackDeltaBundle(bytes: Uint8Array): { diff: Uint8Array; own: OwnColonyBytes[] } {
  if (!isDeltaBundle(bytes)) return { diff: bytes, own: [] };
  const raw = decodeValue(bytes) as [string, Uint8Array, Array<[number, Uint8Array]>];
  if (!Array.isArray(raw) || raw[0] !== BUNDLE_TAG) throw new Error('not a delta bundle');
  return { diff: raw[1], own: raw[2].map(([colony, b]) => ({ colony, bytes: b })) };
}

/** The own frames a socket gets: its colony's, or all of them for a full viewer (`colony` undefined). */
export const ownFramesFor = (own: readonly OwnColonyBytes[], colony: number | undefined): Uint8Array[] =>
  own.filter((o) => colony === undefined || o.colony === colony).map((o) => o.bytes);
