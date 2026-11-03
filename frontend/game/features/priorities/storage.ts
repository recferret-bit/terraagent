import type { PriorityKey } from '@terra/contracts';

/** Generates a storage key scoped to planet and colony index. */
export function makePrioritiesStorageKey(planetId?: string | null, colonyIndex?: number): string {
  const p = planetId || 'default';
  const c = colonyIndex ?? 0;
  return `ta_priorities_${p}_${c}`;
}

const GLOBAL_FALLBACK_KEY = 'ta_priorities';

/** Persists priority values to localStorage and sessionStorage with fallback. */
export function savePriorities(
  values: Record<string, number>,
  planetId?: string | null,
  colonyIndex?: number,
): void {
  try {
    const raw = JSON.stringify(values);
    const key = makePrioritiesStorageKey(planetId, colonyIndex);
    globalThis.localStorage?.setItem(key, raw);
    globalThis.sessionStorage?.setItem(key, raw);
    globalThis.localStorage?.setItem(GLOBAL_FALLBACK_KEY, raw);
    globalThis.sessionStorage?.setItem(GLOBAL_FALLBACK_KEY, raw);
  } catch {
    // Quota or security sandbox error: ignore safely
  }
}

/** Loads stored priority values from localStorage or sessionStorage. */
export function loadPriorities<K extends string = PriorityKey>(
  planetId?: string | null,
  colonyIndex?: number,
): Partial<Record<K, number>> | null {
  try {
    const key = makePrioritiesStorageKey(planetId, colonyIndex);
    const raw =
      globalThis.localStorage?.getItem(key) ??
      globalThis.sessionStorage?.getItem(key) ??
      globalThis.localStorage?.getItem(GLOBAL_FALLBACK_KEY) ??
      globalThis.sessionStorage?.getItem(GLOBAL_FALLBACK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<Record<K, number>>;
  } catch {
    return null;
  }
}

/** Clears stored priorities from storage. */
export function clearPrioritiesStorage(planetId?: string | null, colonyIndex?: number): void {
  try {
    const key = makePrioritiesStorageKey(planetId, colonyIndex);
    globalThis.localStorage?.removeItem(key);
    globalThis.sessionStorage?.removeItem(key);
    globalThis.localStorage?.removeItem(GLOBAL_FALLBACK_KEY);
    globalThis.sessionStorage?.removeItem(GLOBAL_FALLBACK_KEY);
  } catch {
    // ignore
  }
}
