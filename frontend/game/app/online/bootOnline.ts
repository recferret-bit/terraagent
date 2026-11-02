import { HomeResponse, type AuthResponse, type PlanetType } from '@terra/contracts';
import { createPlanet, DEV_PLANET_CAPACITY, DEV_PLANET_RADIUS, DEV_PLANET_SEED, DEV_PLANET_TYPE, devPlanetIdFor, type DevPlanetType, getSpawnSlots, type PlanetState } from '@terra/sim';
import { backoffDelay } from '../../net/backoff';
import { LocalHost } from '../../store/local/LocalHost';
import { builtPlanetSource } from '../../store/local/planetSource';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { planetTypeForKind } from '@terra/render/planets/hex/planetKind';

export const DEVICE_SECRET_KEY = 'ta_device_secret';

/**
 * The `localStorage` key of the guest's device secret. Dev builds give every `?as=<name>` its own key
 * (`ta_device_secret:<name>`), so `?as=b`, `?as=c` are fresh guests in the same browser profile; otherwise one key.
 */
export function deviceSecretKey(search: string, dev: boolean = import.meta.env.DEV): string {
  const as = dev ? new URLSearchParams(search).get('as')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) : '';
  return as ? `${DEVICE_SECRET_KEY}:${as}` : DEVICE_SECRET_KEY;
}

/**
 * An HTTP boot step failed: `status` is the HTTP status (null when no answer came: network error), `code` the server's
 * `errorCode` when it answered with its error envelope (`HOME_UNAVAILABLE`, `TOO_MANY_REQUESTS`, …).
 */
export class BootError extends Error {
  constructor(message: string, readonly status: number | null, readonly code?: string) { super(message); this.name = 'BootError'; }
}

/**
 * No game server behind the page: no answer at all, or a 5xx that is not the server's own error envelope (the Vite dev
 * proxy answers 500 when the app is down). Only then may a dev build fall back to a browser-local host (FA-06); 4xx, a
 * server-named 5xx (`503 HOME_UNAVAILABLE`) and bad payloads are real errors.
 */
export const backendUnreachable = (e: unknown): boolean =>
  e instanceof BootError && (e.status === null || (e.status >= 500 && e.code === undefined));

/** `GET /v1/me/home` tries this many times while the server answers `503 HOME_UNAVAILABLE` or `429`. */
export const HOME_ATTEMPTS = 5;

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
  seed?: string;
  radius?: number;
  state: string;
}

export interface BootAuthResult {
  mode: 'online' | 'local';
  accessToken: string;
  /** Lifetime of `accessToken` from the auth response (s); absent for local tokens, which do not expire. */
  tokenExpiresInS?: number;
  deviceSecret: string;
  playerId: string;
  handle: string;
  /** True for a guest. An auth JSON that omits `player.isGuest` counts as a guest, so older boot fixtures still work. */
  isGuest: boolean;
  /** Pilot account id when the auth JSON includes one (social). Absent for a guest login. */
  accountId?: string;
  state: string;
  planet: BootPlanetSummary;
  colony: BootColonySummary;
  localHost?: LocalHost;
}

export interface BootAuthOptions {
  fetch?: FetchLike;
  storage?: StorageLike;
  search?: string;
  tryRefresh?: boolean;
  /**
   * May an unreachable server (`backendUnreachable`) fall back to a browser-local host? Default: dev builds only.
   * Any other failure, and every failure in production, throws a `BootError` for the caller's error splash.
   */
  allowLocalFallback?: boolean;
  onStatus?: (status: string) => void;
  /** Planet type for a NEW colony (the orbit pick): `GET /v1/me/home?type=`, and the type of the local fallback. */
  planetType?: DevPlanetType;
  /** Waits `ms` between `/me/home` retries (default `setTimeout`; tests pass a fake). */
  wait?: (ms: number) => Promise<void>;
  /** Jitter source of the retry backoff (default `Math.random`). */
  random?: () => number;
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

/** Generates and persists a fresh 32-char hex device secret under `key` (default `ta_device_secret`) in `localStorage`. */
export function resetDeviceSecret(storage: StorageLike = defaultStorage(), key = DEVICE_SECRET_KEY): string {
  const secret = generateHexSecret(16);
  try {
    storage.setItem(key, secret);
  } catch {
    // Ignore storage write failure
  }
  return secret;
}

/** Reads the device secret (`>= 16` chars) under `key` from `localStorage` or generates and persists a 32-char hex one. */
export function getOrCreateDeviceSecret(storage: StorageLike = defaultStorage(), key = DEVICE_SECRET_KEY): string {
  try {
    const existing = storage.getItem(key);
    if (typeof existing === 'string' && existing.trim().length >= 16) {
      return existing.trim();
    }
  } catch {
    // Ignore storage read failure
  }
  return resetDeviceSecret(storage, key);
}

/** `fetch` whose network failure is a `BootError` with status null (see `backendUnreachable`). */
const reachable = (doFetch: FetchLike): FetchLike => (u, i) =>
  doFetch(u, i).catch((e: unknown) => { throw new BootError(`${u}: ${e instanceof Error ? e.message : String(e)}`, null); });

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
  if (!res.ok) throw new BootError(`POST /v1/auth/guest: ${res.status}`, res.status);
  return (await res.json()) as AuthResponse;
}

