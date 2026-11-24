import type { ColonySlotAllowance } from '@terra/contracts';
import { isProductionBuild } from '@terra/render/ui/buildEnv';
import { refreshPilotSession } from './PilotAccess';

export type ActivePlanetKind = 'dune' | 'oceanForest' | 'forestRock';
export type ActivePlanetType = 'desert' | 'ocean' | 'temperate';

export interface ActiveHomeColony {
  readonly kind: ActivePlanetKind;
  readonly planetType: ActivePlanetType;
  readonly planetId: string;
  readonly planetName: string;
  readonly colonyId: string;
  readonly colonyName: string;
  readonly foundingSectorId?: string;
}

export interface PilotColonyRoster {
  readonly primary: ActiveHomeColony | null;
  readonly colonies: readonly ActiveHomeColony[];
  readonly slots: ColonySlotAllowance;
}

const PLANET_TYPE_TO_KIND: Readonly<Record<string, ActivePlanetKind>> = {
  desert: 'dune',
  ocean: 'oceanForest',
  temperate: 'forestRock',
};

export function kindOfPlanetType(type: string): ActivePlanetKind | null {
  return PLANET_TYPE_TO_KIND[type] ?? null;
}

export function defaultSingleSlotAllowance(used: number): ColonySlotAllowance {
  return {
    used,
    max: Math.max(1, used),
    aiColonySlots: 0,
    tier: 0,
    tierName: 'Free Cadet',
    stakedNear: '0',
    isStaker: false,
  };
}

export function canFoundAnotherColony(roster: PilotColonyRoster | null | undefined): boolean {
  if (!roster || roster.colonies.length === 0) return true;
  return roster.slots.isStaker && roster.colonies.length < roster.slots.max;
}

export function rosterFromSingleActiveColony(active: ActiveHomeColony | null): PilotColonyRoster | null {
  if (!active) return null;
  return {
    primary: active,
    colonies: [active],
    slots: defaultSingleSlotAllowance(1),
  };
}

const DEVICE_SECRET_KEY = 'ta_device_secret';

function readExistingDeviceSecret(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  search: string,
  dev: boolean,
): string | null {
  if (!storage) return null;
  try {
    const as = dev ? new URLSearchParams(search).get('as')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) : '';
    const key = as ? `${DEVICE_SECRET_KEY}:${as}` : DEVICE_SECRET_KEY;
    const raw = storage.getItem(key);
    return raw && raw.length >= 16 ? raw : null;
  } catch {
    return null;
  }
}

function readStoredPilotBearer(storage: Pick<Storage, 'getItem'> | null | undefined): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem('ta_active_pilot');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accessToken?: unknown };
    const tok = typeof parsed.accessToken === 'string' ? parsed.accessToken.trim() : '';
    if (
      !tok ||
      tok === 'local-mode-token' ||
      tok.startsWith('ta_mock_') ||
      tok.startsWith('near:') ||
      tok.startsWith('dev:') ||
      tok.startsWith('player:')
    ) {
      return null;
    }
    return tok;
  } catch {
    return null;
  }
}

function readDevOverrideToken(search: string, dev: boolean): string | null {
  if (!dev || !search) return null;
  try {
    const params = new URLSearchParams(search);
    const pid = params.get('playerId')?.trim();
    if (pid) return `player:${pid}`;
    const as = params.get('as')?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (as) return `dev:${as}`;
  } catch {
    /* ignore malformed query */
  }
  return null;
}

export interface ProbeActiveColonyOptions {
  readonly fetch?: typeof fetch;
  readonly storage?: Pick<Storage, 'getItem'> | null;
  readonly search?: string;
  readonly dev?: boolean;
}

interface RawColonyItem {
  readonly id?: string;
  readonly name?: string;
  readonly foundingSectorId?: unknown;
}

interface RawPlanetItem {
  readonly id?: string;
  readonly name?: string;
  readonly type?: string;
}

function mapRawActiveColony(
  colony: RawColonyItem | undefined,
  planet: RawPlanetItem | undefined,
  fallbackSector?: unknown,
): ActiveHomeColony | null {
  if (!colony || !planet) return null;
  const kind = kindOfPlanetType(planet.type ?? '');
  if (!kind) return null;
  const rawSector =
    typeof colony.foundingSectorId === 'string' && colony.foundingSectorId.trim().length > 0
      ? colony.foundingSectorId.trim()
      : typeof fallbackSector === 'string' && fallbackSector.trim().length > 0
        ? fallbackSector.trim()
        : undefined;
  return {
    kind,
    planetType: planet.type as ActivePlanetType,
    planetId: String(planet.id ?? ''),
    planetName: String(planet.name ?? kind),
    colonyId: String(colony.id ?? ''),
    colonyName: String(colony.name ?? 'Colony'),
    ...(rawSector ? { foundingSectorId: rawSector } : {}),
  };
}

/**
 * Resolves the caller's full active colony roster + NEAR.AI staking slot allowance via `GET /v1/me/home?resolve=1`
 * without creating a new guest secret or founding a colony.
 */
export async function probePilotColonyRoster(
  opts: ProbeActiveColonyOptions = {},
): Promise<PilotColonyRoster | null> {
  const doFetch = opts.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!doFetch) return null;
  const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
  const dev = opts.dev ?? (!isProductionBuild() && Boolean(import.meta.env?.DEV));
  const storage = opts.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.storage;

  try {
    let token = readDevOverrideToken(search, dev) ?? '';
    if (!token) {
      const refreshed = await refreshPilotSession(doFetch, !opts.fetch);
      if (refreshed?.accessToken) {
        token = refreshed.accessToken;
      } else {
        token = readStoredPilotBearer(storage) ?? '';
      }
    }
    if (!token) {
      const secret = readExistingDeviceSecret(storage, search, dev);
      if (secret) {
        const res = await doFetch('/v1/auth/guest', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceSecret: secret }),
        });
        if (res.ok) {
          const auth = (await res.json()) as { accessToken?: string };
          if (auth?.accessToken) token = auth.accessToken;
        }
      }
    }
    if (!token) return null;

    const homeRes = await doFetch('/v1/me/home?resolve=1', {
      method: 'GET',
      credentials: 'include',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!homeRes.ok) return null;
    const body = (await homeRes.json()) as {
      state?: string;
      foundingSectorId?: unknown;
      colony?: RawColonyItem;
      planet?: RawPlanetItem;
      colonySlots?: ColonySlotAllowance;
      activeColonies?: ReadonlyArray<{ colony?: RawColonyItem; planet?: RawPlanetItem }>;
    };

    const primary =
      body?.state === 'ACTIVE'
        ? mapRawActiveColony(body.colony, body.planet, body.foundingSectorId)
        : null;
    const listFromRoster = Array.isArray(body?.activeColonies)
      ? body.activeColonies
          .map((e) => mapRawActiveColony(e.colony, e.planet))
          .filter((x): x is ActiveHomeColony => x !== null)
      : [];
    const colonies =
      listFromRoster.length > 0 ? listFromRoster : primary ? [primary] : [];

    const slots = body?.colonySlots ?? defaultSingleSlotAllowance(colonies.length);
    if (colonies.length === 0 && !slots.isStaker) return null;
    return {
      primary: primary ?? colonies[0] ?? null,
      colonies,
      slots,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the caller's existing primary ACTIVE home colony (if any) via `GET /v1/me/home?resolve=1`.
 */
export async function probeActiveHomeColony(
  opts: ProbeActiveColonyOptions = {},
): Promise<ActiveHomeColony | null> {
  const roster = await probePilotColonyRoster(opts);
  return roster?.primary ?? null;
}
