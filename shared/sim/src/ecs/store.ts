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

export function createStore(capacity = 64): EntityStore {
  const cols = {} as Columns;
  for (const c of entityColumns()) cols[c.name] = allocate(c.dtype, capacity);
  return { count: 0, capacity, cols, removed: [] };
}

function grow(s: EntityStore, min: number): void {
  let cap = s.capacity;
  while (cap < min) cap *= 2;
  for (const c of entityColumns()) {
    const next = allocate(c.dtype, cap);
    const prev = s.cols[c.name];
    if (prev) next.set(prev.subarray(0, s.count) as never);
    s.cols[c.name] = next;
  }
  s.capacity = cap;
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
  const ids = s.cols.id;
  let row = s.count;
  while (row > 0 && ids[row - 1] > id) row--;
  if (row < s.count) for (const c of entityColumns()) s.cols[c.name].copyWithin(row + 1, row, s.count);
  for (const c of entityColumns()) s.cols[c.name][row] = 0;
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
  for (const c of entityColumns()) s.cols[c.name].copyWithin(row, row + 1, s.count);
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
}