/** A fresh access token: `POST /v1/auth/refresh` (cookie), else a guest login with the device secret. */
async function refreshOrGuest(deviceSecret: string, doFetch: FetchLike): Promise<AuthResponse> {
  return (await refreshAccessToken(doFetch)) ?? (await guestLogin(deviceSecret, doFetch));
}

/** Renews a guest's access token for a long-lived socket (FA-01); null when neither refresh nor guest login worked. */
export async function renewAccessToken(deviceSecret: string, doFetch: FetchLike = (u, i) => fetch(u, i)): Promise<AuthResponse | null> {
  try { return await refreshOrGuest(deviceSecret, doFetch); } catch { return null; }
}

/** The server's `errorCode` from its error envelope (`{ errorCode, error: { code, … } }`), if the body is one. */
async function errorCodeOf(res: { json(): Promise<unknown> }): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { errorCode?: unknown } | null;
    return typeof body?.errorCode === 'string' ? body.errorCode : undefined;
  } catch { return undefined; }
}

/** The home planet is still loading (`503 HOME_UNAVAILABLE`) or the address is throttled (`429`): try again later. */
const retryableHome = (status: number, code: string | undefined): boolean => status === 429 || (status === 503 && code === 'HOME_UNAVAILABLE');

const realWait = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

interface HomeRequest {
  deviceSecret: string;
  doFetch: FetchLike;
  planetType?: DevPlanetType;
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
  onStatus?: (status: string) => void;
}

/**
 * `GET /v1/me/home`: a `401` renews the token once; `503 HOME_UNAVAILABLE` and `429 rate_limited` are retried with the
 * reconnect backoff (0.5 s, 1, 2, 4 s) up to `HOME_ATTEMPTS` tries; anything else that is not OK is a `BootError`.
 */
async function fetchHomeWithRetry(initialToken: string, o: HomeRequest): Promise<{ accessToken: string; expiresIn?: number; home: unknown }> {
  let token = initialToken;
  let expiresIn: number | undefined;
  let renewed = false;
  const url = o.planetType ? `/v1/me/home?type=${o.planetType}` : '/v1/me/home';
  for (let attempt = 1; ; attempt++) {
    const res = await o.doFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
    if (res.ok) return { accessToken: token, expiresIn, home: await res.json() };
    if (res.status === 401 && !renewed) {
      renewed = true;
      const refreshed = await refreshOrGuest(o.deviceSecret, o.doFetch);
      token = refreshed.accessToken;
      expiresIn = refreshed.expiresIn;
      continue;
    }
    const code = await errorCodeOf(res);
    if (!retryableHome(res.status, code) || attempt >= HOME_ATTEMPTS) {
      throw new BootError(`GET /v1/me/home: ${res.status}${code ? ` ${code}` : ''}`, res.status, code);
    }
    o.onStatus?.(res.status === 429 ? `Orbit is busy, retrying (${attempt}/${HOME_ATTEMPTS - 1})…` : `Home planet is starting, retrying (${attempt}/${HOME_ATTEMPTS - 1})…`);
    await (o.wait ?? realWait)(backoffDelay(attempt, o.random ?? Math.random));
  }
}

const HOME_STATE_TEXT: Record<string, string> = {
  NEW: 'No colony was seated for this player',
  QUEUED: 'Waiting in the planet queue',
  ELIMINATED: 'Your colony was eliminated',
  PLANET_ENDED: 'This planet has ended',
};

/**
 * The `/me/home` answer, checked against the contract (`HomeResponse`). Only an `ACTIVE` home boots a colony; any other
 * state (`NEW` with its `newPlanetTypes`, `QUEUED`, `ELIMINATED`, `PLANET_ENDED`) is a `BootError` naming it, never a
 * made-up colony on a default planet.
 */
function normalizeHomePayload(raw: unknown): { state: string; planet: BootPlanetSummary; colony: BootColonySummary } {
  const parsed = HomeResponse.safeParse(raw);
  if (!parsed.success) throw new BootError('GET /v1/me/home: unexpected answer', 200, 'BAD_HOME');
  const home = parsed.data;
  if (home.state !== 'ACTIVE') {
    const types = 'newPlanetTypes' in home ? ` (new colonies: ${home.newPlanetTypes.join(', ')})` : '';
    throw new BootError(`${HOME_STATE_TEXT[home.state]}${types}`, 200, `HOME_${home.state}`);
  }
  const { planet: p, colony: c } = home;
  const spawn = { q: c.spawnQ ?? 0, r: c.spawnR ?? 0 };
  return {
    state: home.state,
    planet: { id: p.id, name: p.name, type: p.type, seed: p.seed, radius: p.radius, state: p.state },
    colony: { id: c.id, colonyIndex: c.colonyIndex ?? 0, name: c.name, color: c.color, state: c.state, spawnQ: spawn.q, spawnR: spawn.r, spawn },
  };
}

