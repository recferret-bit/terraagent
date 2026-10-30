import { entityColumns } from '../ecs/columns';
import { tileLayers } from '../grid/layers';
import { SIM_VERSION } from '../kernel/constants';
import type { PlanetState } from '../kernel/state';
import { allocate, type FieldDef, type TypedArray } from '../kernel/types';
import { migrate, type SnapshotObject } from './migrations';
import { decodeValue, encodeValue } from './values';

/**
 * Snapshot codec (SIM-S-01). `snapshot(state)` is MessagePack of `{ header, state }`; the host gzips it (Node
 * `zlib.gzipSync`, browser `CompressionStream`), the engine never compresses. Full-capacity entity columns and tile
 * layers are stored with `count`/`capacity`, so `restore(snapshot(s))` deep-equals `s`.
 *
 * Column rule on restore: columns in the registries but missing from the snapshot are zero-filled (owner -1);
 * columns in the snapshot but not registered (their wave is not loaded) are KEPT as-is, so a later save still has them.
 */
export interface SnapshotHeader { simVersion: number; codec: 'msgpack'; tick: number; planetId: string; [k: string]: unknown }

export function snapshot(state: PlanetState): Uint8Array {
  const header: SnapshotHeader = { simVersion: SIM_VERSION, codec: 'msgpack', tick: state.meta.tick, planetId: state.meta.planetId };
  return encodeValue({ header, state });
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
