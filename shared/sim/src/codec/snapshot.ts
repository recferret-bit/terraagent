import { entityColumns } from '../ecs/columns';
import { tileLayers } from '../grid/layers';
import { hydrateStateColonyExplored, linkGridMeta } from '../grid/tileModel';
import { SIM_VERSION } from '../kernel/constants';
import type { PlanetState } from '../kernel/state';
import { allocate, type FieldDef, type TypedArray } from '../kernel/types';
import { migrate, type SnapshotObject } from './migrations';
import { decodeValue, encodeValue } from './values';
import { FAUNA_MOTION_SEED, faunaMotionSeed } from './faunaMotionSeed';

/**
 * Snapshot codec (SIM-S-01). `snapshot(state)` is MessagePack of `{ header, state }`; the host gzips it (Node
 * `zlib.gzipSync`, browser `CompressionStream`), the engine never compresses. Full-capacity entity columns and tile
 * layers are stored with `count`/`capacity`, so `restore(snapshot(s))` deep-equals `s`.
 *
 * Column rule on restore: columns in the registries but missing from the snapshot are zero-filled (owner -1);
 * columns in the snapshot but not registered (their wave is not loaded) are KEPT as-is, so a later save still has them.
 */
export interface SnapshotHeader { simVersion: number; codec: 'msgpack'; tick: number; planetId: string; [k: string]: unknown }

export interface SnapshotOpts {
  /** Client-bound (welcome / local-host join): omit `hidden` tile layers; `restore` zero-fills them (D-38). */
  forClient?: boolean;
}

/** Planet meta as a client may see it: without the hidden-ground secret (`worldSalt`, D-38). */
export function clientMeta(meta: PlanetState['meta']): PlanetState['meta'] {
  if (meta.worldSalt === undefined) return meta;
  const { worldSalt: _secret, ...rest } = meta;
  return rest;
}

/** Internal engine blobs omitted from client-bound snapshots and diffs (`forClient: true`). */
export const CLIENT_OMIT_BLOBS: ReadonlySet<string> = new Set([
  'unitMotion',
  'groupMarch',
  'pathQueue',
  'pathStats',
  'combatVision',
  'combatEvasive',
  'combatDamage',
  'combatStanceChanges',
  'faunaAggression',
]);

export function clientBlobs(blobs: PlanetState['blobs']): PlanetState['blobs'] {
  const out: PlanetState['blobs'] = {};
  for (const [k, v] of Object.entries(blobs)) {
    if (!CLIENT_OMIT_BLOBS.has(k)) out[k] = v;
  }
  return out;
}

export function snapshot(state: PlanetState, opts: SnapshotOpts = {}): Uint8Array {
  hydrateStateColonyExplored(state);
  const header: SnapshotHeader = { simVersion: SIM_VERSION, codec: 'msgpack', tick: state.meta.tick, planetId: state.meta.planetId };
  if (!opts.forClient) return encodeValue({ header, state });
  const layers: Record<string, TypedArray> = {};
  for (const l of tileLayers()) if (!l.hidden && state.grid.layers[l.name]) layers[l.name] = state.grid.layers[l.name];
  const blobs = clientBlobs(state.blobs);
  const motionSeed = faunaMotionSeed(state);
  if (motionSeed) blobs[FAUNA_MOTION_SEED] = motionSeed;
  return encodeValue({
    header,
    state: { ...state, meta: clientMeta(state.meta), grid: { ...state.grid, layers }, blobs },
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function fillMissing(cols: Record<string, TypedArray>, defs: readonly FieldDef[], length: number, where: string): void {
  for (const d of defs) {
    const cur = cols[d.name];
    if (cur === undefined) {
      const a = allocate(d.dtype, length);
      if (d.name === 'owner') a.fill(-1);
      cols[d.name] = a;
    } else if (cur.length !== length) {
      throw new Error(`snapshot ${where} column ${d.name} has length ${cur.length}, expected ${length}`);
    } else if (d.dtype === 'i16' && !(cur instanceof Int16Array)) {
      cols[d.name] = Int16Array.from(cur);
    }
  }
}

function validate(s: unknown): PlanetState {
  if (!isObj(s) || !isObj(s.meta) || !isObj(s.rng) || !isObj(s.grid) || !isObj(s.entities) || !Array.isArray(s.colonies) || !isObj(s.blobs)) {
    throw new Error('snapshot state is malformed');
  }
  const state = s as unknown as PlanetState;
  fillMissing(state.grid.layers, tileLayers(), state.grid.count, 'grid layer');
  fillMissing(state.entities.cols as Record<string, TypedArray>, entityColumns(), state.entities.capacity, 'entity');
  linkGridMeta(state.grid, state.meta, state.blobs);
  hydrateStateColonyExplored(state);
  return state;
}

/** Decodes a snapshot, migrating older versions through the registry. Throws when no migration path exists. */
export function restore(bytes: Uint8Array): PlanetState {
  const raw = decodeValue(bytes);
  if (!isObj(raw) || !isObj(raw.header) || typeof raw.header.simVersion !== 'number') throw new Error('not a snapshot: missing header');
  if (raw.header.codec !== 'msgpack') throw new Error(`unsupported snapshot codec ${String(raw.header.codec)}`);
  const snap = raw as unknown as SnapshotObject;
  if (snap.header.simVersion > SIM_VERSION) throw new Error(`snapshot is sim version ${snap.header.simVersion}, newer than engine ${SIM_VERSION}`);
  const state = validate(migrate(snap, SIM_VERSION).state);
  state.meta.simVersion = SIM_VERSION;
  return state;
}
