import type { AuthResponse, PlanetType } from '@terra/contracts';
import { createPlanet, ENTITY_KIND, ENTITY_STATE, getSpawnSlots, type LandingPodState, type ViewEntity } from '@terra/sim';
import { ENTITY_STRIDE } from '../../store/replica/viewCodec';
import { LocalHost } from '../../store/WorldStore';

export const DEVICE_SECRET_KEY = 'ta_device_secret';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface BootColonySummary {
  id: string;
  colonyIndex: number;
  name: string;
  color: number;
  state: string;
  spawnQ: number;
  spawnR: number;
  spawn: { q: number; r: number };
}

export interface BootPlanetSummary {
  id: string;
  name: string;
  type: PlanetType;
  seed: string;
  radius: number;
  state: string;
}

export interface BootAuthResult {
  mode: 'online' | 'local';
  accessToken: string;
  deviceSecret: string;
  playerId: string;
  handle: string;
  state: string;
  planet: BootPlanetSummary;
  colony: BootColonySummary;
  localHost?: LocalHost;
}

export interface BootAuthOptions {
  fetch?: FetchLike;
  storage?: StorageLike;
  search?: string;
  cachedAccessToken?: string | null;
  tryRefresh?: boolean;
  onStatus?: (status: string) => void;
}

export interface PodDescentStatus {
  descending: boolean;
  hqLanded: boolean;
  progress: number;
  q: number;
  r: number;
  podEntityId: number | null;
  hqEntityId: number | null;
  ticksRemaining?: number;
  totalTicks?: number;
}

const memStorageMap = new Map<string, string>();
const fallbackStorage: StorageLike = {
  getItem: (k) => memStorageMap.get(k) ?? null,
  setItem: (k, v) => {
    memStorageMap.set(k, v);
  },
};

function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as unknown as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') return ls;
  } catch {
    // Fallback to in-memory storage
  }
  return fallbackStorage;
}

