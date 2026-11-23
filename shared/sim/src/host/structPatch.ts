/**
 * Structural patches of plain engine data (colony records, blob values) for the client delta (field-level diffs).
 *
 * A patch describes how to turn the value the receiver already holds into the current one:
 * - object patch `{ s?, p?, d? }`: `s` sets whole values by key, `p` patches nested objects / arrays by key, `d` deletes
 *   keys (a tombstone: `encodeValue` drops `undefined`, so a vanished key must be named);
 * - array patch `{ n, s?, p? }`: the new length `n`, then sets / nested patches by index.
 *
 * Equality is exact (no hash): values are compared structurally against the sender's shadow copy, which is the
 * receiver's copy by construction (both apply the same patches). Object key order is part of the value (a re-ordered
 * object is sent whole) so a patched copy iterates like the authority's (prediction steps the sim on it).
 */

export interface ObjPatch { s?: Record<string, unknown>; p?: Record<string, Patch>; d?: string[] }
export interface ArrPatch { n: number; s?: Record<string, unknown>; p?: Record<string, Patch> }
export type Patch = ObjPatch | ArrPatch;

/** `undefined`: equal. `{ set }`: replace the whole value. `{ patch }`: patch it in place. */
export type Change = undefined | { set: unknown } | { patch: Patch };

type Plain = Record<string, unknown>;

/** Nesting levels a patch may descend before it replaces the rest whole. */
export const MAX_PATCH_DEPTH = 4;

const isPlain = (v: unknown): v is Plain => {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || ArrayBuffer.isView(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Canonical array-index keys: JS orders them numerically whatever the insertion order. */
const isIndexKey = (k: string): boolean => /^(0|[1-9]\d{0,8})$/.test(k);

/** The keys that survive encoding (`undefined` values are dropped by `encodeValue`). */
const liveKeys = (o: Plain): string[] => Object.keys(o).filter((k) => o[k] !== undefined);

function sameBytes(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Exact structural equality as the wire sees it, including the order of non-index object keys. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && sameBytes(a, b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const ka = liveKeys(a), kb = liveKeys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || !deepEqual(a[ka[i]], b[kb[i]])) return false;
  return true;
}

/** A deep copy of plain data (objects, arrays, typed arrays, scalars); `undefined` object fields are dropped. */
export function deepClone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return (v as unknown as { slice(): unknown }).slice() as T;
  if (Array.isArray(v)) return v.map(deepClone) as T;
  const out: Plain = {};
  for (const k of liveKeys(v as Plain)) out[k] = deepClone((v as Plain)[k]);
  return out as T;
}

/**
 * True when patching `prev` (delete removed keys, update kept keys in place, append new ones) yields `next`'s key
 * order. Index keys are ordered by the engine itself, so only the other keys are checked.
 */
function keyOrderPatchable(prevKeys: readonly string[], nextKeys: readonly string[], nextSet: ReadonlySet<string>): boolean {
  const kept = prevKeys.filter((k) => !isIndexKey(k) && nextSet.has(k));
  const prevSet = new Set(prevKeys);
  let i = 0, sawNew = false;
  for (const k of nextKeys) {
    if (isIndexKey(k)) continue;
    if (!prevSet.has(k)) { sawNew = true; continue; }
    if (sawNew || kept[i++] !== k) return false;
  }
  return true;
}

function addChange(into: { s?: Record<string, unknown>; p?: Record<string, Patch> }, key: string, ch: Change): void {
  if (!ch) return;
  if ('set' in ch) (into.s ??= {})[key] = ch.set;
  else (into.p ??= {})[key] = ch.patch;
}

function diffObject(prev: Plain, next: Plain, depth: number): Change {
  const prevKeys = liveKeys(prev), nextKeys = liveKeys(next);
  const nextSet = new Set(nextKeys);
  if (!keyOrderPatchable(prevKeys, nextKeys, nextSet)) return { set: next };
  const patch: ObjPatch = {};
  for (const k of prevKeys) if (!nextSet.has(k)) (patch.d ??= []).push(k);
  for (const k of nextKeys) addChange(patch, k, k in prev && prev[k] !== undefined ? diffValue(prev[k], next[k], depth - 1) : { set: next[k] });
  return patch.s || patch.p || patch.d ? { patch } : undefined;
}

function diffArray(prev: unknown[], next: unknown[], depth: number): Change {
  const patch: ArrPatch = { n: next.length };
  let changed = prev.length !== next.length, replaced = 0;
  for (let i = 0; i < next.length; i++) {
    const ch = i < prev.length ? diffValue(prev[i], next[i], depth - 1) : { set: next[i] };
    if (!ch) continue;
    changed = true;
    addChange(patch, String(i), ch);
    // Mostly replaced items: the whole array is smaller than a per-index patch.
    if ('set' in ch && ++replaced * 2 > next.length + 1) return { set: next };
  }
  return changed ? { patch } : undefined;
}

/** How `next` differs from `prev`, descending at most `depth` levels into plain objects and arrays. */
export function diffValue(prev: unknown, next: unknown, depth = MAX_PATCH_DEPTH): Change {
  if (Object.is(prev, next) && (next === null || typeof next !== 'object')) return undefined;
  if (depth > 0 && isPlain(prev) && isPlain(next)) return diffObject(prev, next, depth);
  if (depth > 0 && Array.isArray(prev) && Array.isArray(next)) return diffArray(prev, next, depth);
  return deepEqual(prev, next) ? undefined : { set: next };
}

const isArrPatch = (p: Patch): p is ArrPatch => typeof (p as ArrPatch).n === 'number';

/**
 * Applies `patch` to `target` in place. `copy` deep-copies the values it stores (the sender's shadow must not alias
 * live state); a receiver applying freshly decoded values passes false. Throws on a shape the patch does not fit,
 * which the caller turns into a resync.
 */
export function applyPatch(target: unknown, patch: Patch, copy = false): void {
  if (target === null || typeof target !== 'object') throw new Error('patch target is not an object');
  const t = target as Record<string, unknown>;
  if (isArrPatch(patch)) {
    if (!Array.isArray(target)) throw new Error('array patch on a non-array');
    target.length = patch.n;
  } else {
    if (!isPlain(target)) throw new Error('object patch on a non-object');
    for (const k of patch.d ?? []) delete t[k];
  }
  for (const [k, v] of Object.entries(patch.s ?? {})) t[k] = copy ? deepClone(v) : v;
  for (const [k, p] of Object.entries(patch.p ?? {})) applyPatch(t[k], p, copy);
}
