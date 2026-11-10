/**
 * The scenario planet a tab is playing, shared across tabs of this browser (localStorage).
 * A second tab of the same `?scenario=` and the same dev name joins it, so the server
 * closes the older socket with 4001. A reload of the only tab before `away` still starts
 * fresh: that tab drops its claim on pagehide. `&as=` does not take another name's planet.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LiveClaim {
  readonly scenario: string;
  readonly planetId: string;
  readonly as: string;
  readonly tabId: string;
  readonly seenAt: number;
  /** True when the URL named `&as=`. A plain URL only joins another plain tab. */
  readonly explicit: boolean;
}

const LIVE_KEY = 'ta.scenario.live';
const STALE_MS = 20_000;
const PLANET_ID = /^pl_[0-9A-Za-z]{1,40}$/;

export function browserKeyValue(): KeyValueStore {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Private mode can throw on the getter. This page then cannot hand its planet to another tab.
  }
  return memoryKeyValue();
}

export function memoryKeyValue(): KeyValueStore {
  const box = new Map<string, string>();
  return { getItem: (key) => box.get(key) ?? null, setItem: (key, value) => { box.set(key, value); } };
}

export function readLiveClaims(storage: KeyValueStore, now = Date.now()): LiveClaim[] {
  const raw = safeGet(storage, LIVE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => liveClaim(row) && now - row.seenAt < STALE_MS);
  } catch {
    return [];
  }
}

/** The newest claim another tab holds for this scenario and this kind of dev name. */
export function matchingLiveClaim(
  claims: readonly LiveClaim[],
  scenario: string | null,
  explicitAs: string,
  tabId: string,
): LiveClaim | null {
  if (!scenario) return null;
  const pool = claims.filter((claim) => (
    claim.scenario === scenario &&
    claim.tabId !== tabId &&
    (explicitAs ? claim.explicit && claim.as === explicitAs : !claim.explicit)
  ));
  return pool.sort((a, b) => b.seenAt - a.seenAt)[0] ?? null;
}

export function putLiveClaim(storage: KeyValueStore, claim: LiveClaim): void {
  if (!PLANET_ID.test(claim.planetId)) return;
  const now = Date.now();
  const rest = readLiveClaims(storage, now).filter((row) => row.tabId !== claim.tabId);
  safeSet(storage, LIVE_KEY, JSON.stringify([...rest, { ...claim, seenAt: now }]));
}

export function removeLiveClaim(storage: KeyValueStore, tabId: string): void {
  const rest = readLiveClaims(storage).filter((row) => row.tabId !== tabId);
  safeSet(storage, LIVE_KEY, JSON.stringify(rest));
}

/** Refresh this tab's claim until the page goes away, so a later tab can still join it. */
export function watchLiveClaim(storage: KeyValueStore, tabId: string): void {
  if (typeof window === 'undefined') return;
  const timer = window.setInterval(() => touchLiveClaim(storage, tabId), 5_000);
  const drop = () => {
    window.clearInterval(timer);
    removeLiveClaim(storage, tabId);
    window.removeEventListener('pagehide', drop);
  };
  window.addEventListener('pagehide', drop);
}

export function withTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request(name, () => fn()) as Promise<T>;
}

function touchLiveClaim(storage: KeyValueStore, tabId: string): void {
  const mine = readLiveClaims(storage).find((row) => row.tabId === tabId);
  if (mine) putLiveClaim(storage, mine);
}

function liveClaim(row: unknown): row is LiveClaim {
  if (!row || typeof row !== 'object') return false;
  const claim = row as Partial<LiveClaim>;
  return typeof claim.scenario === 'string' && typeof claim.planetId === 'string' && PLANET_ID.test(claim.planetId)
    && typeof claim.as === 'string' && typeof claim.tabId === 'string' && typeof claim.seenAt === 'number'
    && typeof claim.explicit === 'boolean';
}

function safeGet(storage: KeyValueStore, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: KeyValueStore, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Quota or private mode: this page still plays. The next tab will not find the claim.
  }
}