/**
 * Graceful local fallback when no backend server is running (dev builds, FA-06): an in-process `LocalHost` (the
 * `LocalHostCore` of `?host=local`, run on the page) on `pl_dev` (`DEV_PLANET_TYPE` = desert, `DEV_PLANET_SEED`,
 * `DEV_PLANET_RADIUS`) with colony 0 seated at the first spawn slot by `system.spawnColony` (a `local.reset` or a
 * restore after a failed step seats it again).
 */
export function createLocalBootFallback(
  deviceSecret: string,
  onStatus?: (status: string) => void,
  spawnOverride?: { q: number; r: number },
  planetType: DevPlanetType = DEV_PLANET_TYPE,
): BootAuthResult {
  const planetId = devPlanetIdFor(planetType, 1); // same dev planet family as the server (pl_dev = desert)
  onStatus?.(`Entering orbit: ${planetId}…`);
  const make = () => createPlanet({
    id: planetId,
    planetId,
    type: planetType,
    planetType,
    seed: DEV_PLANET_SEED,
    radius: DEV_PLANET_RADIUS,
    capacity: DEV_PLANET_CAPACITY,
  });
  let first: PlanetState | null = make(); // generated once for the slot pick and the first seed
  const slot = spawnOverride ?? getSpawnSlots(first)[0] ?? { q: 0, r: 0 };
  const flags = ['W00', 'W01'];
  const fresh = (): PlanetState => { const p = first ?? make(); first = null; return p; };
  const source = builtPlanetSource(planetId, flags, fresh, (host) => {
    host.submit({
      colonyIndex: 0,
      source: 'system',
      commandId: 'cm_boot_spawn',
      kind: 'system.spawnColony',
      args: { colonyId: 'col_0', colonyIndex: 0, name: "Colonist's Colony", q: slot.q, r: slot.r },
    });
    host.step(1);
  });
  const localHost = new LocalHost({ flags, source });

  return {
    mode: 'local',
    accessToken: `local:${deviceSecret.slice(0, 16)}`,
    deviceSecret,
    playerId: 'pr_local',
    handle: 'Colonist',
    isGuest: true,
    state: 'ACTIVE',
    planet: {
      id: planetId,
      name: 'Dev Planet',
      type: planetType,
      seed: DEV_PLANET_SEED,
      radius: DEV_PLANET_RADIUS,
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

/** `accountId` on an auth JSON (social). Guest login omits it. */
function readAccountId(auth: object): string | undefined {
  const id = (auth as { accountId?: unknown }).accountId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** The orbit pick as a dev planet type (seats a NEW colony on that family); no pick → `undefined` (server default). */
export const devPlanetTypeOfKind = (kind: PlanetKind | null | undefined): DevPlanetType | undefined => (kind ? planetTypeForKind(kind) : undefined);

/**
 * Runs W01 guest authentication (`POST /v1/auth/guest` / `POST /v1/auth/refresh`) and `GET /v1/me/home` (`CL-01`).
 * `?host=local` always runs a local `SimHost` on `pl_dev`; an unreachable server does so only where
 * `allowLocalFallback` (dev builds); every other failure throws (`BootError` for HTTP and network failures).
 */
export async function bootAuthAndHome(opts: BootAuthOptions = {}): Promise<BootAuthResult> {
  const storage = opts.storage ?? defaultStorage();
  const doFetch = reachable(opts.fetch ?? ((u, i) => fetch(u, i)));
  const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');

  opts.onStatus?.('Contacting orbit…');
  const deviceSecret = getOrCreateDeviceSecret(storage, deviceSecretKey(search));

  if (new URLSearchParams(search).get('host') === 'local') {
    return createLocalBootFallback(deviceSecret, opts.onStatus, undefined, opts.planetType);
  }

  try {
    const auth = opts.tryRefresh ? await refreshOrGuest(deviceSecret, doFetch) : await guestLogin(deviceSecret, doFetch);
    const { accessToken, expiresIn, home } = await fetchHomeWithRetry(auth.accessToken, {
      deviceSecret, doFetch, planetType: opts.planetType, wait: opts.wait, random: opts.random, onStatus: opts.onStatus,
    });
    const { state, planet, colony } = normalizeHomePayload(home);
    opts.onStatus?.(`Entering orbit: ${planet.id}…`);

    return {
      mode: 'online',
      accessToken,
      tokenExpiresInS: expiresIn ?? auth.expiresIn,
      deviceSecret,
      playerId: auth.player?.id ?? 'pr_guest',
      handle: auth.player?.handle ?? 'Colonist',
      isGuest: auth.player?.isGuest !== false,
      accountId: readAccountId(auth),
      state,
      planet,
      colony,
    };
  } catch (e) {
    if ((opts.allowLocalFallback ?? import.meta.env.DEV) && backendUnreachable(e)) {
      return createLocalBootFallback(deviceSecret, opts.onStatus, undefined, opts.planetType);
    }
    throw e;
  }
}
