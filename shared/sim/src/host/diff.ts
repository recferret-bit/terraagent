import { entityColumns } from '../ecs/columns';
import { insertRow, pruneRemovals, removeRow, rowOf, setCapacity, type Removal } from '../ecs/store';
import { decodeValue, encodeValue } from '../codec/values';
import { tileLayers } from '../grid/layers';
import type { Blob, ColonyState, PlanetMeta, PlanetState } from '../kernel/state';
import { allocate, type FieldDef, type TypedArray } from '../kernel/types';

/** Engine diff wire format version (inside the MessagePack map). */
export const DIFF_FORMAT = 1;

/** Thrown by `applyDiff` when the replica is not at the diff's `fromTick`; the host resyncs from a snapshot. */
export class DiffGapError extends Error {
  constructor(readonly replicaTick: number, readonly fromTick: number) {
    super(`diff starts at tick ${fromTick} but the replica is at tick ${replicaTick}`);
    this.name = 'DiffGapError';
  }
}

/**
 * The decoded diff. `tiles.idx` are changed tile indices; `tiles.cols` / `entities.cols` hold, per registered layer /
 * column, the values of those tiles / rows in the same order (changed rows in ascending id order).
 * `capacity` is the authority's entity store capacity so the replica grows identically.
 */
export interface EngineDiff {
  v: number;
  fromTick: number;
  toTick: number;
  meta: PlanetMeta;
  rng: PlanetState['rng'];
  tiles: { idx: Uint32Array; cols: Record<string, TypedArray> };
  entities: { capacity: number; count: number; cols: Record<string, TypedArray>; removed: Removal[] };
  colonies: ColonyState[];
  blobs: Record<string, Blob>;
}

function gather(defs: readonly FieldDef[], src: Record<string, TypedArray>, idx: ArrayLike<number>): Record<string, TypedArray> {
  const out: Record<string, TypedArray> = {};
  for (const d of defs) {
    const from = src[d.name], to = allocate(d.dtype, idx.length);
    for (let i = 0; i < idx.length; i++) to[i] = from[idx[i]];
    out[d.name] = to;
  }
  return out;
}

function changedIndices(stamp: ArrayLike<number>, length: number, fromTick: number): Uint32Array {
  const out: number[] = [];
  for (let i = 0; i < length; i++) if (stamp[i] > fromTick) out.push(i);
  return Uint32Array.from(out);
}

/** Everything stamped after `fromTick`, as MessagePack bytes (`@terra/sim` host diff, D-31). Pure read of `state`. */
export function diffSince(state: PlanetState, fromTick: number): Uint8Array {
  const e = state.entities;
  const tileIdx = changedIndices(state.grid.layers.changedAt, state.grid.count, fromTick);
  const rows = changedIndices(e.cols.changedAt, e.count, fromTick);
  const diff: EngineDiff = {
    v: DIFF_FORMAT,
    fromTick,
    toTick: state.meta.tick,
    meta: state.meta,
    rng: state.rng,
    tiles: { idx: tileIdx, cols: gather(tileLayers(), state.grid.layers, tileIdx) },
    entities: {
      capacity: e.capacity,
      count: e.count,
      cols: gather(entityColumns(), e.cols, rows),
      removed: e.removed.filter((r) => r.at > fromTick),
    },
    colonies: state.colonies.filter((c) => c.changedAt > fromTick),
    blobs: Object.fromEntries(Object.entries(state.blobs).filter(([, b]) => b.changedAt > fromTick)),
  };
  return encodeValue(diff);
}

function applyEntities(state: PlanetState, d: EngineDiff): void {
  const e = state.entities, tick = d.toTick;
  for (const r of d.entities.removed) {
    removeRow(e, r.id, r.at); // no-op row-wise when the entity was created and removed inside the window
    if (e.removed[e.removed.length - 1]?.id !== r.id) e.removed.push({ id: r.id, at: r.at });
  }
  const ids = d.entities.cols.id;
  for (let i = 0; i < ids.length; i++) {
    let row = rowOf(e, ids[i]);
    if (row < 0) row = insertRow(e, ids[i], tick);
    for (const c of entityColumns()) e.cols[c.name][row] = d.entities.cols[c.name]?.[i] ?? 0;
  }
  setCapacity(e, d.entities.capacity);
  pruneRemovals(e, d.toTick);
}

function applyTiles(state: PlanetState, d: EngineDiff): void {
  const { idx, cols } = d.tiles;
  for (const l of tileLayers()) {
    const to = state.grid.layers[l.name], from = cols[l.name];
    if (from) for (let i = 0; i < idx.length; i++) to[idx[i]] = from[i];
  }
}

/** Applies a diff to a replica at exactly `fromTick`; afterwards the replica deep-equals the authority at `toTick`. */
export function applyDiff(state: PlanetState, bytes: Uint8Array): void {
  const d = decodeValue(bytes) as EngineDiff;
  if (d.v !== DIFF_FORMAT) throw new Error(`unsupported diff format ${String(d.v)}`);
  if (state.meta.tick !== d.fromTick) throw new DiffGapError(state.meta.tick, d.fromTick);
  applyEntities(state, d);
  applyTiles(state, d);
  for (const c of d.colonies) state.colonies[c.index] = c;
  for (const [name, b] of Object.entries(d.blobs)) state.blobs[name] = b;
  Object.assign(state.meta, d.meta);
  for (const k of Object.keys(d.rng) as Array<keyof PlanetState['rng']>) state.rng[k] = d.rng[k];
}
