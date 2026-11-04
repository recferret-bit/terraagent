import { allocate, type TypedArray } from '../kernel/types';
import { entityColumns } from './columns';

export interface BaseColumns {
  id: Uint32Array; kind: Uint8Array; owner: Int8Array; tier: Uint8Array; q: Int16Array; r: Int16Array;
  x: Float32Array; y: Float32Array; rot: Float32Array; hp: Float32Array; hpMax: Float32Array; state: Uint8Array;
  progress: Float32Array; createdAt: Uint32Array; changedAt: Uint32Array;
}
export type Columns = BaseColumns & Record<string, TypedArray>;

/** A removal kept for the delta window: replicas drop the id when they apply a diff past `at`. */
export interface Removal { id: number; at: number }

/**
 * Structure-of-arrays entity store. Rows are kept in ascending id order (ids are monotonic and rows are only appended
 * or removed in order), so iteration order is fixed (SIM-D-05). `capacity` grows by doubling.
 */
export interface EntityStore {
  count: number;
  capacity: number;
  cols: Columns;
  removed: Removal[];
}

/** Removals older than this many ticks are forgotten; a replica further behind resyncs from a snapshot. */
export const REMOVAL_WINDOW_TICKS = 3000;

interface RowMotionTracker {
  motionTick: Uint32Array;
  motionMask: Uint16Array;
  nonMotionAt: Uint32Array;
}

const rowTrackers = new WeakMap<EntityStore, RowMotionTracker>();

function getTracker(s: EntityStore): RowMotionTracker {
  let t = rowTrackers.get(s);
  if (!t || t.motionTick.length < s.capacity) {
    const cap = Math.max(s.capacity, 64);
    const next: RowMotionTracker = {
      motionTick: new Uint32Array(cap),
      motionMask: new Uint16Array(cap),
      nonMotionAt: new Uint32Array(cap),
    };
    if (t) {
      next.motionTick.set(t.motionTick.subarray(0, s.count));
      next.motionMask.set(t.motionMask.subarray(0, s.count));
      next.nonMotionAt.set(t.nonMotionAt.subarray(0, s.count));
    }
    rowTrackers.set(s, next);
    t = next;
  }
  return t;
}

const MOTION_COL_BITS: Readonly<Record<string, number>> = {
  x: 1 << 0,
  y: 1 << 1,
  rot: 1 << 2,
  q: 1 << 3,
  r: 1 << 4,
  targetQ: 1 << 3,
  targetR: 1 << 4,
  state: 1 << 0,
  progress: 1 << 0,
};

export function createStore(capacity = 64): EntityStore {
  const cols = {} as Columns;
  for (const c of entityColumns()) cols[c.name] = allocate(c.dtype, capacity);
  return { count: 0, capacity, cols, removed: [] };
}

function grow(s: EntityStore, min: number): void {
  let cap = s.capacity;
  while (cap < min) cap *= 2;
  setCapacity(s, cap);
}

/** Reallocates every column to exactly `cap` rows (a replica uses it to match the authority's capacity). Never shrinks. */
export function setCapacity(s: EntityStore, cap: number): void {
  if (cap <= s.capacity) return;
  for (const c of entityColumns()) {
    const next = allocate(c.dtype, cap);
    const prev = s.cols[c.name];
    if (prev) next.set(prev.subarray(0, s.count) as never);
    s.cols[c.name] = next;
  }
  s.capacity = cap;
  getTracker(s);
}

/** Row of an id (binary search on the sorted id column), or -1. */
export function rowOf(s: EntityStore, id: number): number {
  const ids = s.cols.id;
  let lo = 0, hi = s.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = ids[mid];
    if (v === id) return mid;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Inserts a row for `id` keeping id order (appends when `id` is the largest, which is always the case on the
 * authority; replicas may insert out of order while applying a diff). Returns the row, zero-filled.
 */
export function insertRow(s: EntityStore, id: number, tick: number): number {
  if (s.count + 1 > s.capacity) grow(s, s.count + 1);
  const t = getTracker(s);
  const ids = s.cols.id;
  let row = s.count;
  while (row > 0 && ids[row - 1] > id) row--;
  if (row < s.count) {
    for (const c of entityColumns()) s.cols[c.name].copyWithin(row + 1, row, s.count);
    t.motionTick.copyWithin(row + 1, row, s.count);
    t.motionMask.copyWithin(row + 1, row, s.count);
    t.nonMotionAt.copyWithin(row + 1, row, s.count);
  }
  for (const c of entityColumns()) s.cols[c.name][row] = 0;
  t.motionTick[row] = 0;
  t.motionMask[row] = 0;
  t.nonMotionAt[row] = tick;
  s.count++;
  ids[row] = id;
  s.cols.owner[row] = -1;
  s.cols.createdAt[row] = tick;
  s.cols.changedAt[row] = tick;
  return row;
}

/** Removes the row of `id` (order-preserving) and records the removal for the next deltas. */
export function removeRow(s: EntityStore, id: number, tick: number): boolean {
  const row = rowOf(s, id);
  if (row < 0) return false;
  const t = getTracker(s);
  for (const c of entityColumns()) s.cols[c.name].copyWithin(row, row + 1, s.count);
  for (const c of entityColumns()) s.cols[c.name][s.count - 1] = 0; // keep the vacated tail row canonical (deep-equal replicas)
  t.motionTick.copyWithin(row, row + 1, s.count);
  t.motionMask.copyWithin(row, row + 1, s.count);
  t.nonMotionAt.copyWithin(row, row + 1, s.count);
  t.motionTick[s.count - 1] = 0;
  t.motionMask[s.count - 1] = 0;
  t.nonMotionAt[s.count - 1] = 0;
  s.count--;
  s.removed.push({ id, at: tick });
  return true;
}

/** Drops removal records that no delta window can still need. */
export function pruneRemovals(s: EntityStore, tick: number): void {
  const min = tick - REMOVAL_WINDOW_TICKS;
  if (s.removed.length && s.removed[0].at < min) s.removed = s.removed.filter((r) => r.at >= min);
}

/** Sets one field and stamps the row as changed when the value differs. */
export function setField(s: EntityStore, row: number, col: string, value: number, tick: number): void {
  const a = s.cols[col];
  if (a[row] === value) return;
  a[row] = value;
  s.cols.changedAt[row] = tick;
  const t = getTracker(s);
  const bit = MOTION_COL_BITS[col];
  if (bit !== undefined) {
    if (t.motionTick[row] !== tick) {
      t.motionTick[row] = tick;
      t.motionMask[row] = bit;
    } else {
      t.motionMask[row] |= bit;
    }
  } else {
    t.nonMotionAt[row] = tick;
  }
}

/**
 * Returns the `FAUNA_DIFF_MASK` bitmask for `row` since `fromTick`.
 * Returns `0` when unchanged, a motion-only mask (`1..31`) when only `x,y,rot,q,r` changed via `setField`,
 * or `1 << 11` (`other`) when created or non-motion fields changed since `fromTick`.
 */
export function rowDiffMaskSince(s: EntityStore, row: number, fromTick: number): number {
  const changedAt = s.cols.changedAt[row];
  if (changedAt <= fromTick) return 0;
  if (s.cols.createdAt[row] > fromTick) return 1 << 9; // spawn
  const t = getTracker(s);
  if (t.nonMotionAt[row] > fromTick || t.motionTick[row] !== changedAt) return 1 << 11; // non-motion / direct write
  return t.motionMask[row] || (1 << 11);
}
