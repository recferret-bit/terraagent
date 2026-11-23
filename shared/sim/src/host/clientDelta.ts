import { clientSnapshotObservers } from '../codec/snapshot';
import type { PlanetState } from '../kernel/state';
import { packDeltaBundle } from './deltaBundle';
import { ClientDeltaShadow } from './deltaShadow';
import { clientDeltaFrames, type DeltaFrame, type DiffChunkOptions } from './diff';

/** One shadow per streamed planet state: a reloaded planet (new state object) starts a fresh one. */
const shadows = new WeakMap<PlanetState, ClientDeltaShadow>();

// A welcome snapshot of a streamed state makes a receiver that holds the live values (see `ClientDeltaShadow.reconcile`).
clientSnapshotObservers.add((state) => shadows.get(state)?.reconcile(state));

/**
 * The client deltas of a host's one send path for `state` (`clientDeltaFrames` with that state's shadow): colonies and
 * blobs as field-level patches, owner fields in the first frame's `ownByColony`. Call it only from that send path: every call
 * advances the shadow, and a window that does not continue the previous one resets it.
 */
export function shadowedClientDeltaFrames(
  state: PlanetState,
  fromTick: number,
  opts: Omit<DiffChunkOptions, 'forClient' | 'shadow'> = {},
): DeltaFrame[] {
  let shadow = shadows.get(state);
  if (!shadow) shadows.set(state, (shadow = new ClientDeltaShadow()));
  return clientDeltaFrames(state, fromTick, { ...opts, shadow });
}

/**
 * The client deltas of a host thread's one send path for `state` (`clientDeltaFrames` with its shadow): colonies and
 * blobs as field-level patches, and the first frame's `diff` a delta bundle when colonies' owner fields changed, so
 * the socket layer cuts each socket's variant (`unpackDeltaBundle` + `ownFramesFor`). Call it only from that send
 * path: every call advances the shadow, and a window that does not continue the previous one resets it.
 */
export function bundledClientDeltaFrames(
  state: PlanetState,
  fromTick: number,
  opts: Omit<DiffChunkOptions, 'forClient' | 'shadow'> = {},
): DeltaFrame[] {
  return shadowedClientDeltaFrames(state, fromTick, opts).map(({ ownByColony, ...f }) =>
    ownByColony ? { ...f, diff: packDeltaBundle(f.diff, ownByColony) } : f);
}
