import { entityColumns } from '../ecs/columns';
import { insertRow, pruneRemovals, removeRow, rowOf, setCapacity, type Removal } from '../ecs/store';
import { decodeValue, encodeValue } from '../codec/values';
import { clientTileLayers, tileLayers } from '../grid/layers';
import type { Blob, ColonyState, PlanetMeta, PlanetState } from '../kernel/state';
import { allocate, type FieldDef, type TypedArray } from '../kernel/types';
import { changedTileIndices, noteTilesStamped } from '../grid/sectors';
import { clientMeta } from '../codec/snapshot';

/** Engine diff wire format version (inside the MessagePack map). */
export const DIFF_FORMAT = 1;

/** Maximum tile count allowed in a single diff delta frame before chunking (W05-19). */
export const MAX_TILE_DIFF_PER_DELTA = 100;

/** Maximum payload size in bytes for a single diff delta frame (8 KB, W05-19). */
export const MAX_DIFF_PAYLOAD_BYTES = 8192;

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
  chunk?: { index: number; total: number };
}

export type SimDiff = EngineDiff & {
  diff?: Uint8Array;
  byteLength?: number;
};

export interface DiffChunkOptions {
  forClient?: boolean;
  maxTilesPerDelta?: number;
  maxPayloadBytes?: number;
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

/**
 * Everything stamped after `fromTick`, as MessagePack bytes (`@terra/sim` host diff, D-31). Pure read of `state`.
 * `forClient` drops `hidden` tile layers (D-38); the replica keeps zeros there (`applyTiles` skips absent layers).
 */
export function diffSince(state: PlanetState, fromTick: number, opts: { forClient?: boolean; maxTiles?: number } = {}): Uint8Array {
  const e = state.entities;
  let tileIdx = changedTileIndices(state, fromTick);
  if (opts.maxTiles !== undefined && tileIdx.length > opts.maxTiles) {
    tileIdx = tileIdx.subarray(0, opts.maxTiles);
  }
  const rows = changedIndices(e.cols.changedAt, e.count, fromTick);
  const diff: EngineDiff = {
    v: DIFF_FORMAT,
    fromTick,
    toTick: state.meta.tick,
    meta: opts.forClient ? clientMeta(state.meta) : state.meta,
    rng: state.rng,
    tiles: { idx: tileIdx, cols: gather(opts.forClient ? clientTileLayers() : tileLayers(), state.grid.layers, tileIdx) },
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

/** Encodes an EngineDiff, SimDiff or payload object to MessagePack bytes. */
export function encodeDiff(diff: EngineDiff | Uint8Array | { diff: Uint8Array }): Uint8Array {
  if (diff instanceof Uint8Array) return diff;
  if (typeof diff === 'object' && diff !== null) {
    if ('diff' in diff && (diff as { diff: Uint8Array }).diff instanceof Uint8Array) {
      return (diff as { diff: Uint8Array }).diff;
    }
    return encodeValue(diff);
  }
  return encodeValue(diff);
}

function partitionTiles(tileIdx: Uint32Array, maxTiles: number): Uint32Array[] {
  if (tileIdx.length === 0) return [new Uint32Array(0)];
  const slices: Uint32Array[] = [];
  for (let i = 0; i < tileIdx.length; i += maxTiles) {
    slices.push(tileIdx.subarray(i, Math.min(i + maxTiles, tileIdx.length)));
  }
  return slices;
}

interface SliceTask {
  slice: Uint32Array;
  isFirst: boolean;
}

function enforcePayloadLimit(
  slices: Uint32Array[],
  state: PlanetState,
  tLayers: readonly FieldDef[],
  baseDiff: Omit<EngineDiff, 'tiles' | 'chunk'>,
  emptyEntities: EngineDiff['entities'],
  maxBytes: number,
): SimDiff[] {
  const finalSlices: { slice: Uint32Array; isFirst: boolean }[] = [];
  const queue: SliceTask[] = slices.map((s, i) => ({ slice: s, isFirst: i === 0 }));

  while (queue.length > 0) {
    const item = queue.shift()!;
    const candidate: EngineDiff = {
      ...baseDiff,
      entities: item.isFirst ? baseDiff.entities : emptyEntities,
      colonies: item.isFirst ? baseDiff.colonies : [],
      blobs: item.isFirst ? baseDiff.blobs : {},
      tiles: { idx: item.slice, cols: gather(tLayers, state.grid.layers, item.slice) },
      chunk: { index: 0, total: slices.length },
    };
    const encoded = encodeValue(candidate);
    if (encoded.byteLength > maxBytes && item.slice.length > 1) {
      const mid = Math.floor(item.slice.length / 2);
      queue.unshift(
        { slice: item.slice.subarray(0, mid), isFirst: item.isFirst },
        { slice: item.slice.subarray(mid), isFirst: false },
      );
    } else {
      finalSlices.push(item);
    }
  }

  const total = finalSlices.length;
  const result: SimDiff[] = [];
  for (let i = 0; i < total; i++) {
    const item = finalSlices[i];
    const candidate: SimDiff = {
      ...baseDiff,
      entities: item.isFirst ? baseDiff.entities : emptyEntities,
      colonies: item.isFirst ? baseDiff.colonies : [],
      blobs: item.isFirst ? baseDiff.blobs : {},
      tiles: { idx: item.slice, cols: gather(tLayers, state.grid.layers, item.slice) },
      chunk: { index: i, total },
    };
    const encoded = encodeValue(candidate);
    candidate.diff = encoded;
    candidate.byteLength = encoded.byteLength;
    result.push(candidate);
  }

  return result;
}

/**
 * Everything stamped after `fromTick`, partitioned into capped chunks (W05-19).
 * Guarantees <= MAX_TILE_DIFF_PER_DELTA tiles per chunk and encoded payload <= MAX_DIFF_PAYLOAD_BYTES.
 */
export function diffSinceChunked(
  state: PlanetState,
  fromTick: number,
  opts: DiffChunkOptions = {},
): SimDiff[] {
  const maxTiles = opts.maxTilesPerDelta ?? MAX_TILE_DIFF_PER_DELTA;
  const maxBytes = opts.maxPayloadBytes ?? MAX_DIFF_PAYLOAD_BYTES;
  const e = state.entities;
  const tileIdx = changedTileIndices(state, fromTick);
  const rows = changedIndices(e.cols.changedAt, e.count, fromTick);
  const tLayers = opts.forClient ? clientTileLayers() : tileLayers();

  const baseDiff = {
    v: DIFF_FORMAT,
    fromTick,
    toTick: state.meta.tick,
    meta: opts.forClient ? clientMeta(state.meta) : state.meta,
    rng: state.rng,
    entities: {
      capacity: e.capacity,
      count: e.count,
      cols: gather(entityColumns(), e.cols, rows),
      removed: e.removed.filter((r) => r.at > fromTick),
    },
    colonies: state.colonies.filter((c) => c.changedAt > fromTick),
    blobs: Object.fromEntries(Object.entries(state.blobs).filter(([, b]) => b.changedAt > fromTick)),
  };

  const emptyEntities: EngineDiff['entities'] = {
    capacity: e.capacity,
    count: e.count,
    cols: gather(entityColumns(), e.cols, []),
    removed: [],
  };

  const slices = partitionTiles(tileIdx, maxTiles);
  return enforcePayloadLimit(slices, state, tLayers, baseDiff, emptyEntities, maxBytes);
}

function applyEntities(state: PlanetState, d: EngineDiff): void {
  const e = state.entities, tick = d.toTick;
  for (const r of d.entities.removed) {
    removeRow(e, r.id, r.at); // no-op row-wise when the entity was created and removed inside the window
    if (e.removed[e.removed.length - 1]?.id !== r.id) e.removed.push({ id: r.id, at: r.at });
  }
  const ids = d.entities.cols.id;
  if (ids) {
    for (let i = 0; i < ids.length; i++) {
      let row = rowOf(e, ids[i]);
      if (row < 0) row = insertRow(e, ids[i], tick);
      for (const c of entityColumns()) e.cols[c.name][row] = d.entities.cols[c.name]?.[i] ?? 0;
    }
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
  noteTilesStamped(state, idx);
}

/** Decodes an engine diff produced by `diffSince`. */
export function decodeDiff(bytes: Uint8Array): EngineDiff {
  const d = decodeValue(bytes) as EngineDiff;
  if (d.v !== DIFF_FORMAT) throw new Error(`unsupported diff format ${String(d.v)}`);
  return d;
}

/** Applies a diff to a replica at exactly `fromTick`; afterwards the replica deep-equals the authority at `toTick`. */
export function applyDiff(state: PlanetState, diff: Uint8Array | EngineDiff | { diff: Uint8Array }): void {
  let raw: Uint8Array | EngineDiff = diff as Uint8Array | EngineDiff;
  if (typeof diff === 'object' && diff !== null && 'diff' in diff && (diff as { diff: Uint8Array }).diff instanceof Uint8Array) {
    raw = (diff as { diff: Uint8Array }).diff;
  }
  const d = raw instanceof Uint8Array ? decodeDiff(raw) : raw;
  const isContinuation = Boolean(d.chunk && d.chunk.index > 0 && state.meta.tick === d.toTick);
  if (d.chunk && d.chunk.index > 0) {
    if (!isContinuation) throw new DiffGapError(state.meta.tick, d.fromTick);
  } else if (state.meta.tick !== d.fromTick) {
    throw new DiffGapError(state.meta.tick, d.fromTick);
  }
  applyEntities(state, d);
  applyTiles(state, d);
  for (const c of d.colonies) state.colonies[c.index] = c;
  for (const [name, b] of Object.entries(d.blobs)) state.blobs[name] = b;
  Object.assign(state.meta, d.meta);
  for (const k of Object.keys(d.rng) as Array<keyof PlanetState['rng']>) state.rng[k] = d.rng[k];
}