function generateHexSecret(byteLen = 16): string {
  const bytes = new Uint8Array(byteLen);
  const cryptoObj = (globalThis as unknown as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLen; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reads `ta_device_secret` (`>= 16` chars) from `localStorage` or generates and persists a 32-char hex secret. */
export function getOrCreateDeviceSecret(storage: StorageLike = defaultStorage()): string {
  try {
    const existing = storage.getItem(DEVICE_SECRET_KEY);
    if (typeof existing === 'string' && existing.trim().length >= 16) {
      return existing.trim();
    }
  } catch {
    // Ignore storage read failure
  }
  const secret = generateHexSecret(16);
  try {
    storage.setItem(DEVICE_SECRET_KEY, secret);
  } catch {
    // Ignore storage write failure
  }
  return secret;
}

/** Calls `POST /v1/auth/refresh` with `credentials: 'include'`. Returns the `AuthResponse` or `null` on failure. */
export async function refreshAccessToken(doFetch: FetchLike = (u, i) => fetch(u, i)): Promise<AuthResponse | null> {
  try {
    const res = await doFetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as AuthResponse;
  } catch {
    return null;
  }
}

async function guestLogin(deviceSecret: string, doFetch: FetchLike): Promise<AuthResponse> {
  const res = await doFetch('/v1/auth/guest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ deviceSecret }),
  });
  if (!res.ok) throw new Error(`POST /v1/auth/guest: ${res.status}`);
  return (await res.json()) as AuthResponse;
}

async function fetchHomeWithRetry(
  initialToken: string,
  deviceSecret: string,
  doFetch: FetchLike,
): Promise<{ accessToken: string; home: Record<string, unknown> }> {
  let token = initialToken;
  let res = await doFetch('/v1/me/home', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  if (res.status === 401) {
    const refreshed = (await refreshAccessToken(doFetch)) ?? (await guestLogin(deviceSecret, doFetch));
    token = refreshed.accessToken;
    res = await doFetch('/v1/me/home', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
  }
  if (!res.ok) throw new Error(`GET /v1/me/home: ${res.status}`);
  const home = (await res.json()) as Record<string, unknown>;
  return { accessToken: token, home };
}

function normalizeHomePayload(home: Record<string, unknown>): {
  state: string;
  planet: BootPlanetSummary;
  colony: BootColonySummary;
} {
  const rawPlanet = (home.planet ?? {}) as Record<string, unknown>;
  const rawColony = (home.colony ?? {}) as Record<string, unknown>;
  const rawSpawn = (rawColony.spawn ?? {}) as { q?: unknown; r?: unknown };

  const spawnQ =
    typeof rawSpawn.q === 'number' ? rawSpawn.q : typeof rawColony.spawnQ === 'number' ? rawColony.spawnQ : 0;
  const spawnR =
    typeof rawSpawn.r === 'number' ? rawSpawn.r : typeof rawColony.spawnR === 'number' ? rawColony.spawnR : 0;

  const rawType = rawPlanet.type;
  const planetType: PlanetType =
    rawType === 'desert' || rawType === 'ocean' || rawType === 'temperate' ? rawType : 'temperate';

  const planet: BootPlanetSummary = {
    id: typeof rawPlanet.id === 'string' && rawPlanet.id.length > 0 ? rawPlanet.id : 'pl_dev',
    name: typeof rawPlanet.name === 'string' && rawPlanet.name.length > 0 ? rawPlanet.name : 'Dev Planet',
    type: planetType,
    seed: typeof rawPlanet.seed === 'string' && rawPlanet.seed.length > 0 ? rawPlanet.seed : 'golden-1',
    radius: typeof rawPlanet.radius === 'number' ? rawPlanet.radius : 56,
    state: typeof rawPlanet.state === 'string' ? rawPlanet.state : 'ACTIVE',
  };

  const colony: BootColonySummary = {
    id: typeof rawColony.id === 'string' && rawColony.id.length > 0 ? rawColony.id : 'col_0',
    colonyIndex: typeof rawColony.colonyIndex === 'number' ? rawColony.colonyIndex : 0,
    name: typeof rawColony.name === 'string' && rawColony.name.length > 0 ? rawColony.name : "Colonist's Colony",
    color: typeof rawColony.color === 'number' ? rawColony.color : 0,
    state: typeof rawColony.state === 'string' ? rawColony.state : 'ACTIVE',
    spawnQ,
    spawnR,
    spawn: { q: spawnQ, r: spawnR },
  };

  return {
    state: typeof home.state === 'string' ? home.state : 'ACTIVE',
    planet,
    colony,
  };
}

/**
 * Graceful local fallback when no backend server is running (or `?host=local&scenario=w01`):
 * creates a `SimHost` on `pl_dev` (`temperate`, `golden-1`, radius `56`) and dispatches `system.spawnColony`.
 */
export function createLocalBootFallback(
  deviceSecret: string,
  onStatus?: (status: string) => void,
  spawnOverride?: { q: number; r: number },
): BootAuthResult {
  onStatus?.('Entering orbit: pl_dev…');
  const planetState = createPlanet({
    id: 'pl_dev',
    planetId: 'pl_dev',
    type: 'temperate',
    planetType: 'temperate',
    seed: 'golden-1',
    radius: 56,
    capacity: 5,
  });
  const slots = getSpawnSlots(planetState);
  const slot = spawnOverride ?? slots[0] ?? { q: 0, r: 0 };

  const localHost = new LocalHost({
    flags: ['W00', 'W01'],
    planet: planetState,
    colonyIndex: 0,
  });
  localHost.sim.submit({
    colonyIndex: 0,
    source: 'system',
    commandId: 'cm_boot_spawn',
    kind: 'system.spawnColony',
    args: {
      colonyId: 'col_0',
      colonyIndex: 0,
      name: "Colonist's Colony",
      q: slot.q,
      r: slot.r,
    },
  });
  localHost.step(1);

  return {
    mode: 'local',
    accessToken: `local:${deviceSecret.slice(0, 16)}`,
    deviceSecret,
    playerId: 'pr_local',
    handle: 'Colonist',
    state: 'ACTIVE',
    planet: {
      id: 'pl_dev',
      name: 'Dev Planet',
      type: 'temperate',
      seed: 'golden-1',
      radius: 56,
      state: 'ACTIVE',
    },
    colony: {
      id: 'col_0',
      colonyIndex: 0,
      name: "Colonist's Colony",
      color: 0,
      state: 'ACTIVE',
      spawnQ: slot.q,
      spawnR: slot.r,
      spawn: { q: slot.q, r: slot.r },
    },
    localHost,
  };
}

/**
 * Runs W01 guest authentication (`POST /v1/auth/guest` / `POST /v1/auth/refresh`) and `GET /v1/me/home` (`CL-01`),
 * falling back cleanly to a local `SimHost` on `pl_dev` if the backend server is unreachable.
 */
export async function bootAuthAndHome(opts: BootAuthOptions = {}): Promise<BootAuthResult> {
  const storage = opts.storage ?? defaultStorage();
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');

  opts.onStatus?.('Contacting orbit…');
  const deviceSecret = getOrCreateDeviceSecret(storage);

  if (new URLSearchParams(search).get('host') === 'local') {
    return createLocalBootFallback(deviceSecret, opts.onStatus);
  }

  try {
    let auth: AuthResponse | null = null;
    if (opts.cachedAccessToken) {
      auth = {
        accessToken: opts.cachedAccessToken,
        expiresIn: 900,
        player: { id: 'pr_cached' as AuthResponse['player']['id'], handle: 'Colonist', isGuest: true },
      };
    } else if (opts.tryRefresh) {
      auth = await refreshAccessToken(doFetch);
    }
    if (!auth) {
      auth = await guestLogin(deviceSecret, doFetch);
    }

    const { accessToken, home } = await fetchHomeWithRetry(auth.accessToken, deviceSecret, doFetch);
    const { state, planet, colony } = normalizeHomePayload(home);
    opts.onStatus?.(`Entering orbit: ${planet.id}…`);

    return {
      mode: 'online',
      accessToken,
      deviceSecret,
      playerId: auth.player?.id ?? 'pr_guest',
      handle: auth.player?.handle ?? 'Colonist',
      state,
      planet,
      colony,
    };
  } catch {
    return createLocalBootFallback(deviceSecret, opts.onStatus);
  }
}

interface ScannedPodHq {
  podEntityId: number | null;
  podState: number;
  podProgress: number;
  podQ: number;
  podR: number;
  hqEntityId: number | null;
  hqQ: number;
  hqR: number;
}

function scanPodAndHqInEntities(
  ents: Float32Array | ViewEntity[] | undefined,
  count: number | undefined,
  colonyIndex: number,
  defQ: number,
  defR: number,
): ScannedPodHq {
  const res: ScannedPodHq = {
    podEntityId: null,
    podState: -1,
    podProgress: 0,
    podQ: defQ,
    podR: defR,
    hqEntityId: null,
    hqQ: defQ,
    hqR: defR,
  };
  if (ents instanceof Float32Array) {
    const n = count ?? Math.floor(ents.length / ENTITY_STRIDE);
    for (let i = 0; i < n; i++) {
      const o = i * ENTITY_STRIDE;
      if (ents[o + 2] !== colonyIndex) continue;
      if (ents[o + 1] === ENTITY_KIND.hq) {
        res.hqEntityId = ents[o];
        res.hqQ = ents[o + 3];
        res.hqR = ents[o + 4];
      } else if (ents[o + 1] === ENTITY_KIND.pod) {
        res.podEntityId = ents[o];
        res.podQ = ents[o + 3];
        res.podR = ents[o + 4];
        res.podState = ents[o + 10];
        res.podProgress = ents[o + 11];
      }
    }
  } else if (Array.isArray(ents)) {
    for (const e of ents) {
      if (e.owner !== colonyIndex) continue;
      if (e.kind === ENTITY_KIND.hq) {
        res.hqEntityId = e.id;
        res.hqQ = e.q;
        res.hqR = e.r;
      } else if (e.kind === ENTITY_KIND.pod) {
        res.podEntityId = e.id;
        res.podQ = e.q;
        res.podR = e.r;
        res.podState = e.state;
        res.podProgress = e.progress;
      }
    }
  }
  return res;
}

/**
 * Inspects a `ClientView` or `SimView` to determine if the colony's drop pod is currently descending (`state === descending`
 * or `blobs.landingPods` undeployed) or if the HQ has already landed (`kind === ENTITY_KIND.hq` or pod deployed).
 */
export function extractPodDescentStatus(
  rawView: unknown,
  colonyIndex = 0,
  fallbackSpawn?: { q: number; r: number },
): PodDescentStatus {
  const defQ = fallbackSpawn?.q ?? 0;
  const defR = fallbackSpawn?.r ?? 0;
  if (!rawView || typeof rawView !== 'object') {
    return { descending: false, hqLanded: false, progress: 0, q: defQ, r: defR, podEntityId: null, hqEntityId: null };
  }
  const view = rawView as {
    entities?: Float32Array | ViewEntity[];
    count?: number;
    blobs?: Record<string, unknown>;
  };

  const { podEntityId, podState, podProgress, podQ, podR, hqEntityId, hqQ, hqR } = scanPodAndHqInEntities(
    view.entities,
    view.count,
    colonyIndex,
    defQ,
    defR,
  );

  const podsBlob = Array.isArray(view.blobs?.landingPods)
    ? (view.blobs.landingPods as LandingPodState[]).find((p) => p.colonyId === colonyIndex)
    : undefined;

  const q = hqEntityId !== null ? hqQ : podEntityId !== null ? podQ : (podsBlob?.q ?? defQ);
  const r = hqEntityId !== null ? hqR : podEntityId !== null ? podR : (podsBlob?.r ?? defR);

  if (
    hqEntityId !== null ||
    podsBlob?.deployed === true ||
    (podEntityId !== null && podState !== ENTITY_STATE.descending)
  ) {
    return {
      descending: false,
      hqLanded: true,
      progress: 1,
      q,
      r,
      podEntityId: podEntityId ?? podsBlob?.podEntityId ?? null,
      hqEntityId,
      ticksRemaining: 0,
      totalTicks: podsBlob?.totalTicks,
    };
  }

  if (
    (podEntityId !== null && podState === ENTITY_STATE.descending) ||
    (podsBlob !== undefined && !podsBlob.deployed && podsBlob.ticksRemaining > 0)
  ) {
    const progress =
      podEntityId !== null && Number.isFinite(podProgress) && podProgress > 0
        ? Math.min(1, Math.max(0, podProgress))
        : podsBlob && podsBlob.totalTicks > 0
          ? Math.min(1, Math.max(0, (podsBlob.totalTicks - podsBlob.ticksRemaining) / podsBlob.totalTicks))
          : 0;
    return {
      descending: true,
      hqLanded: false,
      progress,
      q,
      r,
      podEntityId: podEntityId ?? podsBlob?.podEntityId ?? null,
      hqEntityId: null,
      ticksRemaining: podsBlob?.ticksRemaining,
      totalTicks: podsBlob?.totalTicks,
    };
  }

  return { descending: false, hqLanded: false, progress: 1, q, r, podEntityId: null, hqEntityId: null };
}
